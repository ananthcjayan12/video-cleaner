import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import dotenv from 'dotenv';
import {
  buildBrollOverlayFilter,
  createBrollPlan,
  generateBrollImage,
  loadBrollPlan,
  saveBrollPlan,
  updateBrollScene,
  type BrollPlan,
  type BrollPlanSettings,
  type ImageProvider,
} from './broll.js';

dotenv.config({ path: path.resolve('.env.local') });
dotenv.config({ path: path.resolve('.env') });

type Word = { id: string; text: string; start: number; end: number };
type KeepRange = { startWordId: string; endWordId: string; reason?: string };
type MediaProfile = {
  duration: number;
  size: number;
  width?: number;
  height?: number;
  frameRate?: number;
  bitRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  pixelFormat?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  colorSpace?: string;
  hdr: boolean;
};
type Project = {
  id: string;
  sourcePath: string;
  workDir: string;
  sourceName: string;
  proxyPath?: string;
  audioPath?: string;
  transcript?: { text: string; words: Word[] };
  edl?: { keepRanges: KeepRange[]; notes?: string[] };
  media: MediaProfile;
};
type LocalSettings = {
  elevenLabsApiKey?: string;
  openAiApiKey?: string;
  geminiApiKey?: string;
  imageProvider?: ImageProvider;
  openAiImageModel?: string;
  geminiImageModel?: string;
  grokModel?: string;
  codexBin?: string;
  grokBin?: string;
  ffmpegBin?: string;
  ffprobeBin?: string;
  projectsDir?: string;
};
type FfmpegCapabilities = {
  videoToolboxDecode: boolean;
  h264VideoToolbox: boolean;
  hevcVideoToolbox: boolean;
};
type ExportJob = {
  state: 'idle' | 'running' | 'completed' | 'failed';
  progress: number;
  outTime: string;
  speed: string;
  frame: number;
  outputPath?: string;
  encoder?: string;
  error?: string;
  startedAt?: number;
};

const CONFIG_DIR = path.join(os.homedir(), '.video-cleaner');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const app = express();
const projects = new Map<string, Project>();
const brollPlans = new Map<string, BrollPlan>();
const exportJobs = new Map<string, ExportJob>();
const capabilityCache = new Map<string, FfmpegCapabilities>();
let localSettings: LocalSettings = {};

app.use(express.json({ limit: '1mb' }));

