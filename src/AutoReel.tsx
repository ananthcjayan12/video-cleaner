import { useEffect, useRef, useState } from 'react';
import { api, isRemote, type AutoJob, type AutoOptions, type Me, type Project, type ReelPackage } from './api';
import { CostLine } from './Accounts';
import { startDeviceUpload, VIDEO_ACCEPT } from './device-files';
import { TranscriptReview } from './TranscriptReview';
import './auto-reel.css';

const LENGTHS: Array<{ label: string; value?: number }> = [{ label: 'Auto' }, { label: '30 s', value: 30 }, { label: '45 s', value: 45 }, { label: '60 s', value: 60 }, { label: '90 s', value: 90 }];
const STORE = 'video-cleaner:autoProjectId';

/** The simple path: pick a video, everything else runs on its own until the preview. */
export function AutoReelLauncher({ me, busy, onStarted, onError }: { me?: Me | null; busy: boolean; onStarted: (projectId: string) => void; onError: (message: string) => void }) {
  const [target, setTarget] = useState<number | undefined>(undefined);
  const [images, setImages] = useState<AutoOptions['imageProvider']>('gemini');
  // The owner can make a reel for any account (to test a customer's API setup); a customer always uses their own.
  const [workspaceId, setWorkspaceId] = useState('personal');
  const account = me?.role === 'member' ? me.workspace : me?.workspaces?.find((w) => w.id === workspaceId);
  const apiOnly = account?.effectiveProfile === 'api';
  const left = account?.reelsPerMonth ? Math.max(0, account.reelsPerMonth - account.reelsThisMonth) : undefined;
  const [upload, setUpload] = useState('');
  const [review, setReview] = useState(true);
  const [thumbnail, setThumbnail] = useState(true);
  const [postCaption, setPostCaption] = useState(true);
  async function start() {
    const deviceUpload = startDeviceUpload(VIDEO_ACCEPT, true); // several clips allowed; must start inside the tap on phones
    try {
      setUpload('Choose a video…');
      const uploadIds = deviceUpload ? await deviceUpload(setUpload) : undefined;
      if (deviceUpload && !uploadIds) { setUpload(''); return; }
      setUpload('Creating project…');
      const project = await api.selectProject(uploadIds ?? undefined, true, me?.role === 'admin' ? workspaceId : undefined);
      await api.startAuto(project.id, { targetDurationSec: target, imageProvider: apiOnly ? 'gemini' : images, review, thumbnail, postCaption });
      try { window.localStorage.setItem(STORE, project.id); } catch { /* private mode */ }
      setUpload(''); onStarted(project.id);
    } catch (error) { setUpload(''); onError(error instanceof Error ? error.message : String(error)); }
  }
  return (
    <section className="autoLauncher">
      <span className="autoKicker">One tap</span>
      <h2>Make my reel</h2>
      <p>Upload a talking video, or several clips of the same reel (they play in recording order). It is cleaned, cut, captioned and given B-roll automatically. You check the cleaned talk, then get a preview to download.</p>
      {me?.role === 'admin' && (me.workspaces?.length ?? 0) > 1 && <div className="autoChoice"><span>For account</span><div>{me.workspaces!.map((w) => (
        <button key={w.id} type="button" className={workspaceId === w.id ? 'on' : ''} onClick={() => setWorkspaceId(w.id)}>{w.name}</button>
      ))}</div></div>}
      {left !== undefined && <p className="autoCredits">{left} of {account!.reelsPerMonth} reels left this month</p>}
      <div className="autoChoice"><span>Length</span><div>{LENGTHS.map((option) => <button key={option.label} type="button" className={target === option.value ? 'on' : ''} onClick={() => setTarget(option.value)}>{option.label}</button>)}</div></div>
      {!apiOnly && <div className="autoChoice"><span>B-roll images</span><div>
        <button type="button" className={images === 'gemini' ? 'on' : ''} onClick={() => setImages('gemini')}>Gemini</button>
        <button type="button" className={images === 'chatgpt' ? 'on' : ''} onClick={() => setImages('chatgpt')}>ChatGPT</button>
      </div></div>}
      <div className="autoChoice"><span>Check the transcript before the reel is made</span><div>
        <button type="button" className={review ? 'on' : ''} onClick={() => setReview(true)}>Yes, let me check</button>
        <button type="button" className={!review ? 'on' : ''} onClick={() => setReview(false)}>No, fully automatic</button>
      </div></div>
      <div className="autoChoice"><span>Also make</span><div>
        <button type="button" className={thumbnail ? 'on' : ''} aria-pressed={thumbnail} onClick={() => setThumbnail(!thumbnail)}>Thumbnail</button>
        <button type="button" className={postCaption ? 'on' : ''} aria-pressed={postCaption} onClick={() => setPostCaption(!postCaption)}>Post caption</button>
      </div></div>
      <button className="primary autoStart" type="button" disabled={busy || !!upload || left === 0} onClick={() => void start()}>{upload || (left === 0 ? 'No reels left this month' : 'Choose video(s) & start')}</button>
    </section>
  );
}

