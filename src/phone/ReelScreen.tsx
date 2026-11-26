import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AutoJob, type AutoReview, type Me, type Project, type ReelLook } from '../api';
import { flagsToRanges, keepFlags, keptSeconds, sentences } from '../review';
import { CostLine } from '../Accounts';
import { go } from './PhoneApp';

/** One reel from start to finish: progress you can leave, the review of the cut and the claims, then save and post. */
const STEP_LABEL: Record<string, string> = {
  audio: 'Preparing the audio', transcribe: 'Writing down what you said', clean: 'Cleaning the talk', review: 'Your check',
  'broll-plan': 'Planning the pictures', 'broll-images': 'Making the pictures', edit: 'Cutting and zooming', captions: 'Adding captions',
  compose: 'Putting it together', package: 'Cover and post caption',
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function useReel(id: string) {
  const [job, setJob] = useState<AutoJob | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void api.listProjects().then((list) => { if (!cancelled) setProject(list.find((p) => p.id === id) ?? null); }).catch(() => undefined);
    const poll = async () => {
      try {
        const next = await api.autoStatus(id); if (cancelled) return; setJob(next); setError('');
        const busy = next.state === 'running' || next.state === 'review' || next.package?.state === 'running';
        if (busy) timer.current = window.setTimeout(poll, next.state === 'review' ? 4000 : 2500);
      } catch (err) { if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); timer.current = window.setTimeout(poll, 6000); } }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer.current); };
  }, [id]);
  return { job, setJob, project, setProject, error };
}

export function ReelScreen({ id, me, onToast, onChanged }: { id: string; me: Me | null; onToast: (text: string) => void; onChanged: () => void }) {
  const { job, setJob, project, setProject, error } = useReel(id);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const title = project?.name ?? 'Your reel';
  const back = <button type="button" className="pr-back" onClick={() => go('reels')}>‹ My reels</button>;
  if (!job) return <main className="pr-page">{back}{error ? <p className="pr-error">{error}</p> : <div className="pr-card"><small>Loading…</small></div>}</main>;

  if (job.state === 'review' && job.review) return <main className="pr-page">{back}<ReviewPanel key={job.review.keepRanges.map((r) => r.startWordId + r.endWordId).join()} id={id} review={job.review} onSent={() => onToast('Got it. Making your reel now.')} /></main>;
  if (job.state === 'completed') return <main className="pr-page">{back}<ReadyPanel id={id} job={job} project={project} me={me} onJob={setJob} onProject={setProject} onToast={onToast} onChanged={onChanged} /></main>;

  const elapsed = job.startedAt ? ((job.finishedAt ?? now) - job.startedAt) / 1000 : 0;
  const running = job.state === 'running';
  return (
    <main className="pr-page">
      {back}
      <div className="pr-top"><h1>{running ? 'Making your reel' : job.state === 'stopped' ? 'Reel stopped' : 'Something went wrong'}</h1>{running && <span className="pr-stat">⏱ {clock(elapsed)}</span>}</div>
      <small>{title}</small>
      {job.resumed && running && <p className="pr-info">Picking up where we left off. Finished steps are not redone.</p>}
      <div className="pr-card"><ol className="pr-steps">
        {(job.stages ?? []).map((stage) => (
          <li key={stage.id} className={`pr-step ${stage.state}`}>
            <span className="ic" aria-hidden="true">{stage.state === 'done' ? '✓' : stage.state === 'failed' ? '!' : ''}</span>
            <span className="txt"><strong>{STEP_LABEL[stage.id] ?? stage.label}</strong>{(stage.state === 'running' || stage.state === 'done') && stage.detail && <small>{stage.detail}</small>}</span>
            {stage.state === 'skipped' && <small>Off</small>}
          </li>
        ))}
      </ol></div>
      {running && <p className="pr-info">{job.queuePosition ? `Another reel is being finished first (${job.queuePosition} ahead). ` : ''}This usually takes 8–12 minutes. You can close the app; turn on notifications in Profile and we'll tell you when it's ready.</p>}
      {job.state === 'failed' && <div className="pr-error"><strong>The reel stopped.</strong> No reel was counted. {friendlyError(job.error)}</div>}
      {running ? <StopButton id={id} onToast={onToast} /> : <RetryButtons id={id} job={job} onToast={onToast} onChanged={onChanged} />}
      {me?.role === 'admin' && <CostLine cost={job.cost} />}
    </main>
  );
}

