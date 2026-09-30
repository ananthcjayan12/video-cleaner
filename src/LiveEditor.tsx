import { useEffect, useMemo, useRef, useState } from 'react';
import { CJCutEditor, type CJCutMediaAsset, type CJCutProject } from '@cjcut/editor';
import { api, uploadEditorMedia, type EditorMediaEntry, type BrollPlan, type Edl, type ExportStatus, type MotionPlan, type Project, type Word } from './api';
import { brollSourceDuration, clone, freshProject, hasCurrentVideo, reconcileSaved, usableMotion } from './editor-timeline';

type Props = {
  project: Project;
  words: Word[];
  edl: Edl | null;
  broll: BrollPlan | null;
  exportVideo: (timeline: CJCutProject) => Promise<void>;
  exportJob: ExportStatus | null;
  onStopExport: () => Promise<void>;
  exportBusy: boolean;
};

export default function LiveEditor({ project, words, edl, broll, exportVideo, exportJob, onStopExport, exportBusy }: Props) {
  const [editorProject, setEditorProject] = useState<CJCutProject | null>(null);
  const [status, setStatus] = useState('Preparing live editor…');
  const [error, setError] = useState('');
  const [importedMedia, setImportedMedia] = useState<EditorMediaEntry[]>([]);
  const [mediaImportBusy, setMediaImportBusy] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const pendingWrites = useRef<Promise<unknown>>(Promise.resolve());
  const latestTimeline = useRef<CJCutProject | null>(null);
  const pendingAutosave = useRef(false);
  const hydratedProjectId = useRef<string | null>(null);
  const [exportPreparing, setExportPreparing] = useState(false);
  const [motion, setMotion] = useState<MotionPlan | null>(null);
  const [motionLoaded, setMotionLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setMotionLoaded(false); setMotion(null);
    void api.getMotion(project.id).then(result => { if (active) setMotion(result); }).catch(() => undefined).finally(() => { if (active) setMotionLoaded(true); });
    return () => { active = false; };
  }, [project.id]);

  useEffect(() => {
    let active = true;
    setImportedMedia([]);
    void api.editorMedia(project.id).then(result => {
      if (active) setImportedMedia(result.media);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { active = false; };
  }, [project.id]);

  // Graphics rendered in another tab or while this editor stayed open should appear without a reload.
  useEffect(() => {
    const signature = (plan: MotionPlan | null) => JSON.stringify((plan?.scenes ?? []).map(scene => [scene.id, scene.enabled, scene.status, scene.renderedAt]));
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void api.getMotion(project.id).then(result => setMotion(current => signature(current) === signature(result) ? current : result)).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [project.id]);

  async function importFiles(files: File[]) {
    if (!files.length) return;
    if (mediaImportBusy) throw new Error('A media import is already in progress.');
    setMediaImportBusy(true);
    setError('');
    let imported = 0;
    try {
      for (const file of files) {
        setStatus(`Importing ${file.name} (${imported + 1}/${files.length})…`);
        const entry = await uploadEditorMedia(project.id, file);
        setImportedMedia(current => [...current.filter(item => item.id !== entry.id), entry]);
        imported += 1;
      }
      setStatus(`${imported} file${imported === 1 ? '' : 's'} imported. Drag them from Media onto any timeline layer.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setError(`${imported} file(s) imported. ${detail}`);
      throw error;
    } finally { setMediaImportBusy(false); }
  }

  const seed = useMemo(() => freshProject(project, words, edl, broll, motion), [project, words, edl, broll, motion]);
  // Generated assets remain draggable after the original managed track is removed.
  // The exporter maps these IDs back to known local project media.
  const hostMedia = useMemo<CJCutMediaAsset[]>(() => {
    const assets: CJCutMediaAsset[] = [];
    const seen = new Set<string>();
    for (const clip of seed.tracks.flatMap(track => track.clips).filter(clip => clip.role === 'base')) {
      const sourceClipId = String(clip.metadata?.sourceClipId ?? clip.externalId ?? clip.id);
      if (seen.has(sourceClipId) || !clip.url) continue;
      seen.add(sourceClipId);
      assets.push({
        id: 'source:' + sourceClipId, name: clip.name, kind: 'video', url: clip.url,
        duration: clip.sourceDuration, sourceDuration: clip.sourceDuration, sourceStart: 0,
        role: 'base', externalId: clip.externalId, metadata: clip.metadata,
        width: project.media.width, height: project.media.height,
      });
    }
    for (const scene of broll?.scenes ?? []) {
      if (!scene.enabled || scene.imageStatus === 'generating' || scene.imageStatus === 'failed') continue;
      const duration = Math.max(0.5, scene.sourceEnd - scene.sourceStart);
      const metadata = { managed: true, sceneId: scene.id };
      const videoLength = brollSourceDuration(scene, 'video', duration);
      if (scene.imageFile) assets.push({
        id: 'image:' + scene.id, name: scene.title + ' · still', kind: 'image',
        url: api.brollImageUrl(project.id, scene.id, scene.generatedAt),
        duration, sourceDuration: brollSourceDuration(scene, 'image', duration), role: 'broll', externalId: scene.id,
        metadata: { ...metadata, assetKind: 'image', assetVersion: scene.generatedAt || '' },
      });
      if (hasCurrentVideo(scene)) assets.push({
        id: 'video:' + scene.id, name: scene.title + ' · video', kind: 'video',
        url: api.brollVideoUrl(project.id, scene.id, scene.videoGeneratedAt),
        duration, sourceDuration: videoLength, role: 'broll', externalId: scene.id,
        metadata: { ...metadata, assetKind: 'video', assetVersion: scene.videoGeneratedAt || '' },
      });
    }
    for (const scene of motion?.scenes ?? []) {
      if (!usableMotion(scene)) continue;
      const duration = Math.max(0.5, scene.sourceEnd - scene.sourceStart);
      assets.push({
        id: 'motion:' + scene.id, name: scene.title + ' · motion graphic', kind: 'video',
        url: api.motionVideoUrl(project.id, scene.id, scene.renderedAt),
        duration, sourceDuration: duration, role: 'overlay', externalId: scene.id,
        metadata: { managed: true, motionId: scene.id, assetVersion: scene.renderedAt || '' },
      });
    }
    for (const item of importedMedia) {
      assets.push({
        id: 'imported:' + item.id,
        name: item.name,
        kind: item.kind,
        url: api.editorMediaUrl(project.id, item.id),
        duration: item.duration,
        sourceStart: 0,
        sourceDuration: item.duration,
        width: item.width,
        height: item.height,
        role: 'imported',
        externalId: item.id,
        metadata: { editorMediaId: item.id },
      });
    }
    return assets;
  }, [seed, broll?.scenes, motion?.scenes, importedMedia, project.id, project.media.width, project.media.height]);

  // A new asset changes the editor seed; an unrelated project timestamp does not.
  // Never re-fetch a stale persisted timeline over active unsaved CJCut edits.
  const seedKey = useMemo(() => JSON.stringify({
    project: project.id,
    clips: (project.clips ?? []).map(clip => [clip.id, clip.sourceName, clip.timelineStart, clip.timelineEnd]),
    edl: edl?.keepRanges ?? null,
    broll: (broll?.scenes ?? []).map(scene => [scene.id, scene.enabled, scene.generatedAt, scene.videoGeneratedAt, scene.imageStatus, scene.videoStatus, scene.imageRevision, scene.videoDuration, scene.videoTreatment, scene.stillEffect]),
    motion: (motion?.scenes ?? []).filter(usableMotion).map(scene => [scene.id, scene.renderedAt]),
  }), [project.id, project.clips, edl?.keepRanges, broll?.scenes, motion?.scenes]);

  useEffect(() => {
    if (!motionLoaded) return;
    let cancelled = false;
    if (hydratedProjectId.current !== project.id || !latestTimeline.current) {
      latestTimeline.current = null;
      setEditorProject(null);
      setStatus('Loading saved edit…');
      setError('');
      // Project ID is the only reason to load an editor document from disk.
      // For asset changes we merge into the live in-memory edit below instead.
      void pendingWrites.current.catch(() => undefined)
        .then(() => api.getEditorProject<CJCutProject>(project.id))
        .then(({ project: saved }) => {
          if (cancelled) return;
          const next = reconcileSaved(saved, seed, broll, motion, project.id);
          hydratedProjectId.current = project.id;
          latestTimeline.current = next;
          setEditorProject(next);
          setStatus(saved ? 'Saved editor timeline restored.' : 'Editor ready at this project stage.');
        }).catch(err => {
          if (cancelled) return;
          hydratedProjectId.current = project.id;
          latestTimeline.current = seed;
          setEditorProject(seed);
          setError(err instanceof Error ? err.message : String(err));
        });
    } else if (latestTimeline.current) {
      const merged = reconcileSaved(latestTimeline.current, seed, broll, motion, project.id);
      if (JSON.stringify(merged) !== JSON.stringify(latestTimeline.current)) {
        latestTimeline.current = merged;
        setEditorProject(merged);
        setStatus('New project assets synced without losing timeline edits.');
        pendingAutosave.current = true;
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          pendingAutosave.current = false;
          void queueSave(merged).catch(err => setError(err instanceof Error ? err.message : String(err)));
        }, 700);
      }
    }
    return () => { cancelled = true; };
  }, [project.id, seedKey, motionLoaded]);

  // Switching workflow tabs unmounts Live Editor. Flush the last edit rather
  // than cancelling the debounced save (which previously lost splits/trims).
  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingAutosave.current && latestTimeline.current) {
      const snapshot = clone(latestTimeline.current);
      pendingAutosave.current = false;
      pendingWrites.current = pendingWrites.current.catch(() => undefined)
        .then(() => api.saveEditorProject(project.id, snapshot));
    }
  }, [project.id]);

  function queueSave(next: CJCutProject) {
    const snapshot = clone(next);
    const saving = pendingWrites.current.catch(() => undefined).then(() => api.saveEditorProject(project.id, snapshot));
    pendingWrites.current = saving;
    return saving;
  }

  function handleChange(next: CJCutProject) {
    if (latestTimeline.current && JSON.stringify(next) === JSON.stringify(latestTimeline.current)) return;
    latestTimeline.current = next;
    // CJCut already owns this edit; avoid resetting playhead/undo on every drag.
    pendingAutosave.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      pendingAutosave.current = false;
      void queueSave(next).then(() => setStatus('Editor changes autosaved ✓')).catch(err => setError(err instanceof Error ? err.message : String(err)));
    }, 700);
  }

  async function saveNow(next: CJCutProject) {
    latestTimeline.current = next;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pendingAutosave.current = false;
    try {
      await queueSave(next);
      setStatus('Editor project saved ✓'); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function exportCurrentTimeline() {
    if (exportBusy || exportPreparing) return;
    const latest = latestTimeline.current ?? editorProject;
    if (!latest) return;
    try {
      setExportPreparing(true); setError('');
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingAutosave.current = false;
      await queueSave(latest);
      await exportVideo(latest);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setExportPreparing(false); }
  }

  if (!editorProject) return <section className="panel liveEditorLoading"><strong>Preparing live editor…</strong><span>{status}</span></section>;

  return <section className="liveEditorTab">
    <div className="liveEditorInfo panel">
      <div><span className="label">LIVE PROJECT PREVIEW</span><strong>Current stage → editable CJCut timeline</strong><small>This timeline is now the source of truth for your edited MP4. Trim, split, reposition and hide B-roll layers, then export exactly this composition.</small></div>
      <div className="liveEditorExportActions"><button className="primary" onClick={() => void exportCurrentTimeline()} disabled={exportBusy || exportPreparing || !project.sourceAvailable}>{exportPreparing ? 'Saving timeline…' : 'Export edited MP4'}</button>{exportJob?.state === 'running' && <button onClick={() => void onStopExport()}>Stop</button>}<span>{status}</span>{error && <strong>{error}</strong>}</div>
    </div>
    {exportJob && exportJob.state !== 'idle' && <div className={`liveEditorRenderStatus panel ${exportJob.state}`}><strong>{exportJob.state === 'completed' ? 'Edited MP4 ready' : exportJob.state === 'failed' ? 'Edited render failed' : exportJob.state === 'running' ? 'Rendering edited timeline…' : 'Render stopped'}</strong><span>{Math.min(100, Math.max(0, exportJob.progress || 0)).toFixed(1)}% · {exportJob.speed || exportJob.encoder || ''}</span><div className="progressTrack"><span style={{ width: `${Math.min(100, Math.max(0, exportJob.progress || 0))}%` }} /></div>{exportJob.outputPath && <small>{exportJob.outputPath}</small>}{exportJob.error && <strong className="error">{exportJob.error}</strong>}</div>}
    {mediaImportBusy && <div className="panel" role="status">Importing media into the project library…</div>}
    <div className="liveEditorHost">
      <CJCutEditor
        initialProject={editorProject}
        projectKey={seedKey}
        embedded
        brandName="Video Cleaner · CJCut"
        allowMediaImport={true}
        hostMedia={hostMedia}
        onImportFiles={importFiles}
        onProjectChange={handleChange}
        onSave={saveNow}
      />
    </div>
  </section>;
}
