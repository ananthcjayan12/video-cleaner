import { useRef, useState } from 'react';
import { api, uploadFile, type Me } from '../api';
import { go, picturesPreference, type PendingReel } from './PhoneApp';

/** Last step before a reel is made: length (and, for the owner, which account), then the upload with time left. */
const LENGTHS: Array<{ label: string; value?: number }> = [{ label: 'Auto' }, { label: '30 s', value: 30 }, { label: '45 s', value: 45 }, { label: '60 s', value: 60 }, { label: '90 s', value: 90 }];
const mb = (bytes: number) => `${Math.max(0.1, bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

export function NewReel({ me, pending, onStarted, onCancel }: { me: Me | null; pending: PendingReel | null; onStarted: (projectId: string) => void; onCancel: () => void }) {
  const [length, setLength] = useState<number | undefined>(pending?.idea && pending.idea.seconds <= 40 ? 45 : undefined);
  const [workspaceId, setWorkspaceId] = useState('personal');
  const [progress, setProgress] = useState<{ sent: number; size: number; eta?: number } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'starting'>('idle');
  const [error, setError] = useState('');
  const startedAt = useRef(0);

  if (!pending?.files.length) {
    return <main className="pr-page"><div className="pr-empty"><strong>No video chosen</strong><span>Record a reel or upload a video from Home.</span>
      <button type="button" className="pr-btn primary" onClick={() => go('home')}>Go to Home</button></div></main>;
  }
  const files = pending.files; const total = files.reduce((sum, file) => sum + file.size, 0);
  const account = me?.role === 'member' ? me.workspace : me?.workspaces?.find((w) => w.id === workspaceId);
  const apiOnly = account?.effectiveProfile === 'api';

  async function make() {
    setError(''); setPhase('uploading'); startedAt.current = Date.now();
    try {
      const ids: string[] = []; let done = 0;
      for (const file of files) {
        ids.push(await uploadFile(file, ({ sent }) => {
          const all = done + sent; const elapsed = (Date.now() - startedAt.current) / 1000;
          const rate = elapsed > 2 ? all / elapsed : 0;
          setProgress({ sent: all, size: total, eta: rate ? (total - all) / rate : undefined });
        }));
        done += file.size;
      }
      setPhase('starting');
      const project = await api.selectProject(ids, true, me?.role === 'admin' ? workspaceId : undefined);
      if (pending?.idea) await api.renameProject(project.id, pending.idea.title).catch(() => undefined);
      await api.startAuto(project.id, { targetDurationSec: length, imageProvider: apiOnly ? 'gemini' : picturesPreference(), review: true, thumbnail: true, postCaption: true });
      onStarted(project.id);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setPhase('idle'); }
  }

  if (phase !== 'idle') {
    const percent = progress ? Math.min(100, Math.round((progress.sent / progress.size) * 100)) : 0;
    return (
      <main className="pr-page">
        <div className="pr-top"><h1>{phase === 'starting' ? 'Starting your reel' : 'Sending your video'}</h1></div>
        <div className="pr-card">
          <strong>{pending.idea?.title ?? `${files.length} clip${files.length === 1 ? '' : 's'}`}</strong>
          <div className="pr-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${phase === 'starting' ? 100 : percent}%` }} /></div>
          <small>{phase === 'starting' ? 'Upload done. Setting things up…' : progress ? `${percent}% · ${mb(progress.sent)} of ${mb(progress.size)}${progress.eta !== undefined ? ` · about ${Math.max(1, Math.round(progress.eta))} s left` : ''}` : 'Starting upload…'}</small>
        </div>
        <p className="pr-info">Keep PractiReel open until the upload finishes. After that you can lock your phone; we'll notify you when the reel needs you.</p>
      </main>
    );
  }

  return (
    <main className="pr-page">
      <button type="button" className="pr-back" onClick={onCancel}>‹ Cancel</button>
      <h1>Ready to make your reel</h1>
      <div className="pr-card pr-files">
        <strong style={{ color: 'var(--ink)' }}>{pending.idea?.title ?? (pending.source === 'camera' ? 'Your recording' : 'Your video')}</strong>
        {files.map((file, i) => <span key={`${file.name}-${i}`}>{files.length > 1 ? `Clip ${i + 1}: ` : ''}{file.name.replace(/-\d{10,}/, '')} · {mb(file.size)}</span>)}
        {files.length > 1 && <small>Clips are joined in this order.</small>}
      </div>
      <div className="pr-card pr-options">
        <div className="pr-field">Reel length<div className="pr-chips">{LENGTHS.map((option) => (
          <button key={option.label} type="button" className={`pr-chip${length === option.value ? ' on' : ''}`} onClick={() => setLength(option.value)}>{option.label}</button>
        ))}</div><small>Auto keeps every idea once and cuts the rest.</small></div>
        {me?.role === 'admin' && (me.workspaces?.length ?? 0) > 1 && (
          <label className="pr-field">For account<select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {me.workspaces!.map((w) => <option key={w.id} value={w.id}>{w.name}{w.effectiveProfile === 'api' ? ' (API)' : ''}</option>)}
          </select></label>
        )}
      </div>
      <p className="pr-info">Next: we write down what you said, cut it, and show it to you before anything is made. A reel is only counted when it's finished.</p>
      {error && <p className="pr-error">{error}</p>}
      <button type="button" className="pr-btn primary block" onClick={() => void make()}>{error ? 'Try again' : 'Make my reel'}</button>
    </main>
  );
}
