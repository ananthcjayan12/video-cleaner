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
  createVideoPrompt,
  deleteBrollScene,
  generateBrollImage,
  generateBrollVideoWithGrokCli,
  importBrollImage,
  loadBrollPlan,
  updateBrollScene,
  type BrollPlan,
  type BrollPlanSettings,
  type ImageProvider,
} from './broll.js';
import {
  atomicWriteJson,
  loadProjectDirectory,
  loadProjectSnapshot,
  saveProject,
  scanProjects,
  summarizeProject,
  type KeepRange,
  type MediaProfile,
  type Project,
  type Word,
} from './project-store.js';

dotenv.config({ path: path.resolve('.env.local') });
dotenv.config({ path: path.resolve('.env') });

type LocalSettings = {
  elevenLabsApiKey?: string; openAiApiKey?: string; geminiApiKey?: string; imageProvider?: ImageProvider;
  openAiImageModel?: string; geminiImageModel?: string; grokModel?: string; grokVideoModel?: string;
  codexBin?: string; grokBin?: string; ffmpegBin?: string; ffprobeBin?: string; projectsDir?: string;
};
type FfmpegCapabilities = { videoToolboxDecode: boolean; h264VideoToolbox: boolean; hevcVideoToolbox: boolean };
type ExportJob = {
  state: 'idle' | 'running' | 'completed' | 'failed'; progress: number; outTime: string; speed: string; frame: number;
  outputPath?: string; encoder?: string; error?: string; startedAt?: number;
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
  type: 'object', additionalProperties: false, required: ['keepRanges', 'notes'],
  properties: {
    keepRanges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['startWordId', 'endWordId', 'reason'], properties: { startWordId: { type: 'string' }, endWordId: { type: 'string' }, reason: { type: 'string' } } } },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

