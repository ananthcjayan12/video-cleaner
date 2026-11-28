/**
 * Render computers ("nodes"): the hub (this app, with the one shared database and the public URL) hands the heavy
 * render steps to other computers that run the same repo in node mode (server/node-agent.ts).
 *
 * - Registry: ~/.video-cleaner/nodes.json (mode 600). Each node has a name and a token (only its SHA-256 is kept).
 * - A node polls the hub every few seconds (it can sit behind any NAT); the poll is its heartbeat and how it gets work.
 * - A task names a project and the files it needs. The node mirrors those files (virtual paths such as
 *   "data/projects/<id>/auto/edit.json"), runs the step with the same code the hub would run, uploads what changed and
 *   reports the result. Absolute paths inside text files are rewritten between the two computers' folders.
 * - RenderPool: one render at a time per computer (the hub counts as one); a reel can ask for "auto", "hub" or a node id.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';

export type NodeInfo = { platform: string; arch: string; cpus: number; cpuModel: string; memoryGb: number; hostname: string; encoder: string; version: string; busy?: boolean };
export type NodeRecord = { id: string; name: string; tokenHash: string; createdAt: string; enabled: boolean };
type Registry = { nodes: NodeRecord[]; defaultRenderOn: string; hubRenders: boolean };
export type Roots = { data: string; config: string; repo: string; home: string };
export type TaskSpec = { kind: string; projectId: string; payload: unknown; include: string[]; writable: string[] };
type Task = TaskSpec & {
  id: string; nodeId: string; createdAt: number; state: 'queued' | 'sent' | 'done' | 'failed';
  cancel?: boolean; detail?: string; progress?: number;
  resolve: (value: { result: unknown }) => void; reject: (error: Error) => void; onUpdate?: (detail?: string, progress?: number) => void;
};
export type ManifestEntry = { path: string; size: number; mtime: number };

export const ONLINE_MS = 20_000;
const LOST_MS = 120_000;
/** Never mirrored: finished exports (served by the hub), resumable export checkpoints, picture-tool scratch, partial files. */
export const SKIP = /(^|\/)(exports|render-checkpoints|codex-work|\.git|node_modules)(\/|$)|\.(part|node-upload)(\.|$)|\.part\.mp4$/;
/** Sent back from a node: the same, except finished exports (the reel itself) do come back. */
export const SKIP_UP = /(^|\/)(render-checkpoints|codex-work|\.git|node_modules)(\/|$)|\.(part|node-upload)(\.|$)|\.part\.mp4$/;
/** Hub-owned files a node never sends back (the hub keeps its own copy of the reel's state). */
const NO_UPLOAD = /^data\/projects\/[^/]+\/(project\.json|auto\/job\.json)$/;
const TEXT = /\.(json|jsonl|txt|ndjson)$/i;

let registryFile = path.join(os.homedir(), '.video-cleaner', 'nodes.json');
let hubRoots: () => Roots = () => ({ data: path.join(os.homedir(), 'VideoCleaner'), config: path.join(os.homedir(), '.video-cleaner'), repo: process.cwd(), home: os.homedir() });
export function configureHub(options: { registryFile?: string; roots: () => Roots }) { if (options.registryFile) registryFile = options.registryFile; hubRoots = options.roots; }

const live = new Map<string, { lastSeen: number; info?: NodeInfo }>();
const tasks = new Map<string, Task>();

