import { useMemo, useRef, useState } from 'react';

type Word = { id: string; text: string; start: number; end: number };
type KeepRange = { startWordId: string; endWordId: string; reason?: string };
type Project = { id: string; sourcePath: string; sourceUrl: string; media: any };

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [proxyUrl, setProxyUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [words, setWords] = useState<Word[]>([]);
  const [edl, setEdl] = useState<{ keepRanges: KeepRange[]; notes?: string[] } | null>(null);
  const [intensity, setIntensity] = useState<'light' | 'balanced' | 'aggressive'>('balanced');
  const [status, setStatus] = useState('Choose an iPhone video to begin.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

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

  async function pick() {
    await action('Reading source media…', async () => {
      const selected = await window.videoCleaner.pickProject();
      if (!selected) return;
      setProject(selected);
      setProxyUrl('');
      setWords([]);
      setEdl(null);
      setStatus('Source ready. Create the lightweight working media.');
    });
  }

  async function prepare() {
    if (!project) return;
    await action('Creating analysis audio and 720p proxy in parallel…', async () => {
      const result = await window.videoCleaner.prepareProject(project.id);
      setProxyUrl(result.proxyUrl);
      setStatus('Proxy ready. Transcribe the small analysis audio.');
    });
  }

  async function transcribe() {
    if (!project) return;
    await action('Transcribing with ElevenLabs Scribe…', async () => {
      const result = await window.videoCleaner.transcribe(project.id, apiKey);
      setWords(result.transcript.words);
      setEdl(result.edl);
      setStatus('Transcript ready. Run Codex cleanup or manually edit words.');
    });
  }

  async function clean() {
    if (!project) return;
    await action(`Running ${intensity} delete-only Codex cleanup…`, async () => {
      const result = await window.videoCleaner.clean(project.id, intensity);
      setEdl(result);
      setStatus('AI edit ready. Preview instantly from the proxy; no render was created.');
      if (videoRef.current && previewSegments[0]) videoRef.current.currentTime = previewSegments[0].start;
    });
  }

  function maskToRanges(mask: boolean[]) {
    const ranges: KeepRange[] = [];
    let start = -1;
    for (let i = 0; i <= mask.length; i += 1) {
      if (i < mask.length && mask[i] && start < 0) start = i;
      const closes = start >= 0 && (i === mask.length || !mask[i]);
      if (closes) {
        ranges.push({ startWordId: words[start].id, endWordId: words[i - 1].id, reason: 'Manual edit' });
        start = -1;
      }
    }
    return ranges;
  }

  async function toggleWord(wordIndex: number) {
    if (!project || busy) return;
    const nextMask = [...keepMask];
    nextMask[wordIndex] = !nextMask[wordIndex];
    if (!nextMask.some(Boolean)) return;
    const nextRanges = maskToRanges(nextMask);
    try {
      const result = await window.videoCleaner.setEdl(project.id, nextRanges);
      setEdl(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function syncPreview() {
    const video = videoRef.current;
    if (!video || !previewSegments.length) return;
    const time = video.currentTime;
    const current = previewSegments.find((segment) => time >= segment.start && time <= segment.end);
    if (current) return;
    const next = previewSegments.find((segment) => segment.start > time);
    if (next) video.currentTime = next.start;
    else video.pause();
  }

  async function exportVideo(mode: 'fast' | 'quality') {
    if (!project) return;
    await action('Rendering once from the untouched master…', async () => {
      const output = await window.videoCleaner.exportVideo(project.id, mode);
      setStatus(output ? `Export complete: ${output}` : 'Export cancelled.');
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL-FIRST / NON-DESTRUCTIVE</span>
          <h1>Video Cleaner</h1>
        </div>
        <button className="ghost" onClick={pick} disabled={busy}>{project ? 'Change source' : 'Choose video'}</button>
      </header>

      {!project ? (
        <section className="hero panel">
          <div className="heroMark">VC</div>
          <h2>Clean raw talking-head footage without touching the master.</h2>
          <p>The app creates a tiny speech file and 720p proxy. Codex edits timestamps; FFmpeg only touches the full-resolution source once, during export.</p>
          <button className="primary" onClick={pick} disabled={busy}>Choose iPhone video</button>
        </section>
      ) : (
        <>
          <section className="source panel">
            <div>
              <span className="label">MASTER SOURCE</span>
              <strong>{project.sourcePath.split('/').at(-1)}</strong>
              <small>{project.sourcePath}</small>
            </div>
            <div className="chips">
              <span>{project.media.width}×{project.media.height}</span>
              <span>{String(project.media.videoCodec).toUpperCase()}</span>
              <span>{(project.media.size / 1024 / 1024 / 1024).toFixed(2)} GB</span>
              {project.media.hdr && <span className="warn">HDR detected</span>}
            </div>
          </section>

          <section className="workflow">
            <aside className="panel controls">
              <h3>Pipeline</h3>
              <button onClick={prepare} disabled={busy || !!proxyUrl}>1. Create working media</button>
              <label>
                ElevenLabs API key
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="xi-…" />
              </label>
              <button onClick={transcribe} disabled={busy || !proxyUrl || !apiKey || !!words.length}>2. Transcribe audio</button>
              <label>
                Cleanup intensity
                <select value={intensity} onChange={(e) => setIntensity(e.target.value as typeof intensity)}>
                  <option value="light">Light</option>
                  <option value="balanced">Balanced</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </label>
              <button onClick={clean} disabled={busy || !words.length}>3. Run Codex cleanup</button>
              <div className="divider" />
              <button className="primary" onClick={() => exportVideo('fast')} disabled={busy || !edl}>Fast export</button>
              <button onClick={() => exportVideo('quality')} disabled={busy || !edl}>Quality export</button>
              {project.media.hdr && <p className="warningText">HDR/Dolby Vision is detected. V1 preserves source pixels through the trim graph, but Dolby Vision metadata preservation is not guaranteed; validate HDR exports before production use.</p>}
            </aside>

            <section className="workspace">
              <div className="panel playerCard">
                {proxyUrl ? <video ref={videoRef} src={proxyUrl} controls onTimeUpdate={syncPreview} onSeeked={syncPreview} /> : <div className="emptyPlayer">Working proxy not created yet.</div>}
              </div>

              <div className="panel transcriptCard">
                <div className="sectionTitle">
                  <div><span className="label">EDIT DECISION LIST</span><h3>Transcript</h3></div>
                  <span className="legend"><i /> kept <i className="removedDot" /> removed</span>
                </div>
                {words.length ? (
                  <div className="transcript">
                    {words.map((word, i) => (
                      <button
                        key={word.id}
                        className={`word ${keepMask[i] ? 'kept' : 'removed'}`}
                        title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s · click to toggle`}
                        onClick={() => toggleWord(i)}
                      >{word.text}</button>
                    ))}
                  </div>
                ) : <p className="muted">Word-level timestamps will appear here after transcription.</p>}
              </div>
            </section>
          </section>
        </>
      )}

      <footer className="statusbar">
        <span className={busy ? 'pulse' : ''}>{busy ? '●' : '○'}</span> {status}
        {error && <strong className="error">{error}</strong>}
      </footer>
    </main>
  );
}

export default App;
