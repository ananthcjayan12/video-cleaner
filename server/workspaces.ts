import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, type AuthFile } from './auth.js';
import { ENGINE_PROFILES, type EngineProfile } from './usage.js';
import { nicheValue, type Niche } from './ideas.js';

/**
 * Workspaces: one per account (you, your clinic, each customer). Each has an engine profile:
 * - "in-house": Claude/Codex CLI and ChatGPT in Chrome on this computer's subscriptions (you and your clinic);
 * - "api": paid API keys (Claude API, Gemini) for customers.
 * Members are customer logins tied to one workspace. The owner login (auth.json) is the admin and sees everything.
 * Stored in ~/.video-cleaner/workspaces.json (mode 600).
 */
/** extraReels: reels added on top of the plan for one month only (e.g. "5 more" bought mid-month). */
export type Workspace = { id: string; name: string; profile: EngineProfile; niche?: Niche; reelsPerMonth?: number; extraReels?: { month: string; reels: number }; createdAt: string };
export const monthKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
/** This month's reel limit: the plan plus any extra reels added for this month. undefined = no limit. */
export function limitThisMonth(workspace: Workspace, now = new Date()) {
  if (!workspace.reelsPerMonth) return undefined;
  return workspace.reelsPerMonth + (workspace.extraReels?.month === monthKey(now) ? workspace.extraReels.reels : 0);
}
/** Add reels for this month only (they do not carry over). */
export function addExtraReels(data: WorkspaceFile, id: string, reels: unknown, now = new Date()) {
  const workspace = data.workspaces.find((w) => w.id === id); if (!workspace) throw new Error('Account not found.');
  const n = Math.floor(Number(reels)); if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error('Add between 1 and 100 reels.');
  const month = monthKey(now); const already = workspace.extraReels?.month === month ? workspace.extraReels.reels : 0;
  workspace.extraReels = { month, reels: already + n }; return workspace;
}
export type Member = { username: string; salt: string; hash: string; sessionSecret: string; workspaceId: string; createdAt: string };
export type WorkspaceFile = { workspaces: Workspace[]; members: Member[] };
export type SessionUser = { username: string; role: 'admin' | 'member'; workspaceId?: string };

export const PERSONAL_WORKSPACE: Workspace = { id: 'personal', name: 'Personal', profile: 'in-house', niche: 'dental', createdAt: '2026-11-25T00:00:00.000Z' };
export const workspacesPath = () => process.env.VIDEO_CLEANER_WORKSPACES_FILE || path.join(os.homedir(), '.video-cleaner', 'workspaces.json');

export async function loadWorkspaces(file = workspacesPath()): Promise<WorkspaceFile> {
  const raw = await fs.readFile(file, 'utf8').then((text) => JSON.parse(text) as Partial<WorkspaceFile>).catch(() => ({} as Partial<WorkspaceFile>));
  const workspaces: Workspace[] = (Array.isArray(raw.workspaces) ? raw.workspaces : []).filter((w) => w?.id && w.name).map((w) => ({ ...w, profile: profileValue(w.profile), niche: nicheValue(w.niche) }));
  if (!workspaces.some((w) => w.id === PERSONAL_WORKSPACE.id)) workspaces.unshift({ ...PERSONAL_WORKSPACE });
  const members = (Array.isArray(raw.members) ? raw.members : []).filter((m) => m?.username && m.hash && m.salt && m.sessionSecret && m.workspaceId);
  return { workspaces, members };
}
export async function saveWorkspaces(data: WorkspaceFile, file = workspacesPath()) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}

export const profileValue = (value: unknown): EngineProfile => ENGINE_PROFILES.includes(value as EngineProfile) ? value as EngineProfile : 'api';

/** Profiles this server may run. A cloud deployment sets ALLOWED_ENGINES=api so subscription engines can never run there. */
export function allowedProfiles(env = process.env.ALLOWED_ENGINES): EngineProfile[] {
  const listed = String(env ?? '').split(',').map((value) => value.trim()).filter((value): value is EngineProfile => ENGINE_PROFILES.includes(value as EngineProfile));
  return listed.length ? listed : [...ENGINE_PROFILES];
}
/** The profile a workspace actually runs with on this server. A workspace never falls back from "api" to "in-house". */
export function effectiveProfile(workspace: Pick<Workspace, 'profile'>, allowed = allowedProfiles()): EngineProfile {
  if (allowed.includes(workspace.profile)) return workspace.profile;
  if (allowed.includes('api')) return 'api';
  throw new Error('This server is not allowed to run any AI engine for this account.');
}

export function slug(name: string) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || `ws-${randomUUID().slice(0, 8)}`;
}