// ---- Registry
export async function loadRegistry(): Promise<Registry> {
  const raw = await fs.readFile(registryFile, 'utf8').then((text) => JSON.parse(text) as Partial<Registry>).catch(() => ({} as Partial<Registry>));
  return { nodes: Array.isArray(raw.nodes) ? raw.nodes : [], defaultRenderOn: typeof raw.defaultRenderOn === 'string' ? raw.defaultRenderOn : 'auto', hubRenders: raw.hubRenders !== false };
}
async function saveRegistry(registry: Registry) {
  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  const temp = `${registryFile}.${process.pid}.tmp`; await fs.writeFile(temp, JSON.stringify(registry, null, 2), { mode: 0o600 }); await fs.rename(temp, registryFile);
}
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function addNode(name: string) {
  const clean = name.trim().slice(0, 40); if (!clean) throw Object.assign(new Error('Give the computer a name.'), { status: 400 });
  const registry = await loadRegistry();
  if (registry.nodes.some((node) => node.name.toLowerCase() === clean.toLowerCase())) throw Object.assign(new Error('A computer with that name is already added.'), { status: 409 });
  const token = `prn_${randomBytes(24).toString('base64url')}`;
  const node: NodeRecord = { id: `node-${randomBytes(4).toString('hex')}`, name: clean, tokenHash: hashToken(token), createdAt: new Date().toISOString(), enabled: true };
  registry.nodes.push(node); await saveRegistry(registry); return { node, token };
}
export async function updateRegistry(change: { nodeId?: string; enabled?: boolean; name?: string; defaultRenderOn?: string; hubRenders?: boolean; remove?: boolean }) {
  const registry = await loadRegistry();
  if (change.nodeId) {
    const node = registry.nodes.find((candidate) => candidate.id === change.nodeId); if (!node) throw Object.assign(new Error('No such computer.'), { status: 404 });
    if (change.remove) { registry.nodes = registry.nodes.filter((candidate) => candidate !== node); live.delete(node.id); if (registry.defaultRenderOn === node.id) registry.defaultRenderOn = 'auto'; }
    if (typeof change.enabled === 'boolean') node.enabled = change.enabled;
    if (typeof change.name === 'string' && change.name.trim()) node.name = change.name.trim().slice(0, 40);
  }
  if (typeof change.defaultRenderOn === 'string') {
    if (change.defaultRenderOn !== 'auto' && change.defaultRenderOn !== 'hub' && !registry.nodes.some((node) => node.id === change.defaultRenderOn)) throw Object.assign(new Error('No such computer.'), { status: 400 });
    registry.defaultRenderOn = change.defaultRenderOn;
  }
  if (typeof change.hubRenders === 'boolean') registry.hubRenders = change.hubRenders;
  await saveRegistry(registry); pool.pump(); return registry;
}
/** The node a request comes from (Authorization: Bearer <token>), or null. */
export async function nodeFromRequest(req: Request) {
  const header = req.header('authorization') ?? ''; const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token.startsWith('prn_')) return null;
  const hash = hashToken(token); return (await loadRegistry()).nodes.find((node) => node.tokenHash === hash && node.enabled) ?? null;
}
const isOnline = (nodeId: string) => Date.now() - (live.get(nodeId)?.lastSeen ?? 0) < ONLINE_MS;

/** Everything the Computers page shows. */
export async function computersView(hubInfo: NodeInfo) {
  const registry = await loadRegistry();
  const running = (slot: string) => [...tasks.values()].filter((task) => task.nodeId === slot && (task.state === 'queued' || task.state === 'sent')).map((task) => ({ kind: task.kind, projectId: task.projectId, detail: task.detail, progress: task.progress }));
  return {
    defaultRenderOn: registry.defaultRenderOn, waiting: pool.waitingCount(),
    computers: [
      { id: 'hub', name: 'This laptop (hub)', hub: true, enabled: registry.hubRenders, online: true, busy: pool.isBusy('hub'), info: hubInfo, lastSeen: Date.now(), tasks: pool.hubWork() },
      ...registry.nodes.map((node) => ({ id: node.id, name: node.name, hub: false, enabled: node.enabled, online: isOnline(node.id), busy: pool.isBusy(node.id), info: live.get(node.id)?.info ?? null, lastSeen: live.get(node.id)?.lastSeen ?? null, createdAt: node.createdAt, tasks: running(node.id) })),
    ],
  };
}
export async function renderChoices() {
  const registry = await loadRegistry();
  return { defaultRenderOn: registry.defaultRenderOn, options: [{ id: 'auto', name: 'Any free computer' }, { id: 'hub', name: 'This laptop (hub)' }, ...registry.nodes.filter((node) => node.enabled).map((node) => ({ id: node.id, name: node.name, online: isOnline(node.id) }))] };
}
export async function nodeName(id: string) { return id === 'hub' ? 'this laptop' : (await loadRegistry()).nodes.find((node) => node.id === id)?.name ?? id; }