const EDL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['keepRanges', 'notes'],
  properties: {
    keepRanges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startWordId', 'endWordId', 'reason'],
        properties: {
          startWordId: { type: 'string' },
          endWordId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

async function run(command: string, args: string[], stdin?: string, timeoutMs = 0) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
    }
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`));
    });
    child.stdin.end(stdin ?? '');
  });
}

async function loadSettings() {
  try {
    localSettings = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8')) as LocalSettings;
  } catch {
    localSettings = {};
  }
}

async function saveSettings() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(localSettings, null, 2), { mode: 0o600 });
}

async function detectBinary(name: string) {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await run(command, [name], undefined, 3000);
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  } catch {
    return '';
  }
}

function providerValue(value: unknown): ImageProvider {
  return ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(value)) ? value as ImageProvider : 'gemini';
}

async function resolvedSettings() {
  const codexOverride = localSettings.codexBin || process.env.CODEX_BIN || '';
  const grokOverride = localSettings.grokBin || process.env.GROK_BIN || '';
  const ffmpegOverride = localSettings.ffmpegBin || process.env.FFMPEG_BIN || '';
  const ffprobeOverride = localSettings.ffprobeBin || process.env.FFPROBE_BIN || '';
  return {
    elevenLabsApiKey: localSettings.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '',
    openAiApiKey: localSettings.openAiApiKey || process.env.OPENAI_API_KEY || '',
    geminiApiKey: localSettings.geminiApiKey || process.env.GEMINI_API_KEY || '',
    imageProvider: providerValue(localSettings.imageProvider || process.env.IMAGE_PROVIDER),
    openAiImageModel: localSettings.openAiImageModel || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    geminiImageModel: localSettings.geminiImageModel || process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    grokModel: localSettings.grokModel || process.env.GROK_IMAGE_MODEL || '',
    codexBin: codexOverride || await detectBinary('codex'),
    grokBin: grokOverride || await detectBinary('grok'),
    ffmpegBin: ffmpegOverride || await detectBinary('ffmpeg'),
    ffprobeBin: ffprobeOverride || await detectBinary('ffprobe'),
    projectsDir: localSettings.projectsDir || process.env.PROJECTS_DIR || path.join(os.homedir(), 'VideoCleaner', 'projects'),
  };
}

async function canRun(binary: string, args: string[]) {
  if (!binary) return false;
  try {
    await run(binary, args, undefined, 5000);
    return true;
  } catch {
    return false;
  }
}

async function ffmpegCapabilities(ffmpegBin: string): Promise<FfmpegCapabilities> {
  if (!ffmpegBin) return { videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false };
  const cached = capabilityCache.get(ffmpegBin);
  if (cached) return cached;
  try {
    const [encoders, hwaccels] = await Promise.all([
      run(ffmpegBin, ['-hide_banner', '-encoders'], undefined, 10000),
      run(ffmpegBin, ['-hide_banner', '-hwaccels'], undefined, 10000),
    ]);
    const result = {
      videoToolboxDecode: process.platform === 'darwin' && hwaccels.stdout.includes('videotoolbox'),
      h264VideoToolbox: process.platform === 'darwin' && encoders.stdout.includes('h264_videotoolbox'),
      hevcVideoToolbox: process.platform === 'darwin' && encoders.stdout.includes('hevc_videotoolbox'),
    };
    capabilityCache.set(ffmpegBin, result);
    return result;
  } catch {
    return { videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false };
  }
}

async function systemStatus() {
  const settings = await resolvedSettings();
  const [codexInstalled, grokInstalled, ffmpegInstalled, ffprobeInstalled] = await Promise.all([
    canRun(settings.codexBin, ['--version']),
    canRun(settings.grokBin, ['version']),
    canRun(settings.ffmpegBin, ['-version']),
    canRun(settings.ffprobeBin, ['-version']),
  ]);
  const [codexAuthenticated, capabilities] = await Promise.all([
    codexInstalled ? canRun(settings.codexBin, ['login', 'status']) : Promise.resolve(false),
    ffmpegInstalled ? ffmpegCapabilities(settings.ffmpegBin) : Promise.resolve({
      videoToolboxDecode: false,
      h264VideoToolbox: false,
      hevcVideoToolbox: false,
    }),
  ]);
  return {
    codex: { installed: codexInstalled, authenticated: codexAuthenticated, path: settings.codexBin || null },
    grok: { installed: grokInstalled, path: settings.grokBin || null, model: settings.grokModel || 'CLI default' },
    ffmpeg: { installed: ffmpegInstalled, path: settings.ffmpegBin || null, capabilities },
    ffprobe: { installed: ffprobeInstalled, path: settings.ffprobeBin || null },
    elevenLabs: { configured: Boolean(settings.elevenLabsApiKey) },
    imageProvider: settings.imageProvider,
    imageProviders: {
      openai: { configured: Boolean(settings.openAiApiKey), model: settings.openAiImageModel },
      gemini: { configured: Boolean(settings.geminiApiKey), model: settings.geminiImageModel },
      grokCli: { configured: grokInstalled, model: settings.grokModel || 'CLI default', experimental: true },
      codexCli: { configured: codexInstalled && codexAuthenticated, model: 'Codex CLI', experimental: true },
    },
    projectsDir: settings.projectsDir,
  };
}

async function pickNativeFile() {
  if (process.platform === 'darwin') {
    const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose file with prompt "Choose a talking-head video")']);
    return stdout.trim();
  }
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$d = New-Object System.Windows.Forms.OpenFileDialog;',
      '$d.Filter = "Video files|*.mov;*.mp4;*.m4v;*.webm|All files|*.*";',
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }',
    ].join(' ');
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]);
    return stdout.trim();
  }
  try {
    const { stdout } = await run('zenity', ['--file-selection', '--title=Choose a talking-head video', '--file-filter=Video | *.mov *.mp4 *.m4v *.webm']);
    return stdout.trim();
  } catch {
    throw new Error('No supported native file picker found. Install zenity or use macOS/Windows.');
  }
}

async function pickExportPath(defaultName = 'cleaned-video.mp4', prompt = 'Export video') {
  if (process.platform === 'darwin') {
    const script = `POSIX path of (choose file name with prompt ${JSON.stringify(prompt)} default name ${JSON.stringify(defaultName)})`;
    const { stdout } = await run('osascript', ['-e', script]);
    return stdout.trim();
  }
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$d = New-Object System.Windows.Forms.SaveFileDialog;',
      '$d.Filter = "MP4 video|*.mp4";',
      `$d.FileName = ${JSON.stringify(defaultName)};`,
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }',
    ].join(' ');
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]);
    return stdout.trim();
  }
  const { stdout } = await run('zenity', ['--file-selection', '--save', '--confirm-overwrite', `--filename=${defaultName}`]);
  return stdout.trim();
}

async function pickFolderPath() {
  if (process.platform === 'darwin') {
    const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose folder for B-roll assets")']);
    return stdout.trim();
  }
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
      'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }',
    ].join(' ');
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]);
    return stdout.trim();
  }
  const { stdout } = await run('zenity', ['--file-selection', '--directory', '--title=Choose folder for B-roll assets']);
  return stdout.trim();
}

function parseRate(value: unknown) {
  if (typeof value !== 'string' || !value) return 0;
  if (!value.includes('/')) return Number(value) || 0;
  const [numerator, denominator] = value.split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}

async function probe(sourcePath: string): Promise<MediaProfile> {
  const settings = await resolvedSettings();
  if (!settings.ffprobeBin) throw new Error('ffprobe was not found. Configure FFPROBE_BIN or install FFmpeg.');
  const { stdout } = await run(settings.ffprobeBin, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourcePath]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream: any) => stream.codec_type === 'video') ?? {};
  const audio = data.streams?.find((stream: any) => stream.codec_type === 'audio') ?? {};
  const rotation = Number(video.side_data_list?.find((item: any) => item.side_data_type === 'Display Matrix')?.rotation ?? video.tags?.rotate ?? 0);
  const swapsDisplayDimensions = Math.abs(rotation) % 180 === 90;
  const codedWidth = Number(video.width) || undefined;
  const codedHeight = Number(video.height) || undefined;
  const transfer = String(video.color_transfer ?? '').toLowerCase();
  const primaries = String(video.color_primaries ?? '').toLowerCase();
  const hdr = ['smpte2084', 'arib-std-b67'].includes(transfer) || primaries === 'bt2020';
  return {
    duration: Number(data.format?.duration ?? video.duration ?? 0),
    size: Number(data.format?.size ?? 0),
    width: swapsDisplayDimensions ? codedHeight : codedWidth,
    height: swapsDisplayDimensions ? codedWidth : codedHeight,
    frameRate: parseRate(video.avg_frame_rate || video.r_frame_rate),
    bitRate: Number(video.bit_rate ?? 0) || undefined,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    pixelFormat: video.pix_fmt,
    colorTransfer: video.color_transfer,
    colorPrimaries: video.color_primaries,
    colorSpace: video.color_space,
    hdr,
  };
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getProject(id: string) {
  const project = projects.get(id);
  if (!project) throw new Error('Project not found. Re-select the source video after restarting the local server.');
  return project;
}

async function saveProject(project: Project) {
  await fs.writeFile(path.join(project.workDir, 'project.json'), JSON.stringify(project, null, 2));
}

function serializeProject(project: Project) {
  return { id: project.id, sourceName: project.sourceName, media: project.media };
}

async function invalidateBroll(project: Project) {
  brollPlans.delete(project.id);
  await fs.rm(path.join(project.workDir, 'broll-plan.json'), { force: true });
}

function validateEdl(words: Word[], raw: any) {
  const index = new Map(words.map((word, i) => [word.id, i]));
  let previousEnd = -1;
  const ranges: KeepRange[] = [];
  for (const range of raw.keepRanges ?? []) {
    const start = index.get(range.startWordId);
    const end = index.get(range.endWordId);
    if (start === undefined || end === undefined || start > end) throw new Error('Invalid EDL word range');
    if (start <= previousEnd) throw new Error('EDL ranges overlap or are out of order');
    previousEnd = end;
    ranges.push({ startWordId: range.startWordId, endWordId: range.endWordId, reason: range.reason ?? '' });
  }
  if (!ranges.length) throw new Error('The edit removed the entire video');
  return { keepRanges: ranges, notes: Array.isArray(raw.notes) ? raw.notes : [] };
}

function rangesToSeconds(project: Project) {
  const words = project.transcript!.words;
  const index = new Map(words.map((word, i) => [word.id, i]));
  const seconds = project.edl!.keepRanges.map((range) => {
    const startWord = words[index.get(range.startWordId)!];
    const endWord = words[index.get(range.endWordId)!];
    return {
      start: Math.max(0, startWord.start - 0.08),
      end: Math.min(project.media.duration || Number.POSITIVE_INFINITY, endWord.end + 0.12),
    };
  });
  const merged: { start: number; end: number }[] = [];
  for (const segment of seconds) {
    const previous = merged.at(-1);
    if (previous && segment.start - previous.end < 0.2) previous.end = Math.max(previous.end, segment.end);
    else merged.push({ ...segment });
  }
  return merged;
}

function proxySize(media: MediaProfile, maxEdge = 720) {
  const width = media.width || 1280;
  const height = media.height || 720;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  if (width >= height) {
    const targetWidth = Math.min(maxEdge, width);
    return { width: even(targetWidth), height: even(height * targetWidth / width) };
  }
  const targetHeight = Math.min(maxEdge, height);
  return { width: even(width * targetHeight / height), height: even(targetHeight) };
}

async function ensureAnalysisAudio(project: Project) {
  if (project.audioPath) {
    const exists = await fs.stat(project.audioPath).catch(() => null);
    if (exists?.isFile()) return project.audioPath;
  }
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const audioPath = path.join(project.workDir, 'analysis.m4a');
  await run(settings.ffmpegBin, [
    '-hide_banner', '-y', '-i', project.sourcePath,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath,
  ]);
  project.audioPath = audioPath;
  await saveProject(project);
  return audioPath;
}

async function transcribeProject(project: Project) {
  if (project.transcript?.words.length) return project.transcript;
  const settings = await resolvedSettings();
  if (!settings.elevenLabsApiKey) throw new Error('ElevenLabs API key is not configured');
  const audioPath = await ensureAnalysisAudio(project);
  const bytes = await fs.readFile(audioPath);
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('timestamps_granularity', 'word');
  form.append('file', new Blob([bytes]), 'analysis.m4a');
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': settings.elevenLabsApiKey },
    body: form,
  });
  if (!response.ok) throw new Error(`ElevenLabs failed: ${response.status} ${await response.text()}`);
  const raw: any = await response.json();
  const words: Word[] = (raw.words ?? [])
    .filter((word: any) => word.type === 'word' && Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word: any, index: number) => ({
      id: `w${String(index + 1).padStart(6, '0')}`,
      text: word.text,
      start: word.start,
      end: word.end,
    }));
  if (!words.length) throw new Error('No timestamped words returned by ElevenLabs');
  project.transcript = { text: raw.text ?? words.map((word) => word.text).join(' '), words };
  project.edl = { keepRanges: [{ startWordId: words[0].id, endWordId: words.at(-1)!.id, reason: 'Original recording' }], notes: [] };
  await invalidateBroll(project);
  await Promise.all([
    fs.writeFile(path.join(project.workDir, 'transcript.json'), JSON.stringify(project.transcript, null, 2)),
    saveProject(project),
  ]);
  return project.transcript;
}

function defaultBitRate(media: MediaProfile, hevc: boolean) {
  const pixels = (media.width || 1920) * (media.height || 1080);
  const highFps = (media.frameRate || 30) > 35;
  if (pixels >= 3840 * 2000) return hevc ? (highFps ? 70_000_000 : 45_000_000) : (highFps ? 95_000_000 : 65_000_000);
  if (pixels >= 1920 * 1000) return hevc ? (highFps ? 25_000_000 : 16_000_000) : (highFps ? 35_000_000 : 22_000_000);
  return hevc ? 10_000_000 : 14_000_000;
}

function exportBitRate(media: MediaProfile, hevc: boolean, mode: 'fast' | 'quality') {
  const baseline = media.bitRate || defaultBitRate(media, hevc);
  const floor = defaultBitRate(media, hevc);
  const desired = mode === 'quality' ? Math.max(floor, baseline * 1.05) : Math.max(floor * 0.75, baseline * 0.78);
  return Math.min(140_000_000, Math.round(desired));
}

function formatBitRate(value: number) {
  return `${Math.max(1, Math.round(value / 1000))}k`;
}

function encodingArgs(project: Project, capabilities: FfmpegCapabilities, mode: 'fast' | 'quality') {
  const sourceCodec = String(project.media.videoCodec || '').toLowerCase();
  const useHevc = project.media.hdr || sourceCodec === 'hevc' || sourceCodec === 'h265';
  const hardware = useHevc ? capabilities.hevcVideoToolbox : capabilities.h264VideoToolbox;
  const targetBitRate = exportBitRate(project.media, useHevc, mode);
  if (hardware) {
    const encoder = useHevc ? 'hevc_videotoolbox' : 'h264_videotoolbox';
    return {
      encoder,
      hardware,
      targetBitRate,
      args: [
        '-c:v', encoder, '-realtime', '1', '-allow_sw', '1',
        ...(mode === 'fast' ? ['-prio_speed', '1'] : []),
        '-b:v', formatBitRate(targetBitRate),
        '-maxrate', formatBitRate(Math.round(targetBitRate * 1.2)),
        '-bufsize', formatBitRate(Math.round(targetBitRate * 2)),
        ...(useHevc ? ['-tag:v', 'hvc1'] : []),
        ...(project.media.hdr && useHevc ? ['-profile:v', 'main10'] : []),
      ],
    };
  }
  if (useHevc) {
    return {
      encoder: 'libx265', hardware: false, targetBitRate,
      args: ['-c:v', 'libx265', '-preset', mode === 'fast' ? 'veryfast' : 'fast', '-crf', mode === 'fast' ? '19' : '16', ...(project.media.hdr ? ['-pix_fmt', 'yuv420p10le'] : []), '-tag:v', 'hvc1'],
    };
  }
  return {
    encoder: 'libx264', hardware: false, targetBitRate,
    args: ['-c:v', 'libx264', '-preset', mode === 'fast' ? 'superfast' : 'veryfast', '-crf', mode === 'fast' ? '19' : '17'],
  };
}

function colorArgs(project: Project) {
  const args: string[] = [];
  if (project.media.colorPrimaries) args.push('-color_primaries', project.media.colorPrimaries);
  if (project.media.colorTransfer) args.push('-color_trc', project.media.colorTransfer);
  if (project.media.colorSpace) args.push('-colorspace', project.media.colorSpace);
  return args;
}

function buildTimelineFilter(segments: Array<{ start: number; end: number }>, fps: number) {
  const expression = segments.map((segment) => `between(t\\,${segment.start.toFixed(6)}\\,${segment.end.toFixed(6)})`).join('+');
  return `[0:v]select='${expression}',setpts=N/${fps.toFixed(6)}/TB[vout];[0:a]aselect='${expression}',asetpts=N/SR/TB[aout]`;
}

function parseFfmpegTime(value: string) {
  const parts = value.split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function launchExport(projectId: string, command: string, args: string[], outputDuration: number, outputPath: string, encoder: string) {
  const job: ExportJob = { state: 'running', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0, outputPath, encoder, startedAt: Date.now() };
  exportJobs.set(projectId, job);
  const child = spawn(command, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { shell: false, windowsHide: true });
  let stdoutBuffer = '';
  let stderr = '';
  const handleLine = (line: string) => {
    const equals = line.indexOf('=');
    if (equals < 0) return;
    const key = line.slice(0, equals);
    const value = line.slice(equals + 1);
    if (key === 'out_time') {
      job.outTime = value;
      const seconds = parseFfmpegTime(value);
      job.progress = outputDuration > 0 ? Math.min(99.5, Math.max(0, seconds / outputDuration * 100)) : 0;
    } else if (key === 'speed') job.speed = value;
    else if (key === 'frame') job.frame = Number(value) || job.frame;
  };
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    let newline = stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      handleLine(stdoutBuffer.slice(0, newline).trim());
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); });
  child.on('error', (error) => { job.state = 'failed'; job.error = error.message; });
  child.on('close', (code) => {
    if (code === 0) { job.state = 'completed'; job.progress = 100; }
    else if (job.state !== 'failed') { job.state = 'failed'; job.error = stderr || `FFmpeg exited with code ${code}`; }
  });
}

function route(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response) => {
    handler(req, res).catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : String(error) }));
  };
}

app.get('/api/system/status', route(async (_req, res) => { res.json(await systemStatus()); }));

app.get('/api/settings', route(async (_req, res) => {
  const status = await systemStatus();
  res.json({
    ...status,
    overrides: {
      codexBin: localSettings.codexBin ?? '', grokBin: localSettings.grokBin ?? '', ffmpegBin: localSettings.ffmpegBin ?? '', ffprobeBin: localSettings.ffprobeBin ?? '', projectsDir: localSettings.projectsDir ?? '',
      imageProvider: localSettings.imageProvider ?? '', openAiImageModel: localSettings.openAiImageModel ?? '', geminiImageModel: localSettings.geminiImageModel ?? '', grokModel: localSettings.grokModel ?? '',
    },
  });
}));

app.put('/api/settings', route(async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.elevenLabsApiKey === 'string' && body.elevenLabsApiKey.trim()) localSettings.elevenLabsApiKey = body.elevenLabsApiKey.trim();
  if (typeof body.openAiApiKey === 'string' && body.openAiApiKey.trim()) localSettings.openAiApiKey = body.openAiApiKey.trim();
  if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()) localSettings.geminiApiKey = body.geminiApiKey.trim();
  if (typeof body.imageProvider === 'string') localSettings.imageProvider = providerValue(body.imageProvider);
  for (const key of ['codexBin', 'grokBin', 'ffmpegBin', 'ffprobeBin', 'projectsDir', 'openAiImageModel', 'geminiImageModel', 'grokModel'] as const) {
    if (typeof body[key] === 'string') localSettings[key] = body[key].trim() || undefined;
  }
  capabilityCache.clear();
  await saveSettings();
  res.json(await systemStatus());
}));

app.post('/api/projects/select', route(async (_req, res) => {
  const sourcePath = await pickNativeFile();
  if (!sourcePath) return void res.status(400).json({ error: 'No video selected' });
  const settings = await resolvedSettings();
  const id = randomUUID();
  const workDir = path.join(settings.projectsDir, id);
  await fs.mkdir(workDir, { recursive: true });
  const project: Project = { id, sourcePath, sourceName: path.basename(sourcePath), workDir, media: await probe(sourcePath) };
  projects.set(id, project);
  await saveProject(project);
  res.json(serializeProject(project));
}));

app.post('/api/projects/:id/prepare', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.');
  const capabilities = await ffmpegCapabilities(settings.ffmpegBin);
  const audioPath = path.join(project.workDir, 'analysis.m4a');
  const proxyPath = path.join(project.workDir, 'proxy.mp4');
  const dimensions = proxySize(project.media);
  const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : [];
  const proxyEncoder = capabilities.h264VideoToolbox
    ? ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-prio_speed', '1', '-allow_sw', '1', '-b:v', '1500k', '-maxrate', '2500k', '-bufsize', '4M']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'];
  await run(settings.ffmpegBin, [
    '-hide_banner', '-y', ...inputAcceleration, '-i', project.sourcePath,
    '-map', '0:v:0', '-map', '0:a:0', '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear,fps=30,format=yuv420p`, ...proxyEncoder,
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath,
  ]);
  project.audioPath = audioPath;
  project.proxyPath = proxyPath;
  await saveProject(project);
  res.json({ proxyUrl: `/api/projects/${project.id}/proxy`, proxy: { width: dimensions.width, height: dimensions.height, fps: 30, hardware: capabilities.h264VideoToolbox } });
}));

