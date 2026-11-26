import React, { useCallback, useEffect, useState } from 'react';
import { LookPreview } from './LookPreview';
import { api, type Idea, type Me, type Niche, type Project } from '../api';
import { AccountsPanel } from '../Accounts';
import { RecordScreen } from './Record';
import { NewReel } from './NewReel';
import { CoverEditor, ReelScreen } from './ReelScreen';
import { pushState, registerWorker, turnOffPush, turnOnPush, type PushState } from './notify';
import { chooseFiles, VIDEO_ACCEPT } from '../device-files';
import './phone.css';

/**
 * PractiReel phone app: Home (what to say this week), Ideas, My reels, Profile. Routes live in the URL hash so a
 * notification can open a reel directly (#reel-<id>) and the back button works.
 */
type Route = { name: 'home' | 'ideas' | 'reels' | 'profile' | 'accounts' | 'new' } | { name: 'record'; ideaId?: string } | { name: 'reel' | 'cover'; id: string };
function parseRoute(hash: string): Route {
  const value = hash.replace(/^#/, '');
  const reel = value.match(/^(reel|cover)-(.+)$/); if (reel) return { name: reel[1] as 'reel' | 'cover', id: decodeURIComponent(reel[2]) };
  const record = value.match(/^record(?:-(.+))?$/); if (record) return { name: 'record', ideaId: record[1] ? decodeURIComponent(record[1]) : undefined };
  return ['ideas', 'reels', 'profile', 'accounts', 'new'].includes(value) ? { name: value as 'ideas' } : { name: 'home' };
}
export const go = (hash: string) => { window.location.hash = hash; };

export type PendingReel = { files: File[]; idea?: Idea; source: 'camera' | 'upload' };
const PICTURES_KEY = 'practireel:pictures';
export const picturesPreference = (): 'gemini' | 'chatgpt' => { try { return window.localStorage.getItem(PICTURES_KEY) === 'chatgpt' ? 'chatgpt' : 'gemini'; } catch { return 'gemini'; } };

export function PhoneApp({ me, onMe }: { me: Me | null; onMe: (me: Me) => void }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [ideas, setIdeas] = useState<{ niche: Niche; label: string; week: Idea[]; all: Idea[] } | null>(null);
  const [pending, setPending] = useState<PendingReel | null>(null);
  const [toast, setToast] = useState('');
  useEffect(() => { const onHash = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { registerWorker(); }, []);
  const refresh = useCallback(async () => { try { setProjects(await api.listProjects()); } catch { setProjects((current) => current ?? []); } }, []);
  useEffect(() => { void refresh(); void api.ideas().then(setIdeas).catch(() => undefined); }, [refresh]);
  useEffect(() => { if (route.name === 'home' || route.name === 'reels') void refresh(); }, [route.name, refresh]);
  // Keep the list fresh while a reel is being made.
  useEffect(() => {
    const busy = projects?.some((p) => p.reel?.state === 'running' || p.reel?.state === 'review');
    if (!busy || !['home', 'reels'].includes(route.name)) return;
    const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer);
  }, [projects, route.name, refresh]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(timer); }, [toast]);

  const workspace = me?.role === 'member' ? me.workspace : me?.workspaces?.find((w) => w.id === 'personal');
  const startUpload = () => {
    const chosen = chooseFiles(VIDEO_ACCEPT, true); // must open inside the tap
    void chosen.then((files) => { if (files.length) { setPending({ files, source: 'upload' }); go('new'); } });
  };
  const idea = route.name === 'record' ? ideas?.all.find((item) => item.id === route.ideaId) : undefined;

  if (route.name === 'record') return <RecordScreen idea={idea} onCancel={() => history.back()} onDone={(files) => { setPending({ files, idea, source: 'camera' }); go('new'); }} />;

  let page: React.ReactElement;
  if (route.name === 'new') page = <NewReel me={me} pending={pending} onStarted={(id) => { setPending(null); void refresh(); window.location.replace(`#reel-${id}`); }} onCancel={() => { setPending(null); go('home'); }} />;
  else if (route.name === 'reel') page = <ReelScreen id={route.id} me={me} onToast={setToast} onChanged={refresh} />;
  else if (route.name === 'cover') page = <CoverEditor id={route.id} onToast={setToast} />;
  else if (route.name === 'ideas') page = <IdeasPage ideas={ideas} />;
  else if (route.name === 'reels') page = <ReelsPage projects={projects} />;
  else if (route.name === 'profile') page = <ProfilePage me={me} onToast={setToast} />;
  else if (route.name === 'accounts' && me?.role === 'admin') page = <div className="pr-page"><button className="pr-back" type="button" onClick={() => go('profile')}>‹ Profile</button><AccountsPanel onClose={() => { void api.me().then(onMe); go('profile'); }} /></div>;
  else page = <HomePage me={me} workspaceName={workspace?.name} credits={workspace} ideas={ideas} projects={projects} onUpload={startUpload} />;

  const tab = route.name === 'reel' || route.name === 'cover' ? 'reels' : route.name === 'accounts' || route.name === 'new' ? (route.name === 'new' ? 'home' : 'profile') : route.name;
  return (
    <div className="pr">
      {page}
      <div className="pr-tabs"><nav aria-label="Main">
        <TabButton id="home" label="Home" on={tab === 'home'} icon={<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />} />
        <TabButton id="ideas" label="Ideas" on={tab === 'ideas'} icon={<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />} />
        <TabButton id="reels" label="My reels" on={tab === 'reels'} icon={<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3z" /></>} />
        <TabButton id="profile" label="Profile" on={tab === 'profile'} icon={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>} />
      </nav></div>
      {toast && <div className="pr-toast" role="status">{toast}</div>}
    </div>
  );
}

function TabButton({ id, label, on, icon }: { id: string; label: string; on: boolean; icon: React.ReactElement }) {
  return <button type="button" className={`pr-tab${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => go(id)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>{label}
  </button>;
}

export function Brand() { return <div className="pr-brand"><img src="/icons/icon-192.png" alt="" />PractiReel</div>; }

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

function HomePage({ me, workspaceName, credits, ideas, projects, onUpload }: { me: Me | null; workspaceName?: string; credits?: { reelsPerMonth?: number; limitThisMonth?: number; reelsThisMonth: number }; ideas: { week: Idea[] } | null; projects: Project[] | null; onUpload: () => void }) {
  const limit = credits?.limitThisMonth ?? credits?.reelsPerMonth; const used = credits?.reelsThisMonth ?? 0; const left = limit ? Math.max(0, limit - used) : undefined;
  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
  const working = (projects ?? []).filter((p) => p.reel?.state === 'running' || p.reel?.state === 'review');
  const name = me?.role === 'member' ? (workspaceName ?? '') : '';
  return (
    <main className="pr-page">
      <div className="pr-top"><Brand />{me?.role === 'admin' && <a className="pr-btn small" href="/?view=console#overview">Console</a>}</div>
      <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
      <div className="pr-card pr-credits">
        <div className="pr-ring" style={{ ['--p' as string]: limit ? Math.round((left! / limit) * 100) : 100 }}><b>{left ?? used}</b></div>
        <div>{limit ? <><strong>{left} of {limit} reels left</strong><br /><small>Renews {nextMonth.toLocaleDateString([], { day: 'numeric', month: 'short' })}</small></>
          : <><strong>{used} reel{used === 1 ? '' : 's'} this month</strong><br /><small>No monthly limit</small></>}</div>
      </div>
      {working.map((project) => (
        <button key={project.id} type="button" className="pr-inprogress" onClick={() => go(`reel-${project.id}`)}>
          <span className={`pr-pill ${project.reel?.state === 'review' ? 'review' : 'making'}`}>{project.reel?.state === 'review' ? 'Your turn' : 'Making'}</span>
          <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</strong>
            <small>{project.reel?.state === 'review' ? 'Check what stays' : project.reel?.queuePosition ? `In line · ${project.reel.queuePosition} ahead` : project.reel?.step ?? 'Working…'}</small></span>
          <span aria-hidden="true">›</span>
        </button>
      ))}
      <section className="pr-section">
        <span className="pr-label">This week's ideas</span>
        {(ideas?.week ?? []).map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
        {!ideas && <div className="pr-card"><small>Loading ideas…</small></div>}
      </section>
      {me?.role === 'admin' && (
        <a className="pr-inprogress" href="/?mode=stick-reel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="pr-pill review">Owner</span>
          <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block' }}>Stick-figure reels</strong><small>AI script + voice, from an idea, a link or your recording</small></span>
          <span aria-hidden="true">›</span>
        </a>
      )}
      <div className="pr-actions">
        <button type="button" className="pr-btn primary" disabled={left === 0} onClick={() => go('record')}><span className="pr-dot" />Record</button>
        <button type="button" className="pr-btn" disabled={left === 0} onClick={onUpload}>Upload video</button>
      </div>
      {left === 0 && <p className="pr-info">You've made all your reels for this month. New reels open on the 1st.</p>}
    </main>
  );
}

export function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <button type="button" className="pr-idea" onClick={() => go(`record-${encodeURIComponent(idea.id)}`)}>
      <span className="kind">{idea.kind} · {idea.seconds} s</span>
      <span className="title">{idea.title}</span>
      <small>{idea.points.length} talking points ready</small>
      <span className="pr-btn small primary go"><span className="pr-dot" style={{ background: '#fff' }} />Record this</span>
    </button>
  );
}

function IdeasPage({ ideas }: { ideas: { label: string; all: Idea[] } | null }) {
  return (
    <main className="pr-page">
      <div className="pr-top"><Brand /></div>
      <h1>Ideas</h1>
      <p className="muted">Topics that work for {ideas?.label.toLowerCase() ?? 'your field'}. Each has a hook and three points for the teleprompter.</p>
      {(ideas?.all ?? []).map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
      <button type="button" className="pr-btn block" onClick={() => go('record')}>Record your own topic</button>
    </main>
  );
}

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'making', label: 'In progress' }, { id: 'ready', label: 'Ready' }, { id: 'posted', label: 'Posted' }] as const;
export function reelBadge(project: Project): { cls: string; text: string } {
  const reel = project.reel;
  if (project.postedAt) return { cls: 'posted', text: '✓ Posted' };
  if (!reel) return { cls: 'posted', text: 'Not started' };
  if (reel.state === 'completed') return { cls: 'ready', text: 'Ready' };
  if (reel.state === 'review') return { cls: 'review', text: 'Your turn' };
  if (reel.state === 'running') return { cls: 'making', text: reel.queuePosition ? 'In line' : 'Making' };
  if (reel.state === 'stopped') return { cls: 'posted', text: 'Stopped' };
  return { cls: 'failed', text: 'Stopped with an error' };
}
function ReelsPage({ projects }: { projects: Project[] | null }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const list = (projects ?? []).filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'posted') return Boolean(p.postedAt);
    if (filter === 'ready') return !p.postedAt && p.reel?.state === 'completed';
    return p.reel?.state === 'running' || p.reel?.state === 'review';
  });
  return (
    <main className="pr-page">
      <div className="pr-top"><h1>My reels</h1><button type="button" className="pr-btn small primary" onClick={() => go('record')}>+ New</button></div>
      <div className="pr-chips" role="tablist">{FILTERS.map((f) => <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`pr-chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div>
      {projects === null && <div className="pr-card"><small>Loading your reels…</small></div>}
      {projects !== null && !list.length && (
        <div className="pr-empty"><strong>{filter === 'all' ? 'No reels yet' : 'Nothing here'}</strong><span>{filter === 'all' ? 'Pick an idea on Home and record your first reel. It takes about 15 minutes in all.' : 'Reels show up here as they move along.'}</span>
          {filter === 'all' && <button type="button" className="pr-btn primary" onClick={() => go('home')}>See this week's ideas</button>}</div>
      )}
      {list.map((project) => { const badge = reelBadge(project); return (
        <button key={project.id} type="button" className="pr-reel" onClick={() => go(`reel-${project.id}`)}>
          <span className="pr-thumb" style={project.reel?.coverUrl ? { backgroundImage: `url("${project.reel.coverUrl}")` } : undefined}>{project.reel?.coverUrl ? '' : '▶'}</span>
          <span className="meta"><strong>{project.name}</strong><small>{new Date(project.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}{project.reel?.state === 'running' && project.reel.step ? ` · ${project.reel.step}` : ''}</small>
            <span><span className={`pr-pill ${badge.cls}`}>{badge.text}</span></span></span>
          <span aria-hidden="true">›</span>
        </button>
      ); })}
    </main>
  );
}

function ProfilePage({ me, onToast }: { me: Me | null; onToast: (text: string) => void }) {
  const [push, setPush] = useState<PushState | null>(null);
  const [pictures, setPictures] = useState(picturesPreference());
  useEffect(() => { void pushState().then(setPush).catch(() => setPush('unsupported')); }, []);
  const workspace = me?.role === 'member' ? me.workspace : me?.workspaces?.find((w) => w.id === 'personal');
  async function togglePush() {
    try { const next = push === 'on' ? await turnOffPush() : await turnOnPush(); setPush(next); onToast(next === 'on' ? 'Notifications on' : next === 'blocked' ? 'Notifications are blocked in your phone settings' : 'Notifications off'); }
    catch (error) { onToast(error instanceof Error ? error.message : String(error)); }
  }
  function choosePictures(value: 'gemini' | 'chatgpt') { setPictures(value); try { window.localStorage.setItem(PICTURES_KEY, value); } catch { /* private mode */ } }
  const limit = workspace?.limitThisMonth ?? workspace?.reelsPerMonth;
  return (
    <main className="pr-page">
      <div className="pr-top"><h1>Profile</h1></div>
      <div className="pr-card">
        <div className="pr-row"><img src="/icons/icon-192.png" alt="" style={{ width: 44, height: 44, borderRadius: 12 }} />
          <div><strong>{workspace?.name ?? 'PractiReel'}</strong><br /><small>Logged in as {me?.username}</small></div></div>
      </div>
      <div className="pr-card">
        <span className="pr-label">Plan</span>
        <strong>{limit ? `${limit} reels a month · ${Math.max(0, limit - (workspace?.reelsThisMonth ?? 0))} left` : `${workspace?.reelsThisMonth ?? 0} reels this month · no limit`}</strong>
        {limit ? <small>Need more this month? Ask your PractiReel contact for 5 more reels.</small> : null}
      </div>
      {workspace?.look && <div className="pr-card"><span className="pr-label">Your reel look</span><LookPreview look={workspace.look} /></div>}
      <div className="pr-card">
        <span className="pr-label">Notifications</span>
        {push === 'needs-install' ? <>
          <strong>Add PractiReel to your Home Screen first</strong>
          <small>On iPhone, notifications only work from the Home Screen app: tap the Share button in Safari, then "Add to Home Screen", and open PractiReel from there.</small>
        </> : push === 'unsupported' ? <small>This browser can't show notifications. Open PractiReel in Safari (iPhone) or Chrome (Android).</small>
          : push === 'blocked' ? <small>Notifications are blocked. Turn them on for PractiReel in your phone's Settings → Notifications.</small>
          : <div className="pr-row" style={{ justifyContent: 'space-between' }}><span>Tell me when a reel needs me or is ready</span>
            <button type="button" className={`pr-btn small${push === 'on' ? '' : ' primary'}`} disabled={push === null} onClick={() => void togglePush()}>{push === 'on' ? 'Turn off' : 'Turn on'}</button></div>}
      </div>
      {me?.role === 'admin' && (
        <div className="pr-owner">
          <span className="pr-label">Owner</span>
          <div className="pr-field">Pictures for my reels<div className="pr-chips">
            <button type="button" className={`pr-chip${pictures === 'chatgpt' ? ' on' : ''}`} onClick={() => choosePictures('chatgpt')}>ChatGPT in Chrome</button>
            <button type="button" className={`pr-chip${pictures === 'gemini' ? ' on' : ''}`} onClick={() => choosePictures('gemini')}>Gemini</button>
          </div><small>Customer accounts on API keys always use Gemini.</small></div>
          <a className="pr-btn primary block" href="/?view=console#overview">Open owner console</a>
          <button type="button" className="pr-btn block" onClick={() => go('accounts')}>Customer accounts</button>
          <a className="pr-btn block" href="/?advanced=1">Engine settings and full editor</a>
        </div>
      )}
      <button type="button" className="pr-btn danger block" onClick={() => void fetch('/api/logout', { method: 'POST' }).then(() => window.location.replace('/login'))}>Log out</button>
    </main>
  );
}
