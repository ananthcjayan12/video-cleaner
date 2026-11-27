import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateGemini, generateWithAgentCli, type ImageProviderConfig } from './broll.js';
import { generateChatGptImages, type BrowserEngine } from './chatgpt-images.js';
import { recordUsage } from './usage.js';

/**
 * Pictures for a cinematic stick reel, made in ONE go: the set (a photo-real empty location the camera pans across)
 * and ONE sheet holding 6 real photos in a 2×3 grid with white gutters, which is then cut into separate photos.
 * Engines: ChatGPT in Chrome (owner's plan) → Codex image generation (same plan, no browser) → Gemini (API, opt-in).
 */

export type StickPicturesEngine = 'chatgpt' | 'codex' | 'gemini';
const REAL = 'Photorealistic, a real photograph: natural light, real materials and real skin texture, true-to-life colours, shot on a full-frame DSLR or a good phone camera, shallow depth of field where natural. Not an illustration, not 3D, not CGI, not cartoon. No text, no letters, no logos, no watermarks.';

const SCREEN = 'A real screen capture, pixel-sharp like an actual phone or computer screenshot: real app interface details (status bar with an IST time, battery, read ticks, timestamps, avatars as initials), crisp readable text exactly as written, natural UI spacing. Generic design with no real brand names or logos. Not a photo of a screen, not an illustration or mock-up.';
const ARTICLE = 'A real cropped editorial screenshot: like a screenshot of a news site or blog article (headline, byline, date, first lines, maybe a photo), or a photo of a printed page or handwritten note on real paper. Crisp, readable text exactly as written. Use only the made-up publication name given, never a real newspaper, website or logo.';
const INDIAN = 'Any people are Indian: Indian faces, skin tones, hair, clothing and surroundings, candid and natural, not models posing.';

export function setPicturePrompt(setPrompt: string) {
  return `${setPrompt.trim()}\n\nA vertical 2:3 photograph of an EMPTY, real Indian location (no people at all). Wide shot at eye level; the lower 40% is open floor where characters will stand; slightly dark, moody, cinematic light with practical lamps and window light. ${REAL}`;
}

export function sheetPicturePrompt(photoPrompts: string[], kinds: string[] = []) {
  const label = (kind?: string) => (kind === 'screenshot' ? 'SCREENSHOT' : kind === 'article' ? 'ARTICLE / NOTE' : 'PHOTO');
  const cells = photoPrompts.slice(0, 6).map((p, i) => `${i + 1}. [${label(kinds[i])}] ${p.trim()}`).join('\n');
  const used = new Set(photoPrompts.slice(0, 6).map((_, i) => kinds[i] ?? 'photo'));
  return `ONE vertical image laid out as a contact sheet: exactly 6 separate pictures in a grid of 2 columns × 3 rows, read left to right, top to bottom.
Between the cells and around the outside there must be thick, pure white (#FFFFFF) gutters, about 6% of the image width, perfectly straight, so each photo can be cut out cleanly. Every cell is the same size, filled edge to edge with its own picture, no borders, no rounded corners, no captions, no numbers. No cell may have a pure white background at its edges (screens use dark mode or a light grey / cream app background, paper is off-white), so the white gutters stay clearly separate.
The 6 pictures (each fills its own cell; they must look like 6 different REAL images collected from a phone, never like AI art):
${cells}
${used.has('photo') ? `PHOTO cells: ${REAL.replace(' No text, no letters, no logos, no watermarks.', ' No added text, logos or watermarks.')} ${INDIAN}\n` : ''}${used.has('screenshot') ? `SCREENSHOT cells: ${SCREEN} Crop to the part that matters so the text is large enough to read in its cell.\n` : ''}${used.has('article') ? `ARTICLE / NOTE cells: ${ARTICLE} Crop to the headline and first lines so they are large enough to read in its cell.\n` : ''}`;
}

function run(bin: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal });
    const chunks: Buffer[] = []; let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c) => { err += String(c); if (err.length > 50_000) err = err.slice(-20_000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim().split('\n').pop() || `${bin} exited ${code}`)); });
  });
}

