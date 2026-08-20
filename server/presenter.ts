import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type PresenterMatteStatus = {
  ready: boolean;
  stale: boolean;
  maskPath?: string;
  generatedAt?: string;
  analysisSource?: 'scene-windows' | 'full-segment';
  processedSeconds?: number;
  sourceSeconds?: number;
  fps?: number;
};

export type MattingSystemStatus = {
  configured: boolean;
  pythonInstalled: boolean;
  dependenciesInstalled: boolean;
  pythonPath: string | null;
  detail: string;
};

type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };
type MatteWindow = { start: number; end: number; duration: number };
type MatteSpec = {
  fps: number;
  sourceDuration: number;
  width: number;
  height: number;
  windows: MatteWindow[];
  fingerprint: string;
};

const SELFIE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const SELFIE_MODEL_SHA256 = '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b';
const MATTE_PIPELINE_VERSION = 3;
const MATTE_PREROLL_SECONDS = 0.35;
const MATTE_POSTROLL_SECONDS = 0.20;

async function run(command: string, args: string[], timeoutMs = 0, options?: RunOptions) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, cwd: options?.cwd, env: options?.env });
    let stdout = ''; let stderr = ''; let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`));
    });
  });
}

async function commandPath(name: string) {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [name], 3000);
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  } catch {
    return '';
  }
}

export async function resolvePythonBin() {
  if (process.env.PYTHON_BIN?.trim()) return process.env.PYTHON_BIN.trim();
  return await commandPath('python3') || await commandPath('python') || '';
}

export async function mattingSystemStatus(ffmpegBin: string): Promise<MattingSystemStatus> {
  const pythonBin = await resolvePythonBin();
  if (!pythonBin) return { configured: false, pythonInstalled: false, dependenciesInstalled: false, pythonPath: null, detail: 'Python 3 not detected' };
  try {
    await run(pythonBin, ['-c', 'import cv2, numpy, mediapipe; assert hasattr(mediapipe, "solutions") or hasattr(mediapipe, "tasks"); print("ok")'], 10000);
    return {
      configured: Boolean(ffmpegBin),
      pythonInstalled: true,
      dependenciesInstalled: true,
      pythonPath: pythonBin,
      detail: ffmpegBin ? 'MediaPipe presenter cutout ready · scene-window HQ matte' : 'FFmpeg is required for presenter cutout',
    };
  } catch {
    return {
      configured: false,
      pythonInstalled: true,
      dependenciesInstalled: false,
      pythonPath: pythonBin,
      detail: 'Install: python3 -m pip install -r requirements-matting.txt',
    };
  }
}

async function validSelfieModel(modelPath: string) {
  const contents = await fs.readFile(modelPath).catch(() => null);
  return Boolean(contents && contents.byteLength > 100_000 && createHash('sha256').update(contents).digest('hex') === SELFIE_MODEL_SHA256);
}

async function usableModelFile(modelPath: string) {
  const stat = await fs.stat(modelPath).catch(() => null);
  return Boolean(stat?.isFile() && stat.size > 10_000);
}

async function resolveSelfieModel(pythonBin: string) {
  const { stdout } = await run(pythonBin, ['-c', 'import mediapipe as mp; print("legacy" if hasattr(mp, "solutions") else "tasks")'], 10000);
  if (stdout.trim() === 'legacy') return '';

  const override = process.env.MEDIAPIPE_SELFIE_MODEL?.trim();
  if (override) {
    const resolved = path.resolve(override);
    if (!await usableModelFile(resolved)) throw new Error(`MEDIAPIPE_SELFIE_MODEL is missing or invalid: ${resolved}`);
    return resolved;
  }

  const modelDir = path.join(os.homedir(), '.video-cleaner', 'models');
  const modelPath = path.join(modelDir, 'selfie_segmenter.tflite');
  if (await validSelfieModel(modelPath)) return modelPath;

  await fs.mkdir(modelDir, { recursive: true });
  const response = await fetch(SELFIE_MODEL_URL);
  if (!response.ok) throw new Error(`Could not download the MediaPipe selfie model (${response.status}). Set MEDIAPIPE_SELFIE_MODEL to a local selfie_segmenter.tflite file.`);
  const contents = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(contents).digest('hex') !== SELFIE_MODEL_SHA256) throw new Error('Downloaded MediaPipe selfie model failed its integrity check');
  const temporaryPath = `${modelPath}.${process.pid}.download`;
  await fs.writeFile(temporaryPath, contents);
  await fs.rename(temporaryPath, modelPath);
  return modelPath;
}

function matteDir(workDir: string) { return path.join(workDir, 'presenter'); }
export function presenterMaskPath(workDir: string) { return path.join(matteDir(workDir), 'presenter-mask.mkv'); }
function matteMetaPath(workDir: string) { return path.join(matteDir(workDir), 'presenter-matte.json'); }
function windowCacheDir(workDir: string) { return path.join(matteDir(workDir), 'window-cache'); }

async function fileSignature(filePath: string) {
  const stat = await fs.stat(filePath);
  return { path: filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

async function readMeta(workDir: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(matteMetaPath(workDir), 'utf8')); } catch { return null; }
}

function normalFps(value: unknown) {
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps < 1) return 30;
  // Social/iPhone masters are normally 24/25/30/50/60. Preserve native timing up to 60fps;
  // very high-frame-rate capture is capped because the talking-head output is not intended as slow motion.
  return Math.min(60, fps);
}

function even(value: number) { const rounded = Math.max(2, Math.round(value)); return rounded % 2 === 0 ? rounded : rounded - 1; }
function segmentationSize(width?: number, height?: number) {
  const w = Math.max(1, width || 1080); const h = Math.max(1, height || 1920); const shortEdge = Math.min(w, h);
  const scale = Math.min(1, 1080 / shortEdge);
  return { width: even(w * scale), height: even(h * scale) };
}

function templateNeedsPresenter(template: unknown) {
  return template === 'top-card-presenter' || template === 'presenter-overlay' || template === 'stacked-cards-cutout';
}

function snapDown(value: number, fps: number) { return Math.max(0, Math.floor(value * fps + 1e-7) / fps); }
function snapUp(value: number, fps: number) { return Math.max(0, Math.ceil(value * fps - 1e-7) / fps); }

function mergeWindows(raw: Array<{ start: number; end: number }>, fps: number, sourceDuration: number) {
  const padded = raw.map((range) => ({
    start: snapDown(Math.max(0, range.start - MATTE_PREROLL_SECONDS), fps),
    end: snapUp(Math.min(sourceDuration, range.end + MATTE_POSTROLL_SECONDS), fps),
  })).filter((range) => range.end - range.start >= 1 / fps).sort((a, b) => a.start - b.start);
  const merged: MatteWindow[] = [];
  for (const range of padded) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1 / fps) {
      previous.end = Math.max(previous.end, range.end); previous.duration = previous.end - previous.start;
    } else merged.push({ ...range, duration: range.end - range.start });
  }
  return merged;
}

async function projectMatteSpec(workDir: string): Promise<MatteSpec | null> {
  try {
    const [project, plan] = await Promise.all([
      fs.readFile(path.join(workDir, 'project.json'), 'utf8').then((value) => JSON.parse(value)),
      fs.readFile(path.join(workDir, 'broll-plan.json'), 'utf8').then((value) => JSON.parse(value)),
    ]);
    const fps = normalFps(project?.media?.frameRate); const sourceDuration = Math.max(0, Number(project?.media?.duration) || 0); const width = Math.max(2, Number(project?.media?.width) || 1080); const height = Math.max(2, Number(project?.media?.height) || 1920);
    if (!sourceDuration) return null;
    const defaultTemplate = plan?.settings?.displayTemplate || 'full-frame';
    const scenes = (Array.isArray(plan?.scenes) ? plan.scenes : []).filter((scene: any) => scene?.enabled && (scene?.imageFile || scene?.videoFile) && templateNeedsPresenter(scene?.displayTemplate || defaultTemplate));
    if (!scenes.length) return null;
    const windows = mergeWindows(scenes.map((scene: any) => ({ start: Number(scene.sourceStart) || 0, end: Number(scene.sourceEnd) || 0 })), fps, sourceDuration);
    const sceneSignature = scenes.map((scene: any) => ({ id: String(scene.id), start: Number(scene.sourceStart), end: Number(scene.sourceEnd), template: scene.displayTemplate || defaultTemplate }));
    const fingerprint = createHash('sha256').update(JSON.stringify({ pipeline: MATTE_PIPELINE_VERSION, fps, sourceDuration, width, height, sceneSignature, windows })).digest('hex').slice(0, 24);
    return { fps, sourceDuration, width, height, windows, fingerprint };
  } catch { return null; }
}

export async function presenterMatteStatus(workDir: string, sourcePath: string): Promise<PresenterMatteStatus> {
  const maskPath = presenterMaskPath(workDir);
  const [maskStat, meta, sourceStat, spec] = await Promise.all([
    fs.stat(maskPath).catch(() => null),
    readMeta(workDir),
    fs.stat(sourcePath).catch(() => null),
    projectMatteSpec(workDir),
  ]);
  if (!maskStat?.isFile() || maskStat.size < 10_000 || !meta || !sourceStat?.isFile()) return { ready: false, stale: false };
  const signature = meta.sourceSignature ?? {};
  const sourceStale = signature.path !== sourcePath || Number(signature.size) !== sourceStat.size || Number(signature.mtimeMs) !== Math.round(sourceStat.mtimeMs);
  const pipelineStale = Number(meta.version) !== MATTE_PIPELINE_VERSION;
  const planStale = Boolean(spec && meta.fingerprint !== spec.fingerprint);
  const stale = sourceStale || pipelineStale || planStale;
  return {
    ready: !stale,
    stale,
    maskPath: !stale ? maskPath : undefined,
    generatedAt: meta.generatedAt,
    analysisSource: meta.analysisSource,
    processedSeconds: Number(meta.processedSeconds) || undefined,
    sourceSeconds: Number(meta.sourceSeconds) || undefined,
    fps: Number(meta.fps) || undefined,
  };
}

async function runMatteScript(options: { pythonBin: string; inputPath: string; outputPath: string; ffmpegBin: string; modelPath: string }) {
  const scriptPath = path.resolve('server', 'presenter_matte.py');
  await fs.rm(options.outputPath, { force: true });
  await run(options.pythonBin, [
    scriptPath,
    '--input', options.inputPath,
    '--output', options.outputPath,
    '--ffmpeg', options.ffmpegBin,
    ...(options.modelPath ? ['--model', options.modelPath] : []),
    '--feather', '3',
    '--choke', '1.0',
    '--temporal', '0.10',
  ], 7_200_000, { cwd: path.resolve('.') });
  const stat = await fs.stat(options.outputPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10_000) throw new Error('Presenter matte generation finished without a usable mask video');
  await run(options.ffmpegBin, ['-v', 'error', '-i', options.outputPath, '-f', 'null', '-'], 120000);
}

async function makeAnalysisWindow(options: { sourcePath: string; outputPath: string; start: number; duration: number; width: number; height: number; fps: number; ffmpegBin: string }) {
  await fs.rm(options.outputPath, { force: true });
  await run(options.ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', options.start.toFixed(6), '-t', options.duration.toFixed(6), '-i', options.sourcePath,
    '-vf', `scale=${options.width}:${options.height}:flags=lanczos,fps=${options.fps.toFixed(6)},format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-movflags', '+faststart', options.outputPath,
  ], 7_200_000);
}

