import { useEffect, useRef, useState } from 'react';
import { api, isRemote, type AutoJob, type AutoOptions, type Project } from './api';
import { startDeviceUpload, VIDEO_ACCEPT } from './device-files';
import { TranscriptReview } from './TranscriptReview';
import './auto-reel.css';

const LENGTHS: Array<{ label: string; value?: number }> = [{ label: 'Auto' }, { label: '30 s', value: 30 }, { label: '45 s', value: 45 }, { label: '60 s', value: 60 }, { label: '90 s', value: 90 }];
const STORE = 'video-cleaner:autoProjectId';

/** The simple path: pick a video, everything else runs on its own until the preview. */
export function AutoReelLauncher({ busy, onStarted, onError }: { busy: boolean; onStarted: (projectId: string) => void; onError: (message: string) => void }) {
  const [target, setTarget] = useState<number | undefined>(undefined);
  const [images, setImages] = useState<AutoOptions['imageProvider']>('gemini');
  const [upload, setUpload] = useState('');
  const [review, setReview] = useState(true);
  async function start() {
    const deviceUpload = startDeviceUpload(VIDEO_ACCEPT, false); // must start inside the tap on phones
    try {
      setUpload('Choose a video…');
      const uploadIds = deviceUpload ? await deviceUpload(setUpload) : undefined;
      if (deviceUpload && !uploadIds) { setUpload(''); return; }
      setUpload('Creating project…');
      const project = await api.selectProject(uploadIds ?? undefined);
      await api.startAuto(project.id, { targetDurationSec: target, imageProvider: images, review });
      try { window.localStorage.setItem(STORE, project.id); } catch { /* private mode */ }
      setUpload(''); onStarted(project.id);
    } catch (error) { setUpload(''); onError(error instanceof Error ? error.message : String(error)); }
  }
  return (
    <section className="autoLauncher">
      <span className="autoKicker">One tap</span>
      <h2>Make my reel</h2>
      <p>Upload a talking video. It is cleaned, cut, captioned and given B-roll automatically. You check the cleaned talk, then get a preview to download.</p>
      <div className="autoChoice"><span>Length</span><div>{LENGTHS.map((option) => <button key={option.label} type="button" className={target === option.value ? 'on' : ''} onClick={() => setTarget(option.value)}>{option.label}</button>)}</div></div>
      <div className="autoChoice"><span>B-roll images</span><div>
        <button type="button" className={images === 'gemini' ? 'on' : ''} onClick={() => setImages('gemini')}>Gemini</button>
        <button type="button" className={images === 'chatgpt' ? 'on' : ''} onClick={() => setImages('chatgpt')}>ChatGPT</button>
      </div></div>
      <div className="autoChoice"><span>Check the transcript before the reel is made</span><div>
        <button type="button" className={review ? 'on' : ''} onClick={() => setReview(true)}>Yes, let me check</button>
        <button type="button" className={!review ? 'on' : ''} onClick={() => setReview(false)}>No, fully automatic</button>
      </div></div>
      <button className="primary autoStart" type="button" disabled={busy || !!upload} onClick={() => void start()}>{upload || (isRemote() ? 'Choose video & start' : 'Choose video & start')}</button>
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
      try { const next = await api.autoStatus(projectId); if (!cancelled) { setJob(next); setError(''); } if (next.state === 'running' || next.state === 'review') timer.current = window.setTimeout(poll, next.state === 'review' ? 3000 : 2000); }
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
            <a className="primary" href={job.downloadUrl} download>Download</a>
            {onOpenEditor && <button type="button" onClick={() => void openEditor()}>Open in full editor</button>}
          </div>
          {job.sourceSeconds && job.finalSeconds ? <small>{Math.round(job.sourceSeconds)} s of talking → {Math.round(job.finalSeconds)} s reel</small> : null}
        </div>
      )}
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