app.get('/api/projects/:id/proxy', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  if (!project.proxyPath) throw new Error('Proxy has not been generated yet');
  res.sendFile(project.proxyPath);
}));

app.post('/api/projects/:id/transcribe', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const transcript = await transcribeProject(project);
  res.json({ transcript, edl: project.edl });
}));

app.post('/api/projects/:id/clean', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const settings = await resolvedSettings();
  const intensity = ['light', 'balanced', 'aggressive'].includes(req.body?.intensity) ? req.body.intensity : 'balanced';
  if (!project.transcript) await transcribeProject(project);
  if (!settings.codexBin) throw new Error('Codex CLI was not found.');
  const schemaPath = path.join(project.workDir, 'edl.schema.json');
  const outputPath = path.join(project.workDir, 'codex-edl.json');
  await fs.writeFile(schemaPath, JSON.stringify(EDL_SCHEMA, null, 2));
  const transcript = project.transcript!.words.map((word) => `[${word.id} ${word.start.toFixed(3)}-${word.end.toFixed(3)}] ${word.text}`).join('\n');
  const prompt = `You are a professional talking-head dialogue cleaning editor.\n\nThis is DELETE-ONLY editing. Never invent, paraphrase, replace, reorder, or combine spoken words. Keep source chronology. Return only ranges of ORIGINAL words to keep.\n\nCleanup intensity: ${intensity}.\nLight: remove clear fillers, abandoned false starts, duplicate takes, and excessive dead space only.\nBalanced: also remove low-value repetition and concise tangents while preserving natural speech.\nAggressive: optimize pacing strongly, but preserve meaning and grammatical continuity.\n\nPrefer natural cut points.\n\nSOURCE WORDS:\n${transcript}`;
  await run(settings.codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt);
  project.edl = validateEdl(project.transcript!.words, JSON.parse(await fs.readFile(outputPath, 'utf8')));
  await invalidateBroll(project);
  await Promise.all([fs.writeFile(path.join(project.workDir, 'edl.json'), JSON.stringify(project.edl, null, 2)), saveProject(project)]);
  res.json(project.edl);
}));