async function run(command: string, args: string[], stdin?: string, timeoutMs = 0) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = ''; let stderr = ''; let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString())); child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`)); });
    child.stdin.end(stdin ?? '');
  });
}

async function loadSettings() { try { localSettings = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8')) as LocalSettings; } catch { localSettings = {}; } }
async function saveSettings() { await fs.mkdir(CONFIG_DIR, { recursive: true }); await fs.writeFile(CONFIG_PATH, JSON.stringify(localSettings, null, 2), { mode: 0o600 }); }
async function detectBinary(name: string) { try { const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [name], undefined, 3000); return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''; } catch { return ''; } }
function providerValue(value: unknown): ImageProvider { return ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(value)) ? value as ImageProvider : 'gemini'; }

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
    grokVideoModel: localSettings.grokVideoModel || process.env.GROK_VIDEO_MODEL || 'grok-imagine-video-1.5',
    codexBin: codexOverride || await detectBinary('codex'), grokBin: grokOverride || await detectBinary('grok'),
    ffmpegBin: ffmpegOverride || await detectBinary('ffmpeg'), ffprobeBin: ffprobeOverride || await detectBinary('ffprobe'),
    projectsDir: localSettings.projectsDir || process.env.PROJECTS_DIR || path.join(os.homedir(), 'VideoCleaner', 'projects'),
  };
}

async function hydrateProjects(clear = false) {
  const settings = await resolvedSettings();
  const loaded = await scanProjects(settings.projectsDir);
  if (clear) { projects.clear(); brollPlans.clear(); }
  for (const project of loaded) projects.set(project.id, project);
  return loaded;
}

async function canRun(binary: string, args: string[]) { if (!binary) return false; try { await run(binary, args, undefined, 5000); return true; } catch { return false; } }
async function ffmpegCapabilities(ffmpegBin: string): Promise<FfmpegCapabilities> {
  if (!ffmpegBin) return { videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false };
  const cached = capabilityCache.get(ffmpegBin); if (cached) return cached;
  try {
    const [encoders, hwaccels] = await Promise.all([run(ffmpegBin, ['-hide_banner', '-encoders'], undefined, 10000), run(ffmpegBin, ['-hide_banner', '-hwaccels'], undefined, 10000)]);
    const result = { videoToolboxDecode: process.platform === 'darwin' && hwaccels.stdout.includes('videotoolbox'), h264VideoToolbox: process.platform === 'darwin' && encoders.stdout.includes('h264_videotoolbox'), hevcVideoToolbox: process.platform === 'darwin' && encoders.stdout.includes('hevc_videotoolbox') };
    capabilityCache.set(ffmpegBin, result); return result;
  } catch { return { videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false }; }
}

async function systemStatus() {
  const settings = await resolvedSettings();
  const [codexInstalled, grokInstalled, ffmpegInstalled, ffprobeInstalled] = await Promise.all([canRun(settings.codexBin, ['--version']), canRun(settings.grokBin, ['version']), canRun(settings.ffmpegBin, ['-version']), canRun(settings.ffprobeBin, ['-version'])]);
  const [codexAuthenticated, capabilities] = await Promise.all([codexInstalled ? canRun(settings.codexBin, ['login', 'status']) : Promise.resolve(false), ffmpegInstalled ? ffmpegCapabilities(settings.ffmpegBin) : Promise.resolve({ videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false })]);
  return {
    codex: { installed: codexInstalled, authenticated: codexAuthenticated, path: settings.codexBin || null },
    grok: { installed: grokInstalled, path: settings.grokBin || null, model: settings.grokModel || 'CLI default', videoModel: settings.grokVideoModel },
    ffmpeg: { installed: ffmpegInstalled, path: settings.ffmpegBin || null, capabilities }, ffprobe: { installed: ffprobeInstalled, path: settings.ffprobeBin || null },
    elevenLabs: { configured: Boolean(settings.elevenLabsApiKey) }, imageProvider: settings.imageProvider,
    imageProviders: {
      openai: { configured: Boolean(settings.openAiApiKey), model: settings.openAiImageModel }, gemini: { configured: Boolean(settings.geminiApiKey), model: settings.geminiImageModel },
      grokCli: { configured: grokInstalled, model: settings.grokModel || 'CLI default', experimental: true }, codexCli: { configured: codexInstalled && codexAuthenticated, model: 'Codex CLI', experimental: true },
    },
    brollVideo: { configured: grokInstalled && codexInstalled && codexAuthenticated, provider: 'Grok CLI', model: settings.grokVideoModel, experimental: true },
    projectsDir: settings.projectsDir,
  };
}

async function pickNativeFile(prompt = 'Choose a talking-head video') {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', `POSIX path of (choose file with prompt ${JSON.stringify(prompt)})`]); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Video files|*.mov;*.mp4;*.m4v;*.webm|All files|*.*";', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', `--title=${prompt}`, '--file-filter=Video | *.mov *.mp4 *.m4v *.webm']); return stdout.trim();
}

async function pickNativeImageFile() {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose file with prompt "Choose a B-roll image")']); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Image files|*.png;*.jpg;*.jpeg;*.webp;*.heic;*.heif|All files|*.*";', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--title=Choose a B-roll image', '--file-filter=Images | *.png *.jpg *.jpeg *.webp *.heic *.heif']); return stdout.trim();
}

async function pickExportPath(defaultName = 'cleaned-video.mp4', prompt = 'Export video') {
  if (process.platform === 'darwin') { const script = `POSIX path of (choose file name with prompt ${JSON.stringify(prompt)} default name ${JSON.stringify(defaultName)})`; const { stdout } = await run('osascript', ['-e', script]); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.SaveFileDialog;', '$d.Filter = "MP4 video|*.mp4";', `$d.FileName = ${JSON.stringify(defaultName)};`, 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--save', '--confirm-overwrite', `--filename=${defaultName}`]); return stdout.trim();
}
async function pickFolderPath() {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose folder for B-roll assets")']); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.FolderBrowserDialog;', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--directory', '--title=Choose folder for B-roll assets']); return stdout.trim();
}

function parseRate(value: unknown) { if (typeof value !== 'string' || !value) return 0; if (!value.includes('/')) return Number(value) || 0; const [n, d] = value.split('/').map(Number); return d ? n / d : 0; }
async function probe(sourcePath: string): Promise<MediaProfile> {
  const settings = await resolvedSettings(); if (!settings.ffprobeBin) throw new Error('ffprobe was not found.');
  const { stdout } = await run(settings.ffprobeBin, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourcePath]); const data = JSON.parse(stdout);
  const video = data.streams?.find((stream: any) => stream.codec_type === 'video') ?? {}; const audio = data.streams?.find((stream: any) => stream.codec_type === 'audio') ?? {};
  const rotation = Number(video.side_data_list?.find((item: any) => item.side_data_type === 'Display Matrix')?.rotation ?? video.tags?.rotate ?? 0); const swap = Math.abs(rotation) % 180 === 90;
  const width = Number(video.width) || undefined; const height = Number(video.height) || undefined; const transfer = String(video.color_transfer ?? '').toLowerCase(); const primaries = String(video.color_primaries ?? '').toLowerCase();
  return { duration: Number(data.format?.duration ?? video.duration ?? 0), size: Number(data.format?.size ?? 0), width: swap ? height : width, height: swap ? width : height, frameRate: parseRate(video.avg_frame_rate || video.r_frame_rate), bitRate: Number(video.bit_rate ?? 0) || undefined, videoCodec: video.codec_name, audioCodec: audio.codec_name, pixelFormat: video.pix_fmt, colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries, colorSpace: video.color_space, hdr: ['smpte2084', 'arib-std-b67'].includes(transfer) || primaries === 'bt2020' };
}

function routeParam(value: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function getProject(id: string) { const project = projects.get(id); if (!project) throw new Error('Project not found in the local project library.'); return project; }
async function sourceAvailable(project: Project) { const stat = await fs.stat(project.sourcePath).catch(() => null); return Boolean(stat?.isFile()); }
async function requireSource(project: Project) { if (!await sourceAvailable(project)) throw new Error(`Original source video is missing. Relink ${project.sourceName} from the project library before this operation.`); }
async function touchProject(project: Project) { await saveProject(project); }
async function invalidateBroll(project: Project) { brollPlans.delete(project.id); await fs.rm(path.join(project.workDir, 'broll-plan.json'), { force: true }); await touchProject(project); }

function validateEdl(words: Word[], raw: any) {
  const index = new Map(words.map((word, i) => [word.id, i])); let previousEnd = -1; const ranges: KeepRange[] = [];
  for (const range of raw.keepRanges ?? []) { const start = index.get(range.startWordId); const end = index.get(range.endWordId); if (start === undefined || end === undefined || start > end) throw new Error('Invalid EDL word range'); if (start <= previousEnd) throw new Error('EDL ranges overlap or are out of order'); previousEnd = end; ranges.push({ startWordId: range.startWordId, endWordId: range.endWordId, reason: range.reason ?? '' }); }
  if (!ranges.length) throw new Error('The edit removed the entire video'); return { keepRanges: ranges, notes: Array.isArray(raw.notes) ? raw.notes : [] };
}
function rangesToSeconds(project: Project) {
  const words = project.transcript!.words; const index = new Map(words.map((word, i) => [word.id, i]));
  const seconds = project.edl!.keepRanges.map((range) => { const startWord = words[index.get(range.startWordId)!]; const endWord = words[index.get(range.endWordId)!]; return { start: Math.max(0, startWord.start - 0.08), end: Math.min(project.media.duration || Number.POSITIVE_INFINITY, endWord.end + 0.12) }; });
  const merged: { start: number; end: number }[] = []; for (const segment of seconds) { const previous = merged.at(-1); if (previous && segment.start - previous.end < 0.2) previous.end = Math.max(previous.end, segment.end); else merged.push({ ...segment }); } return merged;
}
function proxySize(media: MediaProfile, maxEdge = 720) { const width = media.width || 1280; const height = media.height || 720; const even = (v: number) => Math.max(2, Math.round(v / 2) * 2); if (width >= height) { const w = Math.min(maxEdge, width); return { width: even(w), height: even(height * w / width) }; } const h = Math.min(maxEdge, height); return { width: even(width * h / height), height: even(h) }; }

async function ensureAnalysisAudio(project: Project) {
  if (project.audioPath) { const exists = await fs.stat(project.audioPath).catch(() => null); if (exists?.isFile()) return project.audioPath; }
  await requireSource(project);
  const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const audioPath = path.join(project.workDir, 'analysis.m4a');
  await run(settings.ffmpegBin, ['-hide_banner', '-y', '-i', project.sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath]); project.audioPath = audioPath; await touchProject(project); return audioPath;
}
async function transcribeProject(project: Project) {
  if (project.transcript?.words.length) return project.transcript; const settings = await resolvedSettings(); if (!settings.elevenLabsApiKey) throw new Error('ElevenLabs API key is not configured');
  const audioPath = await ensureAnalysisAudio(project); const bytes = await fs.readFile(audioPath); const form = new FormData(); form.append('model_id', 'scribe_v2'); form.append('timestamps_granularity', 'word'); form.append('file', new Blob([bytes]), 'analysis.m4a');
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': settings.elevenLabsApiKey }, body: form }); if (!response.ok) throw new Error(`ElevenLabs failed: ${response.status} ${await response.text()}`);
  const raw: any = await response.json(); const words: Word[] = (raw.words ?? []).filter((word: any) => word.type === 'word' && Number.isFinite(word.start) && Number.isFinite(word.end)).map((word: any, index: number) => ({ id: `w${String(index + 1).padStart(6, '0')}`, text: word.text, start: word.start, end: word.end }));
  if (!words.length) throw new Error('No timestamped words returned by ElevenLabs'); project.transcript = { text: raw.text ?? words.map((word) => word.text).join(' '), words }; project.edl = { keepRanges: [{ startWordId: words[0].id, endWordId: words.at(-1)!.id, reason: 'Original recording' }], notes: [] }; await invalidateBroll(project);
  await Promise.all([atomicWriteJson(path.join(project.workDir, 'transcript.json'), project.transcript), touchProject(project)]); return project.transcript;
}

function defaultBitRate(media: MediaProfile, hevc: boolean) { const pixels = (media.width || 1920) * (media.height || 1080); const highFps = (media.frameRate || 30) > 35; if (pixels >= 3840 * 2000) return hevc ? (highFps ? 70_000_000 : 45_000_000) : (highFps ? 95_000_000 : 65_000_000); if (pixels >= 1920 * 1000) return hevc ? (highFps ? 25_000_000 : 16_000_000) : (highFps ? 35_000_000 : 22_000_000); return hevc ? 10_000_000 : 14_000_000; }
function exportBitRate(media: MediaProfile, hevc: boolean, mode: 'fast' | 'quality') { const baseline = media.bitRate || defaultBitRate(media, hevc); const floor = defaultBitRate(media, hevc); const desired = mode === 'quality' ? Math.max(floor, baseline * 1.05) : Math.max(floor * 0.75, baseline * 0.78); return Math.min(140_000_000, Math.round(desired)); }
function formatBitRate(value: number) { return `${Math.max(1, Math.round(value / 1000))}k`; }
function sourceBitDepth(pixelFormat?: string) { const match = String(pixelFormat ?? '').toLowerCase().match(/(9|10|12|14|16)(?:le|be)?$/); return match ? Number(match[1]) : 8; }
function hevcOutputPixelFormat(media: MediaProfile) {
  // VideoToolbox HEVC reliably accepts 8-bit 4:2:0 or Main 10. Normalize higher-chroma/high-bit-depth inputs to Main 10 instead of passing through unsupported formats such as yuv422p10le, yuv444p10le, p010, or 12-bit sources.
  return media.hdr || sourceBitDepth(media.pixelFormat) > 8 ? 'yuv420p10le' : 'yuv420p';
}
function encodingArgs(project: Project, capabilities: FfmpegCapabilities, mode: 'fast' | 'quality') {
  const sourceCodec = String(project.media.videoCodec || '').toLowerCase(); const useHevc = project.media.hdr || sourceCodec === 'hevc' || sourceCodec === 'h265'; const hardware = useHevc ? capabilities.hevcVideoToolbox : capabilities.h264VideoToolbox; const targetBitRate = exportBitRate(project.media, useHevc, mode); const pixelFormat = hevcOutputPixelFormat(project.media); const main10 = pixelFormat === 'yuv420p10le';
  if (hardware) { const encoder = useHevc ? 'hevc_videotoolbox' : 'h264_videotoolbox'; return { encoder, hardware, targetBitRate, args: ['-c:v', encoder, '-realtime', '1', '-allow_sw', '1', ...(mode === 'fast' ? ['-prio_speed', '1'] : []), '-b:v', formatBitRate(targetBitRate), '-maxrate', formatBitRate(Math.round(targetBitRate * 1.2)), '-bufsize', formatBitRate(Math.round(targetBitRate * 2)), ...(useHevc ? ['-pix_fmt', pixelFormat, '-tag:v', 'hvc1', ...(main10 ? ['-profile:v', 'main10'] : [])] : [])] }; }
  if (useHevc) return { encoder: 'libx265', hardware: false, targetBitRate, args: ['-c:v', 'libx265', '-preset', mode === 'fast' ? 'veryfast' : 'fast', '-crf', mode === 'fast' ? '19' : '16', '-pix_fmt', pixelFormat, '-tag:v', 'hvc1'] };
  return { encoder: 'libx264', hardware: false, targetBitRate, args: ['-c:v', 'libx264', '-preset', mode === 'fast' ? 'superfast' : 'veryfast', '-crf', mode === 'fast' ? '19' : '17'] };
}
function colorArgs(project: Project) { const args: string[] = []; if (project.media.colorPrimaries) args.push('-color_primaries', project.media.colorPrimaries); if (project.media.colorTransfer) args.push('-color_trc', project.media.colorTransfer); if (project.media.colorSpace) args.push('-colorspace', project.media.colorSpace); return args; }
function buildTimelineFilter(segments: Array<{ start: number; end: number }>, fps: number) { const expression = segments.map((segment) => `between(t\\,${segment.start.toFixed(6)}\\,${segment.end.toFixed(6)})`).join('+'); return `[0:v]select='${expression}',setpts=N/${fps.toFixed(6)}/TB[vout];[0:a]aselect='${expression}',asetpts=N/SR/TB[aout]`; }
function parseFfmpegTime(value: string) { const parts = value.split(':').map(Number); if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0; return parts[0] * 3600 + parts[1] * 60 + parts[2]; }
function launchExport(projectId: string, command: string, args: string[], outputDuration: number, outputPath: string, encoder: string) {
  const job: ExportJob = { state: 'running', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0, outputPath, encoder, startedAt: Date.now() }; exportJobs.set(projectId, job);
  const child = spawn(command, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { shell: false, windowsHide: true }); let stdoutBuffer = ''; let stderr = '';
  const handleLine = (line: string) => { const equals = line.indexOf('='); if (equals < 0) return; const key = line.slice(0, equals); const value = line.slice(equals + 1); if (key === 'out_time') { job.outTime = value; const seconds = parseFfmpegTime(value); job.progress = outputDuration > 0 ? Math.min(99.5, Math.max(0, seconds / outputDuration * 100)) : 0; } else if (key === 'speed') job.speed = value; else if (key === 'frame') job.frame = Number(value) || job.frame; };
  child.stdout.on('data', (chunk) => { stdoutBuffer += chunk.toString(); let newline = stdoutBuffer.indexOf('\n'); while (newline >= 0) { handleLine(stdoutBuffer.slice(0, newline).trim()); stdoutBuffer = stdoutBuffer.slice(newline + 1); newline = stdoutBuffer.indexOf('\n'); } }); child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); }); child.on('error', (error) => { job.state = 'failed'; job.error = error.message; }); child.on('close', (code) => { if (code === 0) { job.state = 'completed'; job.progress = 100; } else if (job.state !== 'failed') { job.state = 'failed'; job.error = stderr || `FFmpeg exited with code ${code}`; } });
}
function route(handler: (req: express.Request, res: express.Response) => Promise<void>) { return (req: express.Request, res: express.Response) => { handler(req, res).catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : String(error) })); }; }

app.get('/api/system/status', route(async (_req, res) => { res.json(await systemStatus()); }));
app.get('/api/settings', route(async (_req, res) => { const status = await systemStatus(); res.json({ ...status, overrides: { codexBin: localSettings.codexBin ?? '', grokBin: localSettings.grokBin ?? '', ffmpegBin: localSettings.ffmpegBin ?? '', ffprobeBin: localSettings.ffprobeBin ?? '', projectsDir: localSettings.projectsDir ?? '', imageProvider: localSettings.imageProvider ?? '', openAiImageModel: localSettings.openAiImageModel ?? '', geminiImageModel: localSettings.geminiImageModel ?? '', grokModel: localSettings.grokModel ?? '', grokVideoModel: localSettings.grokVideoModel ?? '' } }); }));
app.put('/api/settings', route(async (req, res) => {
  const body = req.body ?? {}; const previousProjectsDir = (await resolvedSettings()).projectsDir;
  if (typeof body.elevenLabsApiKey === 'string' && body.elevenLabsApiKey.trim()) localSettings.elevenLabsApiKey = body.elevenLabsApiKey.trim(); if (typeof body.openAiApiKey === 'string' && body.openAiApiKey.trim()) localSettings.openAiApiKey = body.openAiApiKey.trim(); if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()) localSettings.geminiApiKey = body.geminiApiKey.trim(); if (typeof body.imageProvider === 'string') localSettings.imageProvider = providerValue(body.imageProvider);
  for (const key of ['codexBin', 'grokBin', 'ffmpegBin', 'ffprobeBin', 'projectsDir', 'openAiImageModel', 'geminiImageModel', 'grokModel', 'grokVideoModel'] as const) if (typeof body[key] === 'string') localSettings[key] = body[key].trim() || undefined;
  capabilityCache.clear(); await saveSettings(); const nextProjectsDir = (await resolvedSettings()).projectsDir; if (nextProjectsDir !== previousProjectsDir) await hydrateProjects(true); res.json(await systemStatus());
}));

app.get('/api/projects', route(async (_req, res) => {
  await hydrateProjects(true);
  const summaries = await Promise.all([...projects.values()].map(async (project) => summarizeProject(project, brollPlans.get(project.id))));
  summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  res.json(summaries);
}));

app.post('/api/projects/select', route(async (_req, res) => {
  const sourcePath = await pickNativeFile(); if (!sourcePath) return void res.status(400).json({ error: 'No video selected' });
  const settings = await resolvedSettings(); const id = randomUUID(); const workDir = path.join(settings.projectsDir, id); await fs.mkdir(workDir, { recursive: true }); const now = new Date().toISOString(); const sourceName = path.basename(sourcePath);
  const project: Project = { id, name: sourceName.replace(/\.[^.]+$/, ''), createdAt: now, updatedAt: now, sourcePath, sourceName, workDir, media: await probe(sourcePath) };
  projects.set(id, project); await saveProject(project, false); res.json(await summarizeProject(project, null));
}));

app.post('/api/projects/:id/open', route(async (req, res) => {
  const id = routeParam(req.params.id); let project = projects.get(id);
  if (!project) { const settings = await resolvedSettings(); project = await loadProjectDirectory(path.join(settings.projectsDir, id)) ?? undefined; if (project) projects.set(id, project); }
  if (!project) return void res.status(404).json({ error: 'Project not found on this computer' });
  const snapshot = await loadProjectSnapshot(project); if (snapshot.broll) brollPlans.set(project.id, snapshot.broll); res.json(snapshot);
}));

app.put('/api/projects/:id/meta', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  if (name) project.name = name; await touchProject(project); res.json(await summarizeProject(project, brollPlans.get(project.id)));
}));

app.delete('/api/projects/:id', route(async (req, res) => {
  const id = routeParam(req.params.id); const project = getProject(id); projects.delete(id); brollPlans.delete(id); exportJobs.delete(id); await fs.rm(project.workDir, { recursive: true, force: true }); res.json({ deleted: true, id });
}));

app.post('/api/projects/:id/relink', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const sourcePath = await pickNativeFile(`Relink source for ${project.name}`); if (!sourcePath) return void res.status(400).json({ error: 'Relink cancelled' });
  const media = await probe(sourcePath); const durationTolerance = Math.max(1.5, (project.media.duration || 0) * 0.02); const durationMismatch = Math.abs((media.duration || 0) - (project.media.duration || 0)) > durationTolerance; const dimensionsMismatch = Boolean(project.media.width && project.media.height && media.width && media.height && (project.media.width !== media.width || project.media.height !== media.height));
  if (durationMismatch || dimensionsMismatch) return void res.status(409).json({ error: `Selected video does not match this project. Expected roughly ${project.media.width || '?'}×${project.media.height || '?'} and ${project.media.duration.toFixed(1)}s.` });
  project.sourcePath = sourcePath; project.sourceName = path.basename(sourcePath); project.media = media; await touchProject(project); res.json(await summarizeProject(project, brollPlans.get(project.id)));
}));

app.post('/api/projects/:id/prepare', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.'); const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const audioPath = path.join(project.workDir, 'analysis.m4a'); const proxyPath = path.join(project.workDir, 'proxy.mp4'); const dimensions = proxySize(project.media); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const proxyEncoder = capabilities.h264VideoToolbox ? ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-prio_speed', '1', '-allow_sw', '1', '-b:v', '1500k', '-maxrate', '2500k', '-bufsize', '4M'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'];
  await run(settings.ffmpegBin, ['-hide_banner', '-y', ...inputAcceleration, '-i', project.sourcePath, '-map', '0:v:0', '-map', '0:a:0', '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear,fps=30,format=yuv420p`, ...proxyEncoder, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath]); project.audioPath = audioPath; project.proxyPath = proxyPath; await touchProject(project); res.json({ proxyUrl: `/api/projects/${project.id}/proxy`, proxy: { width: dimensions.width, height: dimensions.height, fps: 30, hardware: capabilities.h264VideoToolbox } });
}));
app.get('/api/projects/:id/proxy', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); if (!project.proxyPath) throw new Error('Proxy has not been generated yet'); res.sendFile(project.proxyPath); }));
app.post('/api/projects/:id/transcribe', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const transcript = await transcribeProject(project); res.json({ transcript, edl: project.edl }); }));
app.post('/api/projects/:id/clean', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const intensity = ['light', 'balanced', 'aggressive'].includes(req.body?.intensity) ? req.body.intensity : 'balanced'; if (!project.transcript) await transcribeProject(project); if (!settings.codexBin) throw new Error('Codex CLI was not found.');
  const schemaPath = path.join(project.workDir, 'edl.schema.json'); const outputPath = path.join(project.workDir, 'codex-edl.json'); await atomicWriteJson(schemaPath, EDL_SCHEMA); const transcript = project.transcript!.words.map((word) => `[${word.id} ${word.start.toFixed(3)}-${word.end.toFixed(3)}] ${word.text}`).join('\n'); const prompt = `You are a professional talking-head dialogue cleaning editor.\n\nThis is DELETE-ONLY editing. Never invent, paraphrase, replace, reorder, or combine spoken words. Keep source chronology. Return only ranges of ORIGINAL words to keep.\n\nCleanup intensity: ${intensity}.\nLight: remove clear fillers, abandoned false starts, duplicate takes, and excessive dead space only.\nBalanced: also remove low-value repetition and concise tangents while preserving natural speech.\nAggressive: optimize pacing strongly, but preserve meaning and grammatical continuity.\n\nPrefer natural cut points.\n\nSOURCE WORDS:\n${transcript}`;
  await run(settings.codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt); project.edl = validateEdl(project.transcript!.words, JSON.parse(await fs.readFile(outputPath, 'utf8'))); await invalidateBroll(project); await Promise.all([atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl), touchProject(project)]); res.json(project.edl);
}));
app.put('/api/projects/:id/edl', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); if (!project.transcript) throw new Error('Missing transcript'); project.edl = validateEdl(project.transcript.words, { keepRanges: req.body?.keepRanges, notes: ['Manually adjusted'] }); await invalidateBroll(project); await Promise.all([atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl), touchProject(project)]); res.json(project.edl); }));