function friendlyError(message?: string) {
  if (!message) return 'Try again in a minute.';
  if (/restart/i.test(message)) return 'The app was restarted while it was working. Start it again.';
  if (/no audio/i.test(message)) return 'The video has no sound. Record again with the microphone on.';
  if (/Stopped/.test(message)) return '';
  return `Details: ${message.slice(0, 220)}`;
}

function StopButton({ id, onToast }: { id: string; onToast: (text: string) => void }) {
  const [sure, setSure] = useState(false);
  if (!sure) return <button type="button" className="pr-btn block" onClick={() => setSure(true)}>Stop</button>;
  return <div className="pr-card"><strong>Stop this reel?</strong><small>It won't be counted. You can start it again later.</small>
    <div className="pr-grid2"><button type="button" className="pr-btn danger" onClick={() => void api.stopAuto(id).then(() => onToast('Stopping…'))}>Yes, stop</button><button type="button" className="pr-btn" onClick={() => setSure(false)}>Keep going</button></div></div>;
}

function RetryButtons({ id, job, onToast, onChanged }: { id: string; job: AutoJob; onToast: (text: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  async function retry() {
    setBusy(true);
    try { await api.startAuto(id, { ...(job.options ?? { imageProvider: 'gemini' }), review: true }); onToast('Started again'); window.location.reload(); }
    catch (err) { onToast(err instanceof Error ? err.message : String(err)); setBusy(false); }
  }
  async function remove() { await api.deleteProject(id); onChanged(); onToast('Reel deleted'); go('reels'); }
  return <>
    <button type="button" className="pr-btn primary block" disabled={busy} onClick={() => void retry()}>{busy ? 'Starting…' : 'Start again'}</button>
    {!sure ? <button type="button" className="pr-btn text" onClick={() => setSure(true)}>Delete this reel</button>
      : <div className="pr-grid2"><button type="button" className="pr-btn danger" onClick={() => void remove()}>Delete for good</button><button type="button" className="pr-btn" onClick={() => setSure(false)}>Keep it</button></div>}
  </>;
}

/** The cut, sentence by sentence, with risky health claims flagged. The words are what was said, so a flag is fixed by removing the sentence. */
function ReviewPanel({ id, review, onSent }: { id: string; review: AutoReview; onSent: () => void }) {
  const original = useMemo(() => keepFlags(review.words, review.keepRanges), [review]);
  const [flags, setFlags] = useState(original);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState<'' | 'continue' | 'redo'>('');
  const [error, setError] = useState('');
  const groups = useMemo(() => sentences(review.words), [review.words]);
  const claims = review.flags ?? [];
  const changed = flags.some((flag, i) => flag !== original[i]);
  const kept = keptSeconds(review.words, flags);
  const keptSentence = (from: number, to: number) => flags.slice(from, to + 1).some(Boolean);
  const openClaims = claims.filter((claim) => keptSentence(claim.from, claim.to) && !dismissed.includes(claim.from));

  function setRange(from: number, to: number, keep: boolean) { setFlags((current) => current.map((flag, i) => (i >= from && i <= to ? keep : flag))); }
  function toggle(from: number, to: number) { setRange(from, to, flags.slice(from, to + 1).filter(Boolean).length <= (to - from + 1) / 2); }
  async function send(action: 'continue' | 'redo') {
    try {
      setSending(action); setError('');
      if (action === 'continue') {
        const keepRanges = flagsToRanges(review.words, flags);
        if (!keepRanges.length) throw new Error('Keep at least one sentence.');
        await api.reviewAuto(id, { action, keepRanges: changed ? keepRanges : undefined });
        onSent();
      } else await api.reviewAuto(id, { action, notes });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setSending(''); }
  }
  if (review.redoing) return <><h1>Check what stays</h1><div className="pr-card"><strong>Redoing the cut with your notes…</strong><small>This takes about a minute.</small></div></>;
  return (
    <>
      <h1>Check what stays</h1>
      <div className="pr-row" style={{ flexWrap: 'wrap' }}><span className="pr-stat">Recorded {clock(review.sourceSeconds)}</span><span aria-hidden="true">→</span><span className="pr-stat">Reel ≈ {clock(kept)}</span></div>
      {openClaims.map((claim) => (
        <div key={claim.from} className="pr-flag" role="alert">
          <strong>⚠ “{claim.match}”: {claim.title.toLowerCase()}</strong>
          <small style={{ color: 'var(--ink)' }}>{claim.fix}</small>
          <div className="pr-grid2">
            <button type="button" className="pr-btn amber small" onClick={() => setRange(claim.from, claim.to, false)}>Remove that sentence</button>
            <button type="button" className="pr-btn small" onClick={() => setDismissed((d) => [...d, claim.from])}>Keep it</button>
          </div>
        </div>
      ))}
      <div className="pr-card">
        <small>Grey, crossed-out words will be cut. Tap a sentence to keep or remove it.</small>
        <div className="pr-transcript">
          {groups.map(({ from, to }) => {
            const count = flags.slice(from, to + 1).filter(Boolean).length;
            const state = count === 0 ? 'cut' : count === to - from + 1 ? 'kept' : 'partial';
            const claim = claims.find((c) => c.from === from);
            const flagged = claim && state !== 'cut' && !dismissed.includes(from);
            return (
              <button key={from} type="button" className={`pr-sentence ${state}${flagged ? ' flagged' : ''}`} disabled={!!sending} onClick={() => toggle(from, to)}>
                {review.words.slice(from, to + 1).map((word, i) => {
                  const hit = flagged && claim!.match.toLowerCase().includes(word.text.toLowerCase().replace(/[^\p{L}\p{N}%-]/gu, '')) && word.text.replace(/[^\p{L}\p{N}%]/gu, '').length > 2;
                  return <span key={word.id} className={flags[from + i] ? 'k' : 'x'}>{hit ? <mark>{word.text}</mark> : word.text} </span>;
                })}
              </button>
            );
          })}
        </div>
        {changed && <button type="button" className="pr-btn text" onClick={() => setFlags(original)} disabled={!!sending}>Undo my changes</button>}
      </div>
      <details className="pr-card"><summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 28 }}>Ask the AI to cut it differently</summary>
        <textarea className="pr-caption" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Keep the part about kids. Remove the hello at the start." disabled={!!sending} />
        <button type="button" className="pr-btn block" disabled={!!sending || !notes.trim()} onClick={() => void send('redo')}>{sending === 'redo' ? 'Sending…' : 'Redo the cut with my notes'}</button>
      </details>
      {error && <p className="pr-error">{error}</p>}
      <button type="button" className="pr-btn primary block" disabled={!!sending} onClick={() => void send('continue')}>{sending === 'continue' ? 'Starting…' : 'Make my reel'}</button>
    </>
  );
}

