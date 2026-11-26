import { useEffect, useRef, useState } from 'react';
import { api, type ReelSource, type StickPlanState, type StudioInfo } from '../api';
import { chooseFiles, uploadAll } from '../device-files';
import type { StickDraft, StickRender, StickTheme } from '../../server/stick-reel';
import type { NarrationJob, StickScript, StickStudioSettings } from '../../server/stick-narration';
import { SceneEditor } from './SceneEditor';
import { StudioSettings } from './StudioSettings';
import '../phone/phone.css';
import './stick.css';

/**
 * Stick-figure reels in the PractiReel phone look. Two ways in:
 *  - Write it for me: concept -> AI script -> owner approves/edits -> AI Malayalam voice -> video
 *  - Use my recording: upload a voiceover or a video with sound -> video
 * Both end in the same pipeline: captions + AI scene plan (background) -> render -> edit & render again.
 */

type Flow = { concept: string; seconds: number; mode?: 'idea' | 'link'; link?: string; sourceJobId?: string; source?: ReelSource; script?: StickScript; scriptJobId?: string; narrationJobId?: string; voiceUrl?: string; uploadId?: string; voiceSeconds?: number };
type View = 'home' | 'write' | 'script' | 'voice' | 'reel' | 'settings';
type StickData = { draft: StickDraft; render: StickRender | null; duration: number; audioUrl: string; customMusic: boolean; facePacks: string[]; themes: StickTheme[]; plan: StickPlanState };

const FLOW_KEY = 'practireel:stickFlow';
const PROJECT_KEY = 'video-cleaner:stickProject';
const AUTO_KEY = 'practireel:stickAuto';
const LENGTHS = [30, 45, 60, 90];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const loadFlow = (): Flow => { try { return { concept: '', seconds: 0, ...JSON.parse(localStorage.getItem(FLOW_KEY) || '{}') }; } catch { return { concept: '', seconds: 0 }; } };
const wordsOf = (lines: string[]) => lines.join(' ').split(/\s+/).filter(Boolean).length;

