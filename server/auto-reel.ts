import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaptionPhrase } from './captions.js';
import type { KeepRange, Word } from './project-store.js';

/**
 * One-tap "Auto reel": upload -> audio -> transcript -> aggressive clean -> B-roll plan + images -> edit (cuts snapped
 * to quiet points, alternating zoom, mastered voice) -> Glass Card captions -> composite with B-roll and whooshes.
 * This module holds the pieces that do not need the web server; server/index.ts runs the job.
 */
export type AutoStageId = 'audio' | 'transcribe' | 'clean' | 'review' | 'broll-plan' | 'broll-images' | 'edit' | 'captions' | 'compose' | 'package';
export type AutoStage = { id: AutoStageId; label: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; detail?: string; seconds?: number };
export type AutoJob = {
  state: 'running' | 'review' | 'completed' | 'failed' | 'stopped'; stages: AutoStage[]; startedAt: number; finishedAt?: number;
  /** While state is "review": the transcript and the current keep decision for the review screen. */
  review?: { words: Array<{ id: string; text: string; start: number; end: number }>; keepRanges: KeepRange[]; keptSeconds: number; sourceSeconds: number; notes?: string; redoing?: boolean };
  error?: string; outputPath?: string; previewUrl?: string; downloadUrl?: string; sourceSeconds?: number; finalSeconds?: number;
  options: AutoOptions; stopRequested?: boolean;
  /** Thumbnail and Instagram post caption, made after the reel (and remade from the review screen). */
  package?: ReelPackage;
};
export type AutoOptions = { targetDurationSec?: number; imageProvider: 'gemini' | 'chatgpt'; broll: boolean; captions: boolean; review: boolean; thumbnail?: boolean; postCaption?: boolean };
export type ThumbnailBadge = { icon: string; label?: string };
export type ReelPackage = {
  state: 'running' | 'ready' | 'failed'; error?: string;
  /** Candidate frames of the speaker (URLs of small previews) and the one used. */
  frames: string[]; frame: number; faces?: number[];
  lines: string[]; label: string; badges: ThumbnailBadge[]; caption: string; hashtags: string[];
  thumbnailPath?: string; thumbnailUrl?: string; thumbnailDownloadUrl?: string;
};

