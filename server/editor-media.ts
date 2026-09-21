import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type EditorMediaKind = 'video' | 'audio' | 'image';
export type EditorMediaEntry = {
  id: string;
  name: string;
  kind: EditorMediaKind;
  duration: number;
  width?: number;
  height?: number;
  size: number;
  hasAudio?: boolean;
};
export type EditorMediaProbe = { duration?: number; width?: number; height?: number; videoCodec?: string; audioCodec?: string };
const EXTENSIONS: Record<EditorMediaKind, Set<string>> = {
  video: new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
};
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB per clip. Streaming, not memory-buffered.
const MAX_ENTRIES = 200;
export function editorMediaDir(workDir: string) { return path.join(workDir, 'editor-media'); }
function manifestPath(workDir: string) { return path.join(editorMediaDir(workDir), 'manifest.json'); }
function safeName(name: string) {
  return path.basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160).trim();
}
export function editorMediaExtension(name: string, kind: EditorMediaKind) {
  const ext = path.extname(name).toLowerCase();
  if (!EXTENSIONS[kind].has(ext)) throw new Error('Unsupported ' + kind + ' format. Supported: ' + [...EXTENSIONS[kind]].join(', '));
  return ext;
}
export async function loadEditorMedia(workDir: string): Promise<EditorMediaEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath(workDir), 'utf8'));
    return Array.isArray(raw) ? raw.filter((entry): entry is EditorMediaEntry =>
      entry && typeof entry.id === 'string' && /^[a-f0-9-]{36}$/.test(entry.id)
      && typeof entry.name === 'string' && EXTENSIONS[entry.kind as EditorMediaKind]
      && Number.isFinite(entry.duration) && entry.duration > 0
    ) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export function editorMediaFile(workDir: string, entry: EditorMediaEntry) {
  return path.join(editorMediaDir(workDir), entry.id + editorMediaExtension(entry.name, entry.kind));
}
export async function resolveEditorMedia(workDir: string, mediaId: string) {
  const entry = (await loadEditorMedia(workDir)).find(item => item.id === mediaId);
  if (!entry) return null;
  const file = editorMediaFile(workDir, entry);
  return (await fs.stat(file).catch(() => null))?.isFile() ? { entry, file } : null;
}
export async function importEditorMedia(options: {
  workDir: string;
  fileName: string;
  kind: EditorMediaKind;
  stream: Readable;
  probe: (filePath: string) => Promise<EditorMediaProbe>;
}): Promise<EditorMediaEntry> {
  const { workDir, stream, kind, probe } = options;
  if (!EXTENSIONS[kind]) throw new Error('Unsupported media category');
  const name = safeName(options.fileName);
  if (!name) throw new Error('Choose a file with a valid name');
  const ext = editorMediaExtension(name, kind);
  const existing = await loadEditorMedia(workDir);
  if (existing.length >= MAX_ENTRIES) throw new Error('This project has reached its 200 imported-file limit');
  const id = randomUUID();
  const dir = editorMediaDir(workDir);
  await fs.mkdir(dir, { recursive: true });
  const output = path.join(dir, id + ext);
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) callback(new Error('Media file exceeds the 1 GiB import limit'));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, cap, createWriteStream(output, { flags: 'wx' }));
    if (!bytes) throw new Error('The selected media file is empty');
    const media = await probe(output);
    if (kind === 'video' && (!media.videoCodec || !media.width || !media.height || !media.duration)) throw new Error('File is not a playable video');
    if (kind === 'audio' && (!media.audioCodec || !media.duration)) throw new Error('File is not a playable audio recording');
    if (kind === 'image' && (!media.width || !media.height)) throw new Error('File is not a supported image');
    const entry: EditorMediaEntry = {
      id, name, kind, size: bytes,
      duration: kind === 'image' ? 5 : media.duration!,
      width: media.width, height: media.height, hasAudio: Boolean(media.audioCodec),
    };
    // A finished file is registered only after it has been validated; cancellation
    // and upload/probe failures leave the existing media manifest untouched.
    await fs.writeFile(manifestPath(workDir), JSON.stringify([...existing, entry], null, 2) + '\n');
    return entry;
  } catch (error) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw error;
  }
}
