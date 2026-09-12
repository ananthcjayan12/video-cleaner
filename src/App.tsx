import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type BrollAssetAspectRatio,
  type BrollDisplayTemplate,
  type BrollPlan,
  type BrollPlanSettings,
  type BrollScene,
  type Edl,
  type ExportStatus,
  type GoogleFlowCatalogVideo,
  type ImageProvider,
  type VideoProvider,
  type KeepRange,
  type Project,
  type SystemStatus,
  type Word,
} from './api';
import ProjectLibrary from './ProjectLibrary';
import TimelineEditorPanel from './TimelineEditor';
import './settings.css';

type SceneDraft = { title: string; imagePrompt: string; videoPrompt: string; sourceStart: string; sourceEnd: string; enabled: boolean };
type ParallelFailure<T> = { item: T; error: string };
type SceneDialog = { kind: 'image-prompt' | 'video-prompt' | 'image-regeneration' | 'video-regeneration'; sceneId: string; value: string };
type ScenePreview = { sceneId: string; title: string; url: string; duration: number };

const DEFAULT_BROLL: BrollPlanSettings = {
  workflowMode: 'cleaned-video', provider: 'gemini', videoProvider: 'grok-cli', countMode: 'auto', targetCount: 6, imagesPerMinute: 5, intervalSeconds: 20,
  minSceneDuration: 3, maxSceneDuration: 8, aspectRatio: 'auto', returnVideoWithAudio: false,
};

