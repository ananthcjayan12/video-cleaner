import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Resumable chunked uploads for the phone UI. Cloudflare caps one request body at 100 MB, so the browser sends the
 * file in slices (PUT ?offset=N). Slices must arrive in order; after a dropped connection the browser asks for the
 * received size and continues from there. Uploaded videos become the project's master source, so they are kept.
 */
export type UploadKind = 'video' | 'image' | 'audio';
export type UploadMeta = { id: string; name: string; size: number; received: number; kind: UploadKind; file: string; createdAt: string; complete: boolean };

export const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 40 * 1024 * 1024 * 1024;
const EXTENSIONS: Record<UploadKind, string[]> = {
  video: ['.mov', '.mp4', '.m4v', '.webm', '.mkv'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'],
  audio: ['.mp3', '.wav', '.m4a', '.aac'],
};

export function uploadKindFor(name: string): UploadKind | null {
  const extension = path.extname(name).toLowerCase();
  return (Object.keys(EXTENSIONS) as UploadKind[]).find((kind) => EXTENSIONS[kind].includes(extension)) ?? null;
}

/** Keep letters (with their vowel signs, e.g. Malayalam), digits, dot, dash and underscore; never allow a path. */
export function safeFileName(name: string) {
  const base = path.basename(String(name || 'upload')).normalize('NFC');
  const cleaned = base.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-').replace(/^[.-]+/, '').slice(-120);
  return cleaned || 'upload';
}

const metaPath = (dir: string, id: string) => path.join(dir, id, 'upload.json');
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export async function createUpload(dir: string, input: { name: unknown; size: unknown }): Promise<UploadMeta> {
  const name = safeFileName(String(input.name ?? ''));
  const size = Number(input.size);
  const kind = uploadKindFor(name);
  if (!kind) throw new Error('Upload a video (MOV/MP4/M4V/WebM/MKV), an image or an audio file.');
  if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) throw new Error('Upload size is missing or larger than 40 GB.');
  const id = randomUUID();
  await fs.mkdir(path.join(dir, id), { recursive: true });
  const meta: UploadMeta = { id, name, size, received: 0, kind, file: path.join(dir, id, name), createdAt: new Date().toISOString(), complete: false };
  await fs.writeFile(meta.file, '');
  await fs.writeFile(metaPath(dir, id), JSON.stringify(meta));
  return meta;
}

export async function readUpload(dir: string, id: string): Promise<UploadMeta> {
  if (!validId(id)) throw new Error('Unknown upload');
  const meta = JSON.parse(await fs.readFile(metaPath(dir, id), 'utf8').catch(() => { throw new Error('Unknown upload'); })) as UploadMeta;
  // The file on disk is the truth: a chunk that was cut off mid-way leaves fewer bytes than the last saved count.
  const stat = await fs.stat(meta.file);
  meta.received = Math.min(stat.size, meta.size); meta.complete = meta.received === meta.size;
  return meta;
}

/** Append one slice at `offset`. Returns the new received size. Out-of-order slices are rejected with the expected offset. */
export async function appendChunk(dir: string, id: string, offset: number, stream: Readable): Promise<UploadMeta> {
  const meta = await readUpload(dir, id);
  if (meta.complete) return meta;
  if (offset !== meta.received) throw Object.assign(new Error(`Expected offset ${meta.received}`), { status: 409, expected: meta.received });
  const limit = Math.min(MAX_CHUNK_BYTES, meta.size - meta.received);
  await new Promise<void>((resolve, reject) => {
    let written = 0;
    const out = createWriteStream(meta.file, { flags: 'r+', start: offset });
    stream.on('data', (chunk: Buffer) => {
      written += chunk.length;
      if (written > limit) { stream.destroy(); out.destroy(); reject(Object.assign(new Error('Chunk is larger than allowed'), { status: 413 })); }
    });
    stream.on('error', reject); out.on('error', reject); out.on('finish', resolve);
    stream.pipe(out);
  });
  const updated = await readUpload(dir, id);
  await fs.writeFile(metaPath(dir, id), JSON.stringify(updated));
  return updated;
}

/** Path of a finished upload, or an error naming what is missing. */
export async function completedUploadPath(dir: string, id: string, kind?: UploadKind) {
  const meta = await readUpload(dir, id);
  if (!meta.complete) throw new Error(`${meta.name} is not fully uploaded yet (${Math.round(meta.received / meta.size * 100)}%).`);
  if (kind && meta.kind !== kind) throw new Error(`${meta.name} is not a ${kind} file.`);
  return meta.file;
}