export const AUTO_STAGES: Array<[AutoStageId, string]> = [
  ['audio', 'Preparing audio'], ['transcribe', 'Transcribing'], ['clean', 'Cleaning the talk'], ['review', 'Your review'], ['broll-plan', 'Planning B-roll'],
  ['broll-images', 'Making B-roll images'], ['edit', 'Cutting, zoom and voice'], ['captions', 'Rendering captions'], ['compose', 'Putting it together'], ['package', 'Thumbnail & post caption'],
];
export const newAutoJob = (options: AutoOptions): AutoJob => ({
  state: 'running', startedAt: Date.now(), options,
  stages: AUTO_STAGES.map(([id, label]) => ({ id, label, state: (!options.broll && id.startsWith('broll')) || (!options.captions && id === 'captions') || (!options.review && id === 'review') || (id === 'package' && options.thumbnail === false && options.postCaption === false) ? 'skipped' : 'pending' })),
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTO_EDIT_SCRIPT = path.join(repoRoot, 'server', 'auto_edit.py');
export const AUTO_COMPOSITE_SCRIPT = path.join(repoRoot, 'server', 'auto_composite.py');
export const CAPTIONS_ENTRY = path.join(repoRoot, 'remotion', 'captions', 'src', 'index.tsx');
export const CAPTIONS_PUBLIC = path.join(repoRoot, 'remotion', 'captions', 'public');
export const WHOOSH = path.join(repoRoot, 'assets', 'motion-sfx', 'Whoosh & Transitions', 'Simple Whoosh 1.wav');

/** Keep ranges (word ids) as inclusive word-index pairs for the edit script. */
export function keepIndexRanges(words: Word[], keepRanges: KeepRange[]) {
  const index = new Map(words.map((word, i) => [word.id, i]));
  return keepRanges.map((range) => [index.get(range.startWordId), index.get(range.endWordId)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined && pair[0] <= pair[1])
    .sort((a, b) => a[0] - b[0]).map(([a, b]) => [a, b]);
}

export type EditRange = { words: [number, number]; start: number; end: number };
/** Where a source word lands on the edited timeline, or undefined when it was cut. */
export function editedTime(words: Word[], ranges: EditRange[], wordIndex: number) {
  let offset = 0;
  for (const range of ranges) {
    if (wordIndex >= range.words[0] && wordIndex <= range.words[1]) return offset + Math.max(0, words[wordIndex].start - range.start);
    offset += range.end - range.start;
  }
  return undefined;
}

/**
 * B-roll scenes are planned on the source timeline; place each one on the edited timeline, starting just before its
 * first kept word. Cutaways are short (1.8–2.6 s), never in the opening hook or the closing seconds, and at least
 * 1.5 s apart so the speaker stays on screen between them.
 */
export function placeBroll(words: Word[], ranges: EditRange[], scenes: Array<{ id: string; startWordId: string; sourceStart: number; sourceEnd: number; image?: string }>, duration: number) {
  const index = new Map(words.map((word, i) => [word.id, i]));
  const placed: Array<{ id: string; image: string; start: number; end: number }> = [];
  let lastEnd = 1.5; // keep the first 1.5 s (the hook) on the speaker
  for (const scene of [...scenes].sort((a, b) => a.sourceStart - b.sourceStart)) {
    if (!scene.image) continue;
    const first = index.get(scene.startWordId);
    if (first === undefined) continue;
    let at: number | undefined;
    for (let i = first; i < words.length && words[i].start <= scene.sourceEnd; i += 1) { at = editedTime(words, ranges, i); if (at !== undefined) break; }
    if (at === undefined) continue;
    const length = Math.min(2.6, Math.max(1.8, scene.sourceEnd - scene.sourceStart));
    const start = Math.max(lastEnd === 1.5 ? 1.5 : lastEnd + 1.5, Math.round((at - 0.2) * 100) / 100);
    const end = Math.round((start + length) * 100) / 100;
    if (end > duration - 1.5) break; // keep the closing call to action on the speaker
    placed.push({ id: scene.id, image: scene.image, start, end }); lastEnd = end;
  }
  return placed;
}

/** Run a Python helper; it prints one JSON line at the end. Progress lines go to onLine. */
export function runPython(pythonBin: string, script: string, args: string[], onLine?: (line: string) => void, signal?: AbortSignal) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(pythonBin, ['-I', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); for (const line of String(chunk).split('\n')) if (line.trim()) onLine?.(line.trim()); });
    child.stderr.on('data', (chunk) => { err += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${path.basename(script)} failed (${code}): ${err.slice(-800)}`));
      const last = out.trim().split('\n').reverse().find((line) => line.startsWith('{'));
      try { resolve(last ? JSON.parse(last) : {}); } catch { resolve({}); }
    });
  });
}

let captionBundle: Promise<string> | null = null;
/** Bundle the caption templates once per server start (bundling takes a few seconds; rendering reuses it). */
function captionServeUrl(workDir: string) {
  captionBundle ??= (async () => {
    const { bundle } = await import('@remotion/bundler');
    const outDir = path.join(os.tmpdir(), 'video-cleaner-caption-bundle');
    await fs.rm(outDir, { recursive: true, force: true });
    return bundle({
      entryPoint: CAPTIONS_ENTRY, publicDir: CAPTIONS_PUBLIC, outDir,
      webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, modules: [path.join(repoRoot, 'node_modules'), ...(config.resolve?.modules ?? [])] } }),
    });
  })().catch((error) => { captionBundle = null; throw error; });
  void workDir;
  return captionBundle;
}

/** Render the Glass Card caption band (1080x300, transparent VP9) for the whole edited video. */
export async function renderCaptionLayer(options: { phrases: CaptionPhrase[]; duration: number; outputPath: string; chromeBin?: string | null; workDir: string; onProgress?: (fraction: number) => void; signal?: AbortSignal }) {
  const serveUrl = await captionServeUrl(options.workDir);
  const { renderMedia, selectComposition, makeCancelSignal } = await import('@remotion/renderer');
  const inputProps = { phrases: options.phrases, size: 46, duration: options.duration };
  const browserExecutable = options.chromeBin || null;
  const composition = await selectComposition({ serveUrl, id: 'GlassCard', inputProps, browserExecutable });
  const { cancelSignal, cancel } = makeCancelSignal();
  options.signal?.addEventListener('abort', cancel, { once: true });
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'vp9', imageFormat: 'png', pixelFormat: 'yuva420p', outputLocation: options.outputPath,
    concurrency: 2, browserExecutable, muted: true, overwrite: true, cancelSignal, onProgress: ({ progress }) => options.onProgress?.(progress),
  });
  return options.outputPath;
}

/** Render the reel cover (1080x1920 JPEG) from a frame of the speaker and the headline text. */
export async function renderThumbnail(options: { framePath: string; faceX?: number; lines: string[]; label: string; badges: ThumbnailBadge[]; outputPath: string; chromeBin?: string | null; workDir: string }) {
  const serveUrl = await captionServeUrl(options.workDir);
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const image = `data:image/jpeg;base64,${(await fs.readFile(options.framePath)).toString('base64')}`;
  const inputProps = { image, lines: options.lines, label: options.label, badges: options.badges.slice(0, 2), faceX: options.faceX ?? 0.5 };
  const browserExecutable = options.chromeBin || null;
  const composition = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps, browserExecutable });
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await renderStill({ composition, serveUrl, inputProps, output: options.outputPath, imageFormat: 'jpeg', jpegQuality: 92, browserExecutable, overwrite: true });
  return options.outputPath;
}