function ReadyPanel({ id, job, project, me, onJob, onProject, onToast, onChanged }: { id: string; job: AutoJob; project: Project | null; me: Me | null; onJob: (job: AutoJob) => void; onProject: (project: Project) => void; onToast: (text: string) => void; onChanged: () => void }) {
  const pkg = job.package;
  const [caption, setCaption] = useState(pkg?.caption ?? '');
  const [tags, setTags] = useState((pkg?.hashtags ?? []).join(' '));
  useEffect(() => { setCaption(pkg?.caption ?? ''); setTags((pkg?.hashtags ?? []).join(' ')); }, [pkg?.caption, pkg?.hashtags?.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  const hashtags = () => tags.split(/[\s,]+/).filter(Boolean);
  const dirty = pkg && (caption !== pkg.caption || hashtags().join(' ') !== pkg.hashtags.join(' '));
  async function saveCaption() { if (dirty) onJob(await api.editPackage(id, { caption, hashtags: hashtags() })); }
  async function copy() {
    const text = `${caption.trim()}\n\n${hashtags().join(' ')}`.trim();
    try { await navigator.clipboard.writeText(text); onToast('Caption copied. Paste it in Instagram.'); } catch { onToast('Press and hold the caption to copy it.'); }
    void saveCaption().catch(() => undefined);
  }
  async function posted(value: boolean) { const result = await api.markPosted(id, value); if (project) onProject({ ...project, postedAt: result.postedAt ?? undefined }); onChanged(); onToast(value ? 'Marked as posted' : 'Moved back to Ready'); }
  return (
    <>
      <div className="pr-top"><h1>Your reel is ready</h1>{project?.postedAt && <span className="pr-pill posted">✓ Posted</span>}</div>
      <small>{project?.name}{job.sourceSeconds && job.finalSeconds ? ` · ${clock(job.sourceSeconds)} of talking → ${clock(job.finalSeconds)} reel` : ''}</small>
      {job.previewUrl && <video className="pr-video" src={job.previewUrl} controls playsInline preload="metadata" poster={pkg?.thumbnailUrl} />}
      <div className="pr-grid2">
        {job.downloadUrl ? <SaveFile url={job.downloadUrl} type="video/mp4" label="Save video" primary onToast={onToast} /> : <span />}
        {pkg?.thumbnailDownloadUrl ? <SaveFile key={pkg.thumbnailDownloadUrl} url={pkg.thumbnailDownloadUrl} type="image/jpeg" label="Save cover" onToast={onToast} /> : <span />}
        <button type="button" className="pr-btn" disabled={!pkg?.caption} onClick={() => void copy()}>Copy caption</button>
        <button type="button" className="pr-btn" disabled={!pkg || pkg.state === 'running'} onClick={() => go(`cover-${id}`)}>Change cover</button>
      </div>
      {pkg?.state === 'running' && <p className="pr-info">Making the cover and caption… about a minute.</p>}
      {pkg?.state === 'failed' && <p className="pr-error">The cover and caption could not be made. <button type="button" className="pr-btn text" onClick={() => void api.remakePackage(id).then(onJob)}>Try again</button></p>}
      {!pkg && <button type="button" className="pr-btn block" onClick={() => void api.remakePackage(id).then(onJob)}>Make cover and post caption</button>}
      {pkg?.caption !== undefined && pkg.state !== 'running' && (
        <div className="pr-card">
          <span className="pr-label">Post caption</span>
          <textarea className="pr-caption" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => void saveCaption()} aria-label="Post caption" />
          <textarea className="pr-caption tags" rows={2} value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => void saveCaption()} aria-label="Hashtags" />
        </div>
      )}
      {project?.postedAt ? <button type="button" className="pr-btn text" onClick={() => void posted(false)}>Not posted yet? Undo</button>
        : <button type="button" className="pr-btn block" onClick={() => void posted(true)}>I've posted it</button>}
      {me?.role === 'admin' && <CostLine cost={job.cost} />}
    </>
  );
}

/**
 * Save on a phone. iPhone Safari ignores <a download> for videos, so the file is fetched as soon as the screen opens and
 * handed to the share sheet on tap ("Save Video" puts it in Photos). Elsewhere it is a normal download.
 */
function SaveFile({ url, type, label, primary, onToast }: { url: string; type: 'video/mp4' | 'image/jpeg'; label: string; primary?: boolean; onToast: (text: string) => void }) {
  const name = `${type === 'video/mp4' ? 'reel' : 'cover'}-${url.match(/(\d{8}-\d{6})/)?.[1] ?? 'file'}.${type === 'video/mp4' ? 'mp4' : 'jpg'}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && (() => { try { return navigator.canShare({ files: [new File([], name, { type })] }); } catch { return false; } })();
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (!canShare) return; let cancelled = false;
    fetch(url, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(`Download failed (${r.status})`); return r.blob(); })
      .then((blob) => { if (!cancelled) setFile(new File([blob], name, { type })); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [url, canShare, name, type]);
  const cls = `pr-btn${primary ? ' primary' : ''}`;
  if (!canShare) return <a className={cls} href={url} download={name}>{label}</a>;
  return <button type="button" className={cls} disabled={!file} onClick={() => { if (file) navigator.share({ files: [file], title: label }).catch((err) => { if ((err as Error)?.name !== 'AbortError') onToast('Could not open the save menu. Try again.'); }); }}>{file ? label : 'Preparing…'}</button>;
}

/** Cover editor: pick the photo from the reel, edit the lines and label, or ask the AI for a new cover. */
/** Live draft of the cover while editing (same layout as the real one); the real JPEG is made once, on Save. */
function CoverDraft({ src, lines, label, look }: { src: string; lines: string[]; label: string; look?: ReelLook }) {
  const font = look ? `'${look.font}', system-ui, sans-serif` : 'inherit';
  // Rough version of the renderer's fit: about 13 characters fill the width at full size.
  const size = (text: string, base: number) => `${(base / 1080) * 100 * Math.min(1, 13 / Math.max(1, text.length))}cqw`;
  const white = (text: string) => <div style={{ fontSize: size(text, 128), color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)' }}>{text}</div>;
  return (
    <div className="pr-cover pr-cover-draft" style={{ fontFamily: font }}>
      <img src={src} alt="" />
      <div className="shade" />
      <div className="lines">
        {lines[0] ? white(lines[0]) : null}
        {lines[1] ? <div className="block" style={{ fontSize: size(lines[1], 118), background: look?.accent ?? '#D7F25B', color: look?.onAccent ?? '#0B0D0C' }}>{lines[1]}</div> : null}
        {lines[2] ? white(lines[2]) : null}
      </div>
      {label ? <div className="label" style={{ color: look?.coverHighlight ?? '#D7F25B' }}>{label}</div> : null}
    </div>
  );
}

export function CoverEditor({ id, onToast }: { id: string; onToast: (text: string) => void }) {
  const { job, setJob } = useReel(id);
  const pkg = job?.package;
  const [lines, setLines] = useState<string[]>(['', '', '']);
  const [label, setLabel] = useState('');
  const [frame, setFrame] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (pkg && pkg.state !== 'running') { setLines(pkg.lines.length ? [...pkg.lines, '', '', ''].slice(0, 3) : ['', '', '']); setLabel(pkg.label); setFrame(pkg.frame); } }, [pkg?.state, pkg?.thumbnailUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(text: string, work: () => Promise<AutoJob>, done: string) {
    setBusy(text); try { setJob(await work()); onToast(done); } catch (err) { onToast(err instanceof Error ? err.message : String(err)); } finally { setBusy(''); }
  }
  const back = <button type="button" className="pr-back" onClick={() => go(`reel-${id}`)}>‹ Back to reel</button>;
  if (!pkg) return <main className="pr-page">{back}<div className="pr-card"><small>{job ? 'This reel has no cover yet.' : 'Loading…'}</small></div></main>;
  if (pkg.state === 'running') return <main className="pr-page">{back}<h1>Edit cover</h1><p className="pr-info">Writing a new cover and caption… about 30 seconds. You can leave this screen.</p></main>;
  const saved = [...pkg.lines, '', '', ''].slice(0, 3);
  const changed = frame !== pkg.frame || label !== pkg.label || lines.some((line, i) => line !== saved[i]);
  return (
    <main className="pr-page">
      {back}
      <h1>Edit cover</h1>
      {changed || !pkg.thumbnailUrl
        ? pkg.frames[frame] && <CoverDraft src={pkg.frames[frame]} lines={lines} label={label} look={job?.look} />
        : <img className="pr-cover" src={pkg.thumbnailUrl} alt="Reel cover" />}
      {changed && <small style={{ textAlign: 'center' }}>Preview. Tap Save cover to make it.</small>}
      {pkg.frames.length > 0 && <div className="pr-field">Photo<div className="pr-frames">{pkg.frames.map((src, n) => (
        <button key={src} type="button" className={n === frame ? 'on' : ''} disabled={!!busy} aria-label={`Use frame ${n + 1}`} aria-pressed={n === frame} onClick={() => setFrame(n)}><img src={src} alt="" /></button>
      ))}</div></div>}
      <div className="pr-card">
        <label className="pr-field">Top line<input value={lines[0]} onChange={(e) => setLines([e.target.value, lines[1], lines[2]])} /></label>
        <label className="pr-field">Highlighted line<input value={lines[1]} onChange={(e) => setLines([lines[0], e.target.value, lines[2]])} /></label>
        <label className="pr-field">Bottom line<input value={lines[2]} onChange={(e) => setLines([lines[0], lines[1], e.target.value])} /></label>
        <label className="pr-field">Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="SAVE THIS TIP" /></label>
        <button type="button" className="pr-btn primary block" disabled={!!busy || (!changed && !!pkg.thumbnailUrl)} onClick={() => void act('Saving…', () => api.editPackage(id, { frame, lines, label }), 'Cover saved')}>{busy || (changed || !pkg.thumbnailUrl ? 'Save cover' : 'Saved')}</button>
      </div>
      <details className="pr-card"><summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 28 }}>✨ Ask AI for a new cover and caption</summary>
        <textarea className="pr-caption" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Make the headline a question. Caption in English." />
        <button type="button" className="pr-btn block" disabled={!!busy} onClick={() => void act('Starting…', () => api.remakePackage(id, notes), 'Making a new cover…')}>Make a new one</button>
        <small>Takes about 30 seconds.</small>
      </details>
    </main>
  );
}