const BROLL_LAYOUTS: Array<{ value: BrollDisplayTemplate; label: string }> = [
  { value: 'full-frame', label: 'Full screen' },
  { value: 'top-card', label: 'Top card' },
  { value: 'split-top', label: 'Top split' },
  { value: 'picture-in-picture', label: 'Picture in picture' },
  { value: 'top-card-presenter', label: 'Top card + presenter' },
  { value: 'presenter-overlay', label: 'Presenter over B-roll' },
  { value: 'stacked-cards-cutout', label: 'Stacked reel cards + cutout' },
  { value: 'stacked-talking-top', label: 'Talking head top · B-roll bottom' },
  { value: 'stacked-broll-top', label: 'B-roll top · talking head bottom' },
];
const HORIZONTAL_BROLL_LAYOUTS = new Set<BrollDisplayTemplate>(['top-card', 'split-top', 'picture-in-picture', 'top-card-presenter', 'stacked-cards-cutout', 'stacked-talking-top', 'stacked-broll-top']);

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [proxyUrl, setProxyUrl] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [broll, setBroll] = useState<BrollPlan | null>(null);
  const [brollSettings, setBrollSettings] = useState<BrollPlanSettings>(DEFAULT_BROLL);
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, SceneDraft>>({});
  const [brollGenerating, setBrollGenerating] = useState<string | null>(null);
  const [layoutSaving, setLayoutSaving] = useState<string | null>(null);
  const [previewingScene, setPreviewingScene] = useState<string | null>(null);
  const [scenePreview, setScenePreview] = useState<ScenePreview | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [parallelRunning, setParallelRunning] = useState<string[]>([]);
  const [imageConcurrency, setImageConcurrency] = useState(0);
  const [videoConcurrency, setVideoConcurrency] = useState(0);
  const [flowUnmatched, setFlowUnmatched] = useState<GoogleFlowCatalogVideo[]>([]);
  const [intensity, setIntensity] = useState<'light' | 'balanced' | 'aggressive'>('balanced');
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    elevenLabsApiKey: '', openAiApiKey: '', geminiApiKey: '', magnificApiKey: '', imageProvider: 'gemini',
    openAiImageModel: '', geminiImageModel: '', grokModel: '', grokVideoModel: '', gflowProfile: '', gflowVideoModel: '', magnificVideoModel: '', magnificVideoEndpoint: '',
    codexBin: '', grokBin: '', gflowBin: '', ffmpegBin: '', ffprobeBin: '', projectsDir: '',
  });
  const [status, setStatus] = useState('Loading local projects…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportJob, setExportJob] = useState<ExportStatus | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewFrameRef = useRef<number | null>(null);
  const previewSegmentsRef = useRef<Array<{ start: number; end: number }>>([]);
  const draftRef = useRef<Record<string, SceneDraft>>({});
  const autosaveTimers = useRef<Record<string, number>>({});

  useEffect(() => { void refreshSystem(); void refreshProjects(); return () => clearAllAutosaves(); }, []);
  const projectId = project?.id;
  const exportRunning = exportJob?.state === 'running';

  useEffect(() => {
    if (!projectId || !exportRunning) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.exportStatus(projectId);
        if (cancelled) return;
        setExportJob(next);
        if (next.state === 'completed') setStatus(`Export complete: ${next.outputPath ?? 'output file'}`);
        if (next.state === 'failed') setError(next.error || 'Export failed');
        if (next.state === 'stopped') setStatus(next.resumable ? 'Export stopped. Completed checkpoints are saved; render again to resume.' : 'Export stopped.');
      } catch (err) { if (!cancelled) setError(message(err)); }
    };
    void tick();
    const timer = window.setInterval(tick, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, exportRunning]);

  useEffect(() => {
    if (!projectId || (!brollGenerating && !generatingAll)) return;
    let cancelled = false;
    const tick = async () => { try { const latest = await api.getBroll(projectId); if (!cancelled) { setBroll(latest); setBrollSettings(latest.settings); } } catch { /* The active request reports the actionable error. */ } };
    void tick(); const timer = window.setInterval(tick, 1500); return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, brollGenerating, generatingAll]);

  const index = useMemo(() => new Map(words.map((word, i) => [word.id, i])), [words]);
  const keepMask = useMemo(() => {
    const mask = words.map(() => false);
    for (const range of edl?.keepRanges ?? []) {
      if (range.startWordId && range.endWordId) {
        const start = index.get(range.startWordId); const end = index.get(range.endWordId);
        if (start !== undefined && end !== undefined) { for (let i = start; i <= end; i += 1) mask[i] = true; continue; }
      }
      if (Number.isFinite(range.sourceStart) && Number.isFinite(range.sourceEnd)) {
        for (let i = 0; i < words.length; i += 1) if (words[i].end > Number(range.sourceStart) && words[i].start < Number(range.sourceEnd)) mask[i] = true;
      }
    }
    return mask;
  }, [words, edl, index]);
  const previewSegments = useMemo(() => (edl?.keepRanges ?? []).map((range) => {
    if (Number.isFinite(range.sourceStart) && Number.isFinite(range.sourceEnd)) return { start: Math.max(0, Number(range.sourceStart)), end: Math.min(project?.media.duration ?? Number.POSITIVE_INFINITY, Number(range.sourceEnd)) };
    if (!range.startWordId || !range.endWordId) return null;
    const startIndex = index.get(range.startWordId) ?? -1; const endIndex = index.get(range.endWordId) ?? -1; const startWord = words[startIndex]; const endWord = words[endIndex];
    if (!startWord || !endWord) return null;
    const previousRemovedWord = startIndex > 0 ? words[startIndex - 1] : undefined; const nextRemovedWord = endIndex < words.length - 1 ? words[endIndex + 1] : undefined;
    const paddedStart = Math.max(0, startWord.start - 0.08); const paddedEnd = endWord.end + 0.12;
    return { start: previousRemovedWord ? Math.max(paddedStart, Math.min(startWord.start, previousRemovedWord.end + 0.01)) : paddedStart, end: nextRemovedWord ? Math.min(paddedEnd, Math.max(endWord.end, nextRemovedWord.start - 0.01)) : paddedEnd };
  }).filter((range): range is { start: number; end: number } => Boolean(range && range.end > range.start)), [edl, words, index, project?.media.duration]);

  useEffect(() => {
    previewSegmentsRef.current = previewSegments; syncPreview(); if (videoRef.current && !videoRef.current.paused) startPreviewGuard();
    return () => { if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current); previewFrameRef.current = null; };
  }, [previewSegments]);

  function applyBrollPlan(plan: BrollPlan) {
    const drafts = Object.fromEntries(plan.scenes.map((scene) => [scene.id, draftFromScene(scene)]));
    setBroll(plan); setBrollSettings(plan.settings); setSceneDrafts(drafts); draftRef.current = drafts;
  }
  function resetBroll() { clearAllAutosaves(); setBroll(null); setSceneDrafts({}); draftRef.current = {}; setBrollGenerating(null); setPreviewingScene(null); setScenePreview(null); setParallelRunning([]); setFlowUnmatched([]); }

  function clearAllAutosaves() {
    for (const timer of Object.values(autosaveTimers.current)) window.clearTimeout(timer);
    autosaveTimers.current = {};
  }
  function clearAutosave(sceneId: string) {
    const timer = autosaveTimers.current[sceneId]; if (timer) window.clearTimeout(timer); delete autosaveTimers.current[sceneId];
  }

  async function refreshProjects() {
    try {
      const list = await api.listProjects(); setRecentProjects(list);
      if (!project) setStatus(list.length ? 'Choose a recent project or create a new one.' : 'Choose a video to create your first local project.');
      return list;
    } catch (err) { setError(message(err)); return []; }
  }

  async function refreshSystem() {
    try {
      const result = await api.settings(); setSystem(result);
      const provider = result.overrides?.imageProvider || result.imageProvider || 'gemini';
      setSettingsForm((current) => ({
        ...current, imageProvider: provider,
        codexBin: result.overrides?.codexBin ?? '', grokBin: result.overrides?.grokBin ?? '', gflowBin: result.overrides?.gflowBin ?? '', ffmpegBin: result.overrides?.ffmpegBin ?? '', ffprobeBin: result.overrides?.ffprobeBin ?? '', projectsDir: result.overrides?.projectsDir ?? '',
        openAiImageModel: result.overrides?.openAiImageModel ?? '', geminiImageModel: result.overrides?.geminiImageModel ?? '', grokModel: result.overrides?.grokModel ?? '', grokVideoModel: result.overrides?.grokVideoModel ?? '', gflowProfile: result.overrides?.gflowProfile ?? '', gflowVideoModel: result.overrides?.gflowVideoModel ?? '', magnificApiKey: '', magnificVideoModel: result.overrides?.magnificVideoModel ?? '', magnificVideoEndpoint: result.overrides?.magnificVideoEndpoint ?? '',
      }));
      setBrollSettings((current) => ({ ...current, provider: provider as ImageProvider }));
    } catch (err) { setError(message(err)); }
  }

  async function action(label: string, fn: () => Promise<void>) {
    try { setBusy(true); setError(''); setStatus(label); await fn(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    await action('Saving local settings…', async () => {
      const result = await api.saveSettings(settingsForm); setSystem(result);
      setSettingsForm((current) => ({ ...current, elevenLabsApiKey: '', openAiApiKey: '', geminiApiKey: '', magnificApiKey: '' }));
      setBrollSettings((current) => ({ ...current, provider: result.imageProvider }));
      await refreshProjects();
      setStatus('Settings saved. Local CLIs, providers and project library were re-checked.');
    });
  }

  async function changeVideoProvider(provider: VideoProvider) {
    setBrollSettings((current) => ({ ...current, videoProvider: provider }));
    if (!project || !broll) return;
    try { setError(''); const updated = await api.updateBrollSettings(project.id, { videoProvider: provider }); applyBrollPlan(updated); setStatus(`Video provider changed to ${videoProviderLabel(provider)}. Saved locally ✓`); }
    catch (err) { setError(message(err)); setBrollSettings(broll.settings); }
  }

  async function changeVideoAudio(returnVideoWithAudio: boolean) {
    setBrollSettings((current) => ({ ...current, returnVideoWithAudio }));
    if (!project || !broll) return;
    try { setError(''); const updated = await api.updateBrollSettings(project.id, { returnVideoWithAudio }); applyBrollPlan(updated); setStatus(`${returnVideoWithAudio ? 'Generated-video audio will be kept' : 'Generated videos will be silent and audio tracks removed'}. Saved locally ✓`); }
    catch (err) { setError(message(err)); setBrollSettings(broll.settings); }
  }

  async function pick() {
    await action('Opening native file picker…', async () => {
      clearAllAutosaves();
      const selected = await api.selectProject(); setProject(selected); setProxyUrl(''); setWords([]); setEdl(null); resetBroll(); setExportJob(null);
      window.localStorage.setItem('video-cleaner:lastProjectId', selected.id);
      await refreshProjects();
      setStatus('Project created locally. Use the cleaning flow, or jump directly to B-roll planning.');
    });
  }

  async function openProject(saved: Project) {
    await action(`Opening ${saved.name}…`, async () => {
      clearAllAutosaves();
      const snapshot = await api.openProject(saved.id);
      setProject(snapshot.project); setProxyUrl(snapshot.proxyUrl ? `${snapshot.proxyUrl}?v=${Date.now()}` : ''); setWords(snapshot.transcript?.words ?? []); setEdl(snapshot.edl); setExportJob(null);
      if (snapshot.broll) applyBrollPlan(snapshot.broll); else resetBroll();
      window.localStorage.setItem('video-cleaner:lastProjectId', saved.id);
      setStatus(snapshot.project.sourceAvailable ? `Resumed ${snapshot.project.name}. Everything is loaded from local storage.` : `Resumed ${snapshot.project.name}. The original source needs to be relinked before source-dependent operations.`);
    });
  }

  async function closeProject() {
    clearAllAutosaves(); setProject(null); setProxyUrl(''); setWords([]); setEdl(null); resetBroll(); setExportJob(null); setError(''); await refreshProjects();
  }

  async function renameProject(saved: Project) {
    const name = window.prompt('Project name', saved.name)?.trim(); if (!name || name === saved.name) return;
    await action('Renaming local project…', async () => { const updated = await api.renameProject(saved.id, name); if (project?.id === updated.id) setProject(updated); await refreshProjects(); setStatus(`Renamed project to ${updated.name}.`); });
  }

  async function deleteProject(saved: Project) {
    if (!window.confirm(`Delete the local project “${saved.name}”?\n\nThis removes its proxy, transcript, edit data and B-roll assets from Video Cleaner. The original source video is NOT deleted.`)) return;
    await action('Deleting local project files…', async () => { await api.deleteProject(saved.id); if (project?.id === saved.id) { setProject(null); setProxyUrl(''); setWords([]); setEdl(null); resetBroll(); } await refreshProjects(); setStatus(`Deleted ${saved.name}. The original video was left untouched.`); });
  }

  async function relinkProject(saved: Project) {
    await action(`Relinking source for ${saved.name}…`, async () => { const updated = await api.relinkProject(saved.id); if (project?.id === updated.id) setProject(updated); await refreshProjects(); setStatus(`Source relinked: ${updated.sourceName}.`); });
  }

  function confirmSourceTimelineChange() {
    if (!project) return false;
    const hasDerivedWork = project.state.proxyReady || project.state.transcriptReady || project.state.cleaned || project.state.brollPlanned;
    return !hasDerivedWork || window.confirm('Changing the base clip timeline requires rebuilding the proxy, transcript, cleanup and B-roll plan. Generated source files are not changed. Continue?');
  }

  function applySourceTimelineChange(updated: Project, detail: string) {
    clearAllAutosaves(); setProject(updated); setProxyUrl(''); setWords([]); setEdl(null); resetBroll(); setExportJob(null); setStatus(detail);
  }

  async function addProjectClips() {
    if (!project || !confirmSourceTimelineChange()) return;
    await action('Choose one or more clips to append…', async () => {
      const updated = await api.addProjectClips(project.id); applySourceTimelineChange(updated, `${updated.clipCount ?? 1} base clips ready. Arrange them in playback order, then create the proxy.`); await refreshProjects();
    });
  }

  async function moveProjectClip(index: number, direction: -1 | 1) {
    if (!project?.clips || !confirmSourceTimelineChange()) return;
    const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= project.clips.length) return;
    const reordered = [...project.clips]; [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    await action('Updating base clip order…', async () => {
      const updated = await api.reorderProjectClips(project.id, reordered.map((clip) => clip.id)); applySourceTimelineChange(updated, 'Base clip playback order updated.'); await refreshProjects();
    });
  }

  async function removeProjectClip(clip: { id: string; sourceName: string }) {
    if (!project || (project.clipCount ?? 1) <= 1) return;
    if (!window.confirm(`Remove “${clip.sourceName}” from this project timeline?\n\nIts original video will remain untouched. The combined proxy, transcript, cleanup and B-roll plan must be rebuilt.`)) return;
    await action(`Removing ${clip.sourceName} from the timeline…`, async () => {
      const updated = await api.removeProjectClip(project.id, clip.id); applySourceTimelineChange(updated, `${clip.sourceName} was removed from the project. The original file was not deleted.`); await refreshProjects();
    });
  }

  async function prepare() { if (!project) return; await action('Creating proxy + analysis audio from one source pass…', async () => { const result = await api.prepare(project.id); setProxyUrl(`${result.proxyUrl}?v=${Date.now()}`); setProject((current) => current ? { ...current, proxyUrl: result.proxyUrl, state: { ...current.state, proxyReady: true } } : current); setStatus(`Proxy ready: ${result.proxy.width}×${result.proxy.height} @ ${result.proxy.fps} fps${result.proxy.hardware ? ' · VideoToolbox' : ''}.`); }); }
  async function transcribe() { if (!project) return; await action('Transcribing source audio with ElevenLabs Scribe…', async () => { const result = await api.transcribe(project.id); setWords(result.transcript.words); setEdl(result.edl); resetBroll(); setProject((current) => current ? { ...current, state: { ...current.state, transcriptReady: true } } : current); setStatus('Transcript ready. Clean it, or plan B-roll directly from the raw narration.'); }); }
  async function clean() { if (!project) return; await action(`Running ${intensity} delete-only Codex cleanup…`, async () => { const result = await api.clean(project.id, intensity); setEdl(result); resetBroll(); setProject((current) => current ? { ...current, state: { ...current.state, cleaned: true, brollPlanned: false, brollScenes: 0, brollImages: 0, brollVideos: 0, missingImages: 0, missingVideos: 0 } } : current); setStatus('Cleaned dialogue EDL ready.'); }); }
  async function planBroll() { if (!project) return; await action('Codex is planning B-roll and will automatically repair timing or validation issues…', async () => { const result = await api.planBroll(project.id, brollSettings); setWords(result.transcript.words); setEdl(result.edl); applyBrollPlan(result.plan); setProject((current) => current ? { ...current, state: { ...current.state, transcriptReady: true, brollPlanned: true, brollScenes: result.plan.scenes.length, brollImages: 0, brollVideos: 0, missingImages: result.plan.scenes.length, missingVideos: 0 } } : current); setStatus(`B-roll plan ready: ${result.plan.scenes.length} scene${result.plan.scenes.length === 1 ? '' : 's'}. Timing validation passed ✓`); }); }

  function maskToRanges(mask: boolean[]) {
    const ranges: KeepRange[] = []; let start = -1;
    for (let i = 0; i <= mask.length; i += 1) { if (i < mask.length && mask[i] && start < 0) start = i; if (start >= 0 && (i === mask.length || !mask[i])) { ranges.push({ startWordId: words[start].id, endWordId: words[i - 1].id, reason: 'Manual edit' }); start = -1; } }
    return ranges;
  }
  async function saveManualEdl(keepRanges: KeepRange[], preserveBroll = false) {
    if (!project) return;
    const updated = await api.setEdl(project.id, keepRanges, preserveBroll); setEdl(updated);
    if (!preserveBroll) {
      resetBroll();
      setProject((current) => current ? { ...current, state: { ...current.state, cleaned: true, brollPlanned: false, brollScenes: 0, brollImages: 0, brollVideos: 0, missingImages: 0, missingVideos: 0 } } : current);
    } else {
      setProject((current) => current ? { ...current, state: { ...current.state, cleaned: true } } : current);
    }
  }
  async function toggleWord(wordIndex: number) { if (!project || busy || exportRunning || generatingAll) return; const nextMask = [...keepMask]; nextMask[wordIndex] = !nextMask[wordIndex]; if (!nextMask.some(Boolean)) return; try { await saveManualEdl(maskToRanges(nextMask)); setStatus('Dialogue edit saved locally ✓ Preview updated.'); } catch (err) { setError(message(err)); } }
  function syncPreview() { const video = videoRef.current; const segments = previewSegmentsRef.current; if (!video || !segments.length) return; const time = video.currentTime; if (segments.some((segment) => time >= segment.start && time < segment.end)) return; const next = segments.find((segment) => segment.start > time); if (next) video.currentTime = next.start; else video.pause(); }
  function startPreviewGuard() { if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current); const tick = () => { syncPreview(); const video = videoRef.current; if (video && !video.paused && !video.ended) previewFrameRef.current = window.requestAnimationFrame(tick); else previewFrameRef.current = null; }; previewFrameRef.current = window.requestAnimationFrame(tick); }
  function stopPreviewGuard() { if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current); previewFrameRef.current = null; }

  function replaceScene(scene: BrollScene) {
    clearAutosave(scene.id);
    setBroll((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === scene.id ? scene : item) } : current);
    const nextDraft = draftFromScene(scene); draftRef.current = { ...draftRef.current, [scene.id]: nextDraft }; setSceneDrafts((current) => ({ ...current, [scene.id]: nextDraft }));
  }

  function changeDraft(sceneId: string, patch: Partial<SceneDraft>) {
    const current = draftRef.current[sceneId]; if (!current) return;
    const next = { ...current, ...patch }; draftRef.current = { ...draftRef.current, [sceneId]: next }; setSceneDrafts((drafts) => ({ ...drafts, [sceneId]: next }));
    if (!project || generatingAll) return;
    clearAutosave(sceneId); setStatus('Saving B-roll changes locally…');
    autosaveTimers.current[sceneId] = window.setTimeout(async () => {
      delete autosaveTimers.current[sceneId]; const draft = draftRef.current[sceneId]; if (!draft || !project) return;
      try {
        const sent = { ...draft };
        const updated = await api.updateBrollScene(project.id, sceneId, draftPatch(sent));
        setBroll((currentPlan) => currentPlan ? { ...currentPlan, scenes: currentPlan.scenes.map((item) => item.id === updated.id ? updated : item) } : currentPlan);
        if (sameDraft(draftRef.current[sceneId], sent)) setStatus('Saved locally ✓');
      } catch (err) { setError(`Autosave failed: ${message(err)}`); }
    }, 700);
  }

  async function saveScene(scene: BrollScene) {
    if (!project) return scene; clearAutosave(scene.id); const draft = draftRef.current[scene.id] ?? draftFromScene(scene);
    const updated = await api.updateBrollScene(project.id, scene.id, draftPatch(draft)); replaceScene(updated); setStatus('Saved locally ✓'); return updated;
  }

  async function changeSceneLayout(scene: BrollScene, displayTemplate: BrollDisplayTemplate) {
    if (!project || layoutSaving) return;
    try {
      setError(''); setLayoutSaving(scene.id); setStatus(`Saving layout for ${scene.title}…`);
      const updated = await api.updateBrollScene(project.id, scene.id, { displayTemplate });
      setBroll((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === updated.id ? updated : item) } : current);
      setStatus(HORIZONTAL_BROLL_LAYOUTS.has(displayTemplate) && (!updated.assetAspectRatio || updated.assetAspectRatio === 'auto') ? `Layout saved for ${updated.title} ✓ Auto orientation will generate horizontal B-roll.` : `Layout saved for ${updated.title} ✓`);
    } catch (err) { setError(message(err)); }
    finally { setLayoutSaving(null); }
  }

  async function changeSceneAspect(scene: BrollScene, assetAspectRatio: BrollAssetAspectRatio) {
    if (!project || layoutSaving) return;
    try {
      setError(''); setLayoutSaving(scene.id); setStatus(`Saving B-roll orientation for ${scene.title}…`);
      const updated = await api.updateBrollScene(project.id, scene.id, { assetAspectRatio });
      setBroll((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === updated.id ? updated : item) } : current);
      setStatus(`B-roll orientation saved for ${updated.title} ✓ Regenerate its image and video to apply it.`);
    } catch (err) { setError(message(err)); }
    finally { setLayoutSaving(null); }
  }

  async function previewScene(scene: BrollScene) {
    if (!project || busy || previewingScene || !scene.imageFile) return;
    try {
      setBusy(true); setError(''); setPreviewingScene(scene.id); setStatus(`Rendering a quick preview for ${scene.title}…`);
      const saved = await saveScene(scene); const result = await api.previewBrollScene(project.id, saved.id);
      setScenePreview({ sceneId: saved.id, title: saved.title, url: result.previewUrl, duration: result.duration }); setStatus(`${saved.title} preview ready${result.cached ? ' from cache' : ''} ✓`);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); setPreviewingScene(null); }
  }

  async function generateScene(scene: BrollScene, regenerationComment?: string) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Generating ${scene.title} with ${providerLabel(broll?.settings.provider ?? brollSettings.provider)}…`); const saved = await saveScene(scene); const result = await api.generateBrollScene(project.id, saved.id, regenerationComment?.trim() || undefined); replaceScene(result.scene); setStatus(`Generated ${result.scene.title}. Saved locally ✓`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function importSceneImage(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Choose a local image for ${scene.title}…`); const saved = await saveScene(scene); const result = await api.importBrollImage(project.id, saved.id); replaceScene(result.scene); setStatus(`Manual B-roll image added for ${result.scene.title}. Saved locally ✓`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function importSceneVideo(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Choose a completed video for ${scene.title}…`); const saved = await saveScene(scene); const result = await api.importBrollVideo(project.id, saved.id); replaceScene(result.scene); setStatus(`Manual video attached to ${result.scene.title}. Saved locally ✓`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function syncGoogleFlow() {
    if (!project || !broll || busy || generatingAll || brollGenerating) return;
    try { setError(''); setBusy(true); setStatus('Syncing this project with the local Google Flow catalog…'); const result = await api.syncGoogleFlow(project.id); applyBrollPlan(result.plan); setFlowUnmatched(result.unmatched); setStatus(result.unmatched.length ? `Found ${result.unmatched.length} unassigned Flow video${result.unmatched.length === 1 ? '' : 's'}.` : 'Google Flow project synced. No unassigned downloaded videos found.'); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }

  async function assignGoogleFlowVideo(sceneId: string, mediaId: string) {
    if (!project || busy || generatingAll || brollGenerating) return;
    try { setError(''); setBusy(true); setStatus('Assigning the Flow video to its scene…'); const result = await api.assignGoogleFlowVideo(project.id, sceneId, mediaId); replaceScene(result.scene); setFlowUnmatched((current) => current.filter((video) => video.mediaId !== mediaId)); setStatus(`Flow video assigned to ${result.scene.title}. Saved locally ✓`); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }

  async function deleteScene(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    if (!window.confirm(`Delete ${scene.title} from the B-roll plan? Its generated/manual image and video will also be removed.`)) return;
    try { setError(''); setBrollGenerating(scene.id); clearAutosave(scene.id); const plan = await api.deleteBrollScene(project.id, scene.id); applyBrollPlan(plan); setStatus(`Deleted ${scene.title}. Saved locally ✓`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function rewriteVideoPrompt(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Codex is writing a motion prompt for ${scene.title}…`); await saveScene(scene); const updated = await api.createBrollVideoPrompt(project.id, scene.id); replaceScene(updated); setStatus(`Video prompt ready for ${updated.title}. Saved locally ✓`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function createSceneVideo(scene: BrollScene, regenerationComment?: string) {
    if (!project || brollGenerating || generatingAll) return;
    const provider = broll?.settings.videoProvider || brollSettings.videoProvider || 'grok-cli'; const label = videoProviderLabel(provider);
    if (!videoProviderReady(system, provider)) { setError(`${label} is not ready. Check Settings and authentication.`); return; }
    if (!scene.videoPrompt && !system?.codex.authenticated) { setError('Codex must be authenticated to create a video motion prompt first.'); return; }
    try { setError(''); setBrollGenerating(scene.id); setStatus(`${scene.videoPrompt ? 'Creating' : 'Codex is prompting, then creating'} video for ${scene.title} with ${label}…`); const saved = await saveScene(scene); const result = await api.createBrollVideo(project.id, saved.id, regenerationComment?.trim() || undefined); replaceScene(result.scene); setStatus(`B-roll video ready for ${result.scene.title} via ${label}. Saved locally ✓`); }
    catch (err) { setError(message(err)); try { applyBrollPlan(await api.getBroll(project.id)); } catch { /* Keep the generation error visible. */ } } finally { setBrollGenerating(null); }
  }

  async function finalizeParallelPlan(scenes: BrollScene[]) {
    if (!project || !scenes.length) return;
    await api.updateBrollScene(project.id, scenes[0].id, { title: scenes[0].title });
    applyBrollPlan(await api.getBroll(project.id));
  }

  async function runImageBatch(scenes: BrollScene[], mode: 'all' | 'missing' | 'orientation-changed' | 'selected') {
    if (!project || !broll || generatingAll || brollGenerating) return false;
    if (!scenes.length) { setStatus(mode === 'orientation-changed' ? 'No B-roll images need orientation regeneration.' : mode === 'selected' ? 'Select at least one B-roll card first.' : 'All B-roll images are already present.'); return false; }
    if (!providerReady(system, broll.settings.provider)) { setError(`${providerLabel(broll.settings.provider)} is not configured/available in Settings.`); return false; }
    const profile = imageConcurrencyProfile(broll.settings.provider); const concurrency = resolveConcurrency(imageConcurrency, profile.defaultConcurrency, profile.maxConcurrency); const provider = providerLabel(broll.settings.provider);
    const batchDescription = mode === 'missing' ? 'missing ' : mode === 'orientation-changed' ? 'orientation-changed ' : mode === 'selected' ? 'selected ' : '';
    if (!window.confirm(`Generate ${scenes.length} ${batchDescription}B-roll image${scenes.length === 1 ? '' : 's'} using ${provider} with up to ${concurrency} parallel worker${concurrency === 1 ? '' : 's'}? Existing videos for regenerated images will be cleared.`)) return false;
    setGeneratingAll(true); setParallelRunning([]); setError('');
    try {
      const savedScenes: BrollScene[] = []; for (const scene of scenes) savedScenes.push(await saveScene(scene));
      const failures = await runParallel(savedScenes, concurrency, async (scene) => {
        setParallelRunning((current) => current.includes(scene.id) ? current : [...current, scene.id]);
        try { const result = await withTransientRetry(() => api.generateBrollScene(project.id, scene.id)); replaceScene(result.scene); }
        finally { setParallelRunning((current) => current.filter((id) => id !== scene.id)); }
      }, (completed, total, failed) => setStatus(`Generating images in parallel · ${completed}/${total} finished${failed ? ` · ${failed} failed` : ''}`));
      await finalizeParallelPlan(savedScenes); const succeeded = savedScenes.length - failures.length;
      setStatus(`Parallel image generation complete: ${succeeded}/${savedScenes.length} succeeded. Project saved locally ✓`);
      if (failures.length) setError(`${failures.length} image job${failures.length === 1 ? '' : 's'} failed. ${failures[0].error}`);
    } catch (err) { setError(message(err)); }
    finally { setParallelRunning([]); setGeneratingAll(false); }
    return true;
  }

  async function generateAllBroll() { if (broll) await runImageBatch(broll.scenes, 'all'); }
  async function generateMissingBroll() { if (broll) await runImageBatch(broll.scenes.filter((scene) => !scene.imageFile), 'missing'); }
  async function regenerateSelectedBroll(scenes: BrollScene[]) { return runImageBatch(scenes, 'selected'); }

  async function generateAllVideoPrompts() {
    if (!project || !broll || generatingAll || brollGenerating) return;
    const scenes = broll.scenes.filter((scene) => scene.imageFile);
    if (!scenes.length) { setStatus('Generate or add at least one B-roll image before creating video prompts.'); return; }
    if (!system?.codex.authenticated) { setError('Codex must be available in Settings before creating B-roll video prompts.'); return; }
    const concurrency = resolveConcurrency(videoConcurrency, 2, 3);
    if (!window.confirm(`Generate video motion prompts for all ${scenes.length} B-roll image${scenes.length === 1 ? '' : 's'} using up to ${concurrency} parallel worker${concurrency === 1 ? '' : 's'}? This replaces any existing video prompts.`)) return;
    setGeneratingAll(true); setParallelRunning([]); setError('');
    try {
      const savedScenes: BrollScene[] = []; for (const scene of scenes) savedScenes.push(await saveScene(scene));
      const failures = await runParallel(savedScenes, concurrency, async (scene) => {
        setParallelRunning((current) => current.includes(scene.id) ? current : [...current, scene.id]);
        try { const updated = await withTransientRetry(() => api.createBrollVideoPrompt(project.id, scene.id), 3); replaceScene(updated); }
        finally { setParallelRunning((current) => current.filter((id) => id !== scene.id)); }
      }, (completed, total, failed) => setStatus(`Generating video prompts in parallel · ${completed}/${total} finished${failed ? ` · ${failed} failed` : ''}`));
      await finalizeParallelPlan(savedScenes); const succeeded = savedScenes.length - failures.length;
      setStatus(`Video prompt generation complete: ${succeeded}/${savedScenes.length} succeeded. Project saved locally ✓`);
      if (failures.length) setError(`${failures.length} video prompt job${failures.length === 1 ? '' : 's'} failed. ${failures[0].error}`);
    } catch (err) { setError(message(err)); }
    finally { setParallelRunning([]); setGeneratingAll(false); }
  }

  async function runVideoBatch(scenes: BrollScene[], mode: 'all' | 'missing') {
    if (!project || !broll || generatingAll || brollGenerating) return;
    const provider = broll.settings.videoProvider || 'grok-cli'; const providerName = videoProviderLabel(provider);
    if (!videoProviderReady(system, provider)) { setError(`${providerName} is not ready. Check Settings and authentication.`); return; }
    if (!scenes.length) { setStatus(mode === 'missing' ? 'All eligible B-roll videos are already present.' : 'Generate or add at least one B-roll image before creating videos.'); return; }
    const profile = videoConcurrencyProfile(provider); const concurrency = resolveConcurrency(videoConcurrency, profile.defaultConcurrency, profile.maxConcurrency);
    if (!window.confirm(`${mode === 'missing' ? 'Create the' : 'Create'} ${scenes.length} ${mode === 'missing' ? 'missing ' : ''}B-roll video${scenes.length === 1 ? '' : 's'} with ${providerName} using up to ${concurrency} parallel worker${concurrency === 1 ? '' : 's'}?${provider === 'google-flow' ? ' Each generation uses your signed-in Google Flow account credits.' : ''}`)) return;
    setGeneratingAll(true); setParallelRunning([]); setError('');
    try {
      const savedScenes: BrollScene[] = []; for (const scene of scenes) savedScenes.push(await saveScene(scene));
      const failures = await runParallel(savedScenes, concurrency, async (scene) => {
        setParallelRunning((current) => current.includes(scene.id) ? current : [...current, scene.id]);
        try { const result = await withTransientRetry(() => api.createBrollVideo(project.id, scene.id), 3); replaceScene(result.scene); }
        finally { setParallelRunning((current) => current.filter((id) => id !== scene.id)); }
      }, (completed, total, failed) => setStatus(`Creating B-roll videos with ${providerName} · ${completed}/${total} finished${failed ? ` · ${failed} failed` : ''}`));
      await finalizeParallelPlan(savedScenes); const succeeded = savedScenes.length - failures.length;
      setStatus(`Video generation complete with ${providerName}: ${succeeded}/${savedScenes.length} succeeded. Project saved locally ✓`);
      if (failures.length) setError(`${failures.length} video job${failures.length === 1 ? '' : 's'} failed. ${failures[0].error}`);
    } catch (err) { setError(message(err)); }
    finally { setParallelRunning([]); setGeneratingAll(false); }
  }

  async function generateAllVideos() { if (broll) await runVideoBatch(broll.scenes.filter((scene) => scene.imageFile), 'all'); }
  async function generateMissingVideos() { if (broll) await runVideoBatch(broll.scenes.filter((scene) => scene.imageFile && !scene.videoFile), 'missing'); }

  async function exportBaseVideo(mode: 'fast' | 'quality') { if (!project || exportRunning) return; await startExport('Choose cleaned-video destination…', () => api.exportVideo(project.id, mode)); }
  async function exportBrollVideo(mode: 'fast' | 'quality') { if (!project || !broll || exportRunning) return; await startExport('Choose B-roll-video destination…', () => api.exportBrollVideo(project.id, mode)); }
  async function startExport(label: string, starter: () => Promise<{ outputPath: string; encoder: string; hardware: boolean }>) {
    try { setBusy(true); setError(''); setStatus(label); const started = await starter(); setExportJob({ state: 'running', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0, outputPath: started.outputPath, encoder: started.encoder }); setStatus(`Exporting with ${started.encoder}${started.hardware ? ' hardware acceleration' : ''}…`); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function stopExport() { if (!project || !exportRunning) return; try { setStatus('Stopping export safely…'); await api.stopExport(project.id); } catch (err) { setError(message(err)); } }
  async function exportAssets() { if (!project || !broll) return; await action('Choose a folder for B-roll assets + timing data…', async () => { const result = await api.exportBrollAssets(project.id); setStatus(`B-roll package exported: ${result.destination}`); }); }

  const ready = Boolean(system?.ffmpeg.installed && system?.ffprobe.installed && system?.codex.installed && system?.codex.authenticated && system?.elevenLabs.configured);
  const capabilities = system?.ffmpeg.capabilities;
  const ffmpegDetail = system?.ffmpeg.path ? `${system.ffmpeg.path}${capabilities?.videoToolboxDecode ? ' · VT decode' : ''}${capabilities?.h264VideoToolbox ? ' · H264 VT' : ''}${capabilities?.hevcVideoToolbox ? ' · HEVC VT' : ''}` : 'Not detected';
  const sourceClips = project?.clips ?? [];

  return (
    <main className="shell">
      <header className="topbar">
        <div><span className="eyebrow">LOCAL AI VIDEO PIPELINE</span><h1>Video Cleaner</h1></div>
        <div className="headerActions">
          <span className={`readyBadge ${ready ? 'ready' : ''}`}>{ready ? 'Core ready' : 'Setup required'}</span>
          {project && <button className="ghost" onClick={() => void closeProject()} disabled={busy || exportRunning || generatingAll}>Projects</button>}
          <button className="ghost" onClick={() => setSettingsOpen((value) => !value)}>Settings</button>
          {project && <button className="ghost" onClick={pick} disabled={busy || exportRunning || generatingAll || !system?.ffprobe.installed}>New project</button>}
        </div>
      </header>

      {settingsOpen && <SettingsPanel system={system} form={settingsForm} setForm={setSettingsForm} save={saveSettings} refresh={refreshSystem} disabled={busy || exportRunning || generatingAll} ffmpegDetail={ffmpegDetail} />}

      {!project ? <ProjectLibrary projects={recentProjects} busy={busy} onNew={pick} onOpen={(saved) => void openProject(saved)} onRename={(saved) => void renameProject(saved)} onDelete={(saved) => void deleteProject(saved)} onRelink={(saved) => void relinkProject(saved)} onRefresh={() => void refreshProjects()} /> : <>
        <section className={`source panel ${project.sourceAvailable ? '' : 'missingSourcePanel'}`}>
          <div className="sourceSummary"><div><span className="label">{project.sourceAvailable ? 'BASE VIDEO TIMELINE' : 'BASE CLIP MISSING'}</span><strong>{project.name}</strong><small>{sourceClips.length > 1 ? `${sourceClips.length} clips play continuously in the order below.` : `${project.sourceName} · Add more clips at any time.`} Original media stays untouched.</small></div><div className="sourceRight"><div className="chips"><span>{project.media.width}×{project.media.height}</span><span>{String(project.media.videoCodec).toUpperCase()}</span>{project.media.frameRate ? <span>{project.media.frameRate.toFixed(2)} fps</span> : null}<span>{(project.media.size / 1024 / 1024 / 1024).toFixed(2)} GB</span>{project.media.hdr && <span className="warn">HDR</span>}</div><div className="sourceActions"><button className="primary" onClick={() => void addProjectClips()} disabled={busy || exportRunning || generatingAll || !system?.ffprobe.installed}>+ Add base clips</button>{!project.sourceAvailable && <button className="danger" onClick={() => void relinkProject(project)} disabled={busy || generatingAll}>Relink missing clip</button>}</div></div></div>
          {sourceClips.length > 0 && <div className="clipTimeline"><div className="clipTimelineHead"><strong>Playback order</strong><span>Add clips in separate selections, then arrange them here.</span></div>{sourceClips.map((clip, index) => <div className="clipTimelineRow" key={clip.id}><span className="clipOrder">{index + 1}</span><div><strong>{clip.sourceName}</strong><small>{formatTime(clip.duration)} · timeline {formatTime(clip.timelineStart)}–{formatTime(clip.timelineEnd)}</small></div><div className="clipOrderActions"><button onClick={() => void moveProjectClip(index, -1)} disabled={busy || exportRunning || generatingAll || index === 0} aria-label={`Move ${clip.sourceName} earlier`}>↑</button><button onClick={() => void moveProjectClip(index, 1)} disabled={busy || exportRunning || generatingAll || index === sourceClips.length - 1} aria-label={`Move ${clip.sourceName} later`}>↓</button>{sourceClips.length > 1 && <button className="danger" onClick={() => void removeProjectClip(clip)} disabled={busy || exportRunning || generatingAll} aria-label={`Remove ${clip.sourceName}`}>Remove</button>}</div></div>)}</div>}
        </section>
        {!project.sourceAvailable && <div className="sourceWarning panel"><strong>Your project data is safe.</strong><span>Transcript, EDL and B-roll assets can still be resumed locally. Relink the original video before proxy creation or final render.</span></div>}
        <section className="workflow"><aside className="panel controls"><h3>Dialogue flow</h3><button onClick={prepare} disabled={busy || exportRunning || !!proxyUrl || !system?.ffmpeg.installed || !project.sourceAvailable}>1. Create proxy + audio</button><button onClick={transcribe} disabled={busy || exportRunning || !system?.elevenLabs.configured || !!words.length}>2. Transcribe audio</button><label>Cleanup intensity<select value={intensity} onChange={(e) => setIntensity(e.target.value as typeof intensity)}><option value="light">Light</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select></label><button onClick={clean} disabled={busy || exportRunning || !system?.codex.authenticated}>3. Clean with Codex</button><div className="divider" /><button onClick={() => exportBaseVideo('quality')} disabled={busy || exportRunning || !edl || !project.sourceAvailable}>Export cleaned video only</button>{exportJob && exportJob.state !== 'idle' && <ExportProgress job={exportJob} onStop={stopExport} />}</aside>
          <section className="workspace"><div className="panel playerCard">{proxyUrl ? <video ref={videoRef} src={proxyUrl} controls onPlay={startPreviewGuard} onPause={stopPreviewGuard} onEnded={stopPreviewGuard} onTimeUpdate={syncPreview} onSeeked={syncPreview} /> : <div className="emptyPlayer">Proxy is optional for standalone B-roll. Saved projects restore it automatically when available.</div>}</div><div className="panel transcriptCard"><div className="sectionTitle"><div><span className="label">EDIT DECISION LIST</span><h3>Transcript</h3></div><span className="legend"><i /> kept <i className="removedDot" /> removed</span></div>{words.length ? <div className="transcript">{words.map((word, i) => <button key={word.id} className={`word ${keepMask[i] ? 'kept' : 'removed'}`} title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`} onClick={() => toggleWord(i)}>{word.text}</button>)}</div> : <p className="muted">No transcript yet. Raw/asset-only B-roll planning can create it automatically.</p>}</div></section>
        </section>
        {proxyUrl && edl && words.length > 0 && <TimelineEditorPanel duration={project.media.duration} fps={project.media.frameRate} words={words} edl={edl} videoRef={videoRef} disabled={busy || exportRunning || generatingAll} onSave={(ranges) => saveManualEdl(ranges, true)} onNotice={setStatus} />}
        <BrollWorkspace project={project} system={system} plan={broll} settings={brollSettings} setSettings={setBrollSettings} drafts={sceneDrafts} changeDraft={changeDraft} changeSceneLayout={changeSceneLayout} changeSceneAspect={changeSceneAspect} changeVideoProvider={changeVideoProvider} changeVideoAudio={changeVideoAudio} previewScene={previewScene} previewingScene={previewingScene} planBroll={planBroll} generateScene={generateScene} importSceneImage={importSceneImage} importSceneVideo={importSceneVideo} deleteScene={deleteScene} rewriteVideoPrompt={rewriteVideoPrompt} createSceneVideo={createSceneVideo} generateAll={generateAllBroll} generateMissing={generateMissingBroll} regenerateSelected={regenerateSelectedBroll} generateAllVideoPrompts={generateAllVideoPrompts} generateAllVideos={generateAllVideos} generateMissingVideos={generateMissingVideos} saveScene={saveScene} generating={brollGenerating} layoutSaving={layoutSaving} parallelRunning={parallelRunning} generatingAll={generatingAll} busy={busy || exportRunning} exportAssets={exportAssets} exportVideo={() => exportBrollVideo('quality')} imageConcurrency={imageConcurrency} setImageConcurrency={setImageConcurrency} videoConcurrency={videoConcurrency} setVideoConcurrency={setVideoConcurrency} flowUnmatched={flowUnmatched} syncGoogleFlow={syncGoogleFlow} assignGoogleFlowVideo={assignGoogleFlowVideo} />
      </>}
      <footer className="statusbar"><span className={busy || exportRunning || generatingAll ? 'pulse' : ''}>{busy || exportRunning || generatingAll ? '●' : '○'}</span> {status}{error && <strong className="error">{error}</strong>}</footer>
      {scenePreview && <ScenePreviewModal preview={scenePreview} close={() => setScenePreview(null)} />}
    </main>
  );
}

function SettingsPanel({ system, form, setForm, save, refresh, disabled, ffmpegDetail }: any) {
  return <section className="panel settingsPanel">
    <div className="sectionTitle"><div><span className="label">LOCAL DEPENDENCIES + IMAGE / VIDEO PROVIDERS</span><h3>Settings</h3></div><button onClick={refresh} disabled={disabled}>Re-check</button></div>
    <div className="systemGrid"><SystemItem label="Codex CLI" ok={Boolean(system?.codex.installed && system?.codex.authenticated)} detail={system?.codex.path ?? 'Not detected'} /><SystemItem label="Grok CLI" ok={Boolean(system?.grok.installed)} detail={system?.grok.path ?? 'Not detected'} /><SystemItem label="Grok Video" ok={Boolean(system?.videoProviders?.grokCli.configured)} detail={system?.videoProviders?.grokCli.configured ? system.videoProviders.grokCli.model : 'Grok CLI not detected'} /><SystemItem label="Google Flow" ok={Boolean(system?.videoProviders?.googleFlow.configured)} detail={system?.videoProviders?.googleFlow.configured ? `${system.videoProviders.googleFlow.model} · profile ${system.videoProviders.googleFlow.profile}` : system?.gflow?.installed ? 'Installed · sign in with gflow auth login' : 'gflow CLI not detected'} /><SystemItem label="Magnific Video" ok={Boolean(system?.videoProviders?.magnific.configured)} detail={system?.videoProviders?.magnific.configured ? system.videoProviders.magnific.model : 'API key missing'} /><SystemItem label="FFmpeg" ok={Boolean(system?.ffmpeg.installed)} detail={ffmpegDetail} /><SystemItem label="ElevenLabs" ok={Boolean(system?.elevenLabs.configured)} detail={system?.elevenLabs.configured ? 'API key configured' : 'API key missing'} /><SystemItem label="Gemini Images" ok={Boolean(system?.imageProviders?.gemini.configured)} detail={system?.imageProviders?.gemini.model ?? 'Not configured'} /><SystemItem label="OpenAI Images" ok={Boolean(system?.imageProviders?.openai.configured)} detail={system?.imageProviders?.openai.model ?? 'Not configured'} /></div>
    <div className="settingsGrid">
      <label>Default image provider<select value={form.imageProvider} onChange={(e) => setForm({ ...form, imageProvider: e.target.value })}><option value="gemini">Gemini API</option><option value="grok-cli">Grok CLI · experimental</option><option value="codex-cli">Codex CLI · experimental</option><option value="openai">OpenAI Images API</option></select></label>
      <label>ElevenLabs API key<input type="password" value={form.elevenLabsApiKey} onChange={(e) => setForm({ ...form, elevenLabsApiKey: e.target.value })} placeholder={system?.elevenLabs.configured ? 'Configured — enter only to replace' : 'xi-…'} /></label>
      <label>Gemini API key<input type="password" value={form.geminiApiKey} onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })} placeholder={system?.imageProviders?.gemini.configured ? 'Configured — enter only to replace' : 'AIza…'} /></label>
      <label>Gemini image model<input value={form.geminiImageModel} onChange={(e) => setForm({ ...form, geminiImageModel: e.target.value })} placeholder={system?.imageProviders?.gemini.model || 'gemini-3.1-flash-image'} /></label>
      <label>OpenAI API key<input type="password" value={form.openAiApiKey} onChange={(e) => setForm({ ...form, openAiApiKey: e.target.value })} placeholder={system?.imageProviders?.openai.configured ? 'Configured — enter only to replace' : 'sk-…'} /></label>
      <label>OpenAI image model<input value={form.openAiImageModel} onChange={(e) => setForm({ ...form, openAiImageModel: e.target.value })} placeholder={system?.imageProviders?.openai.model || 'gpt-image-2'} /></label>
      <label>Codex binary<input value={form.codexBin} onChange={(e) => setForm({ ...form, codexBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
      <label>Grok binary<input value={form.grokBin} onChange={(e) => setForm({ ...form, grokBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
      <label>Grok agent model override<input value={form.grokModel} onChange={(e) => setForm({ ...form, grokModel: e.target.value })} placeholder="CLI default" /></label>
      <label>Grok image-to-video model<input value={form.grokVideoModel} onChange={(e) => setForm({ ...form, grokVideoModel: e.target.value })} placeholder={system?.videoProviders?.grokCli.model || 'grok-imagine-video-1.5'} /></label>
      <label>Google Flow / gflow binary<input value={form.gflowBin} onChange={(e) => setForm({ ...form, gflowBin: e.target.value })} placeholder="Auto detect `gflow` from PATH" /></label>
      <label>Google Flow profile<input value={form.gflowProfile} onChange={(e) => setForm({ ...form, gflowProfile: e.target.value })} placeholder={system?.videoProviders?.googleFlow.profile || 'default'} /></label>
      <label>Google Flow video model<input value={form.gflowVideoModel} onChange={(e) => setForm({ ...form, gflowVideoModel: e.target.value })} placeholder={system?.videoProviders?.googleFlow.model || 'veo-fast'} /></label><label>Magnific API key<input type="password" value={form.magnificApiKey} onChange={(e) => setForm({ ...form, magnificApiKey: e.target.value })} placeholder={system?.videoProviders?.magnific.configured ? 'Configured — enter only to replace' : 'Magnific API key'} /></label><label>Magnific video model<input value={form.magnificVideoModel} onChange={(e) => setForm({ ...form, magnificVideoModel: e.target.value })} placeholder={system?.videoProviders?.magnific.model || 'minimax-hailuo-2-3-768p-fast'} /></label><label className="wide">Magnific endpoint override<input value={form.magnificVideoEndpoint} onChange={(e) => setForm({ ...form, magnificVideoEndpoint: e.target.value })} placeholder={system?.videoProviders?.magnific.endpoint || 'Auto from model'} /></label>
      <label>FFmpeg binary<input value={form.ffmpegBin} onChange={(e) => setForm({ ...form, ffmpegBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
      <label>FFprobe binary<input value={form.ffprobeBin} onChange={(e) => setForm({ ...form, ffprobeBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
      <label className="wide">Projects directory<input value={form.projectsDir} onChange={(e) => setForm({ ...form, projectsDir: e.target.value })} placeholder={system?.projectsDir || '~/VideoCleaner/projects'} /></label>
    </div>
    <p className="muted settingsNote">Project folders are the local source of truth. Closing the browser/server does not remove project state; Video Cleaner scans this directory on the next launch. API secrets remain in the local Node service.</p>
    <button className="primary" onClick={save} disabled={disabled}>Save settings</button>
  </section>;
}

function BrollWorkspace({ project, system, plan, settings, setSettings, drafts, changeDraft, changeSceneLayout, changeSceneAspect, changeVideoProvider, changeVideoAudio, previewScene, previewingScene, planBroll, generateScene, importSceneImage, importSceneVideo, deleteScene, rewriteVideoPrompt, createSceneVideo, generateAll, generateMissing, regenerateSelected, generateAllVideoPrompts, generateAllVideos, generateMissingVideos, saveScene, generating, layoutSaving, parallelRunning, generatingAll, busy, exportAssets, exportVideo, imageConcurrency, setImageConcurrency, videoConcurrency, setVideoConcurrency, flowUnmatched, syncGoogleFlow, assignGoogleFlowVideo }: any) {
  const [dialog, setDialog] = useState<SceneDialog | null>(null);
  const [selectedForRegeneration, setSelectedForRegeneration] = useState<string[]>([]);
  const [flowAssignments, setFlowAssignments] = useState<Record<string, string>>({});
  const providerIsReady = providerReady(system, settings.provider); const videoProvider = (settings.videoProvider || 'grok-cli') as VideoProvider; const videoProviderIsReady = videoProviderReady(system, videoProvider); const imageProfile = imageConcurrencyProfile(settings.provider); const videoProfile = videoConcurrencyProfile(videoProvider); const imageConcurrencyValue = imageConcurrency === 0 ? 0 : Math.min(imageConcurrency, imageProfile.maxConcurrency); const videoConcurrencyValue = videoConcurrency === 0 ? 0 : Math.min(videoConcurrency, videoProfile.maxConcurrency);
  const missingImages = plan?.scenes.filter((scene: BrollScene) => !scene.imageFile).length ?? 0; const missingVideos = plan?.scenes.filter((scene: BrollScene) => scene.imageFile && !scene.videoFile).length ?? 0; const imageScenes = plan?.scenes.filter((scene: BrollScene) => scene.imageFile).length ?? 0;
  const selectedScenes = plan?.scenes.filter((scene: BrollScene) => selectedForRegeneration.includes(scene.id)) ?? [];
  const dialogScene = dialog ? plan?.scenes.find((scene: BrollScene) => scene.id === dialog.sceneId) : undefined;
  function openDialog(kind: SceneDialog['kind'], scene: BrollScene, value = '') { setDialog({ kind, sceneId: scene.id, value }); }
  function toggleRegenerationSelection(sceneId: string, checked: boolean) { setSelectedForRegeneration((current) => checked ? current.includes(sceneId) ? current : [...current, sceneId] : current.filter((id) => id !== sceneId)); }
  async function regenerateCheckedScenes() { if (await regenerateSelected(selectedScenes)) setSelectedForRegeneration([]); }
  function submitDialog() {
    if (!dialog || !dialogScene) return;
    const value = dialog.value.trim();
    if (dialog.kind === 'image-prompt') { if (value) changeDraft(dialogScene.id, { imagePrompt: value }); setDialog(null); return; }
    if (dialog.kind === 'video-prompt') { if (value) changeDraft(dialogScene.id, { videoPrompt: value }); setDialog(null); return; }
    setDialog(null);
    if (dialog.kind === 'image-regeneration') void generateScene(dialogScene, value || undefined);
    else void createSceneVideo(dialogScene, value || undefined);
  }
  return <section className="panel brollPanel">
    <div className="sectionTitle brollTitle"><div><span className="label">INDEPENDENT OR IN-FLOW MODULE</span><h3>Hyper-real B-roll</h3></div><div className="brollActions"><button onClick={planBroll} disabled={busy || generatingAll || !system?.codex.authenticated || !system?.elevenLabs.configured}>{plan ? 'Re-plan scenes' : 'Plan B-roll scenes'}</button>{plan && missingImages > 0 && <button onClick={generateMissing} disabled={busy || generatingAll || !!generating || !providerIsReady}>Generate missing images ({missingImages})</button>}{plan && <button className="primary" onClick={() => void regenerateCheckedScenes()} disabled={busy || generatingAll || !!generating || !providerIsReady || selectedScenes.length === 0}>Regenerate selected images ({selectedScenes.length})</button>}{plan && <button onClick={generateAll} disabled={busy || generatingAll || !!generating || !providerIsReady}>Regenerate all images</button>}{plan && imageScenes > 0 && <button onClick={generateAllVideoPrompts} disabled={busy || generatingAll || !!generating || !system?.codex.authenticated}>Generate video prompts ({imageScenes})</button>}{plan && missingVideos > 0 && <button onClick={generateMissingVideos} disabled={busy || generatingAll || !!generating || !videoProviderIsReady}>Create missing videos ({missingVideos})</button>}{plan && <button onClick={generateAllVideos} disabled={busy || generatingAll || !!generating || !videoProviderIsReady || !plan.scenes.some((scene: BrollScene) => scene.imageFile)}>Create all videos</button>}</div></div>
    <div className="brollConfig"><label>Workflow<select value={settings.workflowMode} onChange={(e) => setSettings({ ...settings, workflowMode: e.target.value })}><option value="cleaned-video">Proxy/audio cleaned → B-roll → final video</option><option value="raw-video">Raw video → B-roll → final video</option><option value="assets-only">Raw video → B-roll files + timing JSON</option></select></label><label>Image provider<select value={settings.provider} onChange={(e) => setSettings({ ...settings, provider: e.target.value })}><option value="gemini">Gemini API</option><option value="grok-cli">Grok CLI · experimental</option><option value="codex-cli">Codex CLI · experimental</option><option value="openai">OpenAI Images API</option></select></label><label>Video provider<select value={videoProvider} onChange={(e) => void changeVideoProvider(e.target.value as VideoProvider)} disabled={busy || generatingAll || !!generating}><option value="magnific">Magnific · MiniMax Hailuo 2.3 Fast</option><option value="grok-cli">Grok CLI</option><option value="google-flow">Google Flow · Veo</option></select></label><label className="configToggle"><input type="checkbox" checked={Boolean(settings.returnVideoWithAudio)} onChange={(e) => void changeVideoAudio(e.target.checked)} disabled={busy || generatingAll || !!generating} /><span>Return video with audio<small>Off sends a silent prompt and removes the audio track after download.</small></span></label><label>Parallel images<select value={imageConcurrencyValue} onChange={(e) => setImageConcurrency(Number(e.target.value))}><option value="0">Auto ({imageProfile.defaultConcurrency})</option>{Array.from({ length: imageProfile.maxConcurrency }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><label>Parallel videos<select value={videoConcurrencyValue} onChange={(e) => setVideoConcurrency(Number(e.target.value))}><option value="0">Auto ({videoProfile.defaultConcurrency})</option>{Array.from({ length: videoProfile.maxConcurrency }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><label>B-roll frequency<select value={settings.countMode} onChange={(e) => setSettings({ ...settings, countMode: e.target.value })}><option value="auto">Auto by semantic scenes</option><option value="interval">One every N seconds</option><option value="exact">Exact count</option><option value="per-minute">B-rolls per minute</option></select></label>{settings.countMode === 'interval' && <label>B-roll interval<select value={settings.intervalSeconds} onChange={(e) => setSettings({ ...settings, intervalSeconds: Number(e.target.value) })}>{[10, 15, 20, 30, 45, 60, 90, 120].map((seconds) => <option key={seconds} value={seconds}>Every {seconds} seconds</option>)}</select></label>}{settings.countMode === 'exact' && <label>Exact B-rolls<input type="number" min="1" max="40" value={settings.targetCount} onChange={(e) => setSettings({ ...settings, targetCount: Number(e.target.value) })} /></label>}{settings.countMode === 'per-minute' && <label>B-rolls / minute<input type="number" min="0.5" max="20" step="0.5" value={settings.imagesPerMinute} onChange={(e) => setSettings({ ...settings, imagesPerMinute: Number(e.target.value) })} /></label>}<label>Aspect ratio<select value={settings.aspectRatio} onChange={(e) => setSettings({ ...settings, aspectRatio: e.target.value })}><option value="auto">Auto from video</option><option value="9:16">9:16 portrait</option><option value="16:9">16:9 landscape</option></select></label><label>Min scene sec<input type="number" min="1" max="20" value={settings.minSceneDuration} onChange={(e) => setSettings({ ...settings, minSceneDuration: Number(e.target.value) })} /></label><label>Max scene sec<input type="number" min="2" max="30" value={settings.maxSceneDuration} onChange={(e) => setSettings({ ...settings, maxSceneDuration: Number(e.target.value) })} /></label></div>
    <p className="muted brollModeHelp">The planner always leaves at least 5 seconds of talking-head footage between B-roll scenes. In interval mode it plans semantic scenes near the selected cadence. Scene timing and prompts autosave locally; interrupted generation can be resumed without regenerating completed scenes.</p>

    {plan && videoProvider === 'google-flow' && <div className="flowProjectPanel">
      <div><strong>{plan.googleFlow ? plan.googleFlow.title : 'Flow project will be created on the first video'}</strong><small>{plan.googleFlow ? `${plan.googleFlow.projectId} · profile ${plan.googleFlow.profile}` : 'Every scene generated afterward will use that same persistent project.'}</small></div>
      {plan.googleFlow && <div className="flowProjectActions"><a href={plan.googleFlow.url} target="_blank" rel="noreferrer">Open in Google Flow</a><button onClick={syncGoogleFlow} disabled={busy || generatingAll || !!generating}>Project finished — sync videos</button></div>}
    </div>}
    {plan && flowUnmatched.length > 0 && <div className="flowInbox"><strong>Unassigned downloaded Flow videos</strong><p>Use the scene marker in the prompt/model/time to match each result, then assign it. Videos created only in the Flow website must first be downloaded and added with “Add video manually”.</p>{flowUnmatched.map((video: GoogleFlowCatalogVideo) => <div className="flowInboxRow" key={video.mediaId}><div><span>{video.model || 'Google Flow video'}{video.createdAt ? ` · ${new Date(video.createdAt).toLocaleString()}` : ''}</span><small>{video.prompt || video.mediaId}</small></div><select value={flowAssignments[video.mediaId] || ''} onChange={(e) => setFlowAssignments((current) => ({ ...current, [video.mediaId]: e.target.value }))}><option value="">Choose scene…</option>{plan.scenes.map((scene: BrollScene) => <option value={scene.id} key={scene.id}>{scene.id} · {scene.title}</option>)}</select><button onClick={() => void assignGoogleFlowVideo(flowAssignments[video.mediaId], video.mediaId)} disabled={!flowAssignments[video.mediaId] || busy}>Assign</button></div>)}</div>}

    {!plan ? <div className="brollEmpty"><strong>No B-roll plan yet</strong><p>Choose the workflow and image count, then plan scenes. Codex creates semantic scene boundaries, timestamps and hyper-real prompts.</p></div> : <>
      <div className="styleStrip"><strong>{plan.scenes.length} scenes</strong><span>{plan.orientation}</span><span>{providerLabel(plan.settings.provider)}</span><span>Video: {videoProviderLabel(plan.settings.videoProvider || 'grok-cli')}</span><span>{plan.settings.workflowMode}</span>{missingImages > 0 && <span>{missingImages} images missing</span>}{missingVideos > 0 && <span>{missingVideos} videos missing</span>}{generatingAll && <span>{parallelRunning.length} active workers</span>}</div>
      <div className="brollGrid">{plan.scenes.map((scene: BrollScene) => {
        const draft = drafts[scene.id] ?? draftFromScene(scene); const isWorking = generating === scene.id || parallelRunning.includes(scene.id);
        const selectedForBatch = selectedForRegeneration.includes(scene.id);
        return <article className={`brollCard ${draft.enabled ? '' : 'disabledScene'} ${selectedForBatch ? 'selectedForBatch' : ''}`} key={scene.id}>
          <div className="brollMediaColumn">
            <div className={`brollImage ${plan.orientation}`}>{scene.videoFile ? <video src={api.brollVideoUrl(project.id, scene.id, scene.videoGeneratedAt)} controls muted playsInline /> : scene.imageFile ? <img src={api.brollImageUrl(project.id, scene.id, scene.generatedAt)} alt={scene.title} /> : <div className="brollPlaceholder"><span>{isWorking ? 'WORKING…' : scene.id.toUpperCase()}</span><small>{scene.shotType || 'B-roll still'}</small></div>}</div>
            <div className="assetActions"><button onClick={() => importSceneImage(scene)} disabled={busy || generatingAll || !!generating}>{scene.imageFile ? 'Replace image manually' : 'Add image manually'}</button><button onClick={() => importSceneVideo(scene)} disabled={busy || generatingAll || !!generating}>Add video manually</button><button className="danger" onClick={() => deleteScene(scene)} disabled={busy || generatingAll || !!generating}>Delete B-roll</button></div>
          </div>
          <div className="brollBody">
            <label className="toggleRow batchSelect"><input type="checkbox" checked={selectedForBatch} onChange={(e) => toggleRegenerationSelection(scene.id, e.target.checked)} disabled={busy || generatingAll || !!generating} /> Select for image regeneration</label>
            <div className="sceneMeta"><span>{scene.id}</span><span>{scene.shotType || 'shot'}</span>{scene.provider && <span>{providerLabel(scene.provider)}</span>}{isWorking && <span>WORKING</span>}{scene.videoFile && <span className="videoBadge">VIDEO</span>}{scene.videoProvider && <span>{videoProviderLabel(scene.videoProvider)}</span>}{scene.videoModel && <span>{scene.videoModel}</span>}</div>
            {scene.videoAttempts?.length ? <details className="videoAttempts" open={scene.videoAttempts.some((attempt) => attempt.status !== 'completed')}><summary>Video attempts ({scene.videoAttempts.length})</summary>{[...scene.videoAttempts].reverse().map((attempt) => <div className={`videoAttempt ${attempt.status}`} key={attempt.id}><span>{attempt.status.toUpperCase()} · {attempt.source} · {new Date(attempt.startedAt).toLocaleString()}</span>{attempt.flowMediaId && <small>Flow media: {attempt.flowMediaId}</small>}{attempt.error && <small className="attemptError">{attempt.error}</small>}{attempt.errorLogFile && <small>Full log: {attempt.errorLogFile}</small>}</div>)}</details> : null}
            <label className="toggleRow"><input type="checkbox" checked={draft.enabled} onChange={(e) => changeDraft(scene.id, { enabled: e.target.checked })} /> Use this B-roll scene</label>
            <label className="sceneLayout">B-roll layout<select value={scene.displayTemplate ?? plan.settings.displayTemplate ?? 'full-frame'} onChange={(e) => void changeSceneLayout(scene, e.target.value as BrollDisplayTemplate)} disabled={busy || generatingAll || !!generating || !!layoutSaving}>{BROLL_LAYOUTS.map((layout) => <option key={layout.value} value={layout.value}>{layout.label}</option>)}</select><small>{layoutSaving === scene.id ? 'Saving layout…' : HORIZONTAL_BROLL_LAYOUTS.has(scene.displayTemplate ?? plan.settings.displayTemplate ?? 'full-frame') && (!scene.assetAspectRatio || scene.assetAspectRatio === 'auto') ? 'Auto orientation uses horizontal 16:9 for this card layout.' : 'Applied only to this B-roll when the final video is rendered.'}</small></label>
            <label className="sceneLayout">B-roll orientation<select value={scene.assetAspectRatio ?? 'auto'} onChange={(e) => void changeSceneAspect(scene, e.target.value as BrollAssetAspectRatio)} disabled={busy || generatingAll || !!generating || !!layoutSaving}><option value="auto">Auto from layout</option><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option></select><small>{scene.assetAspectRatio === '9:16' ? 'Next image and video will be vertical 9:16.' : scene.assetAspectRatio === '16:9' ? 'Next image and video will be horizontal 16:9.' : 'The selected layout decides the next image and video orientation.'}</small></label>
            <label>Scene title<input value={draft.title} onChange={(e) => changeDraft(scene.id, { title: e.target.value })} /></label>
            <div className="timingGrid"><label>Start sec<input type="number" step="0.05" min="0" value={draft.sourceStart} onChange={(e) => changeDraft(scene.id, { sourceStart: e.target.value })} /></label><label>End sec<input type="number" step="0.05" min="0" value={draft.sourceEnd} onChange={(e) => changeDraft(scene.id, { sourceEnd: e.target.value })} /></label></div>
            <p className="sceneNarration">“{scene.narration}”</p><p className="visualIntent">{scene.visualIntent}</p>
            <div className="promptActions"><button onClick={() => openDialog('image-prompt', scene, draft.imagePrompt)} disabled={busy || generatingAll || !!generating}>Edit image prompt</button>{scene.videoPrompt ? <button onClick={() => openDialog('video-prompt', scene, draft.videoPrompt)} disabled={busy || generatingAll || !!generating}>Edit video prompt</button> : scene.imageFile && <button onClick={() => rewriteVideoPrompt(scene)} disabled={busy || generatingAll || !!generating || !system?.codex.authenticated}>Create video prompt</button>}</div>
            <div className="sceneButtons"><button onClick={() => saveScene(scene)} disabled={busy || generatingAll || !!generating}>Save now</button><button onClick={() => void previewScene(scene)} disabled={busy || generatingAll || !!generating || !scene.imageFile || !project.sourceAvailable}>{previewingScene === scene.id ? 'Preparing preview…' : 'Preview section'}</button><button onClick={() => scene.imageFile ? openDialog('image-regeneration', scene) : void generateScene(scene)} disabled={busy || generatingAll || !!generating || !providerReady(system, plan.settings.provider)}>{isWorking ? 'Working…' : scene.imageFile ? 'Regenerate image' : 'Generate image'}</button><button className="primary" onClick={() => scene.videoFile ? openDialog('video-regeneration', scene) : void createSceneVideo(scene)} disabled={busy || generatingAll || !!generating || !scene.imageFile || !videoProviderReady(system, plan.settings.videoProvider || 'grok-cli')}>{isWorking ? 'Working…' : scene.videoFile ? 'Regenerate video' : 'Create video'}</button></div>
          </div>
        </article>;
      })}</div>
      <div className="brollFooterActions">{plan.settings.workflowMode === 'assets-only' ? <button className="primary" onClick={exportAssets} disabled={busy || generatingAll}>Export images/videos + timing JSON</button> : <button className="primary" onClick={exportVideo} disabled={busy || generatingAll || !project.sourceAvailable || !plan.scenes.some((scene: BrollScene) => (scene.videoFile || scene.imageFile) && scene.enabled)}>Render final video with B-roll</button>}</div>
    </>}
    {dialog && dialogScene && <SceneDialogModal dialog={dialog} scene={dialogScene} setDialog={setDialog} onSubmit={submitDialog} />}
  </section>;
}

function ScenePreviewModal({ preview, close }: { preview: ScenePreview; close: () => void }) {
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="sceneModal previewModal" role="dialog" aria-modal="true" aria-labelledby="preview-modal-title">
    <div className="sectionTitle"><div><span className="label">{preview.sceneId} · {preview.duration.toFixed(1)} SEC</span><h3 id="preview-modal-title">{preview.title} — rendered preview</h3></div><button className="ghost" onClick={close}>Close</button></div>
    <video key={preview.url} src={preview.url} controls autoPlay playsInline />
    <p className="muted">This preview renders only this B-roll section at preview resolution using the same layout and presenter-cutout pipeline as the final video.</p>
  </section></div>;
}

function SceneDialogModal({ dialog, scene, setDialog, onSubmit }: { dialog: SceneDialog; scene: BrollScene; setDialog: (dialog: SceneDialog | null) => void; onSubmit: () => void }) {
  const isPromptEditor = dialog.kind === 'image-prompt' || dialog.kind === 'video-prompt';
  const isImage = dialog.kind === 'image-prompt' || dialog.kind === 'image-regeneration';
  const title = dialog.kind === 'image-prompt' ? 'Edit image prompt' : dialog.kind === 'video-prompt' ? 'Edit video motion prompt' : dialog.kind === 'image-regeneration' ? 'Regenerate image' : 'Regenerate video';
  const placeholder = isPromptEditor ? (isImage ? 'Describe the still image you want to generate…' : 'Describe the motion you want in this clip…') : (isImage ? 'Optional: describe what should look different in this new image' : 'Optional: describe how this new video should move differently');
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="sceneModal" role="dialog" aria-modal="true" aria-labelledby="scene-modal-title">
    <div className="sectionTitle"><div><span className="label">{scene.id}</span><h3 id="scene-modal-title">{title}</h3></div><button className="ghost" onClick={() => setDialog(null)} aria-label="Close dialog">Close</button></div>
    <p className="muted">{isPromptEditor ? 'Changes are saved to this scene’s editable prompt.' : 'This optional note is used only for this regeneration and does not change the saved prompt.'}</p>
    <label>{isPromptEditor ? (isImage ? 'Image prompt' : 'Video motion prompt') : 'Optional guidance'}<textarea autoFocus rows={isPromptEditor ? 10 : 4} maxLength={2000} value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} placeholder={placeholder} /></label>
    <div className="modalActions"><button onClick={() => setDialog(null)}>Cancel</button><button className="primary" onClick={onSubmit}>{isPromptEditor ? 'Save prompt' : title}</button></div>
  </section></div>;
}

async function runParallel<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>, onProgress?: (completed: number, total: number, failed: number) => void): Promise<ParallelFailure<T>[]> {
  if (!items.length) return []; let cursor = 0; let completed = 0; const failures: ParallelFailure<T>[] = [];
  const worker = async () => { while (true) { const index = cursor; cursor += 1; if (index >= items.length) return; const item = items[index]; try { await task(item); } catch (err) { failures.push({ item, error: message(err) }); } finally { completed += 1; onProgress?.(completed, items.length, failures.length); } } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker())); return failures;
}

async function withTransientRetry<T>(task: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { return await task(); }
    catch (err) { lastError = err; const text = message(err); const transient = /\b429\b|too many requests|resource_exhausted|rate.?limit|\b502\b|\b503\b|\b504\b/i.test(text); if (!transient || attempt === maxAttempts - 1) throw err; const delayMs = Math.min(30_000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 750); await new Promise((resolve) => window.setTimeout(resolve, delayMs)); }
  }
  throw lastError;
}

function imageConcurrencyProfile(provider: ImageProvider) { if (provider === 'gemini') return { defaultConcurrency: 4, maxConcurrency: 8 }; if (provider === 'openai') return { defaultConcurrency: 3, maxConcurrency: 6 }; if (provider === 'grok-cli') return { defaultConcurrency: 2, maxConcurrency: 3 }; return { defaultConcurrency: 2, maxConcurrency: 3 }; }
function videoConcurrencyProfile(provider: VideoProvider) { return provider === 'google-flow' || provider === 'magnific' ? { defaultConcurrency: 1, maxConcurrency: provider === 'magnific' ? 3 : 1 } : { defaultConcurrency: 2, maxConcurrency: 3 }; }
function videoProviderReady(system: SystemStatus | null, provider: VideoProvider) { if (!system) return false; if (provider === 'google-flow') return Boolean(system.videoProviders?.googleFlow.configured); if (provider === 'magnific') return Boolean(system.videoProviders?.magnific.configured); return Boolean(system.videoProviders?.grokCli.configured); }
function videoProviderLabel(provider: VideoProvider) { if (provider === 'google-flow') return 'Google Flow'; if (provider === 'magnific') return 'Magnific · MiniMax'; return 'Grok CLI'; }
function resolveConcurrency(requested: number, defaultConcurrency: number, maxConcurrency: number) { if (!Number.isFinite(requested) || requested <= 0) return defaultConcurrency; return Math.max(1, Math.min(maxConcurrency, Math.round(requested))); }
function draftPatch(draft: SceneDraft) { return { title: draft.title.trim(), imagePrompt: draft.imagePrompt.trim(), videoPrompt: draft.videoPrompt.trim(), sourceStart: Number(draft.sourceStart), sourceEnd: Number(draft.sourceEnd), enabled: draft.enabled }; }
function sameDraft(a: SceneDraft | undefined, b: SceneDraft) { return Boolean(a && a.title === b.title && a.imagePrompt === b.imagePrompt && a.videoPrompt === b.videoPrompt && a.sourceStart === b.sourceStart && a.sourceEnd === b.sourceEnd && a.enabled === b.enabled); }
function ExportProgress({ job, onStop }: { job: ExportStatus; onStop: () => void }) { const progress = Math.max(0, Math.min(100, job.progress || 0)); const preparing = job.state === 'running' && job.speed.startsWith('Preparing'); const title = job.state === 'completed' ? 'Export complete' : job.state === 'failed' ? 'Export failed' : job.state === 'stopped' ? 'Export paused' : preparing ? 'Preparing export' : job.resumed ? 'Resuming master' : 'Rendering master'; return <div className={`exportProgress ${job.state}`}><div className="exportProgressHead"><strong>{title}</strong><span>{progress.toFixed(1)}%</span></div><div className="progressTrack"><span style={{ width: `${progress}%` }} /></div><div className="exportMeta"><span>{job.encoder || 'FFmpeg'}</span>{job.speed && <span>{job.speed}</span>}{job.checkpointTotal ? <span>{job.checkpointCompleted || 0}/{job.checkpointTotal} checkpoints</span> : null}{job.frame > 0 && <span>{job.frame.toLocaleString()} frames</span>}</div>{job.state === 'running' && !preparing && <button className="danger exportStop" onClick={onStop}>{job.resumable ? 'Stop and keep checkpoints' : 'Stop rendering'}</button>}{job.state === 'stopped' && job.resumable && <small>Choose Render final video again to resume.</small>}</div>; }
function SystemItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) { return <div className="systemItem"><span className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '×'}</span><div><strong>{label}</strong><small>{detail}</small></div></div>; }
function providerReady(system: SystemStatus | null, provider: ImageProvider) { if (!system) return false; if (provider === 'gemini') return system.imageProviders.gemini.configured; if (provider === 'openai') return system.imageProviders.openai.configured; if (provider === 'grok-cli') return system.imageProviders.grokCli.configured; return system.imageProviders.codexCli.configured; }
function providerLabel(provider: ImageProvider | 'manual') { if (provider === 'gemini') return 'Gemini API'; if (provider === 'openai') return 'OpenAI Images API'; if (provider === 'grok-cli') return 'Grok CLI'; if (provider === 'manual') return 'Manual image'; return 'Codex CLI'; }
function formatTime(seconds: number) { const safe = Math.max(0, Number(seconds) || 0); const minutes = Math.floor(safe / 60); const remaining = Math.floor(safe % 60); return `${minutes}:${String(remaining).padStart(2, '0')}`; }
function draftFromScene(scene: BrollScene): SceneDraft { return { title: scene.title, imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt ?? '', sourceStart: scene.sourceStart.toFixed(2), sourceEnd: scene.sourceEnd.toFixed(2), enabled: scene.enabled }; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export default App;