// ---- Render pool: one render per computer at a time, in order of arrival.
type Waiter = { want: string; prefer?: string; label?: string; onPosition: (ahead: number, want: string) => void; grant: (slot: string) => void };
class RenderPool {
  private busy = new Map<string, string | undefined>(); private waiting: Waiter[] = []; private registry: Registry = { nodes: [], defaultRenderOn: 'auto', hubRenders: true };
  isBusy(slot: string) { return this.busy.has(slot); }
  waitingCount() { return this.waiting.length; }
  hubWork() { const label = this.busy.get('hub'); return this.busy.has('hub') ? [{ kind: 'render', detail: label }] : []; }
  /** want: 'auto' | 'hub' | node id ('default' = the owner's choice on the Computers page). prefer: a computer that already has the files. */
  async acquire(want: string, options: { prefer?: string; label?: string; onPosition?: (ahead: number, want: string) => void; stopped?: () => boolean } = {}) {
    this.registry = await loadRegistry();
    const resolved = want === 'default' || !want ? this.registry.defaultRenderOn : want;
    const slot = await new Promise<string>((resolve, reject) => {
      const waiter: Waiter = { want: resolved, prefer: options.prefer, label: options.label, onPosition: options.onPosition ?? (() => undefined), grant: resolve };
      this.waiting.push(waiter); this.pump();
      if (this.waiting.includes(waiter) && options.stopped) {
        const timer = setInterval(() => {
          if (!this.waiting.includes(waiter)) return void clearInterval(timer);
          if (options.stopped!()) { clearInterval(timer); this.waiting = this.waiting.filter((w) => w !== waiter); this.update(); reject(new Error('Stopped')); }
        }, 1000);
        waiter.grant = (granted) => { clearInterval(timer); resolve(granted); };
      }
    });
    this.busy.set(slot, options.label);
    let released = false;
    return { slot, release: () => { if (released) return; released = true; this.busy.delete(slot); this.pump(); } };
  }
  private free(slot: string) {
    if (this.busy.has(slot)) return false;
    if (slot === 'hub') return this.registry.hubRenders;
    const node = this.registry.nodes.find((candidate) => candidate.id === slot); return Boolean(node?.enabled) && isOnline(slot);
  }
  private pick(waiter: Waiter) {
    if (waiter.want === 'hub') return this.busy.has('hub') ? undefined : 'hub'; // asked for by name: allowed even when the hub is off for "auto"
    if (waiter.want !== 'auto') {
      const exists = this.registry.nodes.some((node) => node.id === waiter.want && node.enabled);
      if (!exists) return this.free('hub') ? 'hub' : undefined; // removed / switched off: fall back to the hub
      return this.free(waiter.want) ? waiter.want : undefined;
    }
    const order = [waiter.prefer, 'hub', ...this.registry.nodes.map((node) => node.id)].filter((slot): slot is string => Boolean(slot));
    return order.find((slot) => this.free(slot));
  }
  pump() {
    void loadRegistry().then((registry) => {
      this.registry = registry;
      for (const waiter of [...this.waiting]) {
        const slot = this.pick(waiter); if (!slot) continue;
        this.waiting = this.waiting.filter((w) => w !== waiter); this.busy.set(slot, waiter.label); waiter.grant(slot);
      }
      this.update();
    });
  }
  private update() { this.waiting.forEach((waiter, index) => waiter.onPosition(index + 1, waiter.want)); }
}
export const pool = new RenderPool();