export function StickStudio() {
  const [info, setInfo] = useState<StudioInfo | null>(null);
  const [flow, setFlowState] = useState<Flow>(() => { const shared = new URLSearchParams(window.location.search).get('link'); return shared ? { concept: '', seconds: loadFlow().seconds, mode: 'link', link: shared } : loadFlow(); });
  const [projectId, setProjectId] = useState(() => localStorage.getItem(PROJECT_KEY) || '');
  const [view, setView] = useState<View>(() => {
    const shared = new URLSearchParams(window.location.search).get('link');
    if (shared) {
      // Opened with ?link=… (e.g. from a phone shortcut): start a fresh "from a link" reel.
      localStorage.removeItem(PROJECT_KEY); localStorage.removeItem(AUTO_KEY);
      localStorage.setItem(FLOW_KEY, JSON.stringify({ concept: '', seconds: loadFlow().seconds, mode: 'link', link: shared }));
      window.history.replaceState(null, '', '/?mode=stick-reel');
      return 'write';
    }
    const f = loadFlow();
    if (localStorage.getItem(PROJECT_KEY)) return 'reel';
    if (f.narrationJobId) return 'voice';
    if (f.script || f.scriptJobId) return 'script';
    return 'home';
  });
  const [back, setBack] = useState<View>('home');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [narration, setNarration] = useState<NarrationJob | null>(null);
  const [voiceChoice, setVoiceChoice] = useState('');
  const [sourceStage, setSourceStage] = useState('');
  const autoFetch = useRef(Boolean(new URLSearchParams(window.location.search).get('link')) || Boolean(loadFlow().link && loadFlow().mode === 'link' && !loadFlow().source));

  const setFlow = (patch: Partial<Flow>) => setFlowState((current) => { const next = { ...current, ...patch }; localStorage.setItem(FLOW_KEY, JSON.stringify(next)); return next; });
  const seconds = flow.seconds || info?.settings.scriptSeconds || 45;
  const show = (next: View) => { setError(''); setView(next); window.scrollTo(0, 0); };
  const openSettings = () => { setBack(view); show('settings'); };

  useEffect(() => { void api.studio().then(setInfo).catch((err) => setError(message(err))); }, []);

  // Script job (write / rewrite) runs in the background; poll it.
  useEffect(() => {
    const jobId = flow.scriptJobId; if (!jobId) return;
    let stop = false; let timer = 0;
    const tick = async () => {
      try {
        const { job } = await api.scriptJob(jobId); if (stop) return;
        if (job.state === 'ready' && job.script) { setFlow({ script: job.script, scriptJobId: undefined }); setFeedback(''); }
        else if (job.state === 'failed') { setError(job.error || 'The script could not be written.'); setFlow({ scriptJobId: undefined }); }
        else timer = window.setTimeout(tick, 2000);
      } catch (err) { if (!stop) { setError(message(err)); setFlow({ scriptJobId: undefined }); } }
    };
    timer = window.setTimeout(tick, 1500);
    return () => { stop = true; clearTimeout(timer); };
  }, [flow.scriptJobId]);

  // Link job (download + Gemini watching it); poll it.
  useEffect(() => {
    const jobId = flow.sourceJobId; if (!jobId) return;
    let stop = false; let timer = 0;
    const tick = async () => {
      try {
        const { job } = await api.sourceJob(jobId); if (stop) return;
        setSourceStage(job.stage);
        if (job.state === 'ready' && job.source) setFlow({ source: job.source, sourceJobId: undefined });
        else if (job.state === 'failed') { setError(job.error || 'The link could not be read.'); setFlow({ sourceJobId: undefined }); }
        else timer = window.setTimeout(tick, 1500);
      } catch (err) { if (!stop) { setError(message(err)); setFlow({ sourceJobId: undefined }); } }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [flow.sourceJobId]);

  // Opened from a shared link: fetch it straight away.
  useEffect(() => { if (flow.mode === 'link' && flow.link && !flow.source && !flow.sourceJobId && view === 'write' && new URLSearchParams(window.location.search).get('mode') === 'stick-reel' && autoFetch.current) { autoFetch.current = false; void fetchLink(); } }, []);

  // Narration job; poll until the voice is ready.
  useEffect(() => {
    const jobId = flow.narrationJobId; if (!jobId || flow.uploadId) return;
    let stop = false; let timer = 0;
    const tick = async () => {
      try {
        const { job, url } = await api.narration(jobId); if (stop) return;
        setNarration(job);
        if (job.state === 'ready' && job.uploadId) setFlow({ uploadId: job.uploadId, voiceUrl: url, voiceSeconds: job.seconds });
        else if (job.state === 'running') timer = window.setTimeout(tick, 1500);
      } catch (err) { if (!stop) { setError(message(err)); setNarration(null); setFlow({ narrationJobId: undefined }); } }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [flow.narrationJobId, flow.uploadId]);

  async function act(label: string, action: () => Promise<void>) {
    setError(''); setBusy(label);
    try { await action(); } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }

  const fetchLink = () => act('Starting…', async () => {
    setSourceStage('Starting…');
    const { job } = await api.fetchSource(flow.link ?? '');
    setFlow({ sourceJobId: job.id, source: undefined });
  });

  const useSource = flow.mode === 'link' && flow.source;
  const writeScript = (withFeedback?: boolean) => act('Starting…', async () => {
    const { job } = await api.writeScript({ concept: flow.concept, seconds, ...(useSource ? { source: flow.source } : {}), ...(withFeedback && flow.script ? { feedback, previous: flow.script } : {}) });
    setFlow({ scriptJobId: job.id, ...(withFeedback ? {} : { script: undefined }) });
    show('script');
  });

  const makeVoice = () => act('Starting the voice…', async () => {
    if (!flow.script) return;
    const script = { ...flow.script, lines: flow.script.lines.map((line) => line.trim()).filter(Boolean) };
    const { job } = await api.narrate(script);
    setNarration(job);
    setFlow({ script, narrationJobId: job.id, uploadId: undefined, voiceUrl: undefined, voiceSeconds: undefined });
    show('voice');
  });

  async function startVideo(uploadId: string, brief?: string) {
    const project = await api.createStick(uploadId);
    const studio = info?.settings;
    const current = await api.stick(project.id);
    const draft: StickDraft = studio ? { ...current.draft, themeId: studio.themeId, faces: studio.faces, music: studio.music, sfx: studio.sfx, useOpenverse: studio.useOpenverse, ...(studio.badge ? { badge: studio.badge } : {}) } : current.draft;
    await api.saveStick(project.id, draft);
    await api.planStick(project.id, { brief, themeId: draft.themeId });
    localStorage.setItem(PROJECT_KEY, project.id); localStorage.setItem(AUTO_KEY, project.id);
    setProjectId(project.id); show('reel');
  }

  const fromRecording = async () => {
    const files = await chooseFiles('audio/*,video/*,.mp3,.wav,.m4a,.aac,.mov,.mp4,.m4v,.webm,.mkv', false);
    if (!files.length) return;
    await act('Uploading…', async () => { const [uploadId] = await uploadAll(files, setBusy); setBusy('Setting up…'); await startVideo(uploadId); });
  };

  function newReel() {
    localStorage.removeItem(PROJECT_KEY); localStorage.removeItem(AUTO_KEY);
    const keep: Flow = { concept: '', seconds: flow.seconds };
    localStorage.setItem(FLOW_KEY, JSON.stringify(keep)); setFlowState(keep);
    setProjectId(''); setNarration(null); setFeedback(''); show('home');
  }

  const voiceLabel = info?.voices.find((v) => v.id === info.settings.voice)?.label ?? info?.settings.voice ?? '';
  const header = (title: string, onBack?: () => void, backLabel = 'Back') => (
    <>
      <div className="pr-top">
        {onBack ? <button type="button" className="pr-back" onClick={onBack}>‹ {backLabel}</button> : <a className="pr-back" href="/">‹ PractiReel</a>}
        <button type="button" className="pr-btn small" onClick={openSettings} aria-label="Stick reel settings">⚙ Settings</button>
      </div>
      <h1>{title}</h1>
    </>
  );

  if (view === 'settings' && info) {
    return <div className="pr"><StudioSettings info={info} onBack={() => show(back)} onSaved={(settings: StickStudioSettings) => setInfo({ ...info, settings })} /></div>;
  }

  if (view === 'reel' && projectId) {
    return <div className="pr"><ReelView projectId={projectId} info={info} onNew={newReel} onSettings={openSettings} onLost={newReel} /></div>;
  }

  return (
    <div className="pr">
      {view === 'home' && (
        <main className="pr-page">
          {header('Stick-figure reels')}
          <p className="muted">Your face on a stick figure that acts out the reel, with cards and captions.</p>
          {(flow.script || flow.narrationJobId) && (
            <button type="button" className="pr-inprogress" onClick={() => show(flow.narrationJobId ? 'voice' : 'script')}>
              <span className="pr-pill making">In progress</span>
              <span style={{ flex: 1 }}><strong>{flow.script?.title || 'Your script'}</strong><br /><small className="muted">{flow.narrationJobId ? 'Voice step' : 'Script step'} · tap to continue</small></span>›
            </button>
          )}
          <button type="button" className="st-choice" onClick={() => { if (flow.script || flow.narrationJobId) newReel(); setFlow({ mode: 'idea' }); show('write'); }}>
            <span className="kind">New · AI voice</span>
            <strong>Write it for me</strong>
            <span>Tell the idea. AI writes the script, you approve it, a Malayalam male voice reads it, and the video is made.</span>
          </button>
          <button type="button" className="st-choice" onClick={() => { const seconds_ = flow.seconds; newReel(); setFlow({ seconds: seconds_, mode: 'link' }); show('write'); }}>
            <span className="kind">New · from a reel you liked</span>
            <strong>From an Instagram or YouTube link</strong>
            <span>Paste a link. The AI watches it, then writes your own version for you to approve.</span>
          </button>
          <button type="button" className="st-choice" disabled={Boolean(busy)} onClick={() => void fromRecording()}>
            <span className="kind">Your voice</span>
            <strong>Use my recording</strong>
            <span>Upload a voiceover or a video with sound. We'll use your voice as it is.</span>
          </button>
          {busy && <p className="pr-info">{busy}</p>}
          {error && <p className="pr-error">{error}</p>}
        </main>
      )}

      {view === 'write' && (
        <main className="pr-page">
          {header(flow.mode === 'link' ? 'Make it from a reel' : 'What is the reel about?', () => show('home'))}
          <div className="pr-chips">
            <button type="button" className={`pr-chip${flow.mode !== 'link' ? ' on' : ''}`} onClick={() => setFlow({ mode: 'idea' })}>Type an idea</button>
            <button type="button" className={`pr-chip${flow.mode === 'link' ? ' on' : ''}`} onClick={() => setFlow({ mode: 'link' })}>From a link</button>
          </div>
          {flow.mode === 'link' && (
            <section className="pr-card pr-options">
              <label className="pr-field">Instagram or YouTube link
                <input type="url" inputMode="url" value={flow.link ?? ''} placeholder="https://www.instagram.com/reel/…" onChange={(e) => setFlow({ link: e.target.value, source: undefined })} />
              </label>
              {!flow.source && <button type="button" className="pr-btn small" disabled={!flow.link?.trim() || Boolean(flow.sourceJobId) || Boolean(busy)} onClick={() => void fetchLink()}>{flow.sourceJobId ? 'Reading…' : 'Read this reel'}</button>}
              {flow.sourceJobId && <><div className="pr-bar"><i style={{ width: '55%' }} /></div><small className="muted">{sourceStage || 'Working…'} Usually under a minute.</small></>}
              {flow.source && (
                <div className="st-source">
                  <span className="pr-pill ready">{flow.source.platform}{flow.source.uploader ? ` · ${flow.source.uploader}` : ''}{flow.source.durationSec ? ` · ${flow.source.durationSec} s` : ''}</span>
                  <strong>{flow.source.topic || flow.source.title}</strong>
                  {flow.source.summary && <p>{flow.source.summary}</p>}
                  {flow.source.keyPoints.length > 0 && <ul>{flow.source.keyPoints.slice(0, 6).map((point, i) => <li key={i}>{point}</li>)}</ul>}
                  {flow.source.transcript && <details className="st-more"><summary>What they say</summary><p style={{ whiteSpace: 'pre-wrap' }}>{flow.source.transcript}</p></details>}
                  <small className="muted">We write our own version: same topic, our words. Nothing is copied.</small>
                </div>
              )}
            </section>
          )}
          <section className="pr-card pr-options" style={flow.mode === 'link' && !flow.source ? { display: 'none' } : undefined}>
            <label className="pr-field">{flow.mode === 'link' ? 'Anything to change or add? (optional)' : 'Idea'}
              <textarea rows={flow.mode === 'link' ? 3 : 6} value={flow.concept} maxLength={3000} autoFocus={flow.mode !== 'link'}
                placeholder={flow.mode === 'link' ? 'e.g. Make it for kids’ parents, add our clinic’s free check-up offer' : "e.g. Why clinics should show the doctor's face, not the logo. Patients book faster when they already know you. End: follow for day 4."}
                onChange={(e) => setFlow({ concept: e.target.value })} />
              {flow.mode !== 'link' && <small>A line is enough. Add facts, a story or the call to action if you have them.</small>}
            </label>
            <div className="pr-field">Length<div className="pr-chips">
              {LENGTHS.map((value) => <button key={value} type="button" className={`pr-chip${seconds === value ? ' on' : ''}`} onClick={() => setFlow({ seconds: value })}>{value} s</button>)}
            </div></div>
          </section>
          {info && !info.geminiReady && <p className="pr-error">No Gemini API key is set, so the AI voice step will fail. You can still write the script.</p>}
          {error && <p className="pr-error">{error}</p>}
          {(flow.mode !== 'link' || flow.source) && <button type="button" className="pr-btn primary block" disabled={(flow.mode === 'link' ? !flow.source : !flow.concept.trim()) || Boolean(busy)} onClick={() => void writeScript(false)}>{busy || (flow.mode === 'link' ? 'Write my version' : 'Write the script')}</button>}
        </main>
      )}

      {view === 'script' && (
        <main className="pr-page">
          {header(flow.script ? 'Check the script' : 'Writing your script…', () => show('write'), 'Idea')}
          {!flow.script && (
            <section className="pr-card">
              <div className="pr-bar"><i style={{ width: '60%' }} /></div>
              <small className="muted">The AI is writing about {seconds} s of {info?.settings.scriptLanguage === 'english' ? 'English' : 'Malayalam'}. Usually under a minute.</small>
              {!flow.scriptJobId && <button type="button" className="pr-btn small" onClick={() => void writeScript(false)}>Try again</button>}
            </section>
          )}
          {flow.script && (
            <>
              <section className="pr-card">
                <label className="pr-field">Title<input value={flow.script.title} maxLength={80} onChange={(e) => setFlow({ script: { ...flow.script!, title: e.target.value } })} /></label>
                <div className="st-lines">
                  {flow.script.lines.map((line, i) => (
                    <div className="st-line" key={i}>
                      <span className="n">{i + 1}</span>
                      <textarea rows={Math.max(2, Math.ceil(line.length / 26))} value={line} aria-label={`Line ${i + 1}`} onChange={(e) => setFlow({ script: { ...flow.script!, lines: flow.script!.lines.map((l, j) => (j === i ? e.target.value : l)) } })} />
                      <button type="button" className="x" aria-label={`Delete line ${i + 1}`} onClick={() => setFlow({ script: { ...flow.script!, lines: flow.script!.lines.filter((_, j) => j !== i) } })}>×</button>
                    </div>
                  ))}
                </div>
                <div className="st-meta">
                  <button type="button" className="pr-btn small" onClick={() => setFlow({ script: { ...flow.script!, lines: [...flow.script!.lines, ''] } })}>+ Add line</button>
                  <span className="pr-stat">≈ {Math.round(wordsOf(flow.script.lines) / ((info?.settings.scriptLanguage === 'english' ? 2.5 : 2.2) * (info?.settings.speed ?? 1)))} s</span>
                  <span className="pr-stat">{flow.script.lines.length} lines</span>
                </div>
              </section>
              <section className="pr-card">
                <label className="pr-field">Want changes? Tell the AI
                  <textarea rows={2} value={feedback} maxLength={1500} placeholder="e.g. Stronger hook, shorter, add a line about cost" onChange={(e) => setFeedback(e.target.value)} />
                </label>
                <button type="button" className="pr-btn small" disabled={!feedback.trim() || Boolean(flow.scriptJobId) || Boolean(busy)} onClick={() => void writeScript(true)}>
                  {flow.scriptJobId ? 'Rewriting…' : 'Rewrite with these changes'}
                </button>
              </section>
              <div className="st-voice"><span>Voice: <strong>{voiceLabel}</strong></span><button type="button" className="pr-btn small text" onClick={openSettings}>Change</button></div>
              {error && <p className="pr-error">{error}</p>}
              <button type="button" className="pr-btn primary block st-sticky" disabled={Boolean(flow.scriptJobId) || Boolean(busy) || !flow.script.lines.some((l) => l.trim())} onClick={() => void makeVoice()}>
                {busy || 'Approve script & make the voice'}
              </button>
            </>
          )}
          {!flow.script && error && <p className="pr-error">{error}</p>}
        </main>
      )}

      {view === 'voice' && (
        <main className="pr-page">
          {header(flow.uploadId ? 'Listen to the voice' : 'Making the voice…', () => show('script'), 'Script')}
          {!flow.uploadId && narration?.state !== 'failed' && (
            <section className="pr-card">
              <div className="pr-bar" role="progressbar" aria-valuenow={Math.round((narration?.progress ?? 0) * 100)}><i style={{ width: `${Math.max(5, Math.round((narration?.progress ?? 0) * 100))}%` }} /></div>
              <small className="muted">{narration?.stage ?? 'Starting…'} · {voiceLabel}</small>
            </section>
          )}
          {narration?.state === 'failed' && !flow.uploadId && (
            <>
              <p className="pr-error">{narration.error || 'The voice could not be made.'}</p>
              <button type="button" className="pr-btn primary block" disabled={Boolean(busy)} onClick={() => void makeVoice()}>Try again</button>
            </>
          )}
          {flow.uploadId && flow.voiceUrl && (
            <>
              <section className="pr-card">
                <strong>{flow.script?.title}</strong>
                <audio className="st-audio" src={flow.voiceUrl} controls preload="metadata" />
                <small className="muted">{voiceLabel}{flow.voiceSeconds ? ` · ${flow.voiceSeconds.toFixed(0)} s` : ''}</small>
              </section>
              <details className="pr-card st-more">
                <summary>Try another voice</summary>
                <div className="pr-row">
                  <select value={voiceChoice || info?.settings.voice || ''} onChange={(e) => setVoiceChoice(e.target.value)} style={{ flex: 1, border: '1.5px solid var(--line)', borderRadius: 12, padding: 10, fontSize: 15 }}>
                    {info?.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                  <button type="button" className="pr-btn small" disabled={Boolean(busy) || !voiceChoice || voiceChoice === info?.settings.voice}
                    onClick={() => void act('Saving voice…', async () => { const { settings } = await api.saveStudio({ voice: voiceChoice }); if (info) setInfo({ ...info, settings }); }).then(() => makeVoice())}>Make again</button>
                </div>
                <small className="muted">Becomes your default voice.</small>
              </details>
              {error && <p className="pr-error">{error}</p>}
              <button type="button" className="pr-btn primary block" disabled={Boolean(busy)}
                onClick={() => void act('Setting up the video…', () => startVideo(flow.uploadId!, [flow.script?.title, flow.concept].filter(Boolean).join('. ')))}>
                {busy || 'Sounds good, make the video'}
              </button>
            </>
          )}
        </main>
      )}
    </div>
  );
}

/** One stick reel: making progress, the finished video, and editing scenes / look before rendering again. */
function ReelView({ projectId, info, onNew, onSettings, onLost }: { projectId: string; info: StudioInfo | null; onNew: () => void; onSettings: () => void; onLost: () => void }) {
  const [data, setData] = useState<StickData | null>(null);
  const [draft, setDraft] = useState<StickDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const planning = data?.plan?.state === 'running';
  const rendering = data?.render?.state === 'running';

  async function refresh(keepDraft = false) {
    const next = await api.stick(projectId);
    setData(next as StickData);
    if (!keepDraft) setDraft(next.draft);
    return next as StickData;
  }

  useEffect(() => { void refresh().catch((err) => setError(message(err))); }, [projectId]);

  // Poll while planning or rendering; after an automatic plan, start the render by itself.
  useEffect(() => {
    if (!data) return;
    if (planning || rendering) {
      const timer = window.setTimeout(() => void refresh(rendering && editing).catch((err) => setError(message(err))), 2000);
      return () => clearTimeout(timer);
    }
    if (localStorage.getItem(AUTO_KEY) === projectId && !data.plan && !data.render) {
      localStorage.removeItem(AUTO_KEY);
      const badge = info?.settings.badge;
      const next = badge ? { ...data.draft, badge } : data.draft;
      void api.renderStick(projectId, next).then(() => refresh()).catch((err) => setError(message(err)));
    }
  }, [data, planning, rendering]);

  async function act(label: string, action: () => Promise<void>) {
    setError(''); setNotice(''); setBusy(label);
    try { await action(); } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  const renderAgain = () => act('Starting render…', async () => { if (!draft) return; await api.renderStick(projectId, draft); setEditing(false); await refresh(); window.scrollTo(0, 0); });
  const replan = () => act('Starting…', async () => { if (!draft) return; await api.saveStick(projectId, draft); await api.planStick(projectId, { brief: brief.trim() || undefined, themeId: draft.themeId }); localStorage.setItem(AUTO_KEY, projectId); await refresh(); window.scrollTo(0, 0); });
  const pickMusic = async () => {
    const [file] = await chooseFiles('audio/*,.mp3,.wav,.m4a,.aac', false); if (!file) return;
    await act('Uploading music…', async () => { const [id] = await uploadAll([file], setBusy); await api.stickMusic(projectId, id); await refresh(true); setNotice('Music added. Render again to hear it.'); });
  };
  const seek = (seconds: number) => {
    const el = video.current ?? audio.current; if (!el) return;
    el.currentTime = seconds; void el.play().catch(() => undefined);
  };

  const top = (
    <div className="pr-top">
      <a className="pr-back" href="/">‹ PractiReel</a>
      <div className="pr-row">
        <button type="button" className="pr-btn small" onClick={onSettings}>⚙</button>
        <button type="button" className="pr-btn small primary" onClick={onNew}>+ New</button>
      </div>
    </div>
  );

  if (!data || !draft) {
    return (
      <main className="pr-page">{top}
        {error ? <><p className="pr-error">{error}</p><button type="button" className="pr-btn block" onClick={onLost}>Start a new stick reel</button></> : <p className="muted">Loading…</p>}
      </main>
    );
  }

  const ready = data.render?.state === 'ready' && data.render.url;
  const making = planning || rendering;
  const stepClass = (state: 'done' | 'running' | 'todo' | 'failed') => `pr-step ${state === 'todo' ? '' : state}`;
  const planState = planning ? 'running' : data.plan?.state === 'failed' ? 'failed' : 'done';
  const renderState = rendering ? 'running' : data.render?.state === 'failed' ? 'failed' : ready ? 'done' : 'todo';

  return (
    <main className="pr-page st-wide">
      {top}
      <h1>{ready && !making ? 'Your stick reel' : making ? 'Making your stick reel' : 'Stick reel'}</h1>

      {(making || data.plan?.state === 'failed' || data.render?.state === 'failed' || !ready) && (
        <section className="pr-card">
          <ol className="pr-steps">
            <li className={stepClass('done')}><span className="ic">✓</span><span className="txt"><strong>Voice</strong><small>{data.duration.toFixed(0)} s</small></span></li>
            <li className={stepClass(planState)}><span className="ic">{planState === 'done' ? '✓' : planState === 'failed' ? '!' : ''}</span><span className="txt"><strong>Captions &amp; scene plan</strong><small>{planning ? 'The AI director is planning scenes, poses and sounds (1-3 min)…' : data.plan?.error ?? `${draft.scenes.length} scenes`}</small></span></li>
            <li className={stepClass(renderState)}><span className="ic">{renderState === 'done' ? '✓' : renderState === 'failed' ? '!' : ''}</span><span className="txt"><strong>Drawing the video</strong><small>{rendering ? `${data.render?.stage ?? ''} ${Math.round((data.render?.progress ?? 0) * 100)}%` : data.render?.error ?? (ready ? 'Done' : 'Waiting')}</small></span></li>
          </ol>
          {rendering && <div className="pr-bar"><i style={{ width: `${Math.round((data.render?.progress ?? 0) * 100)}%` }} /></div>}
          {making && <small className="muted">You can close this page. It keeps going and will be here when you come back.</small>}
          {data.plan?.state === 'failed' && <button type="button" className="pr-btn small" disabled={Boolean(busy)} onClick={() => void replan()}>Plan scenes again</button>}
          {!making && !ready && data.plan?.state !== 'failed' && <button type="button" className="pr-btn primary" disabled={Boolean(busy)} onClick={() => void renderAgain()}>Make the video</button>}
        </section>
      )}

      {ready && (
        <section className="pr-card">
          <video ref={video} className="pr-video" src={`${data.render!.url}?inline=1`} controls playsInline preload="metadata" />
          <div className="pr-actions">
            <a className="pr-btn primary" href={data.render!.url}>Download MP4</a>
            <button type="button" className="pr-btn" disabled={making} onClick={() => { setEditing(!editing); setDraft(data.draft); }}>{editing ? 'Close editing' : 'Edit scenes & look'}</button>
          </div>
          {data.render!.creditsUrl && <a className="pr-btn small text" href={data.render!.creditsUrl}>Sound credits (credits.txt)</a>}
        </section>
      )}

      {(editing || (!ready && !making)) && (
        <>
          {!ready && <audio ref={audio} className="st-audio" src={data.audioUrl} controls preload="metadata" />}
          <SceneEditor draft={draft} setDraft={setDraft} duration={data.duration} themes={data.themes} facePacks={data.facePacks} customMusic={data.customMusic}
            onPickMusic={() => void pickMusic()} onDefaultMusic={() => void act('Restoring music…', async () => { await api.stickMusic(projectId); await refresh(true); })}
            onSeek={seek} disabled={making || Boolean(busy)} />
          <details className="pr-card st-more">
            <summary>Let the AI plan the scenes again</summary>
            <label className="pr-field">Direction (optional)<input value={brief} maxLength={1200} placeholder="e.g. more chat bubbles, high energy, CTA: comment SMILE" onChange={(e) => setBrief(e.target.value)} /></label>
            <button type="button" className="pr-btn small" disabled={making || Boolean(busy)} onClick={() => void replan()}>Plan again &amp; render</button>
          </details>
          <div className="pr-actions st-sticky">
            <button type="button" className="pr-btn" disabled={making || Boolean(busy)} onClick={() => void act('Saving…', async () => { await api.saveStick(projectId, draft); setNotice('Saved.'); })}>Save</button>
            <button type="button" className="pr-btn primary" disabled={making || Boolean(busy)} onClick={() => void renderAgain()}>{busy || 'Render again'}</button>
          </div>
        </>
      )}
      {notice && <p className="pr-info">{notice}</p>}
      {error && <p className="pr-error">{error}</p>}
    </main>
  );
}
