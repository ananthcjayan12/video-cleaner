import { useEffect, useMemo, useRef, useState } from 'react';
import { CJCutEditor, type CJCutClip, type CJCutProject, type CJCutTrack } from '@cjcut/editor';
import { api, type BrollDisplayTemplate, type BrollPlan, type BrollScene, type Edl, type Project, type Word } from './api';

type Props = {
  project: Project;
  words: Word[];
  edl: Edl | null;
  broll: BrollPlan | null;
};

type TimelineSegment = { sourceStart: number; sourceEnd: number; timelineStart: number; timelineEnd: number };

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

function hasCurrentVideo(scene: BrollScene) {
  if (!scene.videoFile || scene.videoStatus === 'stale' || scene.imageStatus === 'generating' || scene.imageStatus === 'failed') return false;
  const imageRevision = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
  return scene.videoSourceImageRevision === undefined || scene.videoSourceImageRevision === imageRevision;
}

function cleanedSegments(words: Word[], edl: Edl | null, duration: number): TimelineSegment[] {
  if (!words.length || !edl?.keepRanges?.length) return [{ sourceStart: 0, sourceEnd: duration, timelineStart: 0, timelineEnd: duration }];
  const index = new Map(words.map((word, i) => [word.id, i]));
  const source = edl.keepRanges.flatMap((range) => {
    const startIndex = index.get(range.startWordId); const endIndex = index.get(range.endWordId);
    if (startIndex === undefined || endIndex === undefined || startIndex > endIndex) return [];
    return [{ sourceStart: words[startIndex].start, sourceEnd: words[endIndex].end }];
  }).sort((a, b) => a.sourceStart - b.sourceStart);
  let cursor = 0;
  return source.map((segment) => {
    const length = Math.max(0, segment.sourceEnd - segment.sourceStart);
    const result = { ...segment, timelineStart: cursor, timelineEnd: cursor + length };
    cursor += length;
    return result;
  });
}

function sourceToTimeline(time: number, segments: TimelineSegment[]) {
  for (const segment of segments) {
    if (time >= segment.sourceStart - 0.001 && time <= segment.sourceEnd + 0.001) {
      return segment.timelineStart + Math.max(0, Math.min(segment.sourceEnd, time) - segment.sourceStart);
    }
  }
  const before = [...segments].reverse().find((segment) => segment.sourceEnd < time);
  if (before) return before.timelineEnd;
  return Math.max(0, time);
}

function layoutTransform(layout: BrollDisplayTemplate | undefined) {
  switch (layout) {
    case 'picture-in-picture': return { x: 78, y: 25, scale: 0.34 };
    case 'top-card':
    case 'top-card-presenter': return { x: 50, y: 25, scale: 0.48 };
    case 'split-top':
    case 'stacked-talking-top': return { x: 50, y: 74, scale: 0.5 };
    case 'stacked-broll-top': return { x: 50, y: 26, scale: 0.5 };
    case 'presenter-overlay':
    case 'stacked-cards-cutout': return { x: 50, y: 50, scale: 1 };
    default: return { x: 50, y: 50, scale: 1 };
  }
}