app.post('/api/projects/:id/broll/plan', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); if (!settings.codexBin) throw new Error('Codex CLI was not found; it is required for B-roll scene planning.'); const transcript = await transcribeProject(project); const requested = (req.body?.settings ?? {}) as Partial<BrollPlanSettings>; const workflowMode = ['cleaned-video', 'raw-video', 'assets-only'].includes(String(requested.workflowMode)) ? requested.workflowMode : 'cleaned-video'; const keepRanges = workflowMode === 'cleaned-video' ? project.edl?.keepRanges : undefined; const orientation = (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape'; const plan = await createBrollPlan({ codexBin: settings.codexBin, workDir: project.workDir, words: transcript.words, keepRanges, orientation, settings: { ...requested, provider: requested.provider || settings.imageProvider } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ plan, transcript, edl: project.edl }); }));
app.get('/api/projects/:id/broll', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const cached = brollPlans.get(project.id); if (cached) return void res.json(cached); const plan = await loadBrollPlan(project.workDir); if (!plan) return void res.status(404).json({ error: 'B-roll plan has not been created yet' }); brollPlans.set(project.id, plan); res.json(plan); }));
app.put('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const sceneId = routeParam(req.params.sceneId); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const scene = await updateBrollScene(project.workDir, plan, sceneId, { title: typeof req.body?.title === 'string' ? req.body.title : undefined, imagePrompt: typeof req.body?.imagePrompt === 'string' ? req.body.imagePrompt : undefined, videoPrompt: typeof req.body?.videoPrompt === 'string' ? req.body.videoPrompt : undefined, sourceStart: Number.isFinite(Number(req.body?.sourceStart)) ? Number(req.body.sourceStart) : undefined, sourceEnd: Number.isFinite(Number(req.body?.sourceEnd)) ? Number(req.body.sourceEnd) : undefined, enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined }); brollPlans.set(project.id, plan); await touchProject(project); res.json(scene); }));
app.delete('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const updated = await deleteBrollScene(project.workDir, plan, routeParam(req.params.sceneId)); brollPlans.set(project.id, updated); await touchProject(project); res.json(updated); }));

app.post('/api/projects/:id/broll/scenes/:sceneId/generate', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const sceneId = routeParam(req.params.sceneId); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const regenerationComment = typeof req.body?.regenerationComment === 'string' ? req.body.regenerationComment.trim().slice(0, 2000) : undefined;
  const scene = await generateBrollImage({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { openAiApiKey: settings.openAiApiKey, openAiModel: settings.openAiImageModel, geminiApiKey: settings.geminiApiKey, geminiModel: settings.geminiImageModel, grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` });
}));
app.post('/api/projects/:id/broll/scenes/:sceneId/manual-image', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sourcePath = await pickNativeImageFile(); if (!sourcePath) return void res.status(400).json({ error: 'No image selected' }); const scene = await importBrollImage({ workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), sourcePath, ffmpegBin: settings.ffmpegBin }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` }); }));
app.get('/api/projects/:id/broll/scenes/:sceneId/image', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const scene = plan?.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId)); if (!scene?.imageFile) return void res.status(404).json({ error: 'B-roll image has not been generated yet' }); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(scene.imageFile); }));