// ---- Tasks (hub side)
export class NodeLostError extends Error {}
/** Run one step on a node; resolves after the node has uploaded its files. */
export function runOnNode(nodeId: string, spec: TaskSpec, hooks: { onUpdate?: (detail?: string, progress?: number) => void; signal?: AbortSignal } = {}) {
  return new Promise<{ result: unknown }>((resolve, reject) => {
    const task: Task = { ...spec, id: randomUUID(), nodeId, createdAt: Date.now(), state: 'queued', resolve, reject, onUpdate: hooks.onUpdate };
    tasks.set(task.id, task);
    const finish = () => { clearInterval(watch); setTimeout(() => tasks.delete(task.id), 60_000); };
    const watch = setInterval(() => {
      if (task.state === 'done' || task.state === 'failed') return finish();
      if (hooks.signal?.aborted) task.cancel = true;
      const seen = live.get(nodeId)?.lastSeen ?? 0;
      if (Date.now() - Math.max(seen, task.createdAt) > LOST_MS) { task.state = 'failed'; finish(); reject(new NodeLostError(`The render computer stopped answering (${task.kind}).`)); }
    }, 2000);
    task.resolve = (value) => { finish(); resolve(value); }; task.reject = (error) => { finish(); reject(error); };
  });
}
function taskFor(req: Request, nodeId: string) {
  const task = tasks.get(String(req.params.taskId)); if (!task || task.nodeId !== nodeId) throw Object.assign(new Error('No such task.'), { status: 404 });
  return task;
}

// ---- Virtual paths
const ROOT_KEYS = ['data', 'config', 'repo', 'home'] as const;
export function toReal(roots: Roots, virtual: string) {
  const [key, ...rest] = virtual.split('/'); if (!ROOT_KEYS.includes(key as typeof ROOT_KEYS[number]) || rest.some((part) => part === '..' || part === '')) throw Object.assign(new Error(`Bad path ${virtual}`), { status: 400 });
  return path.join(roots[key as keyof Roots], ...rest);
}
/** The virtual path of a real file (most specific root first), or null when it is outside all of them. */
export function toVirtual(roots: Roots, real: string) {
  const ordered = [...ROOT_KEYS].sort((a, b) => roots[b].length - roots[a].length);
  for (const key of ordered) { const rel = path.relative(roots[key], real); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return `${key}/${rel.split(path.sep).join('/')}`; }
  return null;
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Rewrite absolute folder paths in text from one computer's layout to another's (JSON escapes "/" only optionally). */
export function rewriteRoots(text: string, from: Roots, to: Roots) {
  const keys = [...ROOT_KEYS].sort((a, b) => from[b].length - from[a].length);
  const marks = keys.map((key, i) => ({ key, mark: `\u0000ROOT${i}\u0000` }));
  let out = text;
  for (const { key, mark } of marks) if (from[key] && from[key] !== to[key]) out = out.replace(new RegExp(`${escape(from[key])}(?=[/\\\\"'\\s]|$)`, 'g'), mark);
  for (const { key, mark } of marks) out = out.split(mark).join(to[key]);
  return out;
}
export const isText = (file: string) => TEXT.test(file);

async function walk(roots: Roots, virtual: string, out: ManifestEntry[], skip: RegExp) {
  if (skip.test(virtual)) return;
  const real = toReal(roots, virtual); const stat = await fs.stat(real).catch(() => null); if (!stat) return;
  if (stat.isFile()) return void out.push({ path: virtual, size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000) });
  if (!stat.isDirectory()) return;
  for (const entry of await fs.readdir(real)) await walk(roots, `${virtual}/${entry}`, out, skip);
}
export async function buildManifest(roots: Roots, include: string[], skip: RegExp = SKIP) {
  const out: ManifestEntry[] = []; for (const item of include) await walk(roots, item, out, skip);
  const seen = new Set<string>(); return out.filter((entry) => !seen.has(entry.path) && seen.add(entry.path));
}
const under = (virtual: string, prefixes: string[]) => prefixes.some((prefix) => virtual === prefix || virtual.startsWith(`${prefix}/`));

