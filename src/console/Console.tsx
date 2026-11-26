import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ModelSelect } from '../ModelSelect';
import { api, type AdminWorkspace, type ConsoleData, type ConsoleReel, type EngineProfile, type KeyCheck, type Me, type Niche, type SystemStatus } from '../api';
import { LookPreview } from '../phone/LookPreview';
import './console.css';

/**
 * Desktop owner console: customers, reels, field looks and AI engines in one place.
 * Hash routes: #overview, #customers, #customer-<id>, #reels, #packs, #engines.
 */
const USD_TO_INR = 88; // rough, for reading costs at a glance
const inr = (usd: number) => `₹${Math.round(usd * USD_TO_INR).toLocaleString('en-IN')}`;
const TARGET_INR = 150; // what a reel should cost on paid APIs
const NICHE_LABEL: Record<Niche, string> = { dental: 'Dental', physio: 'Physio', nutrition: 'Nutrition', optometry: 'Optometry' };
const NICHE_ICON: Record<Niche, string> = { dental: '🦷', physio: '🏃', nutrition: '🥗', optometry: '👁️' };
const PROFILE_LABEL: Record<EngineProfile, string> = { 'in-house': 'In-house', api: 'API' };
const PROVIDER_LABEL: Record<string, string> = { 'claude-cli': 'Claude CLI', 'codex-cli': 'Codex CLI', 'agy-cli': 'Antigravity CLI', anthropic: 'Claude API', gemini: 'Gemini', openai: 'OpenAI' };
const DAY = 86_400_000;

type Route = { page: 'overview' | 'customers' | 'customer' | 'reels' | 'packs' | 'engines'; id?: string };
function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('customer-')) return { page: 'customer', id: decodeURIComponent(hash.slice(9)) };
  return { page: (['customers', 'reels', 'packs', 'engines'].includes(hash) ? hash : 'overview') as Route['page'] };
}
const go = (hash: string) => { window.location.hash = hash; };
const phoneLink = (hash = '') => `/?phone=1${hash ? `#${hash}` : ''}`;