app.post('/api/projects/:id/broll/scenes/:sceneId/video-prompt', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); if (!settings.codexBin) throw new Error('Codex CLI was not found'); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const scene = await createVideoPrompt({ codexBin: settings.codexBin, workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId) }); brollPlans.set(project.id, plan); await touchProject(project); res.json(scene); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/video', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sceneId = routeParam(req.params.sceneId); let scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.videoPrompt) { if (!settings.codexBin) throw new Error('Codex CLI was not found'); scene = await createVideoPrompt({ codexBin: settings.codexBin, workDir: project.workDir, plan, sceneId }); }
  const regenerationComment = typeof req.body?.regenerationComment === 'string' ? req.body.regenerationComment.trim().slice(0, 2000) : undefined;
  scene = await generateBrollVideoWithGrokCli({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` });
}));
app.get('/api/projects/:id/broll/scenes/:sceneId/video', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const scene = plan?.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId)); if (!scene?.videoFile) return void res.status(404).json({ error: 'B-roll video has not been created yet' }); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(scene.videoFile); }));

app.post('/api/projects/:id/broll/export-assets', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const selectedFolder = await pickFolderPath(); if (!selectedFolder) return void res.status(400).json({ error: 'Export cancelled' }); const destination = path.join(selectedFolder, `video-cleaner-broll-${project.id.slice(0, 8)}`); await fs.mkdir(destination, { recursive: true }); const scenes = [];
  for (const scene of plan.scenes) { let imageFile: string | null = null; let videoFile: string | null = null; if (scene.imageFile) { imageFile = `${scene.id}.png`; await fs.copyFile(scene.imageFile, path.join(destination, imageFile)); } if (scene.videoFile) { videoFile = `${scene.id}.mp4`; await fs.copyFile(scene.videoFile, path.join(destination, videoFile)); } scenes.push({ id: scene.id, title: scene.title, enabled: scene.enabled, sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd, startWordId: scene.startWordId, endWordId: scene.endWordId, narration: scene.narration, visualIntent: scene.visualIntent, shotType: scene.shotType, imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt || null, provider: scene.provider || plan.settings.provider, model: scene.model || null, imageFile, videoFile, videoModel: scene.videoModel || null }); }
  const timing = { version: 2, sourceName: project.sourceName, workflowMode: plan.settings.workflowMode, orientation: plan.orientation, settings: plan.settings, scenes }; await atomicWriteJson(path.join(destination, 'broll-timing.json'), timing); await fs.writeFile(path.join(destination, 'README.txt'), 'B-roll images/videos and editable timing data exported by Video Cleaner. Edit broll-timing.json or import the files into any editor.\n'); res.json({ destination, sceneCount: scenes.length });
}));

app.post('/api/projects/:id/broll/export-video', route(async (req, res) => {
  const projectId = routeParam(req.params.id); const project = getProject(projectId); await requireSource(project); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); if (plan.settings.workflowMode === 'assets-only') throw new Error('Assets-only projects export files and timing JSON, not a rendered video'); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const active = exportJobs.get(projectId); if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' }); const outputPath = await pickExportPath('video-with-broll.mp4', 'Export video with B-roll'); if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' }); const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality'; const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30; const cleanedSegments = plan.settings.workflowMode === 'cleaned-video' ? rangesToSeconds(project) : undefined;
  const { filter, activeScenes } = buildBrollOverlayFilter({ plan, width: project.media.width || 1920, height: project.media.height || 1080, fps, cleanedSegments }); const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const encoding = encodingArgs(project, capabilities, mode); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : [];
  const brollInputs = activeScenes.flatMap((scene) => scene.videoFile ? ['-stream_loop', '-1', '-i', scene.videoFile] : ['-loop', '1', '-framerate', String(Math.min(30, fps)), '-i', scene.imageFile!]);
  const outputDuration = cleanedSegments?.length ? cleanedSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) : project.media.duration;
  const args = [...inputAcceleration, '-i', project.sourcePath, ...brollInputs, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-fps_mode', 'passthrough', ...encoding.args, ...colorArgs(project), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outputPath]; launchExport(projectId, settings.ffmpegBin, args, outputDuration, outputPath, encoding.encoder); res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, brollScenes: activeScenes.length });
}));

app.post('/api/projects/:id/export', route(async (req, res) => { const projectId = routeParam(req.params.id); const project = getProject(projectId); await requireSource(project); const settings = await resolvedSettings(); if (!project.transcript || !project.edl) throw new Error('Missing transcript or edit decision list'); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const active = exportJobs.get(projectId); if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' }); const outputPath = await pickExportPath(); if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' }); const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality'; const segments = rangesToSeconds(project); const outputDuration = segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0); const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30; const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const encoding = encodingArgs(project, capabilities, mode); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const args = [...inputAcceleration, '-i', project.sourcePath, '-filter_complex', buildTimelineFilter(segments, fps), '-map', '[vout]', '-map', '[aout]', '-fps_mode', 'passthrough', ...encoding.args, ...colorArgs(project), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outputPath]; launchExport(projectId, settings.ffmpegBin, args, outputDuration, outputPath, encoding.encoder); res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate }); }));
app.get('/api/projects/:id/export-status', route(async (req, res) => { res.json(exportJobs.get(routeParam(req.params.id)) ?? { state: 'idle', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0 }); }));

const PORT = Number(process.env.PORT || 3001); await loadSettings(); await hydrateProjects(true);
if (process.env.NODE_ENV === 'production') { const distDir = path.resolve('dist'); app.use(express.static(distDir)); app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html'))); }
app.listen(PORT, '127.0.0.1', () => { console.log(`Video Cleaner local server: http://127.0.0.1:${PORT} · ${projects.size} local project${projects.size === 1 ? '' : 's'} restored`); });