export const savedAutoProjectId = () => { try { return window.localStorage.getItem(STORE) || ''; } catch { return ''; } };
export const clearSavedAutoProject = () => { try { window.localStorage.removeItem(STORE); } catch { /* ignore */ } };

const ICON: Record<string, string> = { pending: '○', running: '◐', done: '✓', skipped: '–', failed: '✕' };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Progress, then preview. Survives a page refresh (the job runs on the server). */
export function AutoReelProgress({ projectId, onOpenEditor, onClose }: { projectId: string; onOpenEditor?: (project: Project) => void; onClose: () => void }) {
  const [job, setJob] = useState<AutoJob | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try { const next = await api.autoStatus(projectId); if (!cancelled) { setJob(next); setError(''); } if (next.state === 'running' || next.state === 'review' || next.package?.state === 'running') timer.current = window.setTimeout(poll, next.state === 'review' ? 3000 : 2000); }
      catch (err) { if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); timer.current = window.setTimeout(poll, 5000); } }
    };
    void poll();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; window.clearTimeout(timer.current); window.clearInterval(tick); };
  }, [projectId]);
  const elapsed = job?.startedAt ? ((job.finishedAt ?? now) - job.startedAt) / 1000 : 0;
  async function openEditor() { const projects = await api.listProjects(); const found = projects.find((p) => p.id === projectId); if (found && onOpenEditor) { clearSavedAutoProject(); onOpenEditor(found); } }
  return (
    <section className="autoProgress">
      <div className="autoHead">
        <div><span className="autoKicker">{job?.state === 'completed' ? 'Ready' : job?.state === 'review' ? 'Your turn' : job?.state === 'failed' ? 'Stopped with an error' : job?.state === 'stopped' ? 'Stopped' : 'Working on your reel'}</span>
          <h2>{job?.state === 'completed' ? 'Your reel' : job?.state === 'review' ? 'Check the cleaned talk' : 'Making your reel'}</h2></div>
        <span className="autoClock">{clock(elapsed)}</span>
      </div>
      {job?.state === 'completed' && job.previewUrl && (
        <div className="autoPreview">
          <video src={job.previewUrl} controls playsInline preload="metadata" />
          <div className="autoActions">
            {job.downloadUrl && <SaveFile url={job.downloadUrl} type="video/mp4" label="Save video" />}
            {onOpenEditor && <button type="button" onClick={() => void openEditor()}>Open in full editor</button>}
          </div>
          {job.sourceSeconds && job.finalSeconds ? <small>{Math.round(job.sourceSeconds)} s of talking → {Math.round(job.finalSeconds)} s reel</small> : null}
        </div>
      )}
      {job?.state === 'completed' && <PackagePanel projectId={projectId} pkg={job.package} options={job.options} onJob={setJob} />}
      {job?.state === 'review' && job.review && <TranscriptReview key={job.review.keepRanges.map((r) => r.startWordId + r.endWordId).join()} projectId={projectId} review={job.review} />}
      <ol className="autoStages">
        {(job?.stages ?? []).map((stage) => (
          <li key={stage.id} className={stage.state}>
            <span className="autoIcon">{ICON[stage.state]}</span>
            <div><strong>{stage.label}</strong>{stage.detail && <small>{stage.detail}</small>}</div>
            {stage.seconds !== undefined && <span className="autoSecs">{clock(stage.seconds)}</span>}
          </li>
        ))}
      </ol>
      <CostLine cost={job?.cost} />
      {job?.error && <p className="autoError">{job.error}</p>}
      {error && <p className="autoError">{error}</p>}
      <div className="autoActions">
        {(job?.state === 'running' || job?.state === 'review') && <button type="button" className="danger" onClick={() => void api.stopAuto(projectId)}>Stop</button>}
        {onOpenEditor && job?.state !== 'running' && job?.state !== 'review' && job?.state !== 'completed' && <button type="button" onClick={() => void openEditor()}>Continue in full editor</button>}
        {job?.state !== 'running' && job?.state !== 'review' && <button type="button" className="ghost" onClick={() => { clearSavedAutoProject(); onClose(); }}>Back to projects</button>}
      </div>
    </section>
  );
}