// ---- Routes the nodes call (mounted before the login check; each checks the node token itself)
type Handler = (req: Request, res: Response, node: NodeRecord) => Promise<void>;
export function nodeRoutes(app: { get: Function; post: Function; put: Function }, express: { raw: Function }) {
  const guard = (handler: Handler) => (req: Request, res: Response) => {
    void (async () => {
      const node = await nodeFromRequest(req); if (!node) return void res.status(401).json({ error: 'Unknown or switched-off render computer.' });
      await handler(req, res, node);
    })().catch((error: any) => { if (!res.headersSent) res.status(error?.status ?? 500).json({ error: error instanceof Error ? error.message : String(error) }); });
  };
  app.post('/api/node/poll', guard(async (req, res, node) => {
    const body = req.body ?? {}; const wasOnline = isOnline(node.id);
    live.set(node.id, { lastSeen: Date.now(), info: body.info ?? live.get(node.id)?.info });
    for (const update of Array.isArray(body.active) ? body.active : []) {
      const task = tasks.get(String(update?.id)); if (!task || task.nodeId !== node.id) continue;
      task.detail = typeof update.detail === 'string' ? update.detail.slice(0, 300) : task.detail; task.progress = typeof update.progress === 'number' ? update.progress : task.progress;
      task.onUpdate?.(task.detail, task.progress);
    }
    const busy = Boolean(body.info?.busy);
    const fresh = busy ? [] : [...tasks.values()].filter((task) => task.nodeId === node.id && task.state === 'queued').slice(0, 1);
    for (const task of fresh) task.state = 'sent';
    const cancel = [...tasks.values()].filter((task) => task.nodeId === node.id && task.cancel && task.state === 'sent').map((task) => task.id);
    if (!wasOnline) pool.pump();
    res.json({ tasks: fresh.map(({ id, kind, projectId, payload }) => ({ id, kind, projectId, payload })), cancel, roots: hubRoots(), hubTime: Date.now() });
  }));
  app.get('/api/node/tasks/:taskId/manifest', guard(async (req, res, node) => {
    const task = taskFor(req, node.id); const roots = hubRoots();
    res.json({ roots, files: await buildManifest(roots, task.include), mirror: task.writable });
  }));
  app.get('/api/node/tasks/:taskId/file', guard(async (req, res, node) => {
    const task = taskFor(req, node.id); const virtual = String(req.query.path ?? '');
    if (!under(virtual, task.include) || SKIP.test(virtual)) throw Object.assign(new Error('That file is not part of this task.'), { status: 403 });
    const real = toReal(hubRoots(), virtual); const stat = await fs.stat(real).catch(() => null);
    if (!stat?.isFile()) throw Object.assign(new Error('Not found.'), { status: 404 });
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(stat.size)); res.setHeader('X-Mtime', String(Math.floor(stat.mtimeMs / 1000)));
    await pipeline(createReadStream(real), res);
  }));
  // Chunks of at most ~32 MB (Cloudflare refuses request bodies over 100 MB); the last one renames the file into place.
  app.put('/api/node/tasks/:taskId/file', express.raw({ type: '*/*', limit: '64mb' }), guard(async (req, res, node) => {
    const task = taskFor(req, node.id); const virtual = String(req.query.path ?? '');
    if (!under(virtual, task.writable) || NO_UPLOAD.test(virtual) || SKIP_UP.test(virtual)) throw Object.assign(new Error('That file cannot be written by a node.'), { status: 403 });
    const real = toReal(hubRoots(), virtual); const temp = `${real}.node-upload`; const offset = Number(req.query.offset ?? 0);
    await fs.mkdir(path.dirname(real), { recursive: true });
    const size = offset === 0 ? 0 : (await fs.stat(temp).catch(() => null))?.size ?? -1;
    if (size !== offset) throw Object.assign(new Error(`Upload out of order (have ${size}, got ${offset}).`), { status: 409 });
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (offset === 0) await fs.writeFile(temp, body); else await fs.appendFile(temp, body);
    if (req.query.done) {
      await fs.rename(temp, real); const mtime = Number(req.query.mtime); if (mtime > 0) await fs.utimes(real, mtime, mtime);
    }
    res.json({ ok: true, received: offset + body.length });
  }));
  // Batches of small files, base64 in JSON (caption frames, plans): one request instead of hundreds.
  app.post('/api/node/tasks/:taskId/fetch', guard(async (req, res, node) => {
    const task = taskFor(req, node.id); const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths.map(String).slice(0, 5000) : [];
    const files = [];
    for (const virtual of paths) {
      if (!under(virtual, task.include) || SKIP.test(virtual)) throw Object.assign(new Error('That file is not part of this task.'), { status: 403 });
      const data = await fs.readFile(toReal(hubRoots(), virtual)).catch(() => null); if (data) files.push({ path: virtual, data: data.toString('base64') });
    }
    res.json({ files });
  }));
  app.post('/api/node/tasks/:taskId/put-many', guard(async (req, res, node) => {
    const task = taskFor(req, node.id); const body = (req.body ?? {}) as { files?: Array<{ path: string; mtime: number; data: string }> };
    for (const file of body.files ?? []) {
      const virtual = String(file.path);
      if (!under(virtual, task.writable) || NO_UPLOAD.test(virtual) || SKIP_UP.test(virtual)) throw Object.assign(new Error('That file cannot be written by a node.'), { status: 403 });
      const real = toReal(hubRoots(), virtual); await fs.mkdir(path.dirname(real), { recursive: true });
      await fs.writeFile(`${real}.node-upload`, Buffer.from(String(file.data), 'base64')); await fs.rename(`${real}.node-upload`, real);
      if (Number(file.mtime) > 0) await fs.utimes(real, Number(file.mtime), Number(file.mtime));
    }
    res.json({ ok: true });
  }));
  app.post('/api/node/tasks/:taskId/delete', guard(async (req, res, node) => {
    const task = taskFor(req, node.id); const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : [];
    for (const virtual of paths) if (under(virtual, task.writable) && !NO_UPLOAD.test(virtual) && !SKIP_UP.test(virtual)) await fs.rm(toReal(hubRoots(), virtual), { force: true });
    res.json({ ok: true });
  }));
  app.post('/api/node/tasks/:taskId/finish', guard(async (req, res, node) => {
    const task = taskFor(req, node.id); if (task.state === 'done' || task.state === 'failed') return void res.json({ ok: true });
    if (req.body?.ok) { task.state = 'done'; task.resolve({ result: req.body.result }); }
    else { task.state = 'failed'; task.reject(new Error(String(req.body?.error || 'The render computer failed.'))); }
    res.json({ ok: true });
  }));
}