const ago = (ms: number, now: number) => { const d = Math.floor((now - ms) / DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const date = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const monthName = (now: number) => new Date(now).toLocaleDateString('en-IN', { month: 'long' });
const startOfMonth = (now: number) => { const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };

function lastActivity(workspace: AdminWorkspace, reels: ConsoleReel[]) {
  const times = reels.filter((r) => r.workspaceId === workspace.id).map((r) => r.finishedAt ?? r.startedAt ?? Date.parse(r.createdAt)).filter(Boolean) as number[];
  return times.length ? Math.max(...times) : undefined;
}
type Status = { label: string; tone: 'good' | 'warn' | 'muted' | 'info' };
function customerStatus(workspace: AdminWorkspace, reels: ConsoleReel[], now: number): Status {
  if (workspace.id === 'personal') return { label: 'Your own', tone: 'info' };
  const limit = workspace.limitThisMonth ?? workspace.reelsPerMonth;
  if (limit && workspace.reelsThisMonth >= limit) return { label: 'Limit reached', tone: 'warn' };
  const last = lastActivity(workspace, reels);
  if (!last) return { label: 'New', tone: 'muted' };
  if (now - last > 14 * DAY) return { label: 'Quiet', tone: 'warn' };
  return { label: 'Active', tone: 'good' };
}

type Attention = { key: string; tone: 'critical' | 'warn' | 'info'; text: string; action?: { label: string; run?: () => Promise<string>; href?: string } };

export function Console({ me }: { me: Me | null }) {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [data, setData] = useState<ConsoleData | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await api.console()); setError(''); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void load(); void api.settings().then(setStatus).catch(() => undefined); }, [load]);
  useEffect(() => { const on = () => setRoute(parseRoute()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  // Keep in-progress reels fresh without reloading the page.
  useEffect(() => { if (!data?.reels.some((r) => r.state === 'running')) return; const timer = setInterval(() => void load(), 10_000); return () => clearInterval(timer); }, [data, load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.title = 'PractiReel · Owner'; }, []);

  const act = useCallback(async (work: () => Promise<string>) => {
    try { setToast(await work()); await load(); } catch (err) { setToast(err instanceof Error ? err.message : String(err)); }
  }, [load]);

  const nav: Array<[Route['page'], string, string, string]> = [['overview', 'Overview', 'Overview', '⌂'], ['customers', 'Customers', 'Customers', '👥'], ['reels', 'Reels', 'Reels', '▶'], ['packs', 'Niche packs', 'Looks', '◈'], ['engines', 'AI engines', 'Engines', '✦']];
  const active = route.page === 'customer' ? 'customers' : route.page;
  let page: React.ReactNode = <p className="oc-muted">Loading…</p>;
  if (data) {
    if (route.page === 'overview') page = <Overview data={data} status={status} act={act} />;
    else if (route.page === 'customers') page = <Customers data={data} act={act} />;
    else if (route.page === 'customer') page = <CustomerPage data={data} id={route.id!} act={act} />;
    else if (route.page === 'reels') page = <ReelsPage data={data} />;
    else if (route.page === 'packs') page = <PacksPage data={data} />;
    else page = <EnginesPage data={data} status={status} onStatus={setStatus} act={act} />;
  }
  return (
    <div className="oc">
      <aside className="oc-side">
        <div className="oc-brand"><img src="/icons/icon-192.png" alt="" />PractiReel</div>
        <nav>{nav.map(([id, label, short, icon]) => (
          <a key={id} href={`#${id}`} className={active === id ? 'on' : ''} aria-current={active === id ? 'page' : undefined}><span aria-hidden="true">{icon}</span><b>{label}</b><i>{short}</i></a>
        ))}</nav>
        <div className="oc-side-foot">
          <a href="/?view=phone#home">📱 My reels app</a>
          <a href="/?advanced=1">🛠 Advanced editor</a>
          <a href="/?mode=stick-reel">🎬 Stick-figure reels</a>
          <small>Logged in as {me?.username}</small>
        </div>
      </aside>
      <header className="oc-mobile-top"><div className="oc-brand"><img src="/icons/icon-192.png" alt="" />Console</div><span className="oc-mobile-actions"><a className="oc-btn small" href="/?mode=stick-reel">🎬 Stick</a><a className="oc-btn small" href="/?view=phone#home">📱 My reels</a></span></header>
      <main className="oc-main">
        {error && <div className="oc-banner critical">Could not load: {error} <button type="button" onClick={() => void load()}>Try again</button></div>}
        {page}
      </main>
      {toast && <div className="oc-toast" role="status">{toast}</div>}
    </div>
  );
}

/* ---------- Overview ---------- */
function Overview({ data, status, act }: { data: ConsoleData; status: SystemStatus | null; act: (work: () => Promise<string>) => Promise<void> }) {
  const { now, workspaces, reels } = data;
  const monthStart = startOfMonth(now);
  const customers = workspaces.filter((w) => w.id !== 'personal');
  const activeCustomers = customers.filter((w) => customerStatus(w, reels, now).label === 'Active' || customerStatus(w, reels, now).label === 'Limit reached').length;
  const made = reels.filter((r) => r.state === 'completed' && (r.finishedAt ?? 0) >= monthStart);
  const costNow = workspaces.reduce((sum, w) => sum + w.costThisMonth.costUsd, 0);
  // Only reels with a recorded cost count (reels made before the cost meter have none).
  const measured = made.filter((r) => r.cost.apiUsd > 0); const paid = measured.reduce((sum, r) => sum + r.cost.apiUsd, 0);
  return (
    <>
      <header className="oc-head"><h1>Overview · {monthName(now)}</h1></header>
      <a className="oc-card oc-shortcut" href="/?mode=stick-reel">
        <span className="oc-shortcut-icon" aria-hidden="true">🎬</span>
        <span><b>Stick-figure reels</b><small className="oc-muted">Your face on a stick figure. From an idea, an Instagram/YouTube link or your recording, with AI script and Malayalam voice.</small></span>
        <span aria-hidden="true">›</span>
      </a>
      <section className="oc-stats">
        <Stat icon="👥" label="Active customers" value={`${activeCustomers}`} sub={`${customers.length} customer account${customers.length === 1 ? '' : 's'}`} />
        <Stat icon="▶" label="Reels made" value={`${made.length}`} sub={`this month, all accounts`} />
        <Stat icon="₹" label="Spent this month" value={inr(costNow)} sub="what you actually paid (APIs)" />
        <Stat icon="📊" label="Avg cost per reel" value={measured.length ? inr(paid / measured.length) : '—'} sub={`on paid APIs · ${measured.length} reel${measured.length === 1 ? '' : 's'} measured · target ₹${TARGET_INR}`} />
      </section>
      <div className="oc-grid">
        <section className="oc-card">
          <div className="oc-card-head"><h2>Customers</h2><a className="oc-btn primary" href="#customers">+ Add customer</a></div>
          <CustomerTable workspaces={workspaces} reels={reels} now={now} />
        </section>
        <section className="oc-card">
          <div className="oc-card-head"><h2>Needs attention</h2></div>
          <AttentionList items={attention(data, status)} act={act} />
        </section>
      </div>
      <section className="oc-card"><div className="oc-card-head"><h2>Cost per reel</h2><small className="oc-muted">Last 30 days · on paid APIs (what a customer reel costs)</small></div><CostChart reels={reels} now={now} /></section>
    </>
  );
}

function Stat({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return <div className="oc-stat"><span className="oc-stat-icon" aria-hidden="true">{icon}</span><div><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div></div>;
}

function attention(data: ConsoleData, status: SystemStatus | null): Attention[] {
  const { now, workspaces, reels } = data; const items: Attention[] = [];
  const name = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id;
  const apiAccounts = workspaces.filter((w) => w.profile === 'api');
  if (status?.apiEngines && apiAccounts.length && (!status.apiEngines.anthropic.configured || !status.apiEngines.gemini.configured)) {
    const missing = [!status.apiEngines.anthropic.configured && 'Claude API', !status.apiEngines.gemini.configured && 'Gemini'].filter(Boolean).join(' and ');
    items.push({ key: 'keys', tone: 'critical', text: `No ${missing} key: ${apiAccounts.length} API account${apiAccounts.length === 1 ? '' : 's'} can't make reels`, action: { label: 'Add key', href: '#engines' } });
  }
  for (const reel of reels) {
    if (reel.state === 'failed' && now - (reel.finishedAt ?? reel.startedAt ?? 0) < 14 * DAY) items.push({ key: `failed-${reel.id}`, tone: 'critical', text: `${name(reel.workspaceId)}: “${reel.name}” stopped with an error`, action: { label: 'Open', href: phoneLink(`reel-${reel.id}`) } });
    if (reel.state === 'review' && now - (reel.startedAt ?? now) > 6 * 3_600_000) items.push({ key: `review-${reel.id}`, tone: 'info', text: `${name(reel.workspaceId)}: “${reel.name}” is waiting for its transcript check`, action: { label: 'Open', href: phoneLink(`reel-${reel.id}`) } });
  }
  for (const workspace of workspaces) {
    if (workspace.id === 'personal') continue;
    const limit = workspace.limitThisMonth ?? workspace.reelsPerMonth;
    if (limit && workspace.reelsThisMonth >= limit) items.push({ key: `limit-${workspace.id}`, tone: 'warn', text: `${workspace.name} used all ${limit} reels this month`, action: { label: 'Add 5 reels', run: async () => { await api.addExtraReels(workspace.id, 5); return `Added 5 reels for ${workspace.name} this month.`; } } });
    if (!workspace.members.length) { items.push({ key: `login-${workspace.id}`, tone: 'info', text: `${workspace.name} has no login yet`, action: { label: 'Add login', href: `#customer-${encodeURIComponent(workspace.id)}` } }); continue; }
    const last = lastActivity(workspace, reels) ?? Date.parse(workspace.createdAt);
    const days = Math.floor((now - last) / DAY);
    if (days >= 9) items.push({ key: `quiet-${workspace.id}`, tone: 'warn', text: `${workspace.name} hasn't made a reel in ${days} days`, action: { label: 'Send a reminder', run: async () => { const { sent } = await api.nudge(workspace.id); return sent ? `Reminder sent to ${sent} phone${sent === 1 ? '' : 's'}.` : `${workspace.name} hasn't turned on notifications, so nothing was sent. Message them directly.`; } } });
  }
  const order = { critical: 0, warn: 1, info: 2 };
  return items.sort((a, b) => order[a.tone] - order[b.tone]);
}

function AttentionList({ items, act }: { items: Attention[]; act: (work: () => Promise<string>) => Promise<void> }) {
  const [busy, setBusy] = useState('');
  if (!items.length) return <p className="oc-empty">✓ Nothing needs you right now.</p>;
  const icon = { critical: '⨯', warn: '!', info: 'i' };
  return (
    <ul className="oc-attention">{items.map((item) => (
      <li key={item.key} className={item.tone}>
        <span className="oc-attention-icon" aria-label={item.tone === 'critical' ? 'Problem' : item.tone === 'warn' ? 'Warning' : 'Note'}>{icon[item.tone]}</span>
        <span>{item.text}</span>
        {item.action?.href && <a className="oc-link" href={item.action.href}>{item.action.label} ›</a>}
        {item.action?.run && <button type="button" className="oc-link" disabled={busy === item.key} onClick={() => { setBusy(item.key); void act(item.action!.run!).finally(() => setBusy('')); }}>{busy === item.key ? 'Working…' : `${item.action.label} ›`}</button>}
      </li>
    ))}</ul>
  );
}

function CustomerTable({ workspaces, reels, now }: { workspaces: AdminWorkspace[]; reels: ConsoleReel[]; now: number }) {
  const sorted = [...workspaces].sort((a, b) => Number(a.id === 'personal') - Number(b.id === 'personal') || a.name.localeCompare(b.name));
  return (
    <table className="oc-table">
      <thead><tr><th>Customer</th><th>Field</th><th>Engines</th><th>Reels this month</th><th className="num">Spent this month</th><th>Status</th></tr></thead>
      <tbody>{sorted.map((workspace) => {
        const limit = workspace.limitThisMonth ?? workspace.reelsPerMonth; const niche = workspace.niche ?? 'dental'; const st = customerStatus(workspace, reels, now);
        return (
          <tr key={workspace.id} onClick={() => go(`customer-${encodeURIComponent(workspace.id)}`)} className="oc-row-link">
            <td className="oc-cell-main"><a href={`#customer-${encodeURIComponent(workspace.id)}`} className="oc-name"><span className="oc-avatar" aria-hidden="true">{NICHE_ICON[niche]}</span>{workspace.name}{workspace.id === 'personal' && <small> (own)</small>}</a></td>
            <td data-label="Field"><span className="oc-pill field">{NICHE_LABEL[niche]}</span></td>
            <td data-label="Engines"><span className={`oc-pill ${workspace.effectiveProfile === 'in-house' ? 'outline' : ''}`}>{workspace.effectiveProfile ? PROFILE_LABEL[workspace.effectiveProfile] : 'Off'}</span></td>
            <td data-label="Reels this month">{limit ? <div className="oc-meter"><span>{workspace.reelsThisMonth} / {limit}</span><div><i style={{ width: `${Math.min(100, (workspace.reelsThisMonth / limit) * 100)}%` }} /></div></div> : <span>{workspace.reelsThisMonth}</span>}</td>
            <td className="num" data-label="Spent this month">{inr(workspace.costThisMonth.costUsd)}</td>
            <td data-label="Status"><span className={`oc-status ${st.tone}`}>{st.label}</span></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

/* ---------- Cost chart: one bar per finished reel, dashed target line ---------- */
function CostChart({ reels, now }: { reels: ConsoleReel[]; now: number }) {
  const points = reels.filter((r) => r.state === 'completed' && r.finishedAt && now - r.finishedAt < 30 * DAY && r.cost.apiUsd > 0)
    .sort((a, b) => a.finishedAt! - b.finishedAt!).map((r) => ({ reel: r, value: r.cost.apiUsd * USD_TO_INR }));
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the box's real width so text stays 12px instead of scaling with the SVG.
  const box = useRef<HTMLDivElement>(null); const [W, setW] = useState(760);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setW(Math.max(260, Math.round(el.clientWidth)));
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [points.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!points.length) return <p className="oc-empty">No finished reels in the last 30 days yet.</p>;
  const H = 220, left = 48, right = 12, top = 14, bottom = 28;
  const max = Math.max(TARGET_INR * 1.15, ...points.map((p) => p.value)) * 1.08;
  const step = max > 400 ? 100 : 50; const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const slot = (W - left - right) / points.length; const barW = Math.max(4, Math.min(36, slot - 6));
  const avg = points.reduce((s, p) => s + p.value, 0) / points.length; const over = points.filter((p) => p.value > TARGET_INR).length;
  return (
    <div className="oc-chart">
      <p className="oc-chart-sum"><strong>₹{Math.round(avg)}</strong> average over {points.length} reel{points.length === 1 ? '' : 's'} · {over ? `${over} above the ₹${TARGET_INR} target` : `all under the ₹${TARGET_INR} target`}</p>
      <div className="oc-chart-box" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Cost per reel, ${points.length} reels, average ₹${Math.round(avg)}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <g key={t}><line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="grid" /><text x={left - 8} y={y(t) + 4} className="tick" textAnchor="end">₹{t}</text></g>)}
          <line x1={left} x2={W - right} y1={y(TARGET_INR)} y2={y(TARGET_INR)} className="target" />
          <text x={W - right} y={y(TARGET_INR) - 6} className="target-label" textAnchor="end">Target ₹{TARGET_INR}</text>
          {points.map((p, i) => {
            const cx = left + slot * i + slot / 2; const h = Math.max(2, y(0) - y(p.value));
            return <g key={p.reel.id} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} tabIndex={0} aria-label={`${p.reel.name}: ₹${Math.round(p.value)}`}>
              <rect x={left + slot * i} y={top} width={slot} height={H - top - bottom} fill="transparent" />
              <path className={`bar${hover === i ? ' on' : ''}`} d={`M${cx - barW / 2},${y(0)} V${y(0) - h + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${y(0)} Z`} />
            </g>;
          })}
          <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} className="axis" />
          <text x={left} y={H - 8} className="tick">{date(points[0].reel.finishedAt)}</text>
          <text x={W - right} y={H - 8} className="tick" textAnchor="end">{date(points.at(-1)!.reel.finishedAt)}</text>
        </svg>
        {hover !== null && (() => { const p = points[hover]; const leftPct = ((left + slot * hover + slot / 2) / W) * 100; return (
          <div className="oc-tip" style={{ left: `${leftPct}%` }}>
            <strong>{p.reel.name}</strong><span>{date(p.reel.finishedAt)}{p.reel.seconds ? ` · ${Math.round(p.reel.seconds)} s` : ''}</span>
            <span>Paid APIs: <b>₹{Math.round(p.value)}</b></span><span>Actually paid: ₹{Math.round(p.reel.cost.costUsd * USD_TO_INR)}</span>
          </div>); })()}
      </div>
      <details className="oc-table-view"><summary>Show as a table</summary>
        <table className="oc-table small"><thead><tr><th>Reel</th><th>Finished</th><th className="num">Paid APIs</th><th className="num">Actually paid</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.reel.id}><td className="oc-cell-main">{p.reel.name}</td><td data-label="Finished">{date(p.reel.finishedAt)}</td><td className="num" data-label="Paid APIs">₹{Math.round(p.value)}</td><td className="num" data-label="Actually paid">{inr(p.reel.cost.costUsd)}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

/* ---------- Customers ---------- */
function Customers({ data, act }: { data: ConsoleData; act: (work: () => Promise<string>) => Promise<void> }) {
  const [name, setName] = useState(''); const [niche, setNiche] = useState<Niche>('dental'); const [limit, setLimit] = useState('10');
  const [profile, setProfile] = useState<EngineProfile>('api');
  return (
    <>
      <header className="oc-head"><h1>Customers</h1></header>
      <section className="oc-card">
        <div className="oc-card-head"><h2>Add a customer</h2></div>
        <form className="oc-form-row" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); void act(async () => { const created = await api.createWorkspace({ name: n, profile, niche, reelsPerMonth: Number(limit) || undefined }); go(`customer-${encodeURIComponent(created.id)}`); return `Added ${n}. Now add a login for them.`; }); setName(''); }}>
          <label>Practice name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Smile Dental, Kochi" required /></label>
          <label>Field<select value={niche} onChange={(e) => setNiche(e.target.value as Niche)}>{(Object.keys(NICHE_LABEL) as Niche[]).map((n) => <option key={n} value={n}>{NICHE_LABEL[n]}</option>)}</select></label>
          <label>Engines<select value={profile} onChange={(e) => setProfile(e.target.value as EngineProfile)}>{data.allowedProfiles.map((p) => <option key={p} value={p}>{p === 'api' ? 'API (customers)' : 'In-house (mine)'}</option>)}</select></label>
          <label>Reels a month<input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" /></label>
          <button type="submit" className="oc-btn primary" disabled={!name.trim()}>Add customer</button>
        </form>
      </section>
      <section className="oc-card"><CustomerTable workspaces={data.workspaces} reels={data.reels} now={data.now} /></section>
    </>
  );
}

function CustomerPage({ data, id, act }: { data: ConsoleData; id: string; act: (work: () => Promise<string>) => Promise<void> }) {
  const workspace = data.workspaces.find((w) => w.id === id);
  const [tab, setTab] = useState<'overview' | 'reels' | 'brand' | 'logins'>('overview');
  if (!workspace) return <><header className="oc-head"><a href="#customers" className="oc-crumb">Customers</a></header><p className="oc-empty">This customer was not found.</p></>;
  const niche = workspace.niche ?? 'dental'; const reels = data.reels.filter((r) => r.workspaceId === id);
  return (
    <>
      <header className="oc-head"><nav className="oc-crumb"><a href="#customers">Customers</a> › <span>{workspace.name}</span></nav></header>
      <section className="oc-card oc-customer-head">
        <span className="oc-avatar big" aria-hidden="true">{NICHE_ICON[niche]}</span>
        <div><h1>{workspace.name}</h1><div className="oc-pills"><span className="oc-pill field">{NICHE_LABEL[niche]}</span><span className="oc-pill">{workspace.effectiveProfile ? PROFILE_LABEL[workspace.effectiveProfile] : 'Engines off'}</span><span className={`oc-status ${customerStatus(workspace, data.reels, data.now).tone}`}>{customerStatus(workspace, data.reels, data.now).label}</span></div></div>
      </section>
      <div className="oc-tabs" role="tablist">{(['overview', 'reels', 'brand', 'logins'] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'brand' ? 'Field & look' : t[0].toUpperCase() + t.slice(1)}{t === 'reels' ? ` (${reels.length})` : t === 'logins' && workspace.id !== 'personal' ? ` (${workspace.members.length})` : ''}</button>
      ))}</div>
      {tab === 'overview' && <div className="oc-grid two">
        <PlanCard workspace={workspace} act={act} />
        <EnginesCard workspace={workspace} allowed={data.allowedProfiles} act={act} />
        <UsageCard workspace={workspace} />
        {workspace.id !== 'personal' && <LoginsCard workspace={workspace} act={act} />}
      </div>}
      {tab === 'reels' && <section className="oc-card"><ReelTable reels={reels} workspaces={data.workspaces} hideCustomer /></section>}
      {tab === 'brand' && <section className="oc-card">
        <div className="oc-card-head"><h2>Field and reel look</h2></div>
        <label className="oc-inline">Field<select value={niche} onChange={(e) => { const next = e.target.value as Niche; void act(async () => { await api.updateWorkspace(workspace.id, { niche: next }); return `${workspace.name} now gets ${NICHE_LABEL[next]} ideas and look.`; }); }}>{(Object.keys(NICHE_LABEL) as Niche[]).map((n) => <option key={n} value={n}>{NICHE_LABEL[n]}</option>)}</select></label>
        {workspace.look && <LookPreview look={workspace.look} />}
        <p className="oc-muted">The field sets this week's ideas, caption and cover font and colours, the picture style, and which promises the review screen warns about.</p>
      </section>}
      {tab === 'logins' && (workspace.id === 'personal' ? <p className="oc-empty">Your own account uses your owner login.</p> : <LoginsCard workspace={workspace} act={act} />)}
    </>
  );
}

function PlanCard({ workspace, act }: { workspace: AdminWorkspace; act: (work: () => Promise<string>) => Promise<void> }) {
  const [limit, setLimit] = useState(String(workspace.reelsPerMonth ?? ''));
  useEffect(() => setLimit(String(workspace.reelsPerMonth ?? '')), [workspace.reelsPerMonth]);
  const thisMonth = workspace.limitThisMonth ?? workspace.reelsPerMonth;
  const extra = thisMonth && workspace.reelsPerMonth ? thisMonth - workspace.reelsPerMonth : 0;
  return (
    <section className="oc-card">
      <div className="oc-card-head"><h2>Plan</h2><small className="oc-muted">{workspace.reelsPerMonth ? `${workspace.reelsPerMonth} reels a month` : 'No monthly limit'}</small></div>
      <div className="oc-kv"><span>Used this month</span><strong>{workspace.reelsThisMonth}{thisMonth ? ` of ${thisMonth}` : ''}</strong></div>
      {extra > 0 && <div className="oc-kv"><span>Extra this month</span><strong>+{extra}</strong></div>}
      <label className="oc-inline">Monthly reels<input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit"
        onBlur={() => { if (limit !== String(workspace.reelsPerMonth ?? '')) void act(async () => { await api.updateWorkspace(workspace.id, { reelsPerMonth: Number(limit) || 0 }); return 'Monthly reels saved.'; }); }} /></label>
      {workspace.reelsPerMonth ? <button type="button" className="oc-btn primary block" onClick={() => void act(async () => { await api.addExtraReels(workspace.id, 5); return `Added 5 reels for ${workspace.name} this month.`; })}>Add 5 reels this month</button> : null}
      <small className="oc-muted">Extra reels are for this month only. Their phone gets a notification.</small>
    </section>
  );
}

function EnginesCard({ workspace, allowed, act }: { workspace: AdminWorkspace; allowed: EngineProfile[]; act: (work: () => Promise<string>) => Promise<void> }) {
  return (
    <section className="oc-card">
      <div className="oc-card-head"><h2>Engines</h2></div>
      <div className="oc-segment" role="radiogroup" aria-label="Engines">{(['api', 'in-house'] as EngineProfile[]).map((p) => (
        <button key={p} type="button" role="radio" aria-checked={workspace.profile === p} className={workspace.profile === p ? 'on' : ''} disabled={!allowed.includes(p)}
          onClick={() => workspace.profile !== p && void act(async () => { await api.updateWorkspace(workspace.id, { profile: p }); return `${workspace.name} now uses ${p === 'api' ? 'API keys' : 'in-house engines'}.`; })}>{p === 'api' ? 'API keys' : 'In-house'}</button>
      ))}</div>
      <p className="oc-muted">{workspace.profile === 'api' ? 'Claude API + Gemini. Never uses your subscriptions.' : 'Your Claude/Codex CLI subscriptions and ChatGPT in Chrome on this computer. For your own clinic only.'}</p>
    </section>
  );
}

const TASK_LABEL: Record<string, string> = { transcribe: 'Speech to text', clean: 'Cleaning', review: 'Review redo', 'broll-plan': 'Picture plan', 'broll-images': 'Pictures', edit: 'Cutting', captions: 'Captions', compose: 'Final render', package: 'Cover & caption' };
function UsageCard({ workspace }: { workspace: AdminWorkspace }) {
  const tasks = Object.entries(workspace.costThisMonth.byTask).map(([task, v]) => ({ task, value: v.apiUsd })).filter((t) => t.value > 0).sort((a, b) => b.value - a.value);
  const total = tasks.reduce((s, t) => s + t.value, 0);
  return (
    <section className="oc-card">
      <div className="oc-card-head"><h2>Usage this month</h2><span className="oc-pill">{inr(workspace.costThisMonth.costUsd)} paid · {inr(total)} on paid APIs</span></div>
      {tasks.length ? <ul className="oc-bars">{tasks.map((t) => (
        <li key={t.task}><span>{TASK_LABEL[t.task] ?? t.task}</span><div><i style={{ width: `${(t.value / total) * 100}%` }} /></div><b>{inr(t.value)} <small>({Math.round((t.value / total) * 100)}%)</small></b></li>
      ))}</ul> : <p className="oc-empty">No reels this month yet.</p>}
      <small className="oc-muted">Shown at paid-API prices, so in-house and API accounts compare fairly.</small>
    </section>
  );
}

function LoginsCard({ workspace, act }: { workspace: AdminWorkspace; act: (work: () => Promise<string>) => Promise<void> }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  return (
    <section className="oc-card">
      <div className="oc-card-head"><h2>Logins</h2></div>
      {workspace.members.length ? <ul className="oc-logins">{workspace.members.map((m) => (
        <li key={m.username}><span>👤 <strong>{m.username}</strong> <small className="oc-muted">since {date(Date.parse(m.createdAt))}</small></span>
          {confirm === m.username
            ? <span><button type="button" className="oc-link danger" onClick={() => { setConfirm(''); void act(async () => { await api.removeMember(m.username); return `Removed ${m.username}.`; }); }}>Remove</button> <button type="button" className="oc-link" onClick={() => setConfirm('')}>Cancel</button></span>
            : <button type="button" className="oc-link" onClick={() => setConfirm(m.username)}>Remove…</button>}
        </li>
      ))}</ul> : <p className="oc-empty">No logins yet. Add one and send them the username and password.</p>}
      <form className="oc-form-row" onSubmit={(e) => { e.preventDefault(); const u = username.trim(); void act(async () => { await api.addMember(workspace.id, u, password); return `Login saved for ${u}. Send them the username and password.`; }); setUsername(''); setPassword(''); }}>
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" placeholder="drmeera" /></label>
        <label>Password (10+ characters)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
        <button type="submit" className="oc-btn" disabled={!username.trim() || password.length < 10}>Add or reset login</button>
      </form>
    </section>
  );
}

/* ---------- Reels ---------- */
const STATE_LABEL: Record<string, [string, Status['tone']]> = { completed: ['Ready', 'good'], running: ['Making', 'info'], review: ['Waiting for check', 'warn'], failed: ['Error', 'warn'], stopped: ['Stopped', 'muted'], idle: ['Not started', 'muted'] };
function ReelsPage({ data }: { data: ConsoleData }) {
  const [who, setWho] = useState('all');
  const reels = useMemo(() => data.reels.filter((r) => who === 'all' || r.workspaceId === who), [data.reels, who]);
  return (
    <>
      <header className="oc-head"><h1>Reels</h1>
        <label className="oc-inline">Customer<select value={who} onChange={(e) => setWho(e.target.value)}><option value="all">Everyone</option>{data.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      </header>
      <section className="oc-card"><ReelTable reels={reels} workspaces={data.workspaces} /></section>
    </>
  );
}
function ReelTable({ reels, workspaces, hideCustomer = false }: { reels: ConsoleReel[]; workspaces: AdminWorkspace[]; hideCustomer?: boolean }) {
  if (!reels.length) return <p className="oc-empty">No reels yet.</p>;
  return (
    <div className="oc-table-wrap"><table className="oc-table">
      <thead><tr><th>Reel</th>{!hideCustomer && <th>Customer</th>}<th>Status</th><th>Finished</th><th className="num">Length</th><th className="num">Paid APIs</th><th className="num">Actually paid</th><th /></tr></thead>
      <tbody>{reels.map((r) => {
        const [label, tone] = r.postedAt ? ['Posted', 'good' as const] : STATE_LABEL[r.state] ?? [r.state, 'muted' as const];
        return (
          <tr key={r.id}>
            <td className="oc-reel-cell oc-cell-main"><span className="oc-name" title={r.name}>{r.coverUrl ? <img className="oc-thumb" src={r.coverUrl} alt="" loading="lazy" /> : <span className="oc-thumb empty" aria-hidden="true">▶</span>}<span className="oc-reel-name"><span className="oc-ellipsis">{r.name}</span>{r.state === 'running' && r.step && <small className="oc-muted"><br />{r.step}</small>}{r.state === 'failed' && r.error && <small className="oc-error"><br />{r.error.slice(0, 90)}</small>}</span></span></td>
            {!hideCustomer && <td data-label="Customer">{workspaces.find((w) => w.id === r.workspaceId)?.name ?? r.workspaceId}</td>}
            <td data-label="Status"><span className={`oc-status ${tone}`}>{label}</span></td>
            <td data-label="Finished">{date(r.finishedAt)}</td>
            <td className="num" data-label="Length">{r.seconds ? `${Math.round(r.seconds)} s` : '—'}</td>
            <td className="num" data-label="Paid APIs">{r.cost.apiUsd ? inr(r.cost.apiUsd) : '—'}</td>
            <td className="num" data-label="Actually paid">{r.cost.apiUsd ? inr(r.cost.costUsd) : '—'}</td>
            <td className="oc-cell-action"><a className="oc-link" href={phoneLink(`reel-${r.id}`)} target="_blank" rel="noreferrer">Open ›</a></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

/* ---------- Niche packs ---------- */
function PacksPage({ data }: { data: ConsoleData }) {
  return (
    <>
      <header className="oc-head"><h1>Niche packs</h1></header>
      <p className="oc-muted">Each field has its own font, colours, picture style and wording rules. A customer's field (on their page) picks the pack.</p>
      <div className="oc-grid two">{data.packs.map((pack) => {
        const users = data.workspaces.filter((w) => (w.niche ?? 'dental') === pack.id);
        return (
          <section key={pack.id} className="oc-card">
            <div className="oc-card-head"><h2>{NICHE_ICON[pack.id]} {pack.label}</h2><small className="oc-muted">{users.length ? users.map((w) => w.name).join(', ') : 'No customers yet'}</small></div>
            <LookPreview look={pack} />
            <details><summary>Picture style and hashtags</summary><p className="oc-small">{pack.artDirection}</p><p className="oc-small">{pack.hashtags.join(' ')}</p></details>
          </section>
        );
      })}</div>
    </>
  );
}

/* ---------- AI engines ---------- */
function EnginesPage({ data, status, onStatus, act }: { data: ConsoleData; status: SystemStatus | null; onStatus: (s: SystemStatus) => void; act: (work: () => Promise<string>) => Promise<void> }) {
  const [anthropicKey, setAnthropicKey] = useState(''); const [geminiKey, setGeminiKey] = useState('');
  const [checks, setChecks] = useState<{ anthropic: KeyCheck; gemini: KeyCheck } | null>(null); const [checking, setChecking] = useState(false);
  if (!status) return <><header className="oc-head"><h1>AI engines</h1></header><p className="oc-muted">Loading…</p></>;
  const api_ = status.apiEngines; const t = status.textModels;
  const engine = (choice: { provider: string; model: string; effort?: string }) => `${PROVIDER_LABEL[choice.provider] ?? choice.provider}${choice.model ? ` · ${choice.model}` : ''}${choice.effort ? ` · ${choice.effort}` : ''}`;
  const cliOk = (provider: string) => provider === 'claude-cli' ? status.claude.authenticated : provider === 'codex-cli' ? status.codex.authenticated : provider === 'agy-cli' ? status.agy.installed : true;
  const save = (body: Record<string, string>, done: string) => act(async () => { onStatus(await api.saveSettings(body)); return done; });
  return (
    <>
      <header className="oc-head"><h1>AI engines</h1></header>
      <div className="oc-grid two">
        <section className="oc-card">
          <div className="oc-card-head"><h2>💻 In-house <small className="oc-muted">your own clinic</small></h2></div>
          <dl className="oc-engines">
            <dt>Cleaning</dt><dd><EngineRow choice={t.clean} keys={{ provider: 'cleanProvider', model: 'cleanModel', effort: 'cleanEffort' }} save={save} ok={cliOk(t.clean.provider)} /></dd>
            <dt>Planning</dt><dd><EngineRow choice={t.planning} keys={{ provider: 'planningProvider', model: 'planningModel', effort: 'planningEffort' }} save={save} ok={cliOk(t.planning.provider)} /></dd>
            <dt>Stick script</dt><dd><EngineRow choice={t.script ?? { provider: 'claude-cli', model: 'claude-sonnet-5-5', effort: 'high' }} keys={{ provider: 'scriptProvider', model: 'scriptModel', effort: 'scriptEffort' }} save={save} ok={cliOk(t.script?.provider ?? 'claude-cli')} /></dd>
            <dt>Pictures</dt><dd><EngineRow choice={{ provider: t.pictures?.provider === 'codex' ? 'codex-cli' : 'claude-cli', model: t.pictures?.model ?? '', effort: t.pictures?.effort }} providers={['claude-cli', 'codex-cli']} keys={{ provider: 'picturesProvider', model: 'picturesModel', effort: 'picturesEffort' }} save={(body, done) => save(body.picturesProvider ? { ...body, picturesProvider: body.picturesProvider === 'codex-cli' ? 'codex' : 'claude' } : body, done)} ok={cliOk(t.pictures?.provider === 'codex' ? 'codex-cli' : 'claude-cli')} />
              <small className="oc-muted">Drives ChatGPT in Chrome. Gemini pictures are picked per reel in the phone app.</small></dd>
            <dt>Speech to text</dt><dd>{status.transcription ? `${status.transcription.provider === 'gemini' ? 'Gemini' : 'ElevenLabs'} · ${status.transcription.model}` : '—'}</dd>
            <dt>Stick voice</dt><dd>Gemini TTS · voice and model in the stick app's Settings</dd>
          </dl>
          <small className="oc-muted">Effort = how long the model thinks. Higher is slower and better. API providers use the keys on the right (OpenAI key in the <a href="/?advanced=1">advanced settings</a>).</small>
        </section>
        <section className="oc-card">
          <div className="oc-card-head"><h2>☁️ API <small className="oc-muted">customers</small></h2></div>
          <dl className="oc-engines">
            <dt>Text</dt><dd><ModelSelect provider="anthropic" allowDefault={false} value={api_?.anthropic.model ?? 'claude-opus-5-5'} onChange={(model) => void save({ apiTextModel: model }, 'Text model saved.')} />
              <select value={api_?.anthropic.effort || 'medium'} onChange={(e) => void save({ apiEffort: e.target.value }, 'Effort saved.')} aria-label="Effort">{EFFORT_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}</select></dd>
            <dt>Pictures</dt><dd>Gemini <ModelSelect provider="gemini" kind="image" allowDefault={false} value={api_?.gemini.imageModel ?? ''} onChange={(model) => void save({ geminiImageModel: model }, 'Picture model saved.')} /></dd>
            <dt>Speech to text</dt><dd>Gemini <ModelSelect provider="gemini" kind="stt" allowDefault={false} value={status.transcription?.model ?? ''} onChange={(model) => void save({ geminiSttModel: model }, 'Speech-to-text model saved.')} /></dd>
            <dt>Claude API key</dt><dd><KeyField configured={Boolean(api_?.anthropic.configured)} value={anthropicKey} onChange={setAnthropicKey} onSave={() => { void save({ anthropicApiKey: anthropicKey }, 'Claude API key saved.'); setAnthropicKey(''); }} check={checks?.anthropic} /></dd>
            <dt>Gemini key</dt><dd><KeyField configured={Boolean(api_?.gemini.configured)} value={geminiKey} onChange={setGeminiKey} onSave={() => { void save({ geminiApiKey: geminiKey }, 'Gemini key saved.'); setGeminiKey(''); }} check={checks?.gemini} /></dd>
          </dl>
          <button type="button" className="oc-btn block" disabled={checking} onClick={() => { setChecking(true); void api.testEngines().then(setChecks).catch((e) => setChecks({ anthropic: { ok: false, detail: String(e) }, gemini: { ok: false, detail: String(e) } })).finally(() => setChecking(false)); }}>{checking ? 'Checking…' : 'Check both keys (free)'}</button>
        </section>
      </div>
      <section className="oc-card"><div className="oc-card-head"><h2>Cost per reel</h2><small className="oc-muted">Last 30 days · on paid APIs</small></div><CostChart reels={data.reels} now={data.now} /></section>
    </>
  );
}
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ENGINE_PROVIDERS = ['claude-cli', 'codex-cli', 'agy-cli', 'anthropic', 'openai', 'gemini'];
const PROVIDER_TITLE: Record<string, string> = { 'claude-cli': 'Claude CLI', 'codex-cli': 'Codex CLI', 'agy-cli': 'Antigravity CLI', anthropic: 'Claude API', openai: 'OpenAI API', gemini: 'Gemini API' };
/** Provider + model + effort for one pipeline step; saves each change straight away. */
function EngineRow({ choice, keys, save, ok, providers = ENGINE_PROVIDERS }: { choice: { provider: string; model: string; effort?: string }; keys: { provider: string; model: string; effort: string }; save: (body: Record<string, string>, done: string) => Promise<void> | void; ok: boolean; providers?: string[] }) {
  const noEffort = choice.provider === 'agy-cli';
  return (
    <span className="oc-engine-row">
      <select aria-label="Provider" value={choice.provider} onChange={(e) => void save({ [keys.provider]: e.target.value, [keys.model]: '' }, 'Engine saved.')}>
        {providers.map((p) => <option key={p} value={p}>{PROVIDER_TITLE[p] ?? p}</option>)}
      </select>
      <ModelSelect provider={choice.provider} value={choice.model} onChange={(model) => void save({ [keys.model]: model }, 'Model saved.')} />
      <select aria-label="Effort" value={noEffort ? '' : choice.effort || 'medium'} disabled={noEffort} title={noEffort ? 'Antigravity has no effort setting' : 'How long the model thinks'} onChange={(e) => void save({ [keys.effort]: e.target.value }, 'Effort saved.')}>
        {noEffort ? <option value="">no effort</option> : EFFORT_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
      </select>
      {['claude-cli', 'codex-cli', 'agy-cli'].includes(choice.provider) && <Signed ok={ok} />}
    </span>
  );
}
function Signed({ ok }: { ok: boolean }) { return <span className={`oc-status ${ok ? 'good' : 'warn'}`}>{ok ? '✓ Signed in' : '! Not signed in'}</span>; }
function KeyField({ configured, value, onChange, onSave, check }: { configured: boolean; value: string; onChange: (v: string) => void; onSave: () => void; check?: KeyCheck }) {
  return (
    <div className="oc-key">
      <span className={`oc-status ${check ? (check.ok ? 'good' : 'warn') : configured ? 'good' : 'warn'}`} title={check?.detail}>{check ? (check.ok ? '✓ Works' : `! ${check.detail}`) : configured ? '✓ Saved' : '! Missing'}</span>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={configured ? 'Replace key…' : 'Paste key'} autoComplete="off" aria-label="New key" />
      <button type="button" className="oc-btn small" disabled={!value.trim()} onClick={onSave}>Save</button>
    </div>
  );
}
