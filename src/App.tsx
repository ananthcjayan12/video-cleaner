import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Edl, type ExportStatus, type KeepRange, type Project, type SystemStatus, type Word } from './api';
import './settings.css';

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [proxyUrl, setProxyUrl] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [edl, setEdl] = useState<Edl | null>(null);
  const [intensity, setIntensity] = useState<'light' | 'balanced' | 'aggressive'>('balanced');
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ elevenLabsApiKey: '', codexBin: '', ffmpegBin: '', ffprobeBin: '', projectsDir: '' });
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
      setSettingsForm((current) => ({ ...current, elevenLabsApiKey: '' }));
      setStatus('Settings saved. Dependencies and hardware acceleration re-checked.');
    });
  }

  async function pick() {
    await action('Opening native file picker…', async () => {
      const selected = await api.selectProject();
      setProject(selected);
      setProxyUrl('');
      setWords([]);
      setEdl(null);
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
      setStatus('Transcript ready. Run Codex cleanup or manually edit words.');
    });
  }

  async function clean() {
    if (!project) return;
    await action(`Running ${intensity} delete-only Codex cleanup…`, async () => {
      const result = await api.clean(project.id, intensity);
      setEdl(result);
      setStatus('AI edit ready. Preview instantly from the proxy; no render was created.');
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
    if (!project || busy || exportRunning) return;
    const nextMask = [...keepMask];
    nextMask[wordIndex] = !nextMask[wordIndex];
    if (!nextMask.some(Boolean)) return;
    try {
      setEdl(await api.setEdl(project.id, maskToRanges(nextMask)));
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

  async function exportVideo(mode: 'fast' | 'quality') {
    if (!project || exportRunning) return;
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
          <button className="ghost" onClick={pick} disabled={busy || exportRunning || !system?.ffprobe.installed}>{project ? 'Change source' : 'Choose video'}</button>
        </div>
      </header>

      {settingsOpen && (
        <section className="panel settingsPanel">
          <div className="sectionTitle"><div><span className="label">LOCAL DEPENDENCIES</span><h3>Settings</h3></div><button onClick={refreshSystem} disabled={busy || exportRunning}>Re-check</button></div>
          <div className="systemGrid">
            <SystemItem label="Codex CLI" ok={Boolean(system?.codex.installed && system?.codex.authenticated)} detail={system?.codex.path ?? 'Not detected'} />
            <SystemItem label="FFmpeg" ok={Boolean(system?.ffmpeg.installed)} detail={ffmpegDetail} />
            <SystemItem label="FFprobe" ok={Boolean(system?.ffprobe.installed)} detail={system?.ffprobe.path ?? 'Not detected'} />
            <SystemItem label="ElevenLabs" ok={Boolean(system?.elevenLabs.configured)} detail={system?.elevenLabs.configured ? 'API key configured' : 'API key missing'} />
          </div>
          <div className="settingsGrid">
            <label>ElevenLabs API key<input type="password" value={settingsForm.elevenLabsApiKey} onChange={(e) => setSettingsForm({ ...settingsForm, elevenLabsApiKey: e.target.value })} placeholder={system?.elevenLabs.configured ? 'Configured — enter only to replace' : 'xi-…'} /></label>
            <label>Codex binary override<input value={settingsForm.codexBin} onChange={(e) => setSettingsForm({ ...settingsForm, codexBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
            <label>FFmpeg binary override<input value={settingsForm.ffmpegBin} onChange={(e) => setSettingsForm({ ...settingsForm, ffmpegBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
            <label>FFprobe binary override<input value={settingsForm.ffprobeBin} onChange={(e) => setSettingsForm({ ...settingsForm, ffprobeBin: e.target.value })} placeholder="Auto detect from PATH" /></label>
            <label className="wide">Projects directory<input value={settingsForm.projectsDir} onChange={(e) => setSettingsForm({ ...settingsForm, projectsDir: e.target.value })} placeholder={system?.projectsDir || '~/VideoCleaner/projects'} /></label>
          </div>
          <p className="muted settingsNote">Codex uses the existing local CLI login. FFmpeg capability detection automatically enables VideoToolbox decode and source-matched H.264/HEVC hardware exports where available.</p>
          <button className="primary" onClick={saveSettings} disabled={busy || exportRunning}>Save settings</button>
        </section>
      )}

      {!project ? (
        <section className="hero panel">
          <div className="heroMark">VC</div>
          <h2>Clean raw talking-head footage without touching the master.</h2>
          <p>The local service reads the original once to create a small 30 fps proxy plus analysis audio. Editing stays non-destructive; the source is rendered only at final export.</p>
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
              <button onClick={prepare} disabled={busy || exportRunning || !!proxyUrl || !system?.ffmpeg.installed}>1. Create working media</button>
              <button onClick={transcribe} disabled={busy || exportRunning || !proxyUrl || !system?.elevenLabs.configured || !!words.length}>2. Transcribe audio</button>
              <label>Cleanup intensity<select value={intensity} onChange={(e) => setIntensity(e.target.value as typeof intensity)}><option value="light">Light</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select></label>
              <button onClick={clean} disabled={busy || exportRunning || !words.length || !system?.codex.authenticated}>3. Run Codex cleanup</button>
              <div className="divider" />
              <button className="primary" onClick={() => exportVideo('quality')} disabled={busy || exportRunning || !edl}>High quality export · Recommended</button>
              <button onClick={() => exportVideo('fast')} disabled={busy || exportRunning || !edl}>Fast export</button>
              <small className="muted">High quality matches the source codec and favors source-level bitrate while still using hardware acceleration when available.</small>
              {exportJob && exportJob.state !== 'idle' && <ExportProgress job={exportJob} />}
              {project.media.hdr && <p className="warningText">HDR uses HEVC/Main10 where supported. Dolby Vision dynamic metadata preservation is still not guaranteed in V1.</p>}
            </aside>
            <section className="workspace">
              <div className="panel playerCard">{proxyUrl ? <video ref={videoRef} src={proxyUrl} controls onTimeUpdate={syncPreview} onSeeked={syncPreview} /> : <div className="emptyPlayer">Working proxy not created yet.</div>}</div>
              <div className="panel transcriptCard">
                <div className="sectionTitle"><div><span className="label">EDIT DECISION LIST</span><h3>Transcript</h3></div><span className="legend"><i /> kept <i className="removedDot" /> removed</span></div>
                {words.length ? <div className="transcript">{words.map((word, i) => <button key={word.id} className={`word ${keepMask[i] ? 'kept' : 'removed'}`} title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s · click to toggle`} onClick={() => toggleWord(i)}>{word.text}</button>)}</div> : <p className="muted">Word-level timestamps will appear here after transcription.</p>}
              </div>
            </section>
          </section>
        </>
      )}
      <footer className="statusbar"><span className={busy || exportRunning ? 'pulse' : ''}>{busy || exportRunning ? '●' : '○'}</span> {status}{error && <strong className="error">{error}</strong>}</footer>
    </main>
  );
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
