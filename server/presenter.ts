import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export type PresenterMatteStatus = {
  ready: boolean;
  stale: boolean;
  maskPath?: string;
  generatedAt?: string;
  analysisSource?: 'proxy' | 'generated-proxy';
};

export type MattingSystemStatus = {
  configured: boolean;
  pythonInstalled: boolean;
  dependenciesInstalled: boolean;
  pythonPath: string | null;
  detail: string;
};

type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };

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
    await run(pythonBin, ['-c', 'import cv2, numpy, mediapipe; print("ok")'], 10000);
    return {
      configured: Boolean(ffmpegBin),
      pythonInstalled: true,
      dependenciesInstalled: true,
      pythonPath: pythonBin,
      detail: ffmpegBin ? 'MediaPipe presenter cutout ready' : 'FFmpeg is required for presenter cutout',
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

function matteDir(workDir: string) { return path.join(workDir, 'presenter'); }
export function presenterMaskPath(workDir: string) { return path.join(matteDir(workDir), 'presenter-mask.mp4'); }
function matteMetaPath(workDir: string) { return path.join(matteDir(workDir), 'presenter-matte.json'); }

async function fileSignature(filePath: string) {
  const stat = await fs.stat(filePath);
  return { path: filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

async function readMeta(workDir: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(matteMetaPath(workDir), 'utf8')); } catch { return null; }
}

export async function presenterMatteStatus(workDir: string, sourcePath: string): Promise<PresenterMatteStatus> {
  const maskPath = presenterMaskPath(workDir);
  const [maskStat, meta, sourceStat] = await Promise.all([
    fs.stat(maskPath).catch(() => null),
    readMeta(workDir),
    fs.stat(sourcePath).catch(() => null),
  ]);
  if (!maskStat?.isFile() || maskStat.size < 10_000 || !meta || !sourceStat?.isFile()) return { ready: false, stale: false };
  const signature = meta.sourceSignature ?? {};
  const stale = signature.path !== sourcePath || Number(signature.size) !== sourceStat.size || Number(signature.mtimeMs) !== Math.round(sourceStat.mtimeMs);
  return {
    ready: !stale,
    stale,
    maskPath: !stale ? maskPath : undefined,
    generatedAt: meta.generatedAt,
    analysisSource: meta.analysisSource,
  };
}

function even(value: number) { const rounded = Math.max(2, Math.round(value)); return rounded % 2 === 0 ? rounded : rounded - 1; }
function segmentationSize(width?: number, height?: number) {
  const w = Math.max(1, width || 1080); const h = Math.max(1, height || 1920); const longEdge = Math.min(1080, Math.max(w, h));
  if (w >= h) return { width: even(longEdge), height: even(longEdge * h / w) };
  return { width: even(longEdge * w / h), height: even(longEdge) };
}

async function ensureAnalysisSource(options: { workDir: string; sourcePath: string; proxyPath?: string; width?: number; height?: number; ffmpegBin: string }) {
  if (options.proxyPath) {
    const stat = await fs.stat(options.proxyPath).catch(() => null);
    if (stat?.isFile()) return { path: options.proxyPath, kind: 'proxy' as const };
  }
  const dir = matteDir(options.workDir); await fs.mkdir(dir, { recursive: true });
  const analysisPath = path.join(dir, 'segmentation-input.mp4'); const size = segmentationSize(options.width, options.height);
  await run(options.ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', options.sourcePath,
    '-vf', `scale=${size.width}:${size.height}:flags=fast_bilinear,fps=30,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', analysisPath,
  ], 7_200_000);
  return { path: analysisPath, kind: 'generated-proxy' as const };
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
  const analysis = await ensureAnalysisSource(options); const maskPath = presenterMaskPath(options.workDir);
  await fs.rm(maskPath, { force: true });
  const scriptPath = path.resolve('server', 'presenter_matte.py');
  await run(system.pythonPath, [
    scriptPath,
    '--input', analysis.path,
    '--output', maskPath,
    '--ffmpeg', options.ffmpegBin,
    '--feather', '4',
    '--temporal', '0.12',
  ], 7_200_000, { cwd: path.resolve('.') });

  const stat = await fs.stat(maskPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10_000) throw new Error('Presenter matte generation finished without a usable mask video');
  await run(options.ffmpegBin, ['-v', 'error', '-i', maskPath, '-f', 'null', '-'], 120000);
  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceSignature: await fileSignature(options.sourcePath),
    analysisSource: analysis.kind,
    analysisPath: analysis.path,
    maskPath,
    note: 'Alpha-only presenter mask. Final render applies this mask to the untouched source master.',
  };
  await fs.writeFile(matteMetaPath(options.workDir), `${JSON.stringify(meta, null, 2)}\n`);
  return { ready: true, stale: false, maskPath, generatedAt: meta.generatedAt, analysisSource: analysis.kind } satisfies PresenterMatteStatus;
}