/** Runs of "white" along one axis: index ranges where at least 97% of the line is near-white. */
function whiteRuns(isWhite: (i: number) => boolean, length: number, minRun: number) {
  const runs: Array<[number, number]> = []; let start = -1;
  for (let i = 0; i <= length; i++) {
    const white = i < length && isWhite(i);
    if (white && start < 0) start = i;
    if (!white && start >= 0) { if (i - start >= minRun) runs.push([start, i]); start = -1; }
  }
  return runs;
}

/** The content spans between white gutters, ignoring slivers. */
function spans(runs: Array<[number, number]>, length: number, minSize: number) {
  const out: Array<[number, number]> = []; let pos = 0;
  for (const [a, b] of [...runs, [length, length] as [number, number]]) { if (a - pos >= minSize) out.push([pos, a]); pos = b; }
  return out;
}

/** Cut a 2×3 sheet into separate photos by finding its white gutters; falls back to an even grid with a safe inset. */
export async function cutSheet(options: { ffmpeg: string; ffprobe: string; sheet: string; outDir: string; prefix: string; signal?: AbortSignal }): Promise<string[]> {
  const probe = JSON.parse((await run(options.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', options.sheet], 30_000, options.signal)).toString()) as { streams: Array<{ width: number; height: number }> };
  const { width: W, height: H } = probe.streams[0];
  const gray = await run(options.ffmpeg, ['-v', 'error', '-i', options.sheet, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], 60_000, options.signal); // W×H bytes (≈1.5 MB)
  const white = (v: number) => v >= 238;
  const colWhite = (x: number) => { let n = 0; for (let y = 0; y < H; y += 2) if (white(gray[y * W + x])) n++; return n >= (H / 2) * 0.97; };
  const rowWhite = (y: number) => { let n = 0; for (let x = 0; x < W; x += 2) if (white(gray[y * W + x])) n++; return n >= (W / 2) * 0.97; };
  let cols = spans(whiteRuns(colWhite, W, Math.max(4, W * 0.008)), W, W * 0.2);
  let rows = spans(whiteRuns(rowWhite, H, Math.max(4, H * 0.006)), H, H * 0.15);
  if (cols.length !== 2 || rows.length !== 3) {
    // Even grid with an inset that stays clear of thin or missing gutters.
    const inset = 0.05;
    cols = [0, 1].map((c) => [Math.round((c + inset) * W / 2), Math.round((c + 1 - inset) * W / 2)] as [number, number]);
    rows = [0, 1, 2].map((r) => [Math.round((r + inset) * H / 3), Math.round((r + 1 - inset) * H / 3)] as [number, number]);
  }
  await fs.mkdir(options.outDir, { recursive: true });
  const files: string[] = [];
  for (const [r, [y0, y1]] of rows.entries()) {
    for (const [c, [x0, x1]] of cols.entries()) {
      const pad = 3; // shave anti-aliased gutter edges
      const name = `${options.prefix}-${r * 2 + c + 1}.jpg`;
      await run(options.ffmpeg, ['-v', 'error', '-y', '-i', options.sheet, '-vf', `crop=${x1 - x0 - pad * 2}:${y1 - y0 - pad * 2}:${x0 + pad}:${y0 + pad},scale='min(1400,iw*2)':-2:flags=lanczos`, '-q:v', '3', path.join(options.outDir, name)], 60_000, options.signal);
      files.push(name);
    }
  }
  return files;
}

async function makeOne(engine: StickPicturesEngine, prompt: string, outPng: string, ctx: { config: ImageProviderConfig; browser: BrowserEngine; workDir: string; signal?: AbortSignal }) {
  if (engine === 'gemini') { await generateGemini(prompt, '9:16', ctx.config, outPng); await recordUsage({ kind: 'image', provider: 'gemini', model: ctx.config.geminiModel, images: 1, task: 'stick pictures' }); return; }
  if (engine === 'codex') { await generateWithAgentCli('codex-cli', prompt, ctx.config, ctx.workDir, outPng); await recordUsage({ kind: 'image', provider: 'codex-imagegen', images: 1, task: 'stick pictures' }); return; }
  throw new Error('use makeWithChatGpt');
}

/** Make the set and the photo sheet, cut the sheet, and return file names inside assetsDir. */
export async function makeStickPictures(options: {
  engine: StickPicturesEngine; assetsDir: string; workDir: string; setPrompt: string; photoPrompts: string[]; photoKinds?: string[];
  config: ImageProviderConfig; browser: BrowserEngine; ffmpeg: string; ffprobe: string;
  progress: (stage: string) => void; signal?: AbortSignal;
}): Promise<{ set?: string; photos: string[]; engineUsed: string; notes: string[] }> {
  await fs.mkdir(options.assetsDir, { recursive: true });
  const stamp = Date.now().toString(36);
  const setPng = path.join(options.assetsDir, `set-${stamp}.png`);
  const sheetPng = path.join(options.assetsDir, `sheet-${stamp}.png`);
  const wantSheet = options.photoPrompts.length >= 2;
  const setText = setPicturePrompt(options.setPrompt || 'A modern, tidy clinic interior');
  const sheetText = sheetPicturePrompt(options.photoPrompts, options.photoKinds);
  const notes: string[] = [];
  const ctx = { config: options.config, browser: options.browser, workDir: options.workDir, signal: options.signal };
  const have = async (file: string) => ((await fs.stat(file).catch(() => null))?.size ?? 0) > 50_000;
  const order: StickPicturesEngine[] = options.engine === 'chatgpt' ? ['chatgpt', 'codex'] : [options.engine];
  let engineUsed = '';
  for (const engine of order) {
    if (await have(setPng) && (!wantSheet || await have(sheetPng))) break;
    options.progress(engine === 'chatgpt' ? 'ChatGPT is making the set and the photo sheet…' : engine === 'codex' ? 'Codex is making the pictures (ChatGPT image model)…' : 'Gemini is making the pictures…');
    try {
      if (engine === 'chatgpt') {
        const requests = [
          ...(await have(setPng) ? [] : [{ id: 'set', prompt: setText, outputPath: setPng, aspect: '9:16' as const }]),
          ...(!wantSheet || await have(sheetPng) ? [] : [{ id: 'sheet', prompt: sheetText, outputPath: sheetPng, aspect: '9:16' as const }]),
        ];
        await generateChatGptImages({ engine: options.browser, workDir: options.workDir, requests, signal: options.signal, timeoutMs: 20 * 60_000 });
      } else {
        if (!await have(setPng)) await makeOne(engine, setText, setPng, ctx);
        if (wantSheet && !await have(sheetPng)) { options.progress('Making the photo sheet…'); await makeOne(engine, sheetText, sheetPng, ctx); }
      }
      engineUsed = engine;
    } catch (error) {
      if (options.signal?.aborted) throw new Error('Stopped.');
      notes.push(`${engine}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    }
  }
  const setOk = await have(setPng);
  const sheetOk = wantSheet && await have(sheetPng);
  if (!setOk && !sheetOk) throw new Error(`No pictures could be made. ${notes.join(' | ')}`);
  let set: string | undefined;
  if (setOk) {
    set = `set-${stamp}.jpg`;
    await run(options.ffmpeg, ['-v', 'error', '-y', '-i', setPng, '-vf', "scale='max(1720,iw)':-2:flags=lanczos", '-q:v', '3', path.join(options.assetsDir, set)], 60_000, options.signal);
  }
  const photos = sheetOk ? (options.progress('Cutting the photo sheet…'), await cutSheet({ ffmpeg: options.ffmpeg, ffprobe: options.ffprobe, sheet: sheetPng, outDir: options.assetsDir, prefix: `photo-${stamp}`, signal: options.signal })) : [];
  return { set, photos, engineUsed, notes };
}