/** "Your reels": earlier uploads; tap one to see its progress or preview. */
export function ReelList({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  if (!projects.length) return null;
  return (
    <section className="reelList">
      <span className="autoKicker">Your reels</span>
      {projects.map((project) => (
        <button key={project.id} type="button" className="reelItem" onClick={() => onOpen(project.id)}>
          <strong>{project.name}</strong>
          <small>{new Date(project.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </button>
      ))}
    </section>
  );
}

/**
 * Save the finished reel on a phone. iPhone Safari (and the home-screen app) ignores <a download> for videos, so the
 * file is fetched as soon as the reel is ready and handed to the share sheet ("Save Video" puts it in Photos).
 * The file is fetched ahead of the tap because the share sheet only opens straight from a tap.
 * Where sharing files is not supported (most computers), it is a normal download link.
 */
function SaveFile({ url, type, label }: { url: string; type: 'video/mp4' | 'image/jpeg'; label: string }) {
  const name = `${type === 'video/mp4' ? 'reel' : 'thumbnail'}-${url.match(/(\d{8}-\d{6})/)?.[1] ?? 'file'}.${type === 'video/mp4' ? 'mp4' : 'jpg'}`;
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
    && (() => { try { return navigator.canShare({ files: [new File([], name, { type })] }); } catch { return false; } })();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!canShareFiles) return;
    let cancelled = false;
    setStatus(type === 'video/mp4' ? 'Getting the reel ready to save…' : '');
    fetch(url, { credentials: 'same-origin' })
      .then((response) => { if (!response.ok) throw new Error(`Download failed (${response.status})`); return response.blob(); })
      .then((blob) => { if (!cancelled) { setFile(new File([blob], name, { type })); setStatus(''); } })
      .catch((err) => { if (!cancelled) setStatus(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [url, canShareFiles, name, type]);
  async function share() {
    if (!file) return;
    try { await navigator.share({ files: [file], title: label }); }
    catch (err) { if ((err as Error)?.name !== 'AbortError') setStatus('Could not open the save menu. Use "Download file" below.'); }
  }
  if (!canShareFiles) return <a className="primary" href={url} download={name}>Download</a>;
  return (
    <>
      <button type="button" className="primary" disabled={!file} onClick={() => void share()}>{file ? label : 'Preparing…'}</button>
      <a className="ghost" href={url} download={name} target="_blank" rel="noopener">Download file</a>
      {status && <small className="autoSaveStatus">{status}</small>}
    </>
  );
}

/** Thumbnail + post caption for a finished reel: preview, save, edit the cover text/frame, copy the caption, or ask the AI again. */
function PackagePanel({ projectId, pkg, options, onJob }: { projectId: string; pkg?: ReelPackage; options?: AutoOptions; onJob: (job: AutoJob) => void }) {
  const [lines, setLines] = useState<string[]>(pkg?.lines ?? ['', '', '']);
  const [label, setLabel] = useState(pkg?.label ?? '');
  const [caption, setCaption] = useState(pkg?.caption ?? '');
  const [hashtags, setHashtags] = useState((pkg?.hashtags ?? []).join(' '));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const version = pkg ? `${pkg.state}|${pkg.thumbnailUrl}|${pkg.caption}|${pkg.lines.join('/')}` : '';
  useEffect(() => {
    if (!pkg || pkg.state === 'running') return;
    setLines(pkg.lines.length ? pkg.lines : ['', '', '']); setLabel(pkg.label); setCaption(pkg.caption); setHashtags(pkg.hashtags.join(' '));
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(text: string, work: () => Promise<AutoJob>) {
    setBusy(text); setMessage('');
    try { onJob(await work()); } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); } finally { setBusy(''); }
  }
  const tags = () => hashtags.split(/[\s,]+/).filter(Boolean);
  const save = (extra: { frame?: number } = {}) => act('Updating the thumbnail…', () => api.editPackage(projectId, { lines, label, caption, hashtags: tags(), ...extra }));
  async function copyCaption() {
    const text = `${caption.trim()}\n\n${tags().join(' ')}`.trim();
    try { await navigator.clipboard.writeText(text); setMessage('Caption copied. Paste it in Instagram.'); }
    catch { setMessage('Could not copy here. Press and hold the caption text to copy it.'); }
    if (pkg && (caption !== pkg.caption || tags().join(' ') !== pkg.hashtags.join(' '))) void api.editPackage(projectId, { caption, hashtags: tags() }).then(onJob).catch(() => undefined);
  }
  if (!pkg) {
    return (
      <section className="pkg">
        <span className="autoKicker">Thumbnail & caption</span>
        <button type="button" className="primary" disabled={!!busy} onClick={() => void act('Starting…', () => api.remakePackage(projectId))}>{busy || 'Make thumbnail & post caption'}</button>
        {message && <p className="autoError">{message}</p>}
      </section>
    );
  }
  if (pkg.state === 'running') return <section className="pkg"><span className="autoKicker">Thumbnail & caption</span><p className="pkgWait">◐ Picking a cover frame and writing the thumbnail and caption… (about a minute)</p></section>;
  const showThumb = options?.thumbnail !== false || !!pkg.thumbnailUrl;
  const showCaption = options?.postCaption !== false || !!pkg.caption;
  return (
    <section className="pkg">
      {pkg.state === 'failed' && <p className="autoError">Thumbnail/caption failed: {pkg.error}</p>}
      {showThumb && pkg.thumbnailUrl && (
        <div className="pkgBlock">
          <span className="autoKicker">Thumbnail</span>
          <img className="pkgThumb" src={pkg.thumbnailUrl} alt="Reel thumbnail" />
          <div className="autoActions">{pkg.thumbnailDownloadUrl && <SaveFile key={pkg.thumbnailDownloadUrl} url={pkg.thumbnailDownloadUrl} type="image/jpeg" label="Save thumbnail" />}</div>
          <details className="pkgEdit">
            <summary>Edit the thumbnail</summary>
            <label>Top line<input value={lines[0] ?? ''} onChange={(e) => setLines([e.target.value, lines[1] ?? '', lines[2] ?? ''])} /></label>
            <label>Highlighted line<input value={lines[1] ?? ''} onChange={(e) => setLines([lines[0] ?? '', e.target.value, lines[2] ?? ''])} /></label>
            <label>Bottom line<input value={lines[2] ?? ''} onChange={(e) => setLines([lines[0] ?? '', lines[1] ?? '', e.target.value])} /></label>
            <label>Label strip<input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
            {pkg.frames.length > 0 && <div className="pkgFrames"><span>Frame</span><div>{pkg.frames.map((src, n) => (
              <button key={src} type="button" className={n === pkg.frame ? 'on' : ''} disabled={!!busy} onClick={() => void save({ frame: n })}><img src={src} alt={`Frame ${n + 1}`} /></button>
            ))}</div></div>}
            <button type="button" className="primary" disabled={!!busy} onClick={() => void save()}>{busy || 'Update thumbnail'}</button>
          </details>
        </div>
      )}
      {showCaption && (
        <div className="pkgBlock">
          <span className="autoKicker">Post caption</span>
          <textarea className="pkgCaption" rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} />
          <textarea className="pkgTags" rows={2} value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
          <div className="autoActions"><button type="button" className="primary" onClick={() => void copyCaption()}>Copy caption + hashtags</button></div>
        </div>
      )}
      <details className="pkgEdit">
        <summary>Ask the AI to redo both</summary>
        <textarea rows={3} placeholder="e.g. make the headline about the price, caption in English" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="button" disabled={!!busy} onClick={() => void act('Starting…', () => api.remakePackage(projectId, notes))}>{busy || 'Redo thumbnail & caption'}</button>
      </details>
      {message && <p className="pkgMessage">{message}</p>}
    </section>
  );
}
