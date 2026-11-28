/**
 * Node mode: this computer renders for a PractiReel hub (see server/nodes.ts).
 * Started by server/index.ts when PRACTIREEL_HUB_URL and PRACTIREEL_NODE_TOKEN are set.
 *
 * Loop: poll the hub every 3 s (heartbeat + progress) → for a new task, mirror its files from the hub → run it with
 * the same code the hub uses → upload new/changed files (and deletions) → report the result.
 */
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { buildManifest, isText, rewriteRoots, SKIP, SKIP_UP, streamToFile, toReal, toVirtual, type ManifestEntry, type NodeInfo, type Roots } from './nodes.js';

export type NodeTask = { id: string; kind: string; projectId: string; payload: any };
export type TaskContext = { signal: AbortSignal; update: (detail?: string, progress?: number) => void; hubRoots: Roots; localRoots: Roots; toHubText: (text: string) => string; fromHubText: (text: string) => string };
export type TaskHandler = (task: NodeTask, ctx: TaskContext) => Promise<unknown>;

const CHUNK = 32 * 1024 * 1024;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startNodeAgent(options: { hubUrl: string; token: string; roots: Roots; info: () => Promise<NodeInfo>; handlers: Record<string, TaskHandler>; log?: (line: string) => void }) {
  const hub = options.hubUrl.replace(/\/+$/, ''); const log = options.log ?? ((line: string) => console.log(`[node] ${line}`));
  const headers = { Authorization: `Bearer ${options.token}` };
  const active = new Map<string, { detail?: string; progress?: number; abort: AbortController }>();
  let info: NodeInfo | undefined; let lastError = '';

  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${hub}${url}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    return response.json() as Promise<any>;
  };

  // What was last copied each way: the hub's size/mtime of a file and this computer's size/mtime of its copy. Text files
  // differ in size between the two (folder paths are rewritten), so they are matched through this index.
  const indexFile = path.join(options.roots.data, '.practireel-sync.json');
  type Synced = { hubSize: number; hubMtime: number; size: number; mtime: number };
  const readIndex = async () => new Map<string, Synced>(Object.entries(JSON.parse(await fs.readFile(indexFile, 'utf8').catch(() => '{}')) as Record<string, Synced>));
  const writeIndex = async (index: Map<string, Synced>) => { await fs.mkdir(path.dirname(indexFile), { recursive: true }); await fs.writeFile(`${indexFile}.tmp`, JSON.stringify(Object.fromEntries(index))); await fs.rename(`${indexFile}.tmp`, indexFile); };
  const stamp = async (local: string) => { const stat = await fs.stat(local); return { size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000) }; };
  /** Small files travel in batches (one request per ~16 MB instead of one per caption frame). */
  const SMALL = 1024 * 1024; const BATCH = 16 * 1024 * 1024;
  const batches = <T extends { size: number }>(items: T[]) => { const out: T[][] = []; let current: T[] = []; let bytes = 0;
    for (const item of items) { if (current.length && bytes + item.size > BATCH) { out.push(current); current = []; bytes = 0; } current.push(item); bytes += item.size; }
    if (current.length) out.push(current); return out; };
  const retry = async <T>(work: () => Promise<T>, signal?: AbortSignal) => { for (let attempt = 1; ; attempt += 1) { try { return await work(); } catch (error) { if (attempt >= 3 || signal?.aborted) throw error; await sleep(2000 * attempt); } } };

  async function mirror(task: NodeTask, ctx: TaskContext) {
    const manifest = await call('GET', `/api/node/tasks/${task.id}/manifest`) as { roots: Roots; files: ManifestEntry[]; mirror: string[] };
    const index = await readIndex(); const need: ManifestEntry[] = [];
    for (const file of manifest.files) {
      const local = toReal(options.roots, file.path); const stat = await fs.stat(local).catch(() => null);
      const known = index.get(file.path); const localStamp = stat ? { size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000) } : null;
      const same = localStamp && (known ? known.hubSize === file.size && known.hubMtime === file.mtime && known.size === localStamp.size && known.mtime === localStamp.mtime
        : !isText(local) && localStamp.size === file.size && localStamp.mtime === file.mtime);
      if (!same) need.push(file);
    }
    const total = need.reduce((sum, file) => sum + file.size, 0); let fetched = 0;
    const place = async (file: ManifestEntry, temp: string) => {
      const local = toReal(options.roots, file.path);
      if (isText(local)) await fs.writeFile(temp, ctx.fromHubText(await fs.readFile(temp, 'utf8')));
      await fs.rename(temp, local); await fs.utimes(local, file.mtime, file.mtime);
      index.set(file.path, { hubSize: file.size, hubMtime: file.mtime, ...await stamp(local) });
      fetched += file.size; ctx.update(`Copying files from the hub ${Math.round((fetched / Math.max(total, 1)) * 100)}%`);
    };
    try {
      for (const group of batches(need.filter((file) => file.size < SMALL))) {
        if (ctx.signal.aborted) throw new Error('Stopped');
        const reply = await retry(() => call('POST', `/api/node/tasks/${task.id}/fetch`, { paths: group.map((file) => file.path) }), ctx.signal) as { files: Array<{ path: string; data: string }> };
        for (const item of reply.files) {
          const file = group.find((candidate) => candidate.path === item.path); if (!file) continue;
          const local = toReal(options.roots, file.path); await fs.mkdir(path.dirname(local), { recursive: true });
          await fs.writeFile(`${local}.part`, Buffer.from(item.data, 'base64')); await place(file, `${local}.part`);
        }
      }
      for (const file of need.filter((candidate) => candidate.size >= SMALL)) {
        if (ctx.signal.aborted) throw new Error('Stopped');
        const local = toReal(options.roots, file.path);
        await retry(async () => {
          const response = await fetch(`${hub}/api/node/tasks/${task.id}/file?path=${encodeURIComponent(file.path)}`, { headers, signal: ctx.signal });
          if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
          await streamToFile(response.body, `${local}.part`);
        }, ctx.signal);
        await place(file, `${local}.part`);
      }
    } finally { await writeIndex(index); }
    // Mirror: files the hub no longer has are removed here too (stale captions or clips must not be reused).
    const wanted = new Set(manifest.files.map((file) => file.path));
    for (const entry of await buildManifest(options.roots, manifest.mirror)) if (!wanted.has(entry.path)) { await fs.rm(toReal(options.roots, entry.path), { force: true }); index.delete(entry.path); }
    log(`task ${task.id.slice(0, 8)}: ${manifest.files.length} files, ${need.length} copied (${(fetched / 1048576).toFixed(1)} MB)`);
    return manifest;
  }

  async function sendBack(task: NodeTask, ctx: TaskContext, before: ManifestEntry[], writable: string[]) {
    const after = await buildManifest(options.roots, writable, SKIP_UP); const old = new Map(before.map((entry) => [entry.path, entry]));
    const changed = after.filter((entry) => { const was = old.get(entry.path); return !was || was.size !== entry.size || was.mtime !== entry.mtime; })
      .filter((entry) => !/^data\/projects\/[^/]+\/(project\.json|auto\/job\.json)$/.test(entry.path));
    const gone = before.filter((entry) => !after.some((now) => now.path === entry.path)).map((entry) => entry.path);
    const total = changed.reduce((sum, entry) => sum + entry.size, 0); let sent = 0;
    const index = await readIndex();
    const sentOne = (entry: ManifestEntry, hubSize: number) => { index.set(entry.path, { hubSize, hubMtime: entry.mtime, size: entry.size, mtime: entry.mtime }); };
    const progress = (bytes: number) => { sent += bytes; ctx.update(`Sending the result to the hub ${Math.round((sent / Math.max(total, 1)) * 100)}%`); };
    try {
      for (const group of batches(changed.filter((entry) => entry.size < SMALL))) {
        const files = await Promise.all(group.map(async (entry) => {
          const local = toReal(options.roots, entry.path);
          const data = isText(local) ? Buffer.from(ctx.toHubText(await fs.readFile(local, 'utf8'))) : await fs.readFile(local);
          return { entry, data };
        }));
        await retry(() => call('POST', `/api/node/tasks/${task.id}/put-many`, { files: files.map(({ entry, data }) => ({ path: entry.path, mtime: entry.mtime, data: data.toString('base64') })) }));
        for (const { entry, data } of files) { sentOne(entry, data.length); progress(entry.size); }
      }
      for (const entry of changed.filter((candidate) => candidate.size >= SMALL)) {
        const local = toReal(options.roots, entry.path);
        const data = isText(local) ? Buffer.from(ctx.toHubText(await fs.readFile(local, 'utf8'))) : null;
        const size = data ? data.length : entry.size;
        for (let offset = 0; ; offset += CHUNK) {
          const end = Math.min(offset + CHUNK, size); const last = end >= size;
          const chunk = data ? data.subarray(offset, end) : await readRange(local, offset, end);
          await retry(async () => {
            const response = await fetch(`${hub}/api/node/tasks/${task.id}/file?path=${encodeURIComponent(entry.path)}&offset=${offset}${last ? `&done=1&mtime=${entry.mtime}` : ''}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: chunk });
            if (!response.ok) throw new Error(`Upload of ${entry.path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
          });
          progress(chunk.length); if (last) break;
        }
        sentOne(entry, size);
      }
      if (gone.length) { await call('POST', `/api/node/tasks/${task.id}/delete`, { paths: gone }); for (const file of gone) index.delete(file); }
    } finally { await writeIndex(index); }
    // Finished videos now live on the hub; do not keep a second copy here.
    for (const entry of changed) if (/\/exports\//.test(entry.path)) { await fs.rm(toReal(options.roots, entry.path), { force: true }); index.delete(entry.path); }
    log(`task ${task.id.slice(0, 8)}: sent ${changed.length} files (${(total / 1048576).toFixed(1)} MB)${gone.length ? `, ${gone.length} removed` : ''}`);
  }

  async function runTask(task: NodeTask, hubRoots: Roots) {
    const abort = new AbortController(); const state = { abort } as { detail?: string; progress?: number; abort: AbortController };
    active.set(task.id, state);
    const ctx: TaskContext = {
      signal: abort.signal, update: (detail, progress) => { if (detail !== undefined) state.detail = detail; if (progress !== undefined) state.progress = progress; },
      hubRoots, localRoots: options.roots, toHubText: (text) => rewriteRoots(text, options.roots, hubRoots), fromHubText: (text) => rewriteRoots(text, hubRoots, options.roots),
    };
    const started = Date.now(); log(`task ${task.id.slice(0, 8)}: ${task.kind} for ${task.projectId}`);
    try {
      const handler = options.handlers[task.kind]; if (!handler) throw new Error(`This computer cannot run "${task.kind}" (update the app here).`);
      ctx.update('Copying files from the hub…');
      const manifest = await mirror(task, ctx);
      const now = new Date(); await fs.utimes(path.join(options.roots.data, 'projects', task.projectId), now, now).catch(() => undefined); // keeps the copy from the 3-day sweep
      const before = await buildManifest(options.roots, manifest.mirror, SKIP_UP);
      const result = await handler(task, ctx);
      if (abort.signal.aborted) throw new Error('Stopped');
      await sendBack(task, ctx, before, manifest.mirror);
      const mapped = result === undefined ? undefined : JSON.parse(ctx.toHubText(JSON.stringify(result)));
      await call('POST', `/api/node/tasks/${task.id}/finish`, { ok: true, result: mapped });
      log(`task ${task.id.slice(0, 8)}: done in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); log(`task ${task.id.slice(0, 8)}: failed: ${message.slice(0, 500)}`);
      await call('POST', `/api/node/tasks/${task.id}/finish`, { ok: false, error: `${message}`.slice(0, 2000) }).catch(() => undefined);
    } finally { active.delete(task.id); }
  }

  /** Reels this computer has not worked on for 3 days: drop their copied files (the hub keeps everything). */
  async function sweep() {
    const dir = path.join(options.roots.data, 'projects');
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stat?.isDirectory() && Date.now() - stat.mtimeMs > 3 * 86_400_000 && !active.size) { await fs.rm(path.join(dir, name), { recursive: true, force: true }); log(`removed old copy of ${name}`); }
    }
  }
  let swept = 0;

  void (async () => {
    log(`render computer for ${hub}`);
    for (;;) {
      try {
        info = { ...(info ?? await options.info()), busy: active.size > 0 };
        const reply = await call('POST', '/api/node/poll', { info, active: [...active].map(([id, state]) => ({ id, detail: state.detail, progress: state.progress })) });
        if (lastError) { log('connected to the hub again'); lastError = ''; }
        for (const id of reply.cancel ?? []) active.get(id)?.abort.abort();
        for (const task of reply.tasks ?? []) void runTask(task, reply.roots);
        if (!active.size && Date.now() - swept > 3_600_000) { swept = Date.now(); void sweep().catch(() => undefined); }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) { log(`cannot reach the hub: ${message.slice(0, 300)}`); lastError = message; }
      }
      await sleep(3000);
    }
  })();
  return { virtual: (real: string) => toVirtual(options.roots, real) };
}

async function readRange(file: string, start: number, end: number) {
  const parts: Buffer[] = [];
  if (end <= start) return Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { start, end: end - 1 })) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}
export { SKIP };