function freshProject(project: Project, words: Word[], edl: Edl | null, broll: BrollPlan | null): CJCutProject {
  const width = project.media.width || 1080;
  const height = project.media.height || 1920;
  const fps = project.media.frameRate || 30;
  const useCleaned = Boolean(edl?.keepRanges?.length);
  const segments = cleanedSegments(words, useCleaned ? edl : null, project.media.duration);
  const duration = Math.max(0.1, segments.at(-1)?.timelineEnd || project.media.duration || 30);
  const sourceClips = project.clips?.length ? project.clips : [{
    id: '__base_video__',
    sourceName: project.sourceName,
    duration: project.media.duration,
    timelineStart: 0,
    timelineEnd: project.media.duration,
  }];
  const baseClips: CJCutClip[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    for (const sourceClip of sourceClips) {
      const intersectionStart = Math.max(segment.sourceStart, sourceClip.timelineStart);
      const intersectionEnd = Math.min(segment.sourceEnd, sourceClip.timelineEnd);
      if (intersectionEnd <= intersectionStart + 0.001) continue;
      const externalId = `vc-base-${sourceClip.id}-${segmentIndex}`;
      baseClips.push({
        id: externalId,
        externalId,
        role: 'base',
        trackId: 'vc-base',
        type: 'video',
        name: sourceClips.length > 1 ? sourceClip.sourceName : 'Talking head',
        url: sourceClip.id === '__base_video__'
          ? api.editorBaseVideoUrl(project.id, project.updatedAt)
          : api.editorBaseClipUrl(project.id, sourceClip.id, project.updatedAt),
        start: segment.timelineStart + (intersectionStart - segment.sourceStart),
        duration: Math.max(0.05, intersectionEnd - intersectionStart),
        sourceStart: Math.max(0, intersectionStart - sourceClip.timelineStart),
        sourceDuration: sourceClip.duration,
        x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1,
        metadata: {
          sourceClipId: sourceClip.id,
          sourceStart: intersectionStart,
          sourceEnd: intersectionEnd,
          managed: true,
        },
      });
    }
  }
  const baseTrack: CJCutTrack = {
    id: 'vc-base',
    externalId: 'vc-base',
    role: 'base',
    name: 'Talking head',
    type: 'video',
    visible: true,
    locked: false,
    clips: baseClips,
  };

  const brollTracks: CJCutTrack[] = [];
  for (const scene of broll?.scenes ?? []) {
    if (!scene.enabled || scene.imageStatus === 'generating' || scene.imageStatus === 'failed') continue;
    const useVideo = hasCurrentVideo(scene);
    const hasImage = Boolean(scene.imageFile);
    if (!useVideo && !hasImage) continue;
    const start = useCleaned ? sourceToTimeline(scene.sourceStart, segments) : scene.sourceStart;
    const end = useCleaned ? sourceToTimeline(scene.sourceEnd, segments) : scene.sourceEnd;
    const clipDuration = Math.max(0.15, end - start);
    const layout = scene.displayTemplate ?? broll?.settings.displayTemplate;
    const transform = layoutTransform(layout);
    const type = useVideo ? 'video' : 'image';
    const url = useVideo
      ? api.brollVideoUrl(project.id, scene.id, scene.videoGeneratedAt)
      : api.brollImageUrl(project.id, scene.id, scene.generatedAt);
    brollTracks.push({
      id: `vc-broll-track-${scene.id}`,
      externalId: scene.id,
      role: 'broll',
      name: `B-roll · ${scene.title}`,
      type,
      visible: true,
      locked: false,
      clips: [{
        id: `vc-broll-${scene.id}`,
        externalId: scene.id,
        role: 'broll',
        trackId: `vc-broll-track-${scene.id}`,
        type,
        name: scene.title,
        url,
        start,
        duration: clipDuration,
        sourceStart: 0,
        sourceDuration: clipDuration,
        x: transform.x, y: transform.y, scale: transform.scale, rotation: 0, opacity: 1, volume: 0, speed: 1,
        metadata: {
          managed: true,
          sceneId: scene.id,
          assetKind: type,
          assetVersion: useVideo ? (scene.videoGeneratedAt || '') : (scene.generatedAt || ''),
          layout: layout || 'full-frame',
        },
      }],
    });
  }

  return {
    name: `${project.name} · Live edit`,
    width,
    height,
    fps,
    duration: Math.max(duration, ...brollTracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)), 1),
    tracks: [...brollTracks, baseTrack],
  };
}