// ---- Node side helpers (used by node-agent.ts)
export async function streamToFile(body: ReadableStream<Uint8Array> | null, file: string) {
  if (!body) throw new Error('Empty response');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const { Readable } = await import('node:stream');
  await pipeline(Readable.fromWeb(body as any), createWriteStream(file));
}

// ---- What a computer is (shown on the Computers page)

const exec = (command: string, args: string[]) => new Promise<{ ok: boolean; stdout: string }>((resolve) => execFile(command, args, { timeout: 20_000 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') })));
let infoCache: NodeInfo | undefined;
export async function machineInfo(ffmpegBin: string, repoDir: string): Promise<NodeInfo> {
  if (infoCache) return infoCache;
  let encoder = 'x264';
  if (ffmpegBin && !process.env.VIDEO_CLEANER_NO_HW_ENCODE) {
    if (process.platform === 'darwin') { if ((await exec(ffmpegBin, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1', '-c:v', 'h264_videotoolbox', '-b:v', '2M', '-frames:v', '1', '-f', 'null', '-'])).ok) encoder = 'videotoolbox'; }
    else {
      const device = process.env.VIDEO_CLEANER_VAAPI_DEVICE || '/dev/dri/renderD128';
      if (await fs.stat(device).then(() => true, () => false) && (await exec(ffmpegBin, ['-v', 'error', '-vaapi_device', device, '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-frames:v', '1', '-f', 'null', '-'])).ok) encoder = 'quicksync';
    }
  }
  const version = (await exec('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'])).stdout.trim() || 'unknown';
  const cpus = os.cpus();
  infoCache = { platform: process.platform, arch: process.arch, cpus: cpus.length, cpuModel: cpus[0]?.model?.trim() ?? '', memoryGb: Math.round(os.totalmem() / 1073741824), hostname: os.hostname(), encoder, version };
  return infoCache;
}
