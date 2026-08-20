import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type BrollPlan,
  type BrollPlanSettings,
  type BrollScene,
  type Edl,
  type ExportStatus,
  type ImageProvider,
  type KeepRange,
  type Project,
  type SystemStatus,
  type Word,
} from './api';
import './settings.css';

type SceneDraft = { title: string; imagePrompt: string; videoPrompt: string; sourceStart: string; sourceEnd: string; enabled: boolean };

type ParallelFailure<T> = { item: T; error: string };

const DEFAULT_BROLL: BrollPlanSettings = {
  workflowMode: 'cleaned-video', provider: 'gemini', countMode: 'auto', targetCount: 6, imagesPerMinute: 5,
  minSceneDuration: 3, maxSceneDuration: 8, aspectRatio: 'auto',
};

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [proxyUrl, setProxyUrl] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [broll, setBroll] = useState<BrollPlan | null>(null);
  const [brollSettings, setBrollSettings] = useState<BrollPlanSettings>(DEFAULT_BROLL);
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, SceneDraft>>({});
  const [brollGenerating, setBrollGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [parallelRunning, setParallelRunning] = useState<string[]>([]);
  const [imageConcurrency, setImageConcurrency] = useState(0);
  const [videoConcurrency, setVideoConcurrency] = useState(0);
  const [intensity, setIntensity] = useState<'light' | 'balanced' | 'aggressive'>('balanced');
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    elevenLabsApiKey: '', openAiApiKey: '', geminiApiKey: '', imageProvider: 'gemini',
    openAiImageModel: '', geminiImageModel: '', grokModel: '', grokVideoModel: '',
    codexBin: '', grokBin: '', ffmpegBin: '', ffprobeBin: '', projectsDir: '',
  });
  const [status, setStatus] = useState('Choose a video to begin.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportJob, setExportJob] = useState<ExportStatus | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { refreshSystem(); }, []);
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
      } catch (err) { if (!cancelled) setError(message(err)); }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, exportRunning]);

  const index = useMemo(() => new Map(words.map((word, i) => [word.id, i])), [words]);
  const keepMask = useMemo(() => {
    const mask = words.map(() => false);
    for (const range of edl?.keepRanges ?? []) {
      const start = index.get(range.startWordId); const end = index.get(range.endWordId);
      if (start === undefined || end === undefined) continue;
      for (let i = start; i <= end; i += 1) mask[i] = true;
    }
    return mask;
  }, [words, edl, index]);
  const previewSegments = useMemo(() => (edl?.keepRanges ?? []).map((range) => {
    const start = words[index.get(range.startWordId) ?? -1]; const end = words[index.get(range.endWordId) ?? -1];
    return start && end ? { start: Math.max(0, start.start - 0.08), end: end.end + 0.12 } : null;
  }).filter(Boolean) as Array<{ start: number; end: number }>, [edl, words, index]);

  function applyBrollPlan(plan: BrollPlan) {
    setBroll(plan); setBrollSettings(plan.settings);
    setSceneDrafts(Object.fromEntries(plan.scenes.map((scene) => [scene.id, draftFromScene(scene)])));
  }
  function resetBroll() { setBroll(null); setSceneDrafts({}); setBrollGenerating(null); setParallelRunning([]); }

  async function refreshSystem() {
    try {
      const result = await api.settings(); setSystem(result);
      const provider = result.overrides?.imageProvider || result.imageProvider || 'gemini';
      setSettingsForm((current) => ({
        ...current, imageProvider: provider,
        codexBin: result.overrides?.codexBin ?? '', grokBin: result.overrides?.grokBin ?? '', ffmpegBin: result.overrides?.ffmpegBin ?? '', ffprobeBin: result.overrides?.ffprobeBin ?? '', projectsDir: result.overrides?.projectsDir ?? '',
        openAiImageModel: result.overrides?.openAiImageModel ?? '', geminiImageModel: result.overrides?.geminiImageModel ?? '', grokModel: result.overrides?.grokModel ?? '', grokVideoModel: result.overrides?.grokVideoModel ?? '',
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
      setSettingsForm((current) => ({ ...current, elevenLabsApiKey: '', openAiApiKey: '', geminiApiKey: '' }));
      setBrollSettings((current) => ({ ...current, provider: result.imageProvider }));
      setStatus('Settings saved. Local CLIs and providers were re-checked.');
    });
  }

  async function pick() {
    await action('Opening native file picker…', async () => {
      const selected = await api.selectProject(); setProject(selected); setProxyUrl(''); setWords([]); setEdl(null); resetBroll(); setExportJob(null);
      setStatus('Source ready. Use the cleaning flow, or jump directly to B-roll planning.');
    });
  }
  async function prepare() { if (!project) return; await action('Creating proxy + analysis audio from one source pass…', async () => { const result = await api.prepare(project.id); setProxyUrl(`${result.proxyUrl}?v=${Date.now()}`); setStatus(`Proxy ready: ${result.proxy.width}×${result.proxy.height} @ ${result.proxy.fps} fps${result.proxy.hardware ? ' · VideoToolbox' : ''}.`); }); }
  async function transcribe() { if (!project) return; await action('Transcribing source audio with ElevenLabs Scribe…', async () => { const result = await api.transcribe(project.id); setWords(result.transcript.words); setEdl(result.edl); resetBroll(); setStatus('Transcript ready. Clean it, or plan B-roll directly from the raw narration.'); }); }
  async function clean() { if (!project) return; await action(`Running ${intensity} delete-only Codex cleanup…`, async () => { const result = await api.clean(project.id, intensity); setEdl(result); resetBroll(); setStatus('Cleaned dialogue EDL ready.'); }); }
  async function planBroll() { if (!project) return; await action('Codex is analyzing narration, timing scenes and writing B-roll prompts…', async () => { const result = await api.planBroll(project.id, brollSettings); setWords(result.transcript.words); setEdl(result.edl); applyBrollPlan(result.plan); setStatus(`B-roll plan ready: ${result.plan.scenes.length} scene${result.plan.scenes.length === 1 ? '' : 's'}.`); }); }

  function maskToRanges(mask: boolean[]) {
    const ranges: KeepRange[] = []; let start = -1;
    for (let i = 0; i <= mask.length; i += 1) { if (i < mask.length && mask[i] && start < 0) start = i; if (start >= 0 && (i === mask.length || !mask[i])) { ranges.push({ startWordId: words[start].id, endWordId: words[i - 1].id, reason: 'Manual edit' }); start = -1; } }
    return ranges;
  }
  async function toggleWord(wordIndex: number) { if (!project || busy || exportRunning || generatingAll) return; const nextMask = [...keepMask]; nextMask[wordIndex] = !nextMask[wordIndex]; if (!nextMask.some(Boolean)) return; try { setEdl(await api.setEdl(project.id, maskToRanges(nextMask))); resetBroll(); } catch (err) { setError(message(err)); } }
  function syncPreview() { const video = videoRef.current; if (!video || !previewSegments.length) return; const time = video.currentTime; if (previewSegments.some((segment) => time >= segment.start && time <= segment.end)) return; const next = previewSegments.find((segment) => segment.start > time); if (next) video.currentTime = next.start; else video.pause(); }

  function replaceScene(scene: BrollScene) { setBroll((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === scene.id ? scene : item) } : current); setSceneDrafts((current) => ({ ...current, [scene.id]: draftFromScene(scene) })); }
  function changeDraft(sceneId: string, patch: Partial<SceneDraft>) { setSceneDrafts((current) => ({ ...current, [sceneId]: { ...current[sceneId], ...patch } })); }
  async function saveScene(scene: BrollScene) {
    if (!project) return scene; const draft = sceneDrafts[scene.id] ?? draftFromScene(scene);
    const updated = await api.updateBrollScene(project.id, scene.id, { title: draft.title.trim(), imagePrompt: draft.imagePrompt.trim(), videoPrompt: draft.videoPrompt.trim(), sourceStart: Number(draft.sourceStart), sourceEnd: Number(draft.sourceEnd), enabled: draft.enabled }); replaceScene(updated); return updated;
  }

  async function generateScene(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Generating ${scene.title} with ${providerLabel(broll?.settings.provider ?? brollSettings.provider)}…`); const saved = await saveScene(scene); const result = await api.generateBrollScene(project.id, saved.id); replaceScene(result.scene); setStatus(`Generated ${result.scene.title}.`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function importSceneImage(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Choose a local image for ${scene.title}…`); const saved = await saveScene(scene); const result = await api.importBrollImage(project.id, saved.id); replaceScene(result.scene); setStatus(`Manual B-roll image added for ${result.scene.title}.`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function deleteScene(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    if (!window.confirm(`Delete ${scene.title} from the B-roll plan? Its generated/manual image and video will also be removed.`)) return;
    try { setError(''); setBrollGenerating(scene.id); const plan = await api.deleteBrollScene(project.id, scene.id); applyBrollPlan(plan); setStatus(`Deleted ${scene.title}.`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function rewriteVideoPrompt(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try { setError(''); setBrollGenerating(scene.id); setStatus(`Codex is writing a motion prompt for ${scene.title}…`); await saveScene(scene); const updated = await api.createBrollVideoPrompt(project.id, scene.id); replaceScene(updated); setStatus(`Video prompt ready for ${updated.title}. You can edit it before regenerating video.`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function createSceneVideo(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    if (!system?.brollVideo?.configured) { setError('Codex + Grok CLI must be available in Settings before creating B-roll video.'); return; }
    try { setError(''); setBrollGenerating(scene.id); setStatus(`${scene.videoPrompt ? 'Creating' : 'Codex is prompting, then creating'} video for ${scene.title} with Grok CLI…`); const saved = await saveScene(scene); const result = await api.createBrollVideo(project.id, saved.id); replaceScene(result.scene); setStatus(`B-roll video ready for ${result.scene.title}.`); }
    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }
  }

  async function finalizeParallelPlan(scenes: BrollScene[]) {
    if (!project || !scenes.length) return;
    await api.updateBrollScene(project.id, scenes[0].id, { title: scenes[0].title });
    applyBrollPlan(await api.getBroll(project.id));
  }

  async function generateAllBroll() {
    if (!project || !broll || generatingAll || brollGenerating) return;
    if (!providerReady(system, broll.settings.provider)) { setError(`${providerLabel(broll.settings.provider)} is not configured/available in Settings.`); return; }
    const profile = imageConcurrencyProfile(broll.settings.provider);
    const concurrency = resolveConcurrency(imageConcurrency, profile.defaultConcurrency, profile.maxConcurrency);
    const provider = providerLabel(broll.settings.provider);
    if (!window.confirm(`Generate ${broll.scenes.length} B-roll image${broll.scenes.length === 1 ? '' : 's'} using ${provider} with up to ${concurrency} parallel worker${concurrency === 1 ? '' : 's'}?`)) return;
    setGeneratingAll(true); setParallelRunning([]); setError('');
    try {
      const savedScenes: BrollScene[] = [];
      for (const scene of broll.scenes) savedScenes.push(await saveScene(scene));
      const failures = await runParallel(savedScenes, concurrency, async (scene) => {
        setParallelRunning((current) => current.includes(scene.id) ? current : [...current, scene.id]);
        try { const result = await withTransientRetry(() => api.generateBrollScene(project.id, scene.id)); replaceScene(result.scene); }
        finally { setParallelRunning((current) => current.filter((id) => id !== scene.id)); }
      }, (completed, total, failed) => setStatus(`Generating images in parallel · ${completed}/${total} finished${failed ? ` · ${failed} failed` : ''}`));
      await finalizeParallelPlan(savedScenes);
      const succeeded = savedScenes.length - failures.length;
      setStatus(`Parallel image generation complete: ${succeeded}/${savedScenes.length} succeeded using ${concurrency} worker${concurrency === 1 ? '' : 's'}.`);
      if (failures.length) setError(`${failures.length} image job${failures.length === 1 ? '' : 's'} failed. ${failures[0].error}`);
    } catch (err) { setError(message(err)); }
    finally { setParallelRunning([]); setGeneratingAll(false); }
  }

  async function generateAllVideos() {
    if (!project || !broll || generatingAll || brollGenerating) return;
    if (!system?.brollVideo?.configured) { setError('Codex + Grok CLI must be available in Settings before creating B-roll videos.'); return; }
    const scenes = broll.scenes.filter((scene) => scene.imageFile);
    if (!scenes.length) { setError('Generate or add at least one B-roll image before creating videos.'); return; }
    const concurrency = resolveConcurrency(videoConcurrency, 2, 3);
    if (!window.confirm(`Create ${scenes.length} B-roll video${scenes.length === 1 ? '' : 's'} with Grok CLI using up to ${concurrency} parallel worker${concurrency === 1 ? '' : 's'}?`)) return;
    setGeneratingAll(true); setParallelRunning([]); setError('');
    try {
      const savedScenes: BrollScene[] = [];
      for (const scene of scenes) savedScenes.push(await saveScene(scene));
      const failures = await runParallel(savedScenes, concurrency, async (scene) => {
        setParallelRunning((current) => current.includes(scene.id) ? current : [...current, scene.id]);
        try { const result = await withTransientRetry(() => api.createBrollVideo(project.id, scene.id), 3); replaceScene(result.scene); }
        finally { setParallelRunning((current) => current.filter((id) => id !== scene.id)); }
      }, (completed, total, failed) => setStatus(`Creating B-roll videos in parallel · ${completed}/${total} finished${failed ? ` · ${failed} failed` : ''}`));
      await finalizeParallelPlan(savedScenes);
      const succeeded = savedScenes.length - failures.length;
      setStatus(`Parallel video generation complete: ${succeeded}/${savedScenes.length} succeeded using ${concurrency} worker${concurrency === 1 ? '' : 's'}.`);
      if (failures.length) setError(`${failures.length} video job${failures.length === 1 ? '' : 's'} failed. ${failures[0].error}`);
    } catch (err) { setError(message(err)); }
    finally { setParallelRunning([]); setGeneratingAll(false); }
  }

  async function exportBaseVideo(mode: 'fast' | 'quality') { if (!project || exportRunning) return; await startExport('Choose cleaned-video destination…', () => api.exportVideo(project.id, mode)); }
  async function exportBrollVideo(mode: 'fast' | 'quality') { if (!project || !broll || exportRunning) return; await startExport('Choose B-roll-video destination…', () => api.exportBrollVideo(project.id, mode)); }
  async function startExport(label: string, starter: () => Promise<{ outputPath: string; encoder: string; hardware: boolean }>) {
    try { setBusy(true); setError(''); setStatus(label); const started = await starter(); setExportJob({ state: 'running', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0, outputPath: started.outputPath, encoder: started.encoder }); setStatus(`Exporting with ${started.encoder}${started.hardware ? ' hardware acceleration' : ''}…`); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function exportAssets() { if (!project || !broll) return; await action('Choose a folder for B-roll assets + timing data…', async () => { const result = await api.exportBrollAssets(project.id); setStatus(`B-roll package exported: ${result.destination}`); }); }

  const ready = Boolean(system?.ffmpeg.installed && system?.ffprobe.installed && system?.codex.installed && system?.codex.authenticated && system?.elevenLabs.configured);
  const capabilities = system?.ffmpeg.capabilities;
  const ffmpegDetail = system?.ffmpeg.path ? `${system.ffmpeg.path}${capabilities?.videoToolboxDecode ? ' · VT decode' : ''}${capabilities?.h264VideoToolbox ? ' · H264 VT' : ''}${capabilities?.hevcVideoToolbox ? ' · HEVC VT' : ''}` : 'Not detected';

  return (
    <main className="shell">
      <header className="topbar"><div><span className="eyebrow">LOCAL AI VIDEO PIPELINE</span><h1>Video Cleaner</h1></div><div className="headerActions"><span className={`readyBadge ${ready ? 'ready' : ''}`}>{ready ? 'Core ready' : 'Setup required'}</span><button className="ghost" onClick={() => setSettingsOpen((value) => !value)}>Settings</button><button className="ghost" onClick={pick} disabled={busy || exportRunning || generatingAll || !system?.ffprobe.installed}>{project ? 'Change source' : 'Choose video'}</button></div></header>

      {settingsOpen && <SettingsPanel system={system} form={settingsForm} setForm={setSettingsForm} save={saveSettings} refresh={refreshSystem} disabled={busy || exportRunning || generatingAll} ffmpegDetail={ffmpegDetail} />}

      {!project ? <section className="hero panel"><div className="heroMark">VC</div><h2>Clean dialogue, generate hyper-real B-roll, or use B-roll as a standalone tool.</h2><p>Choose a raw video. Run the full cleaner flow, skip cleanup and go straight to B-roll, or export only assets plus timing JSON.</p><button className="primary" onClick={pick} disabled={busy || !system?.ffprobe.installed}>Choose video</button></section> : <>
        <section className="source panel"><div><span className="label">MASTER SOURCE</span><strong>{project.sourceName}</strong><small>Original media stays referenced in place.</small></div><div className="chips"><span>{project.media.width}×{project.media.height}</span><span>{String(project.media.videoCodec).toUpperCase()}</span>{project.media.frameRate ? <span>{project.media.frameRate.toFixed(2)} fps</span> : null}<span>{(project.media.size / 1024 / 1024 / 1024).toFixed(2)} GB</span>{project.media.hdr && <span className="warn">HDR</span>}</div></section>
        <section className="workflow"><aside className="panel controls"><h3>Dialogue flow</h3><button onClick={prepare} disabled={busy || exportRunning || !!proxyUrl || !system?.ffmpeg.installed}>1. Create proxy + audio</button><button onClick={transcribe} disabled={busy || exportRunning || !system?.elevenLabs.configured || !!words.length}>2. Transcribe audio</button><label>Cleanup intensity<select value={intensity} onChange={(e) => setIntensity(e.target.value as typeof intensity)}><option value="light">Light</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select></label><button onClick={clean} disabled={busy || exportRunning || !system?.codex.authenticated}>3. Clean with Codex</button><div className="divider" /><button onClick={() => exportBaseVideo('quality')} disabled={busy || exportRunning || !edl}>Export cleaned video only</button>{exportJob && exportJob.state !== 'idle' && <ExportProgress job={exportJob} />}</aside>
          <section className="workspace"><div className="panel playerCard">{proxyUrl ? <video ref={videoRef} src={proxyUrl} controls onTimeUpdate={syncPreview} onSeeked={syncPreview} /> : <div className="emptyPlayer">Proxy is optional for standalone B-roll.</div>}</div><div className="panel transcriptCard"><div className="sectionTitle"><div><span className="label">EDIT DECISION LIST</span><h3>Transcript</h3></div><span className="legend"><i /> kept <i className="removedDot" /> removed</span></div>{words.length ? <div className="transcript">{words.map((word, i) => <button key={word.id} className={`word ${keepMask[i] ? 'kept' : 'removed'}`} title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`} onClick={() => toggleWord(i)}>{word.text}</button>)}</div> : <p className="muted">No transcript yet. Raw/asset-only B-roll planning can create it automatically.</p>}</div></section>
        </section>
        <BrollWorkspace project={project} system={system} plan={broll} settings={brollSettings} setSettings={setBrollSettings} drafts={sceneDrafts} changeDraft={changeDraft} planBroll={planBroll} generateScene={generateScene} importSceneImage={importSceneImage} deleteScene={deleteScene} rewriteVideoPrompt={rewriteVideoPrompt} createSceneVideo={createSceneVideo} generateAll={generateAllBroll} generateAllVideos={generateAllVideos} saveScene={saveScene} generating={brollGenerating} parallelRunning={parallelRunning} generatingAll={generatingAll} busy={busy || exportRunning} exportAssets={exportAssets} exportVideo={() => exportBrollVideo('quality')} imageConcurrency={imageConcurrency} setImageConcurrency={setImageConcurrency} videoConcurrency={videoConcurrency} setVideoConcurrency={setVideoConcurrency} />
      </>}
      <footer className="statusbar"><span className={busy || exportRunning || generatingAll ? 'pulse' : ''}>{busy || exportRunning || generatingAll ? '●' : '○'}</span> {status}{error && <strong className="error">{error}</strong>}</footer>
    </main>
  );
}

function SettingsPanel({ system, form, setForm, save, refresh, disabled, ffmpegDetail }: any) {
  return <section className="panel settingsPanel">
    <div className="sectionTitle"><div><span className="label">LOCAL DEPENDENCIES + IMAGE / VIDEO PROVIDERS</span><h3>Settings</h3></div><button onClick={refresh} disabled={disabled}>Re-check</button></div>
    <div className="systemGrid"><SystemItem label="Codex CLI" ok={Boolean(system?.codex.installed && system?.codex.authenticated)} detail={system?.codex.path ?? 'Not detected'} /><SystemItem label="Grok CLI" ok={Boolean(system?.grok.installed)} detail={system?.grok.path ?? 'Not detected'} /><SystemItem label="B-roll Video" ok={Boolean(system?.brollVideo?.configured)} detail={system?.brollVideo?.configured ? `${system.brollVideo.provider} · ${system.brollVideo.model}` : 'Codex + Grok CLI required'} /><SystemItem label="FFmpeg" ok={Boolean(system?.ffmpeg.installed)} detail={ffmpegDetail} /><SystemItem label="ElevenLabs" ok={Boolean(system?.elevenLabs.configured)} detail={system?.elevenLabs.configured ? 'API key configured' : 'API key missing'} /><SystemItem label="Gemini Images" ok={Boolean(system?.imageProviders?.gemini.configured)} detail={system?.imageProviders?.gemini.model ?? 'Not configured'} /><SystemItem label="OpenAI Images" ok={Boolean(system?.imageProviders?.openai.configured)} detail={system?.imageProviders?.openai.model ?? 'Not configured'} /></div>
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
      <label>Grok image-to-video model<input value={form.grokVideoModel} onChange={(e) => setForm({ ...form, grokVideoModel: e.target.value })} placeholder={system?.brollVideo?.model || 'grok-imagine-video-1.5'} /></label>
      <label>FFmpeg binary<input value={form.ffmpegBin} onChange={(e) => setForm({ ...form, ffmpegBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
      <label>FFprobe binary<input value={form.ffprobeBin} onChange={(e) => setForm({ ...form, ffprobeBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
      <label className="wide">Projects directory<input value={form.projectsDir} onChange={(e) => setForm({ ...form, projectsDir: e.target.value })} placeholder={system?.projectsDir || '~/VideoCleaner/projects'} /></label>
    </div>
    <p className="muted settingsNote">Codex writes the image-to-video motion prompt. Grok Build runs headlessly to create the MP4 and the app validates the output file. This Grok CLI video bridge is experimental and requires the local Grok environment to have image-to-video capability/authentication.</p>
    <button className="primary" onClick={save} disabled={disabled}>Save settings</button>
  </section>;
}

function BrollWorkspace({ project, system, plan, settings, setSettings, drafts, changeDraft, planBroll, generateScene, importSceneImage, deleteScene, rewriteVideoPrompt, createSceneVideo, generateAll, generateAllVideos, saveScene, generating, parallelRunning, generatingAll, busy, exportAssets, exportVideo, imageConcurrency, setImageConcurrency, videoConcurrency, setVideoConcurrency }: any) {
  const providerIsReady = providerReady(system, settings.provider);
  const imageProfile = imageConcurrencyProfile(settings.provider);
  const imageConcurrencyValue = imageConcurrency === 0 ? 0 : Math.min(imageConcurrency, imageProfile.maxConcurrency);
  const videoConcurrencyValue = videoConcurrency === 0 ? 0 : Math.min(videoConcurrency, 3);
  return <section className="panel brollPanel">
    <div className="sectionTitle brollTitle"><div><span className="label">INDEPENDENT OR IN-FLOW MODULE</span><h3>Hyper-real B-roll</h3></div><div className="brollActions"><button onClick={planBroll} disabled={busy || generatingAll || !system?.codex.authenticated || !system?.elevenLabs.configured}>{plan ? 'Re-plan scenes' : 'Plan B-roll scenes'}</button>{plan && <button className="primary" onClick={generateAll} disabled={busy || generatingAll || !!generating || !providerIsReady}>Generate all images</button>}{plan && <button onClick={generateAllVideos} disabled={busy || generatingAll || !!generating || !system?.brollVideo?.configured || !plan.scenes.some((scene: BrollScene) => scene.imageFile)}>Create all videos</button>}</div></div>
    <div className="brollConfig"><label>Workflow<select value={settings.workflowMode} onChange={(e) => setSettings({ ...settings, workflowMode: e.target.value })}><option value="cleaned-video">Proxy/audio cleaned → B-roll → final video</option><option value="raw-video">Raw video → B-roll → final video</option><option value="assets-only">Raw video → B-roll files + timing JSON</option></select></label><label>Image provider<select value={settings.provider} onChange={(e) => setSettings({ ...settings, provider: e.target.value })}><option value="gemini">Gemini API</option><option value="grok-cli">Grok CLI · experimental</option><option value="codex-cli">Codex CLI · experimental</option><option value="openai">OpenAI Images API</option></select></label><label>Parallel images<select value={imageConcurrencyValue} onChange={(e) => setImageConcurrency(Number(e.target.value))}><option value="0">Auto ({imageProfile.defaultConcurrency})</option>{Array.from({ length: imageProfile.maxConcurrency }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><label>Parallel videos<select value={videoConcurrencyValue} onChange={(e) => setVideoConcurrency(Number(e.target.value))}><option value="0">Auto (2)</option>{[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Image count<select value={settings.countMode} onChange={(e) => setSettings({ ...settings, countMode: e.target.value })}><option value="auto">Auto by semantic scenes</option><option value="exact">Exact count</option><option value="per-minute">Images per minute</option></select></label>{settings.countMode === 'exact' && <label>Exact images<input type="number" min="1" max="40" value={settings.targetCount} onChange={(e) => setSettings({ ...settings, targetCount: Number(e.target.value) })} /></label>}{settings.countMode === 'per-minute' && <label>Images / minute<input type="number" min="0.5" max="20" step="0.5" value={settings.imagesPerMinute} onChange={(e) => setSettings({ ...settings, imagesPerMinute: Number(e.target.value) })} /></label>}<label>Aspect ratio<select value={settings.aspectRatio} onChange={(e) => setSettings({ ...settings, aspectRatio: e.target.value })}><option value="auto">Auto from video</option><option value="9:16">9:16 portrait</option><option value="16:9">16:9 landscape</option></select></label><label>Min scene sec<input type="number" min="1" max="20" value={settings.minSceneDuration} onChange={(e) => setSettings({ ...settings, minSceneDuration: Number(e.target.value) })} /></label><label>Max scene sec<input type="number" min="2" max="30" value={settings.maxSceneDuration} onChange={(e) => setSettings({ ...settings, maxSceneDuration: Number(e.target.value) })} /></label></div>
    <p className="muted brollModeHelp">Bulk generation uses a bounded worker pool instead of sequential requests. Auto currently uses {imageProfile.defaultConcurrency} image workers for {providerLabel(settings.provider)} (app cap {imageProfile.maxConcurrency}) and 2 Grok video workers (app cap 3). API providers retry transient 429/5xx failures with exponential backoff; CLI providers stay deliberately conservative.</p>

    {!plan ? <div className="brollEmpty"><strong>No B-roll plan yet</strong><p>Choose the workflow and image count, then plan scenes. Codex creates semantic scene boundaries, timestamps and hyper-real prompts.</p></div> : <>
      <div className="styleStrip"><strong>{plan.scenes.length} scenes</strong><span>{plan.orientation}</span><span>{providerLabel(plan.settings.provider)}</span><span>{plan.settings.workflowMode}</span>{generatingAll && <span>{parallelRunning.length} active workers</span>}</div>
      <div className="brollGrid">{plan.scenes.map((scene: BrollScene) => {
        const draft = drafts[scene.id] ?? draftFromScene(scene);
        const isWorking = generating === scene.id || parallelRunning.includes(scene.id);
        return <article className={`brollCard ${draft.enabled ? '' : 'disabledScene'}`} key={scene.id}>
          <div className="brollMediaColumn">
            <div className={`brollImage ${plan.orientation}`}>{scene.videoFile ? <video src={api.brollVideoUrl(project.id, scene.id, scene.videoGeneratedAt)} controls muted playsInline /> : scene.imageFile ? <img src={api.brollImageUrl(project.id, scene.id, scene.generatedAt)} alt={scene.title} /> : <div className="brollPlaceholder"><span>{isWorking ? 'WORKING…' : scene.id.toUpperCase()}</span><small>{scene.shotType || 'B-roll still'}</small></div>}</div>
            <div className="assetActions"><button onClick={() => importSceneImage(scene)} disabled={busy || generatingAll || !!generating}>{scene.imageFile ? 'Replace image manually' : 'Add image manually'}</button><button className="danger" onClick={() => deleteScene(scene)} disabled={busy || generatingAll || !!generating}>Delete B-roll</button></div>
          </div>
          <div className="brollBody">
            <div className="sceneMeta"><span>{scene.id}</span><span>{scene.shotType || 'shot'}</span>{scene.provider && <span>{providerLabel(scene.provider)}</span>}{isWorking && <span>WORKING</span>}{scene.videoFile && <span className="videoBadge">VIDEO</span>}{scene.videoModel && <span>{scene.videoModel}</span>}</div>
            <label className="toggleRow"><input type="checkbox" checked={draft.enabled} onChange={(e) => changeDraft(scene.id, { enabled: e.target.checked })} /> Use this B-roll scene</label>
            <label>Scene title<input value={draft.title} onChange={(e) => changeDraft(scene.id, { title: e.target.value })} /></label>
            <div className="timingGrid"><label>Start sec<input type="number" step="0.05" min="0" value={draft.sourceStart} onChange={(e) => changeDraft(scene.id, { sourceStart: e.target.value })} /></label><label>End sec<input type="number" step="0.05" min="0" value={draft.sourceEnd} onChange={(e) => changeDraft(scene.id, { sourceEnd: e.target.value })} /></label></div>
            <p className="sceneNarration">“{scene.narration}”</p><p className="visualIntent">{scene.visualIntent}</p>
            <label>Image prompt<textarea rows={6} value={draft.imagePrompt} onChange={(e) => changeDraft(scene.id, { imagePrompt: e.target.value })} /></label>
            {scene.videoPrompt && <label>Video motion prompt<textarea rows={5} value={draft.videoPrompt} onChange={(e) => changeDraft(scene.id, { videoPrompt: e.target.value })} /></label>}
            <div className="sceneButtons"><button onClick={() => saveScene(scene)} disabled={busy || generatingAll || !!generating}>Save</button><button onClick={() => generateScene(scene)} disabled={busy || generatingAll || !!generating || !providerReady(system, plan.settings.provider)}>{isWorking ? 'Working…' : scene.imageFile ? 'Regenerate image' : 'Generate image'}</button><button className="primary" onClick={() => createSceneVideo(scene)} disabled={busy || generatingAll || !!generating || !scene.imageFile || !system?.brollVideo?.configured}>{isWorking ? 'Working…' : scene.videoFile ? 'Regenerate video' : 'Create video'}</button>{scene.imageFile && <button onClick={() => rewriteVideoPrompt(scene)} disabled={busy || generatingAll || !!generating || !system?.codex.authenticated}>{scene.videoPrompt ? 'Rewrite video prompt' : 'Create video prompt'}</button>}</div>
          </div>
        </article>;
      })}</div>
      <div className="brollFooterActions">{plan.settings.workflowMode === 'assets-only' ? <button className="primary" onClick={exportAssets} disabled={busy || generatingAll}>Export images/videos + timing JSON</button> : <button className="primary" onClick={exportVideo} disabled={busy || generatingAll || !plan.scenes.some((scene: BrollScene) => (scene.videoFile || scene.imageFile) && scene.enabled)}>Render final video with B-roll</button>}</div>
    </>}
  </section>;
}

async function runParallel<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>, onProgress?: (completed: number, total: number, failed: number) => void): Promise<ParallelFailure<T>[]> {
  if (!items.length) return [];
  let cursor = 0; let completed = 0; const failures: ParallelFailure<T>[] = [];
  const worker = async () => {
    while (true) {
      const index = cursor; cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      try { await task(item); }
      catch (err) { failures.push({ item, error: message(err) }); }
      finally { completed += 1; onProgress?.(completed, items.length, failures.length); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()));
  return failures;
}

async function withTransientRetry<T>(task: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { return await task(); }
    catch (err) {
      lastError = err;
      const text = message(err);
      const transient = /\b429\b|too many requests|resource_exhausted|rate.?limit|\b502\b|\b503\b|\b504\b/i.test(text);
      if (!transient || attempt === maxAttempts - 1) throw err;
      const delayMs = Math.min(30_000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 750);
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function imageConcurrencyProfile(provider: ImageProvider) {
  if (provider === 'gemini') return { defaultConcurrency: 4, maxConcurrency: 8 };
  if (provider === 'openai') return { defaultConcurrency: 3, maxConcurrency: 6 };
  if (provider === 'grok-cli') return { defaultConcurrency: 2, maxConcurrency: 3 };
  return { defaultConcurrency: 2, maxConcurrency: 3 };
}

function resolveConcurrency(requested: number, defaultConcurrency: number, maxConcurrency: number) {
  if (!Number.isFinite(requested) || requested <= 0) return defaultConcurrency;
  return Math.max(1, Math.min(maxConcurrency, Math.round(requested)));
}

function ExportProgress({ job }: { job: ExportStatus }) { const progress = Math.max(0, Math.min(100, job.progress || 0)); return <div className={`exportProgress ${job.state}`}><div className="exportProgressHead"><strong>{job.state === 'completed' ? 'Export complete' : job.state === 'failed' ? 'Export failed' : 'Rendering master'}</strong><span>{progress.toFixed(1)}%</span></div><div className="progressTrack"><span style={{ width: `${progress}%` }} /></div><div className="exportMeta"><span>{job.encoder || 'FFmpeg'}</span>{job.speed && <span>{job.speed}</span>}{job.frame > 0 && <span>{job.frame.toLocaleString()} frames</span>}</div></div>; }
function SystemItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) { return <div className="systemItem"><span className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '×'}</span><div><strong>{label}</strong><small>{detail}</small></div></div>; }
function providerReady(system: SystemStatus | null, provider: ImageProvider) { if (!system) return false; if (provider === 'gemini') return system.imageProviders.gemini.configured; if (provider === 'openai') return system.imageProviders.openai.configured; if (provider === 'grok-cli') return system.imageProviders.grokCli.configured; return system.imageProviders.codexCli.configured; }
function providerLabel(provider: ImageProvider | 'manual') { if (provider === 'gemini') return 'Gemini API'; if (provider === 'openai') return 'OpenAI Images API'; if (provider === 'grok-cli') return 'Grok CLI'; if (provider === 'manual') return 'Manual image'; return 'Codex CLI'; }
function draftFromScene(scene: BrollScene): SceneDraft { return { title: scene.title, imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt ?? '', sourceStart: scene.sourceStart.toFixed(2), sourceEnd: scene.sourceEnd.toFixed(2), enabled: scene.enabled }; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export default App;
