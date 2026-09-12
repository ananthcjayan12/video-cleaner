import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Timeline, type TimelineState } from '@xzdarcy/react-timeline-editor';
import type { Edl, KeepRange, Word } from './api';
import './timeline-editor.css';

type TimelineEditorPanelProps = {
  duration: number;
  fps?: number;
  words: Word[];
  edl: Edl;
  videoRef: RefObject<HTMLVideoElement | null>;
  disabled?: boolean;
  onSave: (ranges: KeepRange[]) => Promise<void>;
  onNotice?: (message: string) => void;
};

type ClipInfo = {
  id: string;
  index: number;
  start: number;
  end: number;
  range: KeepRange;
};

const MIN_CLIP_SECONDS = 0.08;

function cloneRanges(ranges: KeepRange[]) {
  return ranges.map((range) => ({ ...range }));
}

function wordRangeSeconds(range: KeepRange, words: Word[], duration: number) {
  if (Number.isFinite(range.sourceStart) && Number.isFinite(range.sourceEnd)) {
    return { start: Math.max(0, Number(range.sourceStart)), end: Math.min(duration, Number(range.sourceEnd)) };
  }
  if (!range.startWordId || !range.endWordId) return null;
  const index = new Map(words.map((word, i) => [word.id, i]));
  const startIndex = index.get(range.startWordId); const endIndex = index.get(range.endWordId);
  if (startIndex === undefined || endIndex === undefined) return null;
  const startWord = words[startIndex]; const endWord = words[endIndex];
  const previousRemovedWord = startIndex > 0 ? words[startIndex - 1] : undefined;
  const nextRemovedWord = endIndex < words.length - 1 ? words[endIndex + 1] : undefined;
  const paddedStart = Math.max(0, startWord.start - 0.08);
  const paddedEnd = Math.min(duration, endWord.end + 0.12);
  return {
    start: previousRemovedWord ? Math.max(paddedStart, Math.min(startWord.start, previousRemovedWord.end + 0.01)) : paddedStart,
    end: nextRemovedWord ? Math.min(paddedEnd, Math.max(endWord.end, nextRemovedWord.start - 0.01)) : paddedEnd,
  };
}

function wordIdsForRange(start: number, end: number, words: Word[]) {
  const overlapping = words.filter((word) => word.end > start && word.start < end);
  return overlapping.length ? { startWordId: overlapping[0].id, endWordId: overlapping.at(-1)!.id } : {};
}

function preciseRange(start: number, end: number, words: Word[], reason: string): KeepRange {
  return { ...wordIdsForRange(start, end, words), sourceStart: start, sourceEnd: end, reason };
}