export function createWorkspace(data: WorkspaceFile, input: { name: string; profile?: unknown; niche?: unknown; reelsPerMonth?: unknown }): Workspace {
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Give the account a name.');
  let id = slug(name); for (let n = 2; data.workspaces.some((w) => w.id === id); n += 1) id = `${slug(name)}-${n}`;
  const workspace: Workspace = { id, name, profile: input.profile === undefined ? 'api' : profileValue(input.profile), niche: nicheValue(input.niche), reelsPerMonth: reelLimit(input.reelsPerMonth), createdAt: new Date().toISOString() };
  data.workspaces.push(workspace);
  return workspace;
}
export function updateWorkspace(data: WorkspaceFile, id: string, patch: { name?: unknown; profile?: unknown; niche?: unknown; reelsPerMonth?: unknown }) {
  const workspace = data.workspaces.find((w) => w.id === id); if (!workspace) throw new Error('Account not found.');
  if (typeof patch.name === 'string' && patch.name.trim()) workspace.name = patch.name.trim().slice(0, 80);
  if (patch.profile !== undefined) workspace.profile = profileValue(patch.profile);
  if (patch.niche !== undefined) workspace.niche = nicheValue(patch.niche);
  if (patch.reelsPerMonth !== undefined) workspace.reelsPerMonth = reelLimit(patch.reelsPerMonth);
  return workspace;
}
/** Empty / 0 / invalid means no monthly limit. */
function reelLimit(value: unknown) { const n = Math.floor(Number(value)); return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : undefined; }

export function normalizeUsername(value: unknown) { return String(value ?? '').trim().toLowerCase(); }
export async function addMember(data: WorkspaceFile, input: { username: unknown; password: unknown; workspaceId: string }, ownerUsername?: string) {
  const username = normalizeUsername(input.username); const password = String(input.password ?? '');
  if (!/^[a-z0-9._@-]{3,60}$/.test(username)) throw new Error('Use 3–60 letters, numbers, dots, dashes or @ for the username.');
  if (password.length < 10) throw new Error('The password needs at least 10 characters.');
  if (!data.workspaces.some((w) => w.id === input.workspaceId)) throw new Error('Account not found.');
  if (ownerUsername && normalizeUsername(ownerUsername) === username) throw new Error('That username is the owner login.');
  const { salt, hash } = await hashPassword(password);
  const existing = data.members.find((m) => m.username === username);
  // A new secret logs out the member's other devices when the password changes.
  const member: Member = { username, salt, hash, sessionSecret: randomBytes(32).toString('base64url'), workspaceId: input.workspaceId, createdAt: existing?.createdAt ?? new Date().toISOString() };
  if (existing && existing.workspaceId !== input.workspaceId) throw new Error('That username belongs to another account.');
  data.members = [...data.members.filter((m) => m.username !== username), member];
  return member;
}
export function removeMember(data: WorkspaceFile, username: string) {
  const before = data.members.length; data.members = data.members.filter((m) => m.username !== normalizeUsername(username));
  if (data.members.length === before) throw new Error('Login not found.');
}
/** A member as the shape auth.ts signs and checks sessions with. */
export const memberAuth = (member: Member): AuthFile => ({ username: member.username, salt: member.salt, hash: member.hash, sessionSecret: member.sessionSecret, updatedAt: member.createdAt });

/** The username inside a session cookie (not trusted until the signature is checked). */
export function sessionUsername(token: string | undefined) {
  const part = token?.split('.')[0]; if (!part) return '';
  try { return Buffer.from(part, 'base64url').toString(); } catch { return ''; }
}

/**
 * What a customer login may call: their reels (list, create, auto-reel steps, downloads, rename, delete), uploads,
 * and who-am-I. Everything else (settings, the advanced editor, other accounts) is for the owner only.
 */
export function memberRoute(method: string, url: string): { allowed: boolean; projectId?: string } {
  const pathname = url.split('?')[0];
  if (pathname === '/api/me' || pathname === '/api/logout' || (pathname === '/api/ideas' && method === 'GET')) return { allowed: true };
  if (pathname === '/api/push/key' && method === 'GET') return { allowed: true };
  if ((pathname === '/api/push/subscribe' || pathname === '/api/push/unsubscribe') && method === 'POST') return { allowed: true };
  if (pathname === '/api/uploads' && method === 'POST') return { allowed: true };
  if (/^\/api\/uploads\/[^/]+$/.test(pathname) && (method === 'GET' || method === 'PUT')) return { allowed: true };
  if (pathname === '/api/projects' && method === 'GET') return { allowed: true };
  if (pathname === '/api/projects/select' && method === 'POST') return { allowed: true };
  const match = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
  if (!match) return { allowed: false };
  const projectId = decodeURIComponent(match[1]); const rest = match[2] ?? '';
  const ok = (rest === '' && method === 'DELETE') || (rest === '/meta' && method === 'PUT') || (rest === '/posted' && method === 'POST')
    || (rest === '/auto' && (method === 'GET' || method === 'POST'))
    || (/^\/auto\/(review|stop|package)$/.test(rest) && (method === 'POST' || (rest === '/auto/package' && method === 'PUT')))
    || (/^\/auto\/frames\/\d+$/.test(rest) && method === 'GET')
    || (/^\/exports\/[^/]+$/.test(rest) && method === 'GET');
  return ok ? { allowed: true, projectId } : { allowed: false };
}

/** Reels finished this calendar month by a workspace (a credit is used only when a reel finishes). */
export function reelsThisMonth(finishedAt: Array<number | undefined>, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return finishedAt.filter((time) => typeof time === 'number' && time >= start).length;
}
