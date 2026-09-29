import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export type MotionTemplate = { id: string; name: string; notes: string; file: string; createdAt: string };

const MAX_BYTES = 12 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp' };
export const MOTION_TEMPLATE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

// Templates are brand assets, so they live once per user and can be reused across projects.
export const motionTemplatesDir = () => process.env.MOTION_TEMPLATES_DIR || path.join(os.homedir(), '.video-cleaner', 'motion-templates');
const indexPath = () => path.join(motionTemplatesDir(), 'index.json');

export async function listMotionTemplates(): Promise<MotionTemplate[]> {
  try {
    const entries = JSON.parse(await fs.readFile(indexPath(), 'utf8')) as MotionTemplate[];
    return entries.filter((entry) => entry?.id && /^[\w-]+\.(png|jpg|webp)$/.test(entry.file));
  } catch { return []; }
}
const save = async (entries: MotionTemplate[]) => { await fs.mkdir(motionTemplatesDir(), { recursive: true }); await fs.writeFile(indexPath(), JSON.stringify(entries, null, 2)); };

export async function motionTemplatePath(id: string) {
  const entry = (await listMotionTemplates()).find((item) => item.id === id);
  return entry ? { entry, file: path.join(motionTemplatesDir(), entry.file) } : null;
}

export async function addMotionTemplate(options: { fileName: string; name?: string; notes?: string; stream: Readable }) {
  const extension = path.extname(options.fileName).toLowerCase();
  if (!EXTENSIONS[extension]) throw new Error('Templates must be PNG, JPG or WebP images.');
  await fs.mkdir(motionTemplatesDir(), { recursive: true });
  const id = randomUUID().slice(0, 8); const file = `${id}.${EXTENSIONS[extension]}`; const target = path.join(motionTemplatesDir(), file);
  let size = 0;
  options.stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) options.stream.destroy(new Error('Template image is larger than 12 MB.')); });
  try { await pipeline(options.stream, createWriteStream(target)); } catch (error) { await fs.rm(target, { force: true }); throw error; }
  if (size < 500) { await fs.rm(target, { force: true }); throw new Error('The uploaded template is empty.'); }
  const entry: MotionTemplate = { id, name: (options.name || path.basename(options.fileName, extension)).trim().slice(0, 80) || 'Template', notes: (options.notes || '').trim().slice(0, 600), file, createdAt: new Date().toISOString() };
  await save([...await listMotionTemplates(), entry]);
  return entry;
}

export async function updateMotionTemplate(id: string, patch: { name?: string; notes?: string }) {
  const entries = await listMotionTemplates(); const entry = entries.find((item) => item.id === id); if (!entry) throw new Error('Template not found');
  if (typeof patch.name === 'string' && patch.name.trim()) entry.name = patch.name.trim().slice(0, 80);
  if (typeof patch.notes === 'string') entry.notes = patch.notes.trim().slice(0, 600);
  await save(entries); return entry;
}

export async function deleteMotionTemplate(id: string) {
  const entries = await listMotionTemplates(); const entry = entries.find((item) => item.id === id); if (!entry) throw new Error('Template not found');
  await fs.rm(path.join(motionTemplatesDir(), entry.file), { force: true });
  await save(entries.filter((item) => item.id !== id));
}
