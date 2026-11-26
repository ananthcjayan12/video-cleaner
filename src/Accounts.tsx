import { useEffect, useState } from 'react';
import { api, type AdminWorkspace, type EngineProfile, type Niche, type UsageSummary } from './api';

const NICHE_LABEL: Record<Niche, string> = { dental: 'Dental', physio: 'Physiotherapy', nutrition: 'Nutrition', optometry: 'Optometry' };

const PROFILE_LABEL: Record<EngineProfile, string> = { 'in-house': 'In-house (my subscriptions)', api: 'API keys (customers)' };
export const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const inr = (value: number) => `₹${Math.round(value * 88)}`; // rough conversion for reading on the phone

/** What a reel (or a month) cost now, and what it would cost on paid APIs and a cloud renderer. */
export function CostLine({ cost }: { cost?: UsageSummary }) {
  if (!cost) return null;
  return (
    <small className="costLine">
      Cost now {usd(cost.costUsd)} · as a paid service {usd(cost.apiUsd)} (~{inr(cost.apiUsd)}){cost.estimated ? ' · some tokens estimated' : ''}
    </small>
  );
}

/** Owner only: customer accounts, their engines, monthly reel limit, logins and this month's use. */
export function AccountsPanel({ onClose }: { onClose: () => void }) {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [allowed, setAllowed] = useState<EngineProfile[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('10');
  const [niche, setNiche] = useState<Niche>('dental');
  async function load() { try { const result = await api.adminWorkspaces(); setWorkspaces(result.workspaces); setAllowed(result.allowedProfiles); } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); } }
  useEffect(() => { void load(); }, []);
  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage('');
    try { await work(); await load(); setMessage(done); } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }
  return (
    <section className="panel accounts">
      <div className="sectionTitle"><div><span className="label">ACCOUNTS</span><h3>Customers and engines</h3></div><button type="button" className="ghost" onClick={onClose}>Close</button></div>
      <p className="muted">In-house accounts use Claude/Codex CLI and ChatGPT in Chrome on this computer. API accounts always use the Claude API and Gemini, whatever is set in Settings.{allowed.length === 1 ? ` This server only runs: ${PROFILE_LABEL[allowed[0]]}.` : ''}</p>
      <form className="accountNew" onSubmit={(event) => { event.preventDefault(); void act(() => api.createWorkspace({ name, profile: 'api', niche, reelsPerMonth: Number(limit) || undefined }), `Added ${name}.`).then(() => setName('')); }}>
        <label>New customer account<input id="account-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smile Dental, Kochi" required /></label>
        <label>Field<select id="account-niche" value={niche} onChange={(e) => setNiche(e.target.value as Niche)}>{(Object.keys(NICHE_LABEL) as Niche[]).map((n) => <option key={n} value={n}>{NICHE_LABEL[n]}</option>)}</select></label>
        <label>Reels a month<input id="account-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" /></label>
        <button type="submit" className="primary" disabled={busy || !name.trim()}>Add account</button>
      </form>
      {workspaces.map((workspace) => <AccountCard key={workspace.id} workspace={workspace} busy={busy} act={act} />)}
      {message && <p className="pkgMessage">{message}</p>}
    </section>
  );
}

function AccountCard({ workspace, busy, act }: { workspace: AdminWorkspace; busy: boolean; act: (work: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [limit, setLimit] = useState(String(workspace.reelsPerMonth ?? ''));
  const personal = workspace.id === 'personal';
  return (
    <article className="accountCard">
      <header>
        <strong>{workspace.name}</strong>
        <span className={`accountProfile ${workspace.effectiveProfile ?? ''}`}>{workspace.effectiveProfile ? PROFILE_LABEL[workspace.effectiveProfile] : 'Not allowed on this server'}</span>
      </header>
      <small>{workspace.reelsThisMonth}{workspace.reelsPerMonth ? ` of ${workspace.reelsPerMonth}` : ''} reels this month</small>
      <CostLine cost={workspace.costThisMonth} />
      <div className="accountRow">
        <label>Engines<select id={`profile-${workspace.id}`} value={workspace.profile} disabled={busy} onChange={(e) => void act(() => api.updateWorkspace(workspace.id, { profile: e.target.value as EngineProfile }), `${workspace.name} now uses ${PROFILE_LABEL[e.target.value as EngineProfile]}.`)}>
          <option value="in-house">{PROFILE_LABEL['in-house']}</option><option value="api">{PROFILE_LABEL.api}</option>
        </select></label>
        <label>Field<select id={`niche-${workspace.id}`} value={workspace.niche ?? 'dental'} disabled={busy} onChange={(e) => void act(() => api.updateWorkspace(workspace.id, { niche: e.target.value as Niche }), `${workspace.name} now gets ${NICHE_LABEL[e.target.value as Niche]} ideas.`)}>
          {(Object.keys(NICHE_LABEL) as Niche[]).map((n) => <option key={n} value={n}>{NICHE_LABEL[n]}</option>)}
        </select></label>
        <label>Reels a month<input id={`limit-${workspace.id}`} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} onBlur={() => { if (limit !== String(workspace.reelsPerMonth ?? '')) void act(() => api.updateWorkspace(workspace.id, { reelsPerMonth: Number(limit) || 0 }), 'Limit saved.'); }} placeholder="No limit" /></label>
      </div>
      {!personal && (
        <>
          <ul className="accountMembers">{workspace.members.map((member) => (
            <li key={member.username}><span>{member.username}</span><button type="button" className="ghost" disabled={busy} onClick={() => void act(() => api.removeMember(member.username), `Removed ${member.username}.`)}>Remove login</button></li>
          ))}</ul>
          <form className="accountRow" onSubmit={(event) => { event.preventDefault(); void act(() => api.addMember(workspace.id, username, password), `Login saved for ${username}. Send them the username and password.`).then(() => { setUsername(''); setPassword(''); }); }}>
            <label>Login username<input id={`user-${workspace.id}`} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" placeholder="drmeera" /></label>
            <label>Password (10+ characters)<input id={`pass-${workspace.id}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
            <button type="submit" disabled={busy || !username || password.length < 10}>Add or reset login</button>
          </form>
        </>
      )}
    </article>
  );
}
