import type { PackLook } from './niche-packs.js';
import { captionStates } from './captions.js';
import { motionStates, type ReelGraphic } from './reel-motion.js';
import type { BrandTheme } from './brand-theme.js';
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
export type AutoStageId = 'audio' | 'transcribe' | 'clean' | 'review' | 'broll-plan' | 'broll-images' | 'edit' | 'motion' | 'captions' | 'compose' | 'package';
export type AutoStage = { id: AutoStageId; label: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; detail?: string; seconds?: number };
export type AutoJob = {
  state: 'running' | 'review' | 'completed' | 'failed' | 'stopped'; stages: AutoStage[]; startedAt: number; finishedAt?: number;
  /** While state is "review": the transcript and the current keep decision for the review screen. */
  review?: { words: Array<{ id: string; text: string; start: number; end: number }>; keepRanges: KeepRange[]; keptSeconds: number; sourceSeconds: number; notes?: string; redoing?: boolean; flags?: import('./claims.js').ClaimFlag[] };
  /** Set while waiting for another reel to finish rendering (this machine renders one at a time). */
  queuePosition?: number; resumed?: boolean;
  error?: string; outputPath?: string; previewUrl?: string; downloadUrl?: string; sourceSeconds?: number; finalSeconds?: number;
  options: AutoOptions; stopRequested?: boolean;
  /** Thumbnail and Instagram post caption, made after the reel (and remade from the review screen). */
  package?: ReelPackage;
  /** Engines the reel ran on, and what it cost (shown to the owner only). */
  profile?: import('./usage.js').EngineProfile; cost?: import('./usage.js').UsageSummary;
  /** The computer the last render step ran on ('hub' or a node id), so the next one goes where the files already are. */
  renderNode?: string;
  /** Only on a render computer: the one step the hub asked it to run. */
  only?: AutoStageId;
};
export type AutoOptions = { targetDurationSec?: number; imageProvider: 'gemini' | 'chatgpt'; broll: boolean; captions: boolean; review: boolean; thumbnail?: boolean; postCaption?: boolean;
  /** Where the render steps run: 'auto' (any free computer), 'hub' or a render computer's id; unset = the owner's default. */
  renderOn?: string };
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
  ['broll-images', 'Making B-roll images'], ['edit', 'Cutting, zoom and voice'], ['motion', 'Planning motion & sound'], ['captions', 'Rendering captions'], ['compose', 'Putting it together'], ['package', 'Thumbnail & post caption'],
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

/**
 * Render the Glass Card caption band (1080x300, transparent) for the whole edited video.
 * The card is still most of the time, so each distinct look is drawn once as a PNG (no video encode at all) and
 * outputPath gets an FFmpeg concat list that shows each image for as long as it holds. ~2-4x faster than VP9.
 */
export async function renderCaptionLayer(options: { look?: PackLook; phrases: CaptionPhrase[]; duration: number; outputPath: string; chromeBin?: string | null; workDir: string; onProgress?: (fraction: number) => void; signal?: AbortSignal }) {
  const serveUrl = await captionServeUrl(options.workDir);
  const { renderFrames, selectComposition, makeCancelSignal } = await import('@remotion/renderer');
  const fps = 30;
  const { times, runs } = captionStates(options.phrases, options.duration, fps);
  const inputProps = { phrases: options.phrases, size: 46, font: options.look?.font, keyColor: options.look?.highlight, frameTimes: times };
  const browserExecutable = options.chromeBin || null;
  const composition = await selectComposition({ serveUrl, id: 'GlassCardStates', inputProps, browserExecutable });
  const { cancelSignal, cancel } = makeCancelSignal();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const framesDir = options.outputPath.replace(/\.txt$/, '') + '-frames';
  await fs.rm(framesDir, { recursive: true, force: true }); await fs.mkdir(framesDir, { recursive: true });
  await renderFrames({
    composition, serveUrl, inputProps, imageFormat: 'png', outputDir: framesDir, imageSequencePattern: 'state-[frame].[ext]',
    concurrency: Math.max(2, Math.min(4, os.cpus().length)), browserExecutable, cancelSignal, muted: true,
    onStart: () => undefined, onFrameUpdate: (done) => options.onProgress?.(done / times.length),
  });
  const files = (await fs.readdir(framesDir)).filter((name) => name.endsWith('.png')).sort();
  if (files.length !== times.length) throw new Error(`Caption render made ${files.length} of ${times.length} images`);
  // Concat list: each run of identical frames is one image with its duration; the last entry is repeated (FFmpeg rule).
  const lines = ['ffconcat version 1.0'];
  for (const run of runs) lines.push(`file '${path.join(framesDir, files[run.state]).replace(/'/g, "'\\''")}'`, `duration ${(run.frames / fps).toFixed(6)}`);
  lines.push(`file '${path.join(framesDir, files[runs.at(-1)!.state]).replace(/'/g, "'\\''")}'`);
  await fs.writeFile(options.outputPath, lines.join('\n') + '\n');
  return options.outputPath;
}

/**
 * The motion layer (brand graphics, punch boxes, comment sticker, split-screen frames, watermark) as a timed list of
 * full-frame transparent PNGs, drawn once per distinct look (see motionStates in reel-motion.ts). Returns null when
 * there is nothing to show. Split-screen pictures are shrunk to small JPEGs first: every frame render gets the props.
 */
