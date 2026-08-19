import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type BrollPlan,
  type BrollScene,
  type Edl,
  type ExportStatus,
  type KeepRange,
  type Project,
  type SystemStatus,
  type Word,
} from './api';
import './settings.css';

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [proxyUrl, setProxyUrl] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [broll, setBroll] = useState<BrollPlan | null>(null);
  const [brollPrompts, setBrollPrompts] = useState<Record<string, string>>({});
  const [brollGenerating, setBrollGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [intensity, setIntensity] = useState<'light' | 'balanced' | 'aggressive'>('balanced');
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    elevenLabsApiKey: '',
    openAiApiKey: '',
    codexBin: '',
    ffmpegBin: '',
    ffprobeBin: '',
    projectsDir: '',
  });
  const [status, setStatus] = useState('Choose an iPhone video to begin.');
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
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, exportRunning]);

  const index = useMemo(() => new Map(words.map((word, i) => [word.id, i])), [words]);
  const keepMask = useMemo(() => {
    const mask = words.map(() => false);
    for (const range of edl?.keepRanges ?? []) {
      const start = index.get(range.startWordId);
      const end = index.get(range.endWordId);
      if (start === undefined || end === undefined) continue;
      for (let i = start; i <= end; i += 1) mask[i] = true;
    }
    return mask;
  }, [words, edl, index]);

  const previewSegments = useMemo(() => (edl?.keepRanges ?? []).map((range) => {
    const start = words[index.get(range.startWordId) ?? -1];
    const end = words[index.get(range.endWordId) ?? -1];
    return start && end ? { start: Math.max(0, start.start - 0.08), end: end.end + 0.12 } : null;
  }).filter(Boolean) as Array<{ start: number; end: number }>, [edl, words, index]);

  function resetBroll() {
    setBroll(null);
    setBrollPrompts({});
    setBrollGenerating(null);
  }

  function applyBrollPlan(plan: BrollPlan) {
    setBroll(plan);
    setBrollPrompts(Object.fromEntries(plan.scenes.map((scene) => [scene.id, scene.imagePrompt])));
  }

  async function refreshSystem() {
    try {
      const result = await api.settings();
      setSystem(result);
      setSettingsForm((current) => ({
        ...current,
        codexBin: result.overrides?.codexBin ?? '',
        ffmpegBin: result.overrides?.ffmpegBin ?? '',
        ffprobeBin: result.overrides?.ffprobeBin ?? '',
        projectsDir: result.overrides?.projectsDir ?? '',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function action(label: string, fn: () => Promise<void>) {
    try {
      setBusy(true);
      setError('');
      setStatus(label);
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    await action('Saving local settings…', async () => {
      const result = await api.saveSettings(settingsForm);
      setSystem(result);
      setSettingsForm((current) => ({ ...current, elevenLabsApiKey: '', openAiApiKey: '' }));
      setStatus('Settings saved. Dependencies and image generation were re-checked.');
    });
  }

  async function pick() {
    await action('Opening native file picker…', async () => {
      const selected = await api.selectProject();
      setProject(selected);
      setProxyUrl('');
      setWords([]);
      setEdl(null);
      resetBroll();
      setExportJob(null);
      setStatus('Source ready. Create lightweight working media.');
    });
  }

  async function prepare() {
    if (!project) return;
    await action('Creating proxy + analysis audio from one source pass…', async () => {
      const result = await api.prepare(project.id);
      setProxyUrl(`${result.proxyUrl}?v=${Date.now()}`);
      setStatus(`Proxy ready: ${result.proxy.width}×${result.proxy.height} @ ${result.proxy.fps} fps${result.proxy.hardware ? ' · VideoToolbox' : ''}.`);
    });
  }

  async function transcribe() {
    if (!project) return;
    await action('Transcribing with ElevenLabs Scribe…', async () => {
      const result = await api.transcribe(project.id);
      setWords(result.transcript.words);
      setEdl(result.edl);
      resetBroll();
      setStatus('Transcript ready. Run Codex cleanup or manually edit words.');
    });
  }

  async function clean() {
    if (!project) return;
    await action(`Running ${intensity} delete-only Codex cleanup…`, async () => {
      const result = await api.clean(project.id, intensity);
      setEdl(result);
      resetBroll();
      setStatus('AI edit ready. Preview instantly from the proxy; no render was created.');
    });
  }

  async function planBroll() {
    if (!project || !edl) return;
    await action('Codex is planning semantic B-roll scenes and writing image prompts…', async () => {
      const plan = await api.planBroll(project.id);
      applyBrollPlan(plan);
      setStatus(`B-roll plan ready: ${plan.scenes.length} scene${plan.scenes.length === 1 ? '' : 's'}. Review prompts before generating images.`);
    });
  }

  function maskToRanges(mask: boolean[]) {
    const ranges: KeepRange[] = [];
    let start = -1;
    for (let i = 0; i <= mask.length; i += 1) {
      if (i < mask.length && mask[i] && start < 0) start = i;
      if (start >= 0 && (i === mask.length || !mask[i])) {
        ranges.push({ startWordId: words[start].id, endWordId: words[i - 1].id, reason: 'Manual edit' });
        start = -1;
      }
    }
    return ranges;
  }

  async function toggleWord(wordIndex: number) {
    if (!project || busy || exportRunning || generatingAll) return;
    const nextMask = [...keepMask];
    nextMask[wordIndex] = !nextMask[wordIndex];
    if (!nextMask.some(Boolean)) return;
    try {
      setEdl(await api.setEdl(project.id, maskToRanges(nextMask)));
      resetBroll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function syncPreview() {
    const video = videoRef.current;
    if (!video || !previewSegments.length) return;
    const time = video.currentTime;
    if (previewSegments.some((segment) => time >= segment.start && time <= segment.end)) return;
    const next = previewSegments.find((segment) => segment.start > time);
    if (next) video.currentTime = next.start;
    else video.pause();
  }

  function replaceScene(scene: BrollScene) {
    setBroll((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === scene.id ? scene : item) } : current);
    setBrollPrompts((current) => ({ ...current, [scene.id]: scene.imagePrompt }));
  }

  async function saveScenePrompt(scene: BrollScene) {
    if (!project) return;
    const draft = (brollPrompts[scene.id] ?? scene.imagePrompt).trim();
    if (!draft || draft === scene.imagePrompt) return;
    try {
      const updated = await api.updateBrollScene(project.id, scene.id, { imagePrompt: draft });
      replaceScene(updated);
      setStatus(`Saved prompt for ${updated.title}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function generateScene(scene: BrollScene) {
    if (!project || brollGenerating || generatingAll) return;
    try {
      setError('');
      setBrollGenerating(scene.id);
      setStatus(`Generating hyper-realistic image for ${scene.title}…`);
      await saveScenePrompt(scene);
      const result = await api.generateBrollScene(project.id, scene.id);
      replaceScene(result.scene);
      setStatus(`Generated B-roll image for ${result.scene.title}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrollGenerating(null);
    }
  }

  async function generateAllBroll() {
    if (!project || !broll || generatingAll || brollGenerating) return;
    if (!system?.openaiImages?.configured) {
      setError('Add OPENAI_API_KEY in Settings before generating B-roll images.');
      return;
    }
    const confirmed = window.confirm(`Generate ${broll.scenes.length} high-quality ${system.openaiImages.model} B-roll images? This uses OpenAI API credits.`);
    if (!confirmed) return;

    setGeneratingAll(true);
    setError('');
    try {
      for (let i = 0; i < broll.scenes.length; i += 1) {
        const scene = broll.scenes[i];
        setBrollGenerating(scene.id);
        setStatus(`Generating B-roll ${i + 1}/${broll.scenes.length}: ${scene.title}…`);
        const draft = (brollPrompts[scene.id] ?? scene.imagePrompt).trim();
        if (draft && draft !== scene.imagePrompt) {
          const updated = await api.updateBrollScene(project.id, scene.id, { imagePrompt: draft });
          replaceScene(updated);
        }
        const result = await api.generateBrollScene(project.id, scene.id);
        replaceScene(result.scene);
      }
      setStatus(`Generated ${broll.scenes.length} hyper-realistic B-roll images.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrollGenerating(null);
      setGeneratingAll(false);
    }
  }

  async function exportVideo(mode: 'fast' | 'quality') {
    if (!project || exportRunning || generatingAll) return;
    try {
      setBusy(true);
      setError('');
      setStatus('Choose the export destination…');
      const started = await api.exportVideo(project.id, mode);
      setExportJob({ state: 'running', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0, outputPath: started.outputPath, encoder: started.encoder });
      setStatus(`Exporting with ${started.encoder}${started.hardware ? ' hardware acceleration' : ''}…`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(system?.ffmpeg.installed && system?.ffprobe.installed && system?.codex.installed && system?.codex.authenticated && system?.elevenLabs.configured);
  const capabilities = system?.ffmpeg.capabilities;
  const ffmpegDetail = system?.ffmpeg.path
    ? `${system.ffmpeg.path}${capabilities?.videoToolboxDecode ? ' · VT decode' : ''}${capabilities?.h264VideoToolbox ? ' · H264 VT' : ''}${capabilities?.hevcVideoToolbox ? ' · HEVC VT' : ''}`
    : 'Not detected';

  return (
    <main className="shell">
      <header className="topbar">
        <div><span className="eyebrow">REACT + VITE / LOCAL NODE SERVICE</span><h1>Video Cleaner</h1></div>
        <div className="headerActions">
          <span className={`readyBadge ${ready ? 'ready' : ''}`}>{ready ? 'System ready' : 'Setup required'}</span>
          <button className="ghost" onClick={() => setSettingsOpen((value) => !value)}>Settings</button>
          <button className="ghost" onClick={pick} disabled={busy || exportRunning || generatingAll || !system?.ffprobe.installed}>{project ? 'Change source' : 'Choose video'}</button>
        </div>
      </header>

      {settingsOpen && (
        <section className="panel settingsPanel">
          <div className="sectionTitle"><div><span className="label">LOCAL DEPENDENCIES</span><h3>Settings</h3></div><button onClick={refreshSystem} disabled={busy || exportRunning || generatingAll}>Re-check</button></div>
          <div className="systemGrid">
            <SystemItem label="Codex CLI" ok={Boolean(system?.codex.installed && system?.codex.authenticated)} detail={system?.codex.path ?? 'Not detected'} />
            <SystemItem label="FFmpeg" ok={Boolean(system?.ffmpeg.installed)} detail={ffmpegDetail} />
            <SystemItem label="FFprobe" ok={Boolean(system?.ffprobe.installed)} detail={system?.ffprobe.path ?? 'Not detected'} />
            <SystemItem label="ElevenLabs" ok={Boolean(system?.elevenLabs.configured)} detail={system?.elevenLabs.configured ? 'API key configured' : 'API key missing'} />
            <SystemItem label="B-roll Images" ok={Boolean(system?.openaiImages?.configured)} detail={system?.openaiImages?.configured ? `${system.openaiImages.model} configured` : 'OPENAI_API_KEY missing'} />
          </div>
          <div className="settingsGrid">
            <label>ElevenLabs API key<input type="password" value={settingsForm.elevenLabsApiKey} onChange={(e) => setSettingsForm({ ...settingsForm, elevenLabsApiKey: e.target.value })} placeholder={system?.elevenLabs.configured ? 'Configured — enter only to replace' : 'xi-…'} /></label>
            <label>OpenAI API key · B-roll images<input type="password" value={settingsForm.openAiApiKey} onChange={(e) => setSettingsForm({ ...settingsForm, openAiApiKey: e.target.value })} placeholder={system?.openaiImages?.configured ? 'Configured — enter only to replace' : 'sk-…'} /></label>
            <label>Codex binary override<input value={settingsForm.codexBin} onChange={(e) => setSettingsForm({ ...settingsForm, codexBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
            <label>FFmpeg binary override<input value={settingsForm.ffmpegBin} onChange={(e) => setSettingsForm({ ...settingsForm, ffmpegBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
            <label>FFprobe binary override<input value={settingsForm.ffprobeBin} onChange={(e) => setSettingsForm({ ...settingsForm, ffprobeBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
            <label>Projects directory<input value={settingsForm.projectsDir} onChange={(e) => setSettingsForm({ ...settingsForm, projectsDir: e.target.value })} placeholder={system?.projectsDir || '~/VideoCleaner/projects'} /></label>
          </div>
          <p className="muted settingsNote">Codex uses the existing CLI login for cleanup and B-roll planning. Image pixels are generated separately by {system?.openaiImages?.model || 'GPT Image'} through the OpenAI API, so that feature needs OPENAI_API_KEY. Both API keys remain in the local Node service.</p>
          <button className="primary" onClick={saveSettings} disabled={busy || exportRunning || generatingAll}>Save settings</button>
        </section>
      )}

      {!project ? (
        <section className="hero panel">
          <div className="heroMark">VC</div>
          <h2>Clean raw talking-head footage and plan visual B-roll without touching the master.</h2>
          <p>The local service creates a small proxy, cleans dialogue with Codex, then can turn each major visual idea into an editable hyper-realistic B-roll prompt and generated still.</p>
          <button className="primary" onClick={pick} disabled={busy || !system?.ffprobe.installed}>Choose iPhone video</button>
        </section>
      ) : (
        <>
          <section className="source panel">
            <div><span className="label">MASTER SOURCE</span><strong>{project.sourceName}</strong><small>Original file is referenced in place and never copied into the project workspace.</small></div>
            <div className="chips">
              <span>{project.media.width}×{project.media.height}</span>
              <span>{String(project.media.videoCodec).toUpperCase()}</span>
              {project.media.frameRate ? <span>{project.media.frameRate.toFixed(2)} fps</span> : null}
              {project.media.bitRate ? <span>{(project.media.bitRate / 1_000_000).toFixed(1)} Mbps</span> : null}
              <span>{(project.media.size / 1024 / 1024 / 1024).toFixed(2)} GB</span>
              {project.media.hdr && <span className="warn">HDR detected</span>}
            </div>
          </section>
          <section className="workflow">
            <aside className="panel controls">
              <h3>Pipeline</h3>
              <button onClick={prepare} disabled={busy || exportRunning || generatingAll || !!proxyUrl || !system?.ffmpeg.installed}>1. Create working media</button>
              <button onClick={transcribe} disabled={busy || exportRunning || generatingAll || !proxyUrl || !system?.elevenLabs.configured || !!words.length}>2. Transcribe audio</button>
              <label>Cleanup intensity<select value={intensity} onChange={(e) => setIntensity(e.target.value as typeof intensity)}><option value="light">Light</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select></label>
              <button onClick={clean} disabled={busy || exportRunning || generatingAll || !words.length || !system?.codex.authenticated}>3. Run Codex cleanup</button>
              <button onClick={planBroll} disabled={busy || exportRunning || generatingAll || !edl || !system?.codex.authenticated}>4. Plan B-roll scenes</button>
              {broll && <button className="primary" onClick={generateAllBroll} disabled={busy || exportRunning || generatingAll || !!brollGenerating || !system?.openaiImages?.configured}>Generate all B-roll images</button>}
              <small className="muted">Planning uses Codex. Image generation uses {system?.openaiImages?.model || 'GPT Image'} API credits and only runs after you click Generate.</small>
              <div className="divider" />
              <button className="primary" onClick={() => exportVideo('quality')} disabled={busy || exportRunning || generatingAll || !edl}>High quality export · Recommended</button>
              <button onClick={() => exportVideo('fast')} disabled={busy || exportRunning || generatingAll || !edl}>Fast export</button>
              <small className="muted">B-roll images are generated assets only in this version; final video compositing comes next.</small>
              {exportJob && exportJob.state !== 'idle' && <ExportProgress job={exportJob} />}
              {project.media.hdr && <p className="warningText">HDR uses HEVC/Main10 where supported. Dolby Vision dynamic metadata preservation is still not guaranteed in V1.</p>}
            </aside>
            <section className="workspace">
              <div className="panel playerCard">{proxyUrl ? <video ref={videoRef} src={proxyUrl} controls onTimeUpdate={syncPreview} onSeeked={syncPreview} /> : <div className="emptyPlayer">Working proxy not created yet.</div>}</div>
              <div className="panel transcriptCard">
                <div className="sectionTitle"><div><span className="label">EDIT DECISION LIST</span><h3>Transcript</h3></div><span className="legend"><i /> kept <i className="removedDot" /> removed</span></div>
                {words.length ? <div className="transcript">{words.map((word, i) => <button key={word.id} className={`word ${keepMask[i] ? 'kept' : 'removed'}`} title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s · click to toggle`} onClick={() => toggleWord(i)}>{word.text}</button>)}</div> : <p className="muted">Word-level timestamps will appear here after transcription.</p>}
              </div>
              <BrollPanel
                project={project}
                plan={broll}
                prompts={brollPrompts}
                generatingScene={brollGenerating}
                generatingAll={generatingAll}
                canGenerate={Boolean(system?.openaiImages?.configured)}
                onPlan={planBroll}
                onPromptChange={(sceneId, value) => setBrollPrompts((current) => ({ ...current, [sceneId]: value }))}
                onPromptBlur={saveScenePrompt}
                onGenerate={generateScene}
                onGenerateAll={generateAllBroll}
                disabled={busy || exportRunning}
              />
            </section>
          </section>
        </>
      )}
      <footer className="statusbar"><span className={busy || exportRunning || generatingAll || brollGenerating ? 'pulse' : ''}>{busy || exportRunning || generatingAll || brollGenerating ? '●' : '○'}</span> {status}{error && <strong className="error">{error}</strong>}</footer>
    </main>
  );
}

function BrollPanel({
  project,
  plan,
  prompts,
  generatingScene,
  generatingAll,
  canGenerate,
  onPlan,
  onPromptChange,
  onPromptBlur,
  onGenerate,
  onGenerateAll,
  disabled,
}: {
  project: Project;
  plan: BrollPlan | null;
  prompts: Record<string, string>;
  generatingScene: string | null;
  generatingAll: boolean;
  canGenerate: boolean;
  onPlan: () => void;
  onPromptChange: (sceneId: string, value: string) => void;
  onPromptBlur: (scene: BrollScene) => void;
  onGenerate: (scene: BrollScene) => void;
  onGenerateAll: () => void;
  disabled: boolean;
}) {
  return <section className="panel brollPanel">
    <div className="sectionTitle brollTitle">
      <div><span className="label">CODEX B-ROLL DIRECTOR</span><h3>Hyper-realistic scene images</h3></div>
      <div className="brollActions">
        <button onClick={onPlan} disabled={disabled || generatingAll || !!generatingScene}>{plan ? 'Re-plan scenes' : 'Plan scenes'}</button>
        {plan && <button className="primary" onClick={onGenerateAll} disabled={disabled || generatingAll || !!generatingScene || !canGenerate}>{generatingAll ? 'Generating…' : 'Generate all'}</button>}
      </div>
    </div>
    {!plan ? (
      <div className="brollEmpty">
        <strong>Turn the cleaned narration into visual scenes.</strong>
        <p>Codex groups the kept transcript into major visual ideas and writes production-ready prompts tuned to the supplied reference style: premium Indian healthcare/lifestyle photography, natural skin and anatomy, realistic clinic/home environments, shallow depth of field and clean 9:16-safe composition.</p>
      </div>
    ) : (
      <>
        <div className="styleStrip"><strong>{plan.orientation === 'portrait' ? '9:16 vertical' : '16:9 landscape'}</strong><span>{plan.scenes.length} scenes</span><span>High-realism commercial photography</span><span>No text / logos</span></div>
        <div className="brollGrid">
          {plan.scenes.map((scene) => {
            const generating = generatingScene === scene.id;
            const imageUrl = scene.generatedAt ? api.brollImageUrl(project.id, scene.id, scene.generatedAt) : '';
            return <article className="brollCard" key={scene.id}>
              <div className={`brollImage ${plan.orientation}`}>
                {imageUrl ? <img src={imageUrl} alt={`${scene.title} B-roll`} /> : <div className="brollPlaceholder"><span>{generating ? 'Generating image…' : scene.id.toUpperCase()}</span><small>{scene.shotType || 'B-roll still'}</small></div>}
              </div>
              <div className="brollBody">
                <div className="sceneMeta"><span>{scene.sourceStart.toFixed(1)}–{scene.sourceEnd.toFixed(1)}s</span><span>{scene.shotType}</span></div>
                <h4>{scene.title}</h4>
                <p className="sceneNarration">“{scene.narration}”</p>
                {scene.visualIntent && <p className="visualIntent">{scene.visualIntent}</p>}
                <label>Image prompt<textarea value={prompts[scene.id] ?? scene.imagePrompt} onChange={(e) => onPromptChange(scene.id, e.target.value)} onBlur={() => onPromptBlur(scene)} rows={9} /></label>
                <button className={scene.generatedAt ? '' : 'primary'} onClick={() => onGenerate(scene)} disabled={disabled || generatingAll || !!generatingScene || !canGenerate}>{generating ? 'Generating…' : scene.generatedAt ? 'Regenerate image' : 'Generate image'}</button>
              </div>
            </article>;
          })}
        </div>
      </>
    )}
  </section>;
}

function ExportProgress({ job }: { job: ExportStatus }) {
  const progress = Math.max(0, Math.min(100, job.progress || 0));
  return <div className={`exportProgress ${job.state}`}>
    <div className="exportProgressHead"><strong>{job.state === 'completed' ? 'Export complete' : job.state === 'failed' ? 'Export failed' : 'Rendering master'}</strong><span>{progress.toFixed(1)}%</span></div>
    <div className="progressTrack"><span style={{ width: `${progress}%` }} /></div>
    <div className="exportMeta"><span>{job.encoder || 'FFmpeg'}</span>{job.speed && <span>{job.speed}</span>}{job.frame > 0 && <span>{job.frame.toLocaleString()} frames</span>}</div>
  </div>;
}

function SystemItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return <div className="systemItem"><span className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '×'}</span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

export default App;