app.put('/api/projects/:id/edl', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  if (!project.transcript) throw new Error('Missing transcript');
  project.edl = validateEdl(project.transcript.words, { keepRanges: req.body?.keepRanges, notes: ['Manually adjusted'] });
  await invalidateBroll(project);
  await Promise.all([fs.writeFile(path.join(project.workDir, 'edl.json'), JSON.stringify(project.edl, null, 2)), saveProject(project)]);
  res.json(project.edl);
}));

app.post('/api/projects/:id/broll/plan', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const settings = await resolvedSettings();
  if (!settings.codexBin) throw new Error('Codex CLI was not found; it is required for B-roll scene planning.');
  const transcript = await transcribeProject(project);
  const requested = (req.body?.settings ?? {}) as Partial<BrollPlanSettings>;
  const workflowMode = ['cleaned-video', 'raw-video', 'assets-only'].includes(String(requested.workflowMode)) ? requested.workflowMode : 'cleaned-video';
  const keepRanges = workflowMode === 'cleaned-video' ? project.edl?.keepRanges : undefined;
  const orientation = (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape';
  const plan = await createBrollPlan({
    codexBin: settings.codexBin,
    workDir: project.workDir,
    words: transcript.words,
    keepRanges,
    orientation,
    settings: { ...requested, provider: requested.provider || settings.imageProvider },
  });
  brollPlans.set(project.id, plan);
  res.json({ plan, transcript, edl: project.edl });
}));

