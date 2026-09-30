import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type MotionRenderInput = {
  /** Aborting stops the frame capture and encode. */
  signal?: AbortSignal;
  /** Directory that receives the generated Remotion project (Scene.tsx, index.tsx, meta.json). */
  sceneDir: string;
  code: string;
  props: Record<string, unknown>;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  outputPath: string;
  chromeBin?: string;
  ffmpegBin: string;
  onProgress?: (fraction: number) => void;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Generated scenes are written by a model, so only Remotion/React APIs are allowed and
// anything that touches the network, filesystem, process or dynamic code is rejected.
const ALLOWED_IMPORTS = new Set(['react', 'remotion', '@remotion/shapes', '@remotion/paths', '@remotion/noise', '@remotion/transitions', '@remotion/motion-blur', '@remotion/layout-utils']);
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\brequire\s*\(/, 'require()'], [/\bimport\s*\(/, 'dynamic import()'], [/\beval\s*\(/, 'eval()'], [/\bnew\s+Function\b/, 'new Function'],
  [/\bfetch\s*\(/, 'fetch()'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'], [/\bprocess\./, 'process'],
  [/\bchild_process\b/, 'child_process'], [/\blocalStorage\b|\bsessionStorage\b|\bdocument\.cookie\b/, 'browser storage'],
  [/\bMath\.random\s*\(/, 'Math.random() (non-deterministic across frames; use remotion random())'],
  [/\bDate\.now\s*\(|\bnew\s+Date\s*\(/, 'Date (non-deterministic across frames)'],
  [/<\s*(?:script|iframe)\b/i, 'script/iframe element'], [/url\(\s*['"]?\s*https?:/i, 'remote url()'], [/\bsrc\s*=\s*["']https?:/i, 'remote src'],
  [/@import\b/, 'CSS @import'],
];

/** Returns human-readable problems; an empty array means the source passes static safety checks. */
export function validateMotionCode(code: string): string[] {
  const issues: string[] = [];
  if (code.length < 200) issues.push('The component is too short to be a finished motion graphic.');
  if (code.length > 60_000) issues.push('The component is larger than 60,000 characters; simplify it.');
  if (!/export\s+default\b/.test(code)) issues.push('The file must `export default` the scene component.');
  if (!/useCurrentFrame\s*\(/.test(code)) issues.push('The scene must animate from useCurrentFrame().');
  for (const match of code.matchAll(/(?:import\s+(?:[^'"]*?\s+from\s+)?|from\s+)['"]([^'"]+)['"]/g)) {
    if (!ALLOWED_IMPORTS.has(match[1])) issues.push(`Import "${match[1]}" is not allowed. Allowed: ${[...ALLOWED_IMPORTS].join(', ')}.`);
  }
  for (const [pattern, label] of FORBIDDEN_PATTERNS) if (pattern.test(code)) issues.push(`Forbidden construct: ${label}.`);
  return issues;
}

// Capturing frames is CPU bound, so only a couple of graphics render at once; each gets a share of the cores.
// Waiting graphics (and the AI design step, which is network bound) do not hold a slot.
const MAX_PARALLEL_RENDERS = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4)));
let activeRenders = 0; const waiting: Array<() => void> = [];
async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_PARALLEL_RENDERS) await new Promise<void>((resolve) => waiting.push(resolve));
  activeRenders += 1;
  try { return await task(); } finally { activeRenders -= 1; waiting.shift()?.(); }
}

function encodeAlphaWebm(ffmpegBin: string, framesDir: string, fps: number, outputPath: string, signal?: AbortSignal) {
  // Remotion's own VP9 stitch uses libvpx's slowest preset (~30 s for 4 s of video); this is visually equivalent for flat graphics.
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-pattern_type', 'glob', '-i', path.join(framesDir, 'element-*.png'),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '22', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', outputPath];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'], signal }); let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg could not encode the motion graphic (${code}): ${stderr.slice(-800)}`)));
  });
}

/**
 * Bundle a generated scene with Remotion, capture transparent PNG frames in headless Chromium, then encode
 * them to a VP9 WebM with an alpha channel. Chromium comes from the user's installed Chrome when available.
 */
export async function renderMotionScene(input: MotionRenderInput): Promise<{ outputPath: string; frames: number }> {
  const issues = validateMotionCode(input.code);
  if (issues.length) throw new Error(`Generated motion graphic failed safety checks:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
  const frames = Math.max(1, Math.round(input.durationSeconds * input.fps));
  await fs.mkdir(input.sceneDir, { recursive: true });
  const entry = path.join(input.sceneDir, 'index.tsx');
  await fs.writeFile(path.join(input.sceneDir, 'Scene.tsx'), input.code);
  await fs.writeFile(entry, [
    "import React from 'react';",
    "import { Composition, registerRoot } from 'remotion';",
    "import Scene from './Scene';",
    `const meta = ${JSON.stringify({ width: input.width, height: input.height, fps: input.fps, durationInFrames: frames, props: input.props })};`,
    "const Root: React.FC = () => <Composition id=\"Scene\" component={Scene as React.ComponentType<any>} durationInFrames={meta.durationInFrames} fps={meta.fps} width={meta.width} height={meta.height} defaultProps={meta.props} />;",
    'registerRoot(Root);',
    '',
  ].join('\n'));

  return withRenderSlot(async () => {
    const [{ bundle }, { renderFrames, selectComposition, makeCancelSignal }] = await Promise.all([import('@remotion/bundler'), import('@remotion/renderer')]);
    const stopped = () => new Error('Render stopped');
    if (input.signal?.aborted) throw stopped();
    const { cancelSignal, cancel } = makeCancelSignal(); input.signal?.addEventListener('abort', cancel, { once: true });
    // Bundle inside the scene folder (not the OS temp dir, where every render would leave ~25 MB behind) and delete it afterwards.
    const bundleDir = path.join(input.sceneDir, 'bundle'); const framesDir = path.join(input.sceneDir, 'frames');
    await Promise.all([fs.rm(bundleDir, { recursive: true, force: true }), fs.rm(framesDir, { recursive: true, force: true })]);
    try {
      const serveUrl = await bundle({
        entryPoint: entry, outDir: bundleDir,
        webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, modules: [path.join(repoRoot, 'node_modules'), ...(config.resolve?.modules ?? [])] }, resolveLoader: { ...config.resolveLoader, modules: [path.join(repoRoot, 'node_modules'), ...(config.resolveLoader?.modules ?? [])] } }),
      });
      if (input.signal?.aborted) throw stopped();
      const browserExecutable = input.chromeBin || null;
      const composition = await selectComposition({ serveUrl, id: 'Scene', inputProps: input.props, browserExecutable });
      await renderFrames({
        composition, serveUrl, inputProps: input.props, browserExecutable, outputDir: framesDir, imageFormat: 'png', cancelSignal,
        concurrency: Math.max(2, Math.floor(os.cpus().length / MAX_PARALLEL_RENDERS)),
        onStart: () => undefined, onFrameUpdate: (rendered) => input.onProgress?.(0.9 * rendered / frames),
      });
      await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
      const partial = `${input.outputPath}.partial.webm`;
      await fs.rm(partial, { force: true });
      if (input.signal?.aborted) throw stopped();
      await encodeAlphaWebm(input.ffmpegBin, framesDir, input.fps, partial, input.signal);
      await fs.rename(partial, input.outputPath);
    } catch (error) { if (input.signal?.aborted) throw stopped(); throw error; } finally { input.signal?.removeEventListener('abort', cancel); await Promise.all([fs.rm(framesDir, { recursive: true, force: true }), fs.rm(bundleDir, { recursive: true, force: true })]); }
    input.onProgress?.(1);
    return { outputPath: input.outputPath, frames };
  });
}