export async function renderMotionLayer(options: { theme: BrandTheme; graphics: ReelGraphic[]; duration: number; outputPath: string; chromeBin?: string | null; workDir: string; ffmpegBin: string; onProgress?: (fraction: number) => void }) {
  if (!options.graphics.length) return null;
  const graphics = await Promise.all(options.graphics.map(async (graphic) => {
    if (graphic.kind !== 'split' || typeof graphic.pictureFile !== 'string') return graphic;
    const small = path.join(options.workDir, `split-${path.basename(graphic.pictureFile).replace(/\.[^.]+$/, '')}.jpg`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.ffmpegBin, ['-hide_banner', '-v', 'error', '-y', '-i', graphic.pictureFile as string, '-vf', 'scale=1080:-2', '-q:v', '4', '-frames:v', '1', small], { stdio: 'ignore' });
      child.on('error', reject); child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Could not shrink ${graphic.pictureFile}`))));
    });
    const { pictureFile: _file, ...rest } = graphic;
    return { ...rest, picture: `data:image/jpeg;base64,${(await fs.readFile(small)).toString('base64')}` };
  }));
  const serveUrl = await captionServeUrl(options.workDir);
  const { renderFrames, selectComposition } = await import('@remotion/renderer');
  const fps = 30;
  const { times, runs } = motionStates(options.graphics, options.duration, fps);
  const inputProps = { graphics, frameTimes: times, theme: options.theme };
  const browserExecutable = options.chromeBin || null;
  const composition = await selectComposition({ serveUrl, id: 'ReelGraphicsStates', inputProps, browserExecutable });
  const framesDir = options.outputPath.replace(/\.txt$/, '') + '-frames';
  await fs.rm(framesDir, { recursive: true, force: true }); await fs.mkdir(framesDir, { recursive: true });
  await renderFrames({
    composition, serveUrl, inputProps, imageFormat: 'png', outputDir: framesDir, imageSequencePattern: 'state-[frame].[ext]',
    concurrency: Math.max(2, Math.min(4, os.cpus().length)), browserExecutable, muted: true,
    onStart: () => undefined, onFrameUpdate: (done) => options.onProgress?.(done / times.length),
  });
  const files = (await fs.readdir(framesDir)).filter((name) => name.endsWith('.png')).sort();
  if (files.length !== times.length) throw new Error(`Motion layer render made ${files.length} of ${times.length} images`);
  const lines = ['ffconcat version 1.0'];
  for (const run of runs) lines.push(`file '${path.join(framesDir, files[run.state]).replace(/'/g, "'\\''")}'`, `duration ${(run.frames / fps).toFixed(6)}`);
  lines.push(`file '${path.join(framesDir, files[runs.at(-1)!.state]).replace(/'/g, "'\\''")}'`);
  await fs.writeFile(options.outputPath, lines.join('\n') + '\n');
  return options.outputPath;
}

/** Bundle the caption templates in the background at startup, so the first cover edit does not wait for it. */
export function warmCaptionRenderer(workDir: string) { void captionServeUrl(workDir).catch(() => undefined); }

// One Chrome kept open for cover renders (opening a new one costs a second or two per save); closed after a quiet spell.
let stillBrowser: Promise<any> | null = null; let stillBrowserTimer: NodeJS.Timeout | undefined;
async function coverBrowser(chromeBin: string | null) {
  const { openBrowser } = await import('@remotion/renderer');
  stillBrowser ??= openBrowser('chrome', { browserExecutable: chromeBin }).catch((error) => { stillBrowser = null; throw error; });
  clearTimeout(stillBrowserTimer);
  stillBrowserTimer = setTimeout(() => { const open = stillBrowser; stillBrowser = null; void open?.then((b) => b.close({ silent: true })).catch(() => undefined); }, 5 * 60_000);
  stillBrowserTimer.unref();
  return stillBrowser;
}

/**
 * A small copy of the finished reel for watching on the phone (720p, ~2 Mbps, starts playing at once).
 * The full-quality file is still what "Save video" downloads.
 */
export function makePreviewVideo(ffmpegBin: string, input: string, output: string, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const args = ['-hide_banner', '-v', 'error', '-y', '-i', input, '-vf', "scale='if(gt(iw,ih),1280,720)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27',
      '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let err = ''; child.stderr.on('data', (chunk) => { err += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`Preview encode failed (${code}): ${err.slice(-300)}`)));
  });
}

/** Render the reel cover (1080x1920 JPEG) from a frame of the speaker and the headline text. */
export async function renderThumbnail(options: { look?: PackLook; framePath: string; faceX?: number; lines: string[]; label: string; badges: ThumbnailBadge[]; outputPath: string; chromeBin?: string | null; workDir: string }) {
  const serveUrl = await captionServeUrl(options.workDir);
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const image = `data:image/jpeg;base64,${(await fs.readFile(options.framePath)).toString('base64')}`;
  const inputProps = { image, lines: options.lines, label: options.label, badges: options.badges.slice(0, 2), faceX: options.faceX ?? 0.5, font: options.look?.font, accent: options.look?.accent, onAccent: options.look?.onAccent, highlight: options.look?.coverHighlight };
  const browserExecutable = options.chromeBin || null;
  const puppeteerInstance = await coverBrowser(browserExecutable).catch(() => undefined);
  const composition = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps, browserExecutable, puppeteerInstance });
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await renderStill({ composition, serveUrl, inputProps, output: options.outputPath, imageFormat: 'jpeg', jpegQuality: 92, browserExecutable, overwrite: true, puppeteerInstance });
  return options.outputPath;
}