app.get('/api/projects/:id/broll', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const cached = brollPlans.get(project.id);
  if (cached) return void res.json(cached);
  const plan = await loadBrollPlan(project.workDir);
  if (!plan) return void res.status(404).json({ error: 'B-roll plan has not been created yet' });
  brollPlans.set(project.id, plan);
  res.json(plan);
}));

app.put('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const sceneId = routeParam(req.params.sceneId);
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  if (!plan) throw new Error('B-roll plan has not been created yet');
  const scene = await updateBrollScene(project.workDir, plan, sceneId, {
    title: typeof req.body?.title === 'string' ? req.body.title : undefined,
    imagePrompt: typeof req.body?.imagePrompt === 'string' ? req.body.imagePrompt : undefined,
    sourceStart: Number.isFinite(Number(req.body?.sourceStart)) ? Number(req.body.sourceStart) : undefined,
    sourceEnd: Number.isFinite(Number(req.body?.sourceEnd)) ? Number(req.body.sourceEnd) : undefined,
    enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
  });
  brollPlans.set(project.id, plan);
  res.json(scene);
}));

app.post('/api/projects/:id/broll/scenes/:sceneId/generate', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const sceneId = routeParam(req.params.sceneId);
  const settings = await resolvedSettings();
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  if (!plan) throw new Error('B-roll plan has not been created yet');
  const scene = await generateBrollImage({
    workDir: project.workDir,
    plan,
    sceneId,
    config: {
      openAiApiKey: settings.openAiApiKey,
      openAiModel: settings.openAiImageModel,
      geminiApiKey: settings.geminiApiKey,
      geminiModel: settings.geminiImageModel,
      grokBin: settings.grokBin,
      grokModel: settings.grokModel,
      codexBin: settings.codexBin,
      ffmpegBin: settings.ffmpegBin,
    },
  });
  brollPlans.set(project.id, plan);
  res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` });
}));

app.get('/api/projects/:id/broll/scenes/:sceneId/image', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const sceneId = routeParam(req.params.sceneId);
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  const scene = plan?.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene?.imageFile) return void res.status(404).json({ error: 'B-roll image has not been generated yet' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(scene.imageFile);
}));

app.post('/api/projects/:id/broll/export-assets', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  if (!plan) throw new Error('B-roll plan has not been created yet');
  const selectedFolder = await pickFolderPath();
  if (!selectedFolder) return void res.status(400).json({ error: 'Export cancelled' });
  const destination = path.join(selectedFolder, `video-cleaner-broll-${project.id.slice(0, 8)}`);
  await fs.mkdir(destination, { recursive: true });
  const scenes = [];
  for (const scene of plan.scenes) {
    let imageFile: string | null = null;
    if (scene.imageFile) {
      const filename = `${scene.id}.png`;
      await fs.copyFile(scene.imageFile, path.join(destination, filename));
      imageFile = filename;
    }
    scenes.push({
      id: scene.id, title: scene.title, enabled: scene.enabled, sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd,
      startWordId: scene.startWordId, endWordId: scene.endWordId, narration: scene.narration, visualIntent: scene.visualIntent,
      shotType: scene.shotType, imagePrompt: scene.imagePrompt, provider: scene.provider || plan.settings.provider, model: scene.model || null, imageFile,
    });
  }
  const timing = { version: 1, sourceName: project.sourceName, workflowMode: plan.settings.workflowMode, orientation: plan.orientation, settings: plan.settings, scenes };
  await fs.writeFile(path.join(destination, 'broll-timing.json'), JSON.stringify(timing, null, 2));
  await fs.writeFile(path.join(destination, 'README.txt'), 'B-roll stills and editable timing data exported by Video Cleaner. Edit broll-timing.json or import the files into any editor.\n');
  res.json({ destination, sceneCount: scenes.length });
}));

app.post('/api/projects/:id/broll/export-video', route(async (req, res) => {
  const projectId = routeParam(req.params.id);
  const project = getProject(projectId);
  const settings = await resolvedSettings();
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  if (!plan) throw new Error('B-roll plan has not been created yet');
  if (plan.settings.workflowMode === 'assets-only') throw new Error('Assets-only projects export files and timing JSON, not a rendered video');
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const active = exportJobs.get(projectId);
  if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' });
  const outputPath = await pickExportPath('video-with-broll.mp4', 'Export video with B-roll');
  if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' });
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality';
  const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30;
  const cleanedSegments = plan.settings.workflowMode === 'cleaned-video' ? rangesToSeconds(project) : undefined;
  const { filter, activeScenes } = buildBrollOverlayFilter({
    plan, width: project.media.width || 1920, height: project.media.height || 1080, fps, cleanedSegments,
  });
  const capabilities = await ffmpegCapabilities(settings.ffmpegBin);
  const encoding = encodingArgs(project, capabilities, mode);
  const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : [];
  const imageInputs = activeScenes.flatMap((scene) => ['-loop', '1', '-framerate', String(Math.min(30, fps)), '-i', scene.imageFile!]);
  const outputDuration = cleanedSegments?.length
    ? cleanedSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0)
    : project.media.duration;
  const args = [
    ...inputAcceleration, '-i', project.sourcePath, ...imageInputs,
    '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-fps_mode', 'passthrough',
    ...encoding.args, ...colorArgs(project), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outputPath,
  ];
  launchExport(projectId, settings.ffmpegBin, args, outputDuration, outputPath, encoding.encoder);
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, brollScenes: activeScenes.length });
}));

app.post('/api/projects/:id/export', route(async (req, res) => {
  const projectId = routeParam(req.params.id);
  const project = getProject(projectId);
  const settings = await resolvedSettings();
  if (!project.transcript || !project.edl) throw new Error('Missing transcript or edit decision list');
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const active = exportJobs.get(projectId);
  if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' });
  const outputPath = await pickExportPath();
  if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' });
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality';
  const segments = rangesToSeconds(project);
  const outputDuration = segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
  const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30;
  const capabilities = await ffmpegCapabilities(settings.ffmpegBin);
  const encoding = encodingArgs(project, capabilities, mode);
  const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : [];
  const args = [
    ...inputAcceleration, '-i', project.sourcePath, '-filter_complex', buildTimelineFilter(segments, fps), '-map', '[vout]', '-map', '[aout]', '-fps_mode', 'passthrough',
    ...encoding.args, ...colorArgs(project), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outputPath,
  ];
  launchExport(projectId, settings.ffmpegBin, args, outputDuration, outputPath, encoding.encoder);
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate });
}));

app.get('/api/projects/:id/export-status', route(async (req, res) => {
  const projectId = routeParam(req.params.id);
  res.json(exportJobs.get(projectId) ?? { state: 'idle', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0 });
}));

const PORT = Number(process.env.PORT || 3001);
await loadSettings();

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve('dist');
  app.use(express.static(distDir));
  app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Video Cleaner local server: http://127.0.0.1:${PORT}`);
});