async function assembleSparseMask(options: { workDir: string; windows: Array<MatteWindow & { maskPath: string }>; outputPath: string; width: number; height: number; fps: number; sourceDuration: number; ffmpegBin: string }) {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const window of options.windows) args.push('-i', window.maskPath);
  const parts: string[] = []; const labels: string[] = []; let cursor = 0; let gapIndex = 0;
  const addGap = (duration: number) => {
    if (duration < 0.5 / options.fps) return;
    const label = `gap${gapIndex++}`; parts.push(`color=c=black:s=${options.width}x${options.height}:r=${options.fps.toFixed(6)}:d=${duration.toFixed(6)},format=gray[${label}]`); labels.push(label);
  };
  options.windows.forEach((window, index) => {
    addGap(Math.max(0, window.start - cursor));
    const label = `window${index}`; parts.push(`[${index}:v]fps=${options.fps.toFixed(6)},scale=${options.width}:${options.height}:flags=neighbor,format=gray,trim=duration=${window.duration.toFixed(6)},setpts=PTS-STARTPTS[${label}]`); labels.push(label); cursor = window.end;
  });
  addGap(Math.max(0, options.sourceDuration - cursor));
  if (!labels.length) throw new Error('No presenter matte windows were produced');
  if (labels.length === 1) parts.push(`[${labels[0]}]setpts=PTS-STARTPTS[maskout]`);
  else parts.push(`${labels.map((label) => `[${label}]`).join('')}concat=n=${labels.length}:v=1:a=0,setpts=PTS-STARTPTS[maskout]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[maskout]', '-an', '-c:v', 'ffv1', '-level', '3', '-g', '1', '-pix_fmt', 'gray', options.outputPath);
  await fs.rm(options.outputPath, { force: true }); await run(options.ffmpegBin, args, 7_200_000);
}

async function ensureSceneWindowMatte(options: { workDir: string; sourcePath: string; ffmpegBin: string; pythonBin: string; modelPath: string; spec: MatteSpec }) {
  const size = segmentationSize(options.spec.width, options.spec.height); const cacheDir = windowCacheDir(options.workDir); await fs.mkdir(cacheDir, { recursive: true });
  const processed: Array<MatteWindow & { maskPath: string }> = [];
  for (const window of options.spec.windows) {
    const frameStart = Math.round(window.start * options.spec.fps); const frameEnd = Math.round(window.end * options.spec.fps); const key = `${frameStart}-${frameEnd}-${size.width}x${size.height}-${options.spec.fps.toFixed(3).replace('.', '_')}`;
    const maskPath = path.join(cacheDir, `mask-${key}.mkv`); const existing = await fs.stat(maskPath).catch(() => null);
    if (!existing?.isFile() || existing.size < 10_000) {
      const analysisPath = path.join(cacheDir, `analysis-${key}.mp4`);
      await makeAnalysisWindow({ sourcePath: options.sourcePath, outputPath: analysisPath, start: window.start, duration: window.duration, width: size.width, height: size.height, fps: options.spec.fps, ffmpegBin: options.ffmpegBin });
      try { await runMatteScript({ pythonBin: options.pythonBin, inputPath: analysisPath, outputPath: maskPath, ffmpegBin: options.ffmpegBin, modelPath: options.modelPath }); }
      finally { await fs.rm(analysisPath, { force: true }); }
    }
    processed.push({ ...window, maskPath });
  }
  const finalMaskPath = presenterMaskPath(options.workDir);
  await assembleSparseMask({ workDir: options.workDir, windows: processed, outputPath: finalMaskPath, width: size.width, height: size.height, fps: options.spec.fps, sourceDuration: options.spec.sourceDuration, ffmpegBin: options.ffmpegBin });
  return { finalMaskPath, size, processed };
}

export async function ensurePresenterMatte(options: {
  workDir: string;
  sourcePath: string;
  proxyPath?: string;
  width?: number;
  height?: number;
  ffmpegBin: string;
}) {
  const existing = await presenterMatteStatus(options.workDir, options.sourcePath);
  if (existing.ready && existing.maskPath) return existing;
  const system = await mattingSystemStatus(options.ffmpegBin);
  if (!system.configured || !system.pythonPath) throw new Error(system.detail);

  const dir = matteDir(options.workDir); await fs.mkdir(dir, { recursive: true });
  const modelPath = await resolveSelfieModel(system.pythonPath); const spec = await projectMatteSpec(options.workDir);
  let maskPath: string; let analysisSource: PresenterMatteStatus['analysisSource']; let processedSeconds: number; let sourceSeconds: number; let fps: number; let fingerprint: string; let dimensions: { width: number; height: number };

  if (spec?.windows.length) {
    const result = await ensureSceneWindowMatte({ workDir: options.workDir, sourcePath: options.sourcePath, ffmpegBin: options.ffmpegBin, pythonBin: system.pythonPath, modelPath, spec });
    maskPath = result.finalMaskPath; analysisSource = 'scene-windows'; processedSeconds = spec.windows.reduce((sum, window) => sum + window.duration, 0); sourceSeconds = spec.sourceDuration; fps = spec.fps; fingerprint = spec.fingerprint; dimensions = result.size;
  } else {
    // Scene preview calls pass a short already-trimmed source and have no project/plan manifest.
    // Process that short clip directly rather than falling back to a low-resolution project proxy.
    maskPath = presenterMaskPath(options.workDir); await runMatteScript({ pythonBin: system.pythonPath, inputPath: options.sourcePath, outputPath: maskPath, ffmpegBin: options.ffmpegBin, modelPath });
    analysisSource = 'full-segment'; processedSeconds = 0; sourceSeconds = 0; fps = 0; fingerprint = 'full-segment'; dimensions = { width: options.width || 0, height: options.height || 0 };
  }

  const stat = await fs.stat(maskPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10_000) throw new Error('Presenter matte generation finished without a usable mask video');
  const meta = {
    version: MATTE_PIPELINE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSignature: await fileSignature(options.sourcePath),
    fingerprint,
    analysisSource,
    processedSeconds,
    sourceSeconds,
    fps,
    dimensions,
    maskPath,
    quality: { maxShortEdge: 1080, losslessMask: true, codec: 'ffv1', featherPx: 3, chokePx: 1.0, temporalBlend: 0.10, motionAwareTemporal: true, preRollSeconds: MATTE_PREROLL_SECONDS, postRollSeconds: MATTE_POSTROLL_SECONDS },
    note: 'Scene-windowed lossless alpha-only presenter mask. Final render applies this mask to the untouched source master.',
  };
  await fs.writeFile(matteMetaPath(options.workDir), `${JSON.stringify(meta, null, 2)}\n`);
  return { ready: true, stale: false, maskPath, generatedAt: meta.generatedAt, analysisSource, processedSeconds: processedSeconds || undefined, sourceSeconds: sourceSeconds || undefined, fps: fps || undefined } satisfies PresenterMatteStatus;
}