function reconcileSaved(saved: CJCutProject | null, fresh: CJCutProject): CJCutProject {
  if (!saved?.tracks?.length) return fresh;
  const freshTracksByExternal = new Map(fresh.tracks.filter((track) => track.externalId).map((track) => [track.externalId!, track]));
  const freshClipsByExternal = new Map(fresh.tracks.flatMap((track) => track.clips).filter((clip) => clip.externalId).map((clip) => [clip.externalId!, clip]));
  const seenTracks = new Set<string>();

  const tracks: CJCutTrack[] = saved.tracks.flatMap((track) => {
    if (!track.externalId) return [clone(track)];
    const currentTrack = freshTracksByExternal.get(track.externalId);
    if (!currentTrack) return [];
    seenTracks.add(track.externalId);
    const clips = track.clips.flatMap((clip) => {
      if (!clip.externalId) return [clone(clip)];
      const current = freshClipsByExternal.get(clip.externalId);
      if (!current) return [];
      return [{ ...clone(clip), trackId: track.id, type: current.type, url: current.url, sourceDuration: current.sourceDuration, metadata: current.metadata }];
    });
    return [{ ...clone(track), type: currentTrack.type, role: currentTrack.role, clips }];
  });

  for (const track of fresh.tracks) {
    if (track.externalId && !seenTracks.has(track.externalId)) tracks.push(clone(track));
  }
  const duration = Math.max(fresh.duration, ...tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)), 1);
  return { ...clone(saved), name: fresh.name, width: fresh.width, height: fresh.height, fps: fresh.fps, duration, tracks };
}

export default function LiveEditor({ project, words, edl, broll }: Props) {
  const [editorProject, setEditorProject] = useState<CJCutProject | null>(null);
  const [status, setStatus] = useState('Preparing live editor…');
  const [error, setError] = useState('');
  const saveTimer = useRef<number | null>(null);

  const seed = useMemo(() => freshProject(project, words, edl, broll), [project, words, edl, broll]);
  const seedKey = useMemo(() => JSON.stringify({
    project: project.id,
    updatedAt: project.updatedAt,
    broll: (broll?.scenes ?? []).map((scene) => [scene.id, scene.enabled, scene.generatedAt, scene.videoGeneratedAt, scene.imageStatus, scene.videoStatus]),
  }), [project.id, project.updatedAt, broll]);

  useEffect(() => {
    let cancelled = false;
    setStatus('Loading saved edit…'); setError('');
    void api.getEditorProject<CJCutProject>(project.id).then(({ project: saved }) => {
      if (cancelled) return;
      setEditorProject(reconcileSaved(saved, seed));
      setStatus(saved ? 'Live editor restored and refreshed from current project assets.' : 'Live editor created from the current project stage.');
    }).catch((err) => {
      if (cancelled) return;
      setEditorProject(seed);
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [project.id, seedKey]);

  useEffect(() => () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); }, []);

  function handleChange(next: CJCutProject) {
    setEditorProject(next);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api.saveEditorProject(project.id, next).then(() => setStatus('Editor changes autosaved ✓')).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 700);
  }

  async function saveNow(next: CJCutProject) {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    try {
      await api.saveEditorProject(project.id, next);
      setStatus('Editor project saved ✓'); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  if (!editorProject) return <section className="panel liveEditorLoading"><strong>Preparing live editor…</strong><span>{status}</span></section>;

  return <section className="liveEditorTab">
    <div className="liveEditorInfo panel">
      <div><span className="label">LIVE PROJECT PREVIEW</span><strong>Current stage → editable CJCut timeline</strong><small>Talking head is the base layer. Every available B-roll is a separate editable layer; video is preferred, otherwise the generated image is used. Move, trim, split, hide or delete clips without changing CJCut itself.</small></div>
      <div><span>{status}</span>{error && <strong>{error}</strong>}</div>
    </div>
    <div className="liveEditorHost">
      <CJCutEditor
        initialProject={editorProject}
        projectKey={seedKey}
        embedded
        brandName="Video Cleaner · CJCut"
        allowMediaImport={false}
        onProjectChange={handleChange}
        onSave={saveNow}
      />
    </div>
  </section>;
}