function timeLabel(seconds: number) {
  const safe = Math.max(0, seconds || 0); const minutes = Math.floor(safe / 60); const secs = Math.floor(safe % 60); const frames = Math.floor((safe % 1) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

export default function TimelineEditorPanel({ duration, fps = 30, words, edl, videoRef, disabled, onSave, onNotice }: TimelineEditorPanelProps) {
  const timelineRef = useRef<TimelineState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(92);
  const [currentTime, setCurrentTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<KeepRange[][]>([]);
  const [redoStack, setRedoStack] = useState<KeepRange[][]>([]);

  const clips = useMemo<ClipInfo[]>(() => edl.keepRanges.map((range, index) => {
    const seconds = wordRangeSeconds(range, words, duration) ?? { start: 0, end: 0 };
    return { id: `clip-${index}`, index, start: seconds.start, end: seconds.end, range };
  }).filter((clip) => clip.end > clip.start), [edl.keepRanges, words, duration]);

  useEffect(() => {
    if (selectedId && !clips.some((clip) => clip.id === selectedId)) setSelectedId(clips[0]?.id ?? null);
    if (!selectedId && clips.length) setSelectedId(clips[0].id);
  }, [clips, selectedId]);

  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const sync = () => {
      const time = video.currentTime || 0; setCurrentTime(time);
      if (Math.abs((timelineRef.current?.getTime() ?? 0) - time) > 0.02) timelineRef.current?.setTime(time);
    };
    sync(); video.addEventListener('timeupdate', sync); video.addEventListener('seeked', sync); video.addEventListener('loadedmetadata', sync);
    return () => { video.removeEventListener('timeupdate', sync); video.removeEventListener('seeked', sync); video.removeEventListener('loadedmetadata', sync); };
  }, [videoRef]);

  const selected = clips.find((clip) => clip.id === selectedId) ?? null;

  function seek(time: number) {
    const next = Math.max(0, Math.min(duration, time));
    setCurrentTime(next); timelineRef.current?.setTime(next);
    if (videoRef.current) videoRef.current.currentTime = next;
  }

  async function commit(next: KeepRange[], message: string, recordHistory = true) {
    if (disabled || saving || !next.length) return;
    setSaving(true);
    try {
      if (recordHistory) { setUndoStack((stack) => [...stack.slice(-49), cloneRanges(edl.keepRanges)]); setRedoStack([]); }
      await onSave(next); onNotice?.(message);
    } finally { setSaving(false); }
  }

  async function splitAtPlayhead() {
    const time = videoRef.current?.currentTime ?? timelineRef.current?.getTime() ?? currentTime;
    const clip = clips.find((item) => time > item.start + MIN_CLIP_SECONDS && time < item.end - MIN_CLIP_SECONDS);
    if (!clip) return void onNotice?.('Move the playhead inside a kept clip before splitting.');
    const next = cloneRanges(edl.keepRanges);
    next.splice(clip.index, 1,
      preciseRange(clip.start, time, words, 'Timeline split'),
      preciseRange(time, clip.end, words, 'Timeline split'),
    );
    await commit(next, `Split clip at ${timeLabel(time)} ✓`);
    setSelectedId(`clip-${clip.index + 1}`);
  }

  async function deleteSelected() {
    if (!selected) return void onNotice?.('Select a clip to delete.');
    if (edl.keepRanges.length <= 1) return void onNotice?.('The timeline cannot remove the entire video.');
    const next = cloneRanges(edl.keepRanges); next.splice(selected.index, 1);
    await commit(next, 'Selected clip deleted from the final timeline ✓');
    setSelectedId(`clip-${Math.max(0, selected.index - 1)}`);
  }

  async function trimSelected(side: 'start' | 'end') {
    if (!selected) return void onNotice?.('Select a clip before trimming.');
    const time = videoRef.current?.currentTime ?? currentTime;
    if (side === 'start' && !(time >= selected.start && time < selected.end - MIN_CLIP_SECONDS)) return void onNotice?.('Playhead must be inside the selected clip to set its start.');
    if (side === 'end' && !(time > selected.start + MIN_CLIP_SECONDS && time <= selected.end)) return void onNotice?.('Playhead must be inside the selected clip to set its end.');
    const start = side === 'start' ? time : selected.start; const end = side === 'end' ? time : selected.end;
    const next = cloneRanges(edl.keepRanges); next[selected.index] = preciseRange(start, end, words, `Timeline trim ${side}`);
    await commit(next, `Trimmed selected clip ${side} to playhead ✓`);
  }

  async function resizeClip(actionId: string, start: number, end: number) {
    const clip = clips.find((item) => item.id === actionId); if (!clip || saving) return;
    const previous = clips[clip.index - 1]; const nextClip = clips[clip.index + 1];
    const safeStart = Math.max(previous?.end ?? 0, Math.min(start, end - MIN_CLIP_SECONDS));
    const safeEnd = Math.min(nextClip?.start ?? duration, Math.max(end, safeStart + MIN_CLIP_SECONDS));
    const next = cloneRanges(edl.keepRanges); next[clip.index] = preciseRange(safeStart, safeEnd, words, 'Timeline trim');
    await commit(next, 'Timeline trim saved ✓');
  }

  async function undo() {
    const previous = undoStack.at(-1); if (!previous || saving) return;
    setUndoStack((stack) => stack.slice(0, -1)); setRedoStack((stack) => [...stack, cloneRanges(edl.keepRanges)]);
    await commit(cloneRanges(previous), 'Undo ✓', false);
  }

  async function redo() {
    const next = redoStack.at(-1); if (!next || saving) return;
    setRedoStack((stack) => stack.slice(0, -1)); setUndoStack((stack) => [...stack, cloneRanges(edl.keepRanges)]);
    await commit(cloneRanges(next), 'Redo ✓', false);
  }

  function togglePlayback() {
    const video = videoRef.current; if (!video) return;
    if (video.paused) void video.play(); else video.pause();
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || disabled) return;
      const command = event.metaKey || event.ctrlKey;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); return; }
      if ((!command && event.key.toLowerCase() === 's') || (command && event.key.toLowerCase() === 'b')) { event.preventDefault(); void splitAtPlayhead(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void deleteSelected(); return; }
      if (command && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); void undo(); return; }
      if ((command && event.key.toLowerCase() === 'z' && event.shiftKey) || (event.ctrlKey && event.key.toLowerCase() === 'y')) { event.preventDefault(); void redo(); return; }
      if (event.key === '[') { event.preventDefault(); void trimSelected('start'); return; }
      if (event.key === ']') { event.preventDefault(); void trimSelected('end'); return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); const direction = event.key === 'ArrowLeft' ? -1 : 1; const amount = event.shiftKey ? 1 : 1 / Math.max(1, fps); seek((videoRef.current?.currentTime ?? currentTime) + direction * amount); return;
      }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((value) => Math.min(220, value + 12)); return; }
      if (event.key === '-') { event.preventDefault(); setZoom((value) => Math.max(42, value - 12)); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });

  const editorData = useMemo(() => [{
    id: 'video-track',
    actions: clips.map((clip) => ({
      id: clip.id, start: clip.start, end: clip.end, effectId: 'video', selected: clip.id === selectedId,
      movable: false, flexible: true, minStart: clips[clip.index - 1]?.end ?? 0, maxEnd: clips[clip.index + 1]?.start ?? duration,
    })),
  }], [clips, selectedId, duration]);

  const effects = useMemo(() => ({ video: { id: 'video', name: 'Video' } }), []);

  return <section className="panel capcutTimelinePanel">
    <div className="timelineTopbar">
      <div><span className="label">PRE-RENDER EDITOR</span><h3>Timeline</h3><small>Non-destructive cuts · final render uses this exact EDL</small></div>
      <div className="timelineTimecode">{timeLabel(currentTime)}</div>
    </div>

    <div className="timelineToolbar">
      <button onClick={togglePlayback} disabled={disabled}>▶︎ / ❚❚ <kbd>Space</kbd></button>
      <button onClick={() => void splitAtPlayhead()} disabled={disabled || saving}>Split <kbd>S</kbd><kbd>⌘B</kbd></button>
      <button onClick={() => void deleteSelected()} disabled={disabled || saving || !selected}>Delete <kbd>⌫</kbd></button>
      <button onClick={() => void trimSelected('start')} disabled={disabled || saving || !selected}>Set in <kbd>[</kbd></button>
      <button onClick={() => void trimSelected('end')} disabled={disabled || saving || !selected}>Set out <kbd>]</kbd></button>
      <span className="timelineToolbarSpacer" />
      <button onClick={() => void undo()} disabled={disabled || saving || !undoStack.length}>Undo <kbd>⌘Z</kbd></button>
      <button onClick={() => void redo()} disabled={disabled || saving || !redoStack.length}>Redo <kbd>⇧⌘Z</kbd></button>
      <label className="timelineZoom">Zoom<input type="range" min="42" max="220" step="6" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
    </div>

    <div className="timelineTrackLabels"><span>V1</span><strong>{selected ? `Clip ${selected.index + 1} · ${(selected.end - selected.start).toFixed(2)}s` : 'Select a clip'}</strong><small>Arrow keys = 1 frame · Shift+Arrow = 1 sec</small></div>
    <div className="timelineLibrarySurface">
      <Timeline
        ref={timelineRef}
        editorData={editorData as any}
        effects={effects as any}
        scale={1}
        scaleWidth={zoom}
        scaleSplitCount={Math.max(2, Math.min(10, Math.round(fps / 6)))}
        minScaleCount={Math.max(10, Math.ceil(duration))}
        maxScaleCount={Math.max(10, Math.ceil(duration) + 1)}
        rowHeight={58}
        gridSnap
        dragLine
        autoScroll
        onClickTimeArea={(time) => { seek(time); return true; }}
        onCursorDrag={(time) => seek(time)}
        onCursorDragEnd={(time) => seek(time)}
        onClickActionOnly={(_event, { action, time }) => { setSelectedId(action.id); seek(time); }}
        onActionResizeEnd={({ action, start, end }) => { void resizeClip(action.id, start, end); }}
        getActionRender={(action: any) => {
          const clip = clips.find((item) => item.id === action.id);
          return <div className={`timelineClipBody ${action.selected ? 'selected' : ''}`}><strong>{clip ? `Clip ${clip.index + 1}` : 'Clip'}</strong><span>{Math.max(0, action.end - action.start).toFixed(2)}s</span></div>;
        }}
        style={{ width: '100%', height: 116 }}
      />
    </div>
    <div className="timelineShortcutHint"><span><kbd>S</kbd> split</span><span><kbd>Delete</kbd> remove clip</span><span><kbd>[</kbd>/<kbd>]</kbd> trim to playhead</span><span><kbd>Space</kbd> play/pause</span><span><kbd>⌘Z</kbd>/<kbd>⇧⌘Z</kbd> undo/redo</span><span><kbd>+/-</kbd> zoom</span></div>
  </section>;
}
