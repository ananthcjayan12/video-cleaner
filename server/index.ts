import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import dotenv from 'dotenv';
import {
  BROLL_DISPLAY_TEMPLATES,
  buildBrollOverlayFilter,
  createBrollPlan,
  createVideoPrompt,
  deleteBrollScene,
  displayTemplateNeedsPresenterMatte,
  generateBrollImage,
  generateBrollVideoWithGoogleFlow,
  generateBrollVideoWithGrokCli,
  generateBrollVideoWithMagnific,
  importBrollImage,
  importBrollVideo,
  listGoogleFlowProjectVideos,
  loadBrollPlan,
  planNeedsPresenterMatte,
  updateBrollScene,
  updateBrollSettings,
  type BrollDisplayTemplate,
  type BrollPlan,
  type BrollPlanSettings,
  type ImageProvider,
  type VideoProvider,
} from './broll.js';
import { ensurePresenterMatte, mattingSystemStatus, presenterMatteStatus, type PresenterMatteSpecInput } from './presenter.js';
import {
  atomicWriteJson,
  clipAtTimelineTime,
  loadProjectDirectory,
  loadProjectSnapshot,
  projectClips,
  saveProject,
  scanProjects,
  splitTimelineRange,
  summarizeProject,
  syncProjectTimeline,
  type KeepRange,
  type MediaProfile,
  type Project,
  type ProjectClip,
  type Word,
} from './project-store.js';

dotenv.config({ path: path.resolve('.env.local') });
dotenv.config({ path: path.resolve('.env') });

type LocalSettings = {
  elevenLabsApiKey?: string; openAiApiKey?: string; geminiApiKey?: string; imageProvider?: ImageProvider;
  openAiImageModel?: string; geminiImageModel?: string; grokModel?: string; grokVideoModel?: string; gflowProfile?: string; gflowVideoModel?: string;
  magnificApiKey?: string; magnificVideoModel?: string; magnificVideoEndpoint?: string;
  // Legacy names from the initial Magnific integration; retained for automatic migration.
  freepikApiKey?: string; freepikVideoModel?: string; freepikVideoEndpoint?: string;
  codexBin?: string; grokBin?: string; gflowBin?: string; ffmpegBin?: string; ffprobeBin?: string; projectsDir?: string;
};
type FfmpegCapabilities = { videoToolboxDecode: boolean; h264VideoToolbox: boolean; hevcVideoToolbox: boolean };
type ExportJob = {
  state: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'; progress: number; outTime: string; speed: string; frame: number;
  outputPath?: string; encoder?: string; error?: string; startedAt?: number; checkpointCompleted?: number; checkpointTotal?: number; resumable?: boolean; resumed?: boolean; stopRequested?: boolean;
};

const CONFIG_DIR = path.join(os.homedir(), '.video-cleaner');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const app = express();
const projects = new Map<string, Project>();
const brollPlans = new Map<string, BrollPlan>();
const exportJobs = new Map<string, ExportJob>();
const exportProcesses = new Map<string, ReturnType<typeof spawn>>();
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
async function detectBinary(name: string) {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [name], undefined, 3000);
    const detected = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (detected) return detected;
  } catch { /* Try common user-local install locations below. */ }
  if (process.platform !== 'win32') {
    const userLocalBinary = path.join(os.homedir(), '.local', 'bin', name);
    try { await fs.access(userLocalBinary); return userLocalBinary; } catch { /* Not installed here. */ }
  }
  return '';
}
function providerValue(value: unknown): ImageProvider { return ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(value)) ? value as ImageProvider : 'gemini'; }
function videoProviderValue(value: unknown): VideoProvider { return ['grok-cli', 'google-flow', 'magnific'].includes(String(value)) ? value as VideoProvider : 'grok-cli'; }
function displayTemplateValue(value: unknown): BrollDisplayTemplate {
  const candidate = String(value || 'full-frame') as BrollDisplayTemplate;
  return BROLL_DISPLAY_TEMPLATES.some((template) => template.id === candidate) ? candidate : 'full-frame';
}

async function resolvedSettings() {
  const codexOverride = localSettings.codexBin || process.env.CODEX_BIN || '';
  const grokOverride = localSettings.grokBin || process.env.GROK_BIN || '';
  const gflowOverride = localSettings.gflowBin || process.env.GFLOW_BIN || '';
  const ffmpegOverride = localSettings.ffmpegBin || process.env.FFMPEG_BIN || '';
  const ffprobeOverride = localSettings.ffprobeBin || process.env.FFPROBE_BIN || '';
  return {
    elevenLabsApiKey: localSettings.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '',
    openAiApiKey: localSettings.openAiApiKey || process.env.OPENAI_API_KEY || '',
    geminiApiKey: localSettings.geminiApiKey || process.env.GEMINI_API_KEY || '',
    magnificApiKey: localSettings.magnificApiKey || localSettings.freepikApiKey || process.env.MAGNIFIC_API_KEY || process.env.FREEPIK_API_KEY || '',
    imageProvider: providerValue(localSettings.imageProvider || process.env.IMAGE_PROVIDER),
    openAiImageModel: localSettings.openAiImageModel || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    geminiImageModel: localSettings.geminiImageModel || process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    grokModel: localSettings.grokModel || process.env.GROK_IMAGE_MODEL || '',
    grokVideoModel: localSettings.grokVideoModel || process.env.GROK_VIDEO_MODEL || 'grok-imagine-video-1.5',
    gflowProfile: localSettings.gflowProfile || process.env.GFLOW_PROFILE || '',
    gflowVideoModel: localSettings.gflowVideoModel || process.env.GFLOW_VIDEO_MODEL || 'veo-fast',
    magnificVideoModel: localSettings.magnificVideoModel || localSettings.freepikVideoModel || process.env.MAGNIFIC_VIDEO_MODEL || process.env.FREEPIK_VIDEO_MODEL || 'minimax-hailuo-2-3-768p-fast',
    magnificVideoEndpoint: localSettings.magnificVideoEndpoint || localSettings.freepikVideoEndpoint || process.env.MAGNIFIC_VIDEO_ENDPOINT || process.env.FREEPIK_VIDEO_ENDPOINT || '',
    codexBin: codexOverride || await detectBinary('codex'), grokBin: grokOverride || await detectBinary('grok'), gflowBin: gflowOverride || await detectBinary('gflow'),
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
async function hasGflowSession(binary: string, profile?: string) {
  if (!binary) return false;
  try {
    const { stdout } = await run(binary, ['auth', 'list', '--json'], undefined, 5000);
    const profiles = JSON.parse(stdout) as Array<{ name?: string; is_default?: boolean; cookies_present?: boolean }>;
    if (!Array.isArray(profiles)) return false;
    const selected = profile ? profiles.find((candidate) => candidate.name === profile) : profiles.find((candidate) => candidate.is_default) ?? profiles[0];
    return Boolean(selected?.cookies_present);
  } catch { return false; }
}
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
  const [codexInstalled, grokInstalled, gflowInstalled, ffmpegInstalled, ffprobeInstalled] = await Promise.all([canRun(settings.codexBin, ['--version']), canRun(settings.grokBin, ['version']), canRun(settings.gflowBin, ['--version']), canRun(settings.ffmpegBin, ['-version']), canRun(settings.ffprobeBin, ['-version'])]);
  const [codexAuthenticated, gflowAuthenticated, capabilities, matting] = await Promise.all([
    codexInstalled ? canRun(settings.codexBin, ['login', 'status']) : Promise.resolve(false),
    gflowInstalled ? hasGflowSession(settings.gflowBin, settings.gflowProfile) : Promise.resolve(false),
    ffmpegInstalled ? ffmpegCapabilities(settings.ffmpegBin) : Promise.resolve({ videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false }),
    mattingSystemStatus(ffmpegInstalled ? settings.ffmpegBin : ''),
  ]);
  return {
    codex: { installed: codexInstalled, authenticated: codexAuthenticated, path: settings.codexBin || null },
    grok: { installed: grokInstalled, path: settings.grokBin || null, model: settings.grokModel || 'CLI default', videoModel: settings.grokVideoModel },
    gflow: { installed: gflowInstalled, authenticated: gflowAuthenticated, path: settings.gflowBin || null, model: settings.gflowVideoModel, profile: settings.gflowProfile || 'default' },
    ffmpeg: { installed: ffmpegInstalled, path: settings.ffmpegBin || null, capabilities }, ffprobe: { installed: ffprobeInstalled, path: settings.ffprobeBin || null },
    elevenLabs: { configured: Boolean(settings.elevenLabsApiKey) }, imageProvider: settings.imageProvider,
    imageProviders: {
      openai: { configured: Boolean(settings.openAiApiKey), model: settings.openAiImageModel }, gemini: { configured: Boolean(settings.geminiApiKey), model: settings.geminiImageModel },
      grokCli: { configured: grokInstalled, model: settings.grokModel || 'CLI default', experimental: true }, codexCli: { configured: codexInstalled && codexAuthenticated, model: 'Codex CLI', experimental: true },
    },
    videoProviders: {
      grokCli: { configured: grokInstalled, model: settings.grokVideoModel, experimental: true },
      googleFlow: { configured: gflowInstalled && gflowAuthenticated, model: settings.gflowVideoModel, profile: settings.gflowProfile || 'default', experimental: true },
      magnific: { configured: Boolean(settings.magnificApiKey), model: settings.magnificVideoModel, endpoint: settings.magnificVideoEndpoint || `https://api.magnific.com/v1/ai/image-to-video/${settings.magnificVideoModel}`, experimental: false },
    },
    brollVideo: { configured: grokInstalled || (gflowInstalled && gflowAuthenticated) || Boolean(settings.magnificApiKey), provider: 'Grok CLI / Google Flow / Magnific', model: `${settings.grokVideoModel} / ${settings.gflowVideoModel} / ${settings.magnificVideoModel}`, experimental: true },
    matting,
    projectsDir: settings.projectsDir,
  };
}

async function pickNativeFile(prompt = 'Choose a talking-head video') {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', `POSIX path of (choose file with prompt ${JSON.stringify(prompt)})`]); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Video files|*.mov;*.mp4;*.m4v;*.webm|All files|*.*";', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', `--title=${prompt}`, '--file-filter=Video | *.mov *.mp4 *.m4v *.webm']); return stdout.trim();
}

async function pickNativeFiles(prompt = 'Choose one or more talking-head clips') {
  if (process.platform === 'darwin') {
    const script = `set chosenFiles to choose file with prompt ${JSON.stringify(prompt)} with multiple selections allowed\nset output to ""\nrepeat with chosenFile in chosenFiles\nset output to output & POSIX path of chosenFile & linefeed\nend repeat\nreturn output`;
    const { stdout } = await run('osascript', ['-e', script]); return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  if (process.platform === 'win32') {
    const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Video files|*.mov;*.mp4;*.m4v;*.webm|All files|*.*";', '$d.Multiselect = $true;', 'if ($d.ShowDialog() -eq "OK") { $d.FileNames | ForEach-Object { Write-Output $_ } }'].join(' ');
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  const { stdout } = await run('zenity', ['--file-selection', '--multiple', '--separator=\n', `--title=${prompt}`, '--file-filter=Video | *.mov *.mp4 *.m4v *.webm']); return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
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

function assertCompatibleClips(items: Array<{ sourcePath: string; media: MediaProfile }>) {
  const first = items[0]; if (!first) throw new Error('Choose at least one clip');
  if (!first.media.audioCodec) throw new Error(`${path.basename(first.sourcePath)} has no audio track. Multi-clip talking-head projects currently require audio in every clip.`);
  for (const item of items.slice(1)) {
    const a = first.media; const b = item.media; const name = path.basename(item.sourcePath);
    if (!b.audioCodec) throw new Error(`${name} has no audio track. Multi-clip talking-head projects currently require audio in every clip.`);
    if (a.width !== b.width || a.height !== b.height) throw new Error(`${name} is ${b.width || '?'}×${b.height || '?'}. Multi-clip projects currently require the same frame dimensions as the first clip (${a.width || '?'}×${a.height || '?'}).`);
    if (Math.abs((a.frameRate || 30) - (b.frameRate || 30)) > 0.75) throw new Error(`${name} uses ${(b.frameRate || 0).toFixed(2)} fps. Multi-clip projects currently require matching frame rates.`);
    if (Boolean(a.hdr) !== Boolean(b.hdr)) throw new Error(`${name} does not match the first clip's HDR/SDR format. Keep all clips HDR or all clips SDR in one project.`);
  }
}

function routeParam(value: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function getProject(id: string) { const project = projects.get(id); if (!project) throw new Error('Project not found in the local project library.'); return project; }
async function sourceAvailable(project: Project) { const results = await Promise.all(projectClips(project).map((clip) => fs.stat(clip.sourcePath).then((stat) => stat.isFile()).catch(() => false))); return results.every(Boolean); }
async function requireSource(project: Project) { if (await sourceAvailable(project)) return; const missing: string[] = []; for (const clip of projectClips(project)) if (!await fs.stat(clip.sourcePath).then((stat) => stat.isFile()).catch(() => false)) missing.push(clip.sourceName); throw new Error(`Original source clip${missing.length === 1 ? '' : 's'} missing: ${missing.join(', ')}. Relink before this operation.`); }
async function touchProject(project: Project) { await saveProject(project); }
async function invalidateBroll(project: Project) { brollPlans.delete(project.id); await fs.rm(path.join(project.workDir, 'broll-plan.json'), { force: true }); await touchProject(project); }
async function invalidateSourceDerivedState(project: Project) {
  brollPlans.delete(project.id); project.proxyPath = undefined; project.audioPath = undefined; project.transcript = undefined; project.edl = undefined;
  await Promise.all([
    fs.rm(path.join(project.workDir, 'proxy.mp4'), { force: true }),
    fs.rm(path.join(project.workDir, 'analysis.m4a'), { force: true }),
    fs.rm(path.join(project.workDir, 'transcript.json'), { force: true }),
    fs.rm(path.join(project.workDir, 'edl.json'), { force: true }),
    fs.rm(path.join(project.workDir, 'broll-plan.json'), { force: true }),
  ]);
  await touchProject(project);
}

function validateEdl(words: Word[], raw: any) {
  const index = new Map(words.map((word, i) => [word.id, i])); let previousEnd = -1; const ranges: KeepRange[] = [];
  for (const range of raw.keepRanges ?? []) { const start = index.get(range.startWordId); const end = index.get(range.endWordId); if (start === undefined || end === undefined || start > end) throw new Error('Invalid EDL word range'); if (start <= previousEnd) throw new Error('EDL ranges overlap or are out of order'); previousEnd = end; ranges.push({ startWordId: range.startWordId, endWordId: range.endWordId, reason: range.reason ?? '' }); }
  if (!ranges.length) throw new Error('The edit removed the entire video'); return { keepRanges: ranges, notes: Array.isArray(raw.notes) ? raw.notes : [] };
}
function rangesToSeconds(project: Project) {
  const words = project.transcript!.words; const index = new Map(words.map((word, i) => [word.id, i]));
  return project.edl!.keepRanges.map((range) => {
    const startIndex = index.get(range.startWordId)!; const endIndex = index.get(range.endWordId)!; const startWord = words[startIndex]; const endWord = words[endIndex];
    const previousRemovedWord = startIndex > 0 ? words[startIndex - 1] : undefined; const nextRemovedWord = endIndex < words.length - 1 ? words[endIndex + 1] : undefined;
    const paddedStart = Math.max(0, startWord.start - 0.08); const paddedEnd = Math.min(project.media.duration || Number.POSITIVE_INFINITY, endWord.end + 0.12);
    const start = previousRemovedWord ? Math.max(paddedStart, Math.min(startWord.start, previousRemovedWord.end + 0.01)) : paddedStart;
    const end = nextRemovedWord ? Math.min(paddedEnd, Math.max(endWord.end, nextRemovedWord.start - 0.01)) : paddedEnd;
    return { start, end };
  }).filter((range) => range.end > range.start);
}
function proxySize(media: MediaProfile, maxEdge = 720) { const width = media.width || 1280; const height = media.height || 720; const even = (v: number) => Math.max(2, Math.round(v / 2) * 2); if (width >= height) { const w = Math.min(maxEdge, width); return { width: even(w), height: even(height * w / width) }; } const h = Math.min(maxEdge, height); return { width: even(width * h / height), height: even(h) }; }
function normalizedColorTag(value: string | undefined, fallback: string) { const tag = String(value || '').trim().toLowerCase(); if (!tag || tag === 'unknown' || tag === 'unspecified' || tag === 'reserved') return fallback; return tag === 'bt2020ncl' ? 'bt2020nc' : tag; }
function sdrBt709VideoFilter(media: MediaProfile, leadingFilters: string[] = []) {
  const filters = [...leadingFilters]; const transfer = normalizedColorTag(media.colorTransfer, media.hdr ? 'arib-std-b67' : 'bt709'); const primaries = normalizedColorTag(media.colorPrimaries, media.hdr ? 'bt2020' : 'bt709'); const matrix = normalizedColorTag(media.colorSpace, media.hdr ? 'bt2020nc' : 'bt709');
  if (transfer === 'smpte2084' || transfer === 'arib-std-b67') {
    filters.push(`zscale=pin=${primaries}:tin=${transfer}:min=${matrix}:t=linear:npl=100`, 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=mobius:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  } else if (primaries !== 'bt709' || matrix !== 'bt709') {
    filters.push(`zscale=pin=${primaries}:tin=${transfer}:min=${matrix}:p=bt709:t=bt709:m=bt709:r=tv`);
  }
  filters.push('format=yuv420p', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709'); return filters.join(',');
}
function bt709ColorArgs() { return ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']; }
function hlgBt2020VideoFilter() { return 'format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc'; }
function splitSegmentsAtClipBoundaries(project: Project, segments: Array<{ start: number; end: number }>) { return segments.flatMap((segment) => splitTimelineRange(project, segment.start, segment.end).map((piece) => ({ start: piece.start, end: piece.end }))); }

function concatEntry(filePath: string) { return `file '${filePath.replaceAll("'", "'\\''")}'`; }
async function concatPreparedFiles(ffmpegBin: string, inputs: string[], outputPath: string) {
  if (inputs.length === 1) return inputs[0];
  const listPath = `${outputPath}.concat.txt`; await fs.writeFile(listPath, `${inputs.map(concatEntry).join('\n')}\n`); await fs.rm(outputPath, { force: true });
  try { await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath], undefined, 600_000); }
  finally { await fs.rm(listPath, { force: true }); }
  return outputPath;
}

async function prepareProjectMedia(project: Project, includeProxy: boolean) {
  await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.'); const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const clips = syncProjectTimeline(project); const dimensions = proxySize(project.media); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const proxyEncoder = capabilities.h264VideoToolbox ? ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-prio_speed', '1', '-allow_sw', '1', '-b:v', '1500k', '-maxrate', '2500k', '-bufsize', '4M'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'];
  for (const clip of clips) {
    const clipDir = path.join(project.workDir, 'clips', clip.id); await fs.mkdir(clipDir, { recursive: true }); const audioPath = path.join(clipDir, 'analysis.m4a'); const proxyPath = path.join(clipDir, 'proxy.mp4');
    const audioReady = await fs.stat(audioPath).then((stat) => stat.isFile() && stat.size > 1000).catch(() => false); const proxyReady = await fs.stat(proxyPath).then((stat) => stat.isFile() && stat.size > 10_000).catch(() => false);
    if (includeProxy && (!audioReady || !proxyReady)) {
      await run(settings.ffmpegBin, ['-hide_banner', '-y', ...inputAcceleration, '-i', clip.sourcePath, '-map', '0:v:0', '-map', '0:a:0', '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear,fps=30,format=yuv420p`, ...proxyEncoder, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath], undefined, 7_200_000);
    } else if (!audioReady) {
      await run(settings.ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip.sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath], undefined, 1_800_000);
    }
    clip.audioPath = audioPath; if (includeProxy) clip.proxyPath = proxyPath;
  }
  const combinedAudio = await concatPreparedFiles(settings.ffmpegBin, clips.map((clip) => clip.audioPath!), path.join(project.workDir, 'analysis.m4a')); project.audioPath = combinedAudio;
  if (includeProxy) { const combinedProxy = await concatPreparedFiles(settings.ffmpegBin, clips.map((clip) => clip.proxyPath!), path.join(project.workDir, 'proxy.mp4')); project.proxyPath = combinedProxy; }
  await touchProject(project); return { dimensions, hardware: capabilities.h264VideoToolbox };
}

async function renderBrollScenePreview(project: Project, plan: BrollPlan, sceneId: string, ffmpegBin: string) {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found');
  const assetPath = scene.videoFile || scene.imageFile; if (!assetPath) throw new Error('Add or generate a B-roll image or video before previewing');
  let sourcePath = project.proxyPath && await fs.stat(project.proxyPath).then((stat) => stat.isFile()).catch(() => false) ? project.proxyPath : '';
  let sourceStart = scene.sourceStart;
  if (!sourcePath) { const clip = clipAtTimelineTime(project, scene.sourceStart); if (!clip) throw new Error('No source clip covers this B-roll scene'); if (scene.sourceEnd > clip.timelineEnd + 0.001) throw new Error('This B-roll scene crosses a clip boundary. Create the combined proxy before previewing it.'); sourcePath = clip.sourcePath; sourceStart = scene.sourceStart - clip.timelineStart; }
  const [sourceStat, assetStat] = await Promise.all([fs.stat(sourcePath), fs.stat(assetPath)]); const dimensions = proxySize(project.media, 720); const fps = Math.min(30, Math.max(15, project.media.frameRate || 30)); const duration = Math.max(0.5, Math.min(12, scene.sourceEnd - scene.sourceStart)); const template = scene.displayTemplate || plan.settings.displayTemplate || 'full-frame';
  const cacheKey = createHash('sha256').update(JSON.stringify({ previewPipeline: 4, sourcePath, sourceSize: sourceStat.size, sourceMtime: sourceStat.mtimeMs, start: sourceStart, assetPath, assetSize: assetStat.size, assetMtime: assetStat.mtimeMs, duration, template, width: dimensions.width, height: dimensions.height, fps })).digest('hex').slice(0, 16);
  const previewDir = path.join(project.workDir, 'previews', scene.id); const previewPath = path.join(previewDir, 'preview.mp4'); const segmentPath = path.join(previewDir, 'source-segment.mp4'); const metaPath = path.join(previewDir, 'preview.json'); await fs.mkdir(previewDir, { recursive: true });
  const [previewStat, cachedMeta] = await Promise.all([fs.stat(previewPath).catch(() => null), fs.readFile(metaPath, 'utf8').then((value) => JSON.parse(value)).catch(() => null)]);
  if (previewStat?.isFile() && previewStat.size > 10_000 && cachedMeta?.cacheKey === cacheKey) return { previewPath, cacheKey, duration, cached: true };

  const previewSourceFilter = sdrBt709VideoFilter(project.media, [`scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear`, `fps=${fps.toFixed(6)}`]);
  await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', sourceStart.toFixed(6), '-t', duration.toFixed(6), '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0?', '-vf', previewSourceFilter, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', ...bt709ColorArgs(), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', segmentPath], undefined, 300_000);
  const previewScene = { ...scene, sourceStart: 0, sourceEnd: duration, enabled: true }; const previewPlan: BrollPlan = { ...plan, orientation: dimensions.height >= dimensions.width ? 'portrait' : 'landscape', settings: { ...plan.settings, workflowMode: 'raw-video' }, scenes: [previewScene] };
  let mattePath: string | undefined;
  if (planNeedsPresenterMatte(previewPlan)) {
    const matte = await ensurePresenterMatte({ workDir: previewDir, sourcePath: segmentPath, proxyPath: segmentPath, width: dimensions.width, height: dimensions.height, ffmpegBin }); mattePath = matte.maskPath;
    if (!mattePath) throw new Error('Presenter cutout preview could not prepare its alpha mask');
  }
  const { filter, activeScenes } = buildBrollOverlayFilter({ plan: previewPlan, width: dimensions.width, height: dimensions.height, fps, presenterInputIndex: mattePath ? 2 : undefined });
  const brollInputs = activeScenes[0].videoFile ? ['-stream_loop', '-1', '-i', activeScenes[0].videoFile] : ['-loop', '1', '-framerate', String(fps), '-i', activeScenes[0].imageFile!]; const presenterInput = mattePath ? ['-i', mattePath] : [];
  await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', segmentPath, ...brollInputs, ...presenterInput, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-t', duration.toFixed(6), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', ...bt709ColorArgs(), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', previewPath], undefined, 600_000);
  const resultStat = await fs.stat(previewPath).catch(() => null); if (!resultStat?.isFile() || resultStat.size < 10_000) throw new Error('Scene preview finished without creating a playable video');
  await atomicWriteJson(metaPath, { cacheKey, generatedAt: new Date().toISOString(), duration, template }); return { previewPath, cacheKey, duration, cached: false };
}

async function ensureAnalysisAudio(project: Project) {
  if (project.audioPath) { const exists = await fs.stat(project.audioPath).catch(() => null); if (exists?.isFile()) return project.audioPath; }
  await prepareProjectMedia(project, false); if (!project.audioPath) throw new Error('Analysis audio was not created'); return project.audioPath;
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
function hevcOutputPixelFormat(media: MediaProfile) { return media.hdr || sourceBitDepth(media.pixelFormat) > 8 ? 'yuv420p10le' : 'yuv420p'; }
function encodingArgs(project: Project, capabilities: FfmpegCapabilities, mode: 'fast' | 'quality', forceSdr = false) {
  const sourceCodec = String(project.media.videoCodec || '').toLowerCase(); const useHevc = !forceSdr && (project.media.hdr || sourceCodec === 'hevc' || sourceCodec === 'h265'); const hardware = useHevc ? capabilities.hevcVideoToolbox : capabilities.h264VideoToolbox; const targetBitRate = exportBitRate(project.media, useHevc, mode); const pixelFormat = forceSdr ? 'yuv420p' : hevcOutputPixelFormat(project.media); const main10 = pixelFormat === 'yuv420p10le';
  if (hardware) { const encoder = useHevc ? 'hevc_videotoolbox' : 'h264_videotoolbox'; return { encoder, hardware, targetBitRate, args: ['-c:v', encoder, '-allow_sw', '1', ...(mode === 'fast' ? ['-realtime', '1', '-prio_speed', '1'] : []), '-b:v', formatBitRate(targetBitRate), '-maxrate', formatBitRate(Math.round(targetBitRate * 1.2)), '-bufsize', formatBitRate(Math.round(targetBitRate * 2)), ...(useHevc ? ['-pix_fmt', pixelFormat, '-tag:v', 'hvc1', ...(main10 ? ['-profile:v', 'main10'] : [])] : forceSdr ? ['-pix_fmt', 'yuv420p'] : [])] }; }
  if (useHevc) return { encoder: 'libx265', hardware: false, targetBitRate, args: ['-c:v', 'libx265', '-preset', mode === 'fast' ? 'veryfast' : 'fast', '-crf', mode === 'fast' ? '19' : '16', '-pix_fmt', pixelFormat, '-tag:v', 'hvc1'] };
  return { encoder: 'libx264', hardware: false, targetBitRate, args: ['-c:v', 'libx264', '-preset', mode === 'fast' ? 'superfast' : 'veryfast', '-crf', mode === 'fast' ? '19' : '17', ...(forceSdr ? ['-pix_fmt', 'yuv420p'] : [])] };
}
function colorArgs(project: Project) { const args: string[] = []; if (project.media.colorPrimaries) args.push('-color_primaries', project.media.colorPrimaries); if (project.media.colorTransfer) args.push('-color_trc', project.media.colorTransfer); if (project.media.colorSpace) args.push('-colorspace', project.media.colorSpace); return args; }
function parseFfmpegTime(value: string) { const parts = value.split(':').map(Number); if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0; return parts[0] * 3600 + parts[1] * 60 + parts[2]; }
type CheckpointRange = { start: number; end: number; duration: number };
function checkpointRanges(segments: Array<{ start: number; end: number }>, scenes: BrollPlan['scenes'], targetDuration = 12) {
  const ranges: CheckpointRange[] = [];
  for (const segment of segments) {
    let cursor = Math.max(0, segment.start); const segmentEnd = Math.max(cursor, segment.end);
    while (segmentEnd - cursor > 0.01) {
      let boundary = Math.min(segmentEnd, cursor + targetDuration);
      if (boundary < segmentEnd) {
        const crossing = scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile) && scene.sourceStart < boundary && scene.sourceEnd > boundary);
        if (crossing.length) boundary = Math.min(segmentEnd, Math.max(...crossing.map((scene) => scene.sourceEnd)));
        if (segmentEnd - boundary < 2) boundary = segmentEnd;
      }
      if (boundary <= cursor + 0.01) boundary = segmentEnd;
      ranges.push({ start: cursor, end: boundary, duration: boundary - cursor }); cursor = boundary;
    }
  }
  return ranges;
}
async function checkpointSignature(filePath: string) { const stat = await fs.stat(filePath); return { path: filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) }; }
async function checkpointFingerprint(options: { project: Project; plan?: BrollPlan; mattePaths?: string[]; mode: 'fast' | 'quality'; segments: Array<{ start: number; end: number }>; encodingArgs: string[]; fps: number }) {
  const activeScenes = options.plan?.scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile)) ?? []; const files = [...projectClips(options.project).map((clip) => clip.sourcePath), ...(options.mattePaths ?? []), ...activeScenes.map((scene) => scene.videoFile || scene.imageFile)].filter((value): value is string => Boolean(value)); const signatures = await Promise.all(files.map(checkpointSignature));
  const payload = { pipeline: 5, signatures, mode: options.mode, segments: options.segments, encodingArgs: options.encodingArgs, fps: options.fps, width: options.project.media.width, height: options.project.media.height, color: [options.project.media.colorPrimaries, options.project.media.colorTransfer, options.project.media.colorSpace], scenes: activeScenes.map((scene) => ({ id: scene.id, start: scene.sourceStart, end: scene.sourceEnd, template: scene.displayTemplate || options.plan?.settings.displayTemplate, file: scene.videoFile || scene.imageFile })) };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}
function runTrackedExportProcess(projectId: string, command: string, args: string[], onProgress?: (seconds: number, speed: string, frame: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { shell: false, windowsHide: true }); exportProcesses.set(projectId, child); let stdoutBuffer = ''; let stderr = ''; let speed = ''; let frame = 0; let seconds = 0; let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; if (exportProcesses.get(projectId) === child) exportProcesses.delete(projectId); error ? reject(error) : resolve(); };
    const handleLine = (line: string) => { const equals = line.indexOf('='); if (equals < 0) return; const key = line.slice(0, equals); const value = line.slice(equals + 1); if (key === 'out_time') seconds = parseFfmpegTime(value); else if (key === 'out_time_us' || key === 'out_time_ms') seconds = Number(value) / 1_000_000; else if (key === 'speed') speed = value; else if (key === 'frame') frame = Number(value) || frame; onProgress?.(seconds, speed, frame); };
    child.stdout.on('data', (chunk) => { stdoutBuffer += chunk.toString(); let newline = stdoutBuffer.indexOf('\n'); while (newline >= 0) { handleLine(stdoutBuffer.slice(0, newline).trim()); stdoutBuffer = stdoutBuffer.slice(newline + 1); newline = stdoutBuffer.indexOf('\n'); } }); child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); }); child.on('error', (error) => finish(error)); child.on('close', (code, signal) => code === 0 ? finish() : finish(new Error(stderr || `FFmpeg exited with ${signal || `code ${code}`}`)));
  });
}
function launchCheckpointExport(options: { projectId: string; command: string; sessionDir: string; fingerprint: string; outputPath: string; encoder: string; ranges: CheckpointRange[]; buildPartArgs: (range: CheckpointRange, outputPath: string) => string[]; audioArgs: (outputPath: string) => string[] }) {
  const { projectId, command, sessionDir, fingerprint, outputPath, encoder, ranges } = options; const totalDuration = ranges.reduce((sum, range) => sum + range.duration, 0); const partPath = (index: number) => path.join(sessionDir, `part-${String(index).padStart(4, '0')}.mp4`); const manifestPath = path.join(sessionDir, 'manifest.json');
  const job: ExportJob = { state: 'running', progress: 0, outTime: '00:00:00.000000', speed: 'Checking saved checkpoints…', frame: 0, outputPath, encoder, checkpointCompleted: 0, checkpointTotal: ranges.length, resumable: true, resumed: false, startedAt: Date.now() }; exportJobs.set(projectId, job);
  void (async () => {
    const completed = new Set<number>();
    for (let index = 0; index < ranges.length; index += 1) { const stat = await fs.stat(partPath(index)).catch(() => null); if (stat?.isFile() && stat.size > 10_000) completed.add(index); }
    const resumed = completed.size > 0; const completedDuration = () => [...completed].reduce((sum, index) => sum + ranges[index].duration, 0); Object.assign(job, { progress: totalDuration ? completedDuration() / totalDuration * 92 : 0, speed: resumed ? `Resuming · ${completed.size}/${ranges.length} checkpoints ready` : 'Starting checkpoint 1', checkpointCompleted: completed.size, resumed });
    const saveManifest = () => atomicWriteJson(manifestPath, { version: 1, fingerprint, updatedAt: new Date().toISOString(), completed: [...completed].sort((a, b) => a - b), ranges });
    try {
      await saveManifest();
      for (let index = 0; index < ranges.length; index += 1) {
        if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; return; }
        if (completed.has(index)) continue; const range = ranges[index]; const partialPath = `${partPath(index)}.partial.mp4`; await fs.rm(partialPath, { force: true }); job.speed = `Checkpoint ${index + 1}/${ranges.length}`;
        try { await runTrackedExportProcess(projectId, command, options.buildPartArgs(range, partialPath), (seconds, speed, frame) => { job.progress = totalDuration ? Math.min(92, (completedDuration() + Math.min(range.duration, Math.max(0, seconds))) / totalDuration * 92) : 0; job.speed = `Checkpoint ${index + 1}/${ranges.length}${speed ? ` · ${speed}` : ''}`; job.frame = frame; }); }
        catch (error) { await fs.rm(partialPath, { force: true }); if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; job.checkpointCompleted = completed.size; return; } throw error; }
        await fs.rename(partialPath, partPath(index)); completed.add(index); job.checkpointCompleted = completed.size; await saveManifest();
      }
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; return; }
      const concatPath = path.join(sessionDir, 'parts.txt'); const joinedVideo = path.join(sessionDir, 'joined-video.mp4'); const audioPath = path.join(sessionDir, 'audio.m4a'); await fs.writeFile(concatPath, `${ranges.map((_range, index) => `file '${partPath(index).replaceAll("'", "'\\''")}'`).join('\n')}\n`);
      job.progress = 94; job.speed = 'Joining checkpoint video'; await runTrackedExportProcess(projectId, command, ['-f', 'concat', '-safe', '0', '-i', concatPath, '-map', '0:v:0', '-c', 'copy', joinedVideo]);
      job.progress = 96; job.speed = 'Rendering final audio'; await runTrackedExportProcess(projectId, command, options.audioArgs(audioPath));
      job.progress = 98; job.speed = 'Muxing final video'; await runTrackedExportProcess(projectId, command, ['-i', joinedVideo, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', '-movflags', '+faststart', outputPath]);
      job.state = 'completed'; job.progress = 100; job.speed = 'Checkpoint render complete'; job.resumable = false; await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (error) {
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; }
      else { job.state = 'failed'; job.speed = ''; job.error = error instanceof Error ? error.message : String(error); }
      job.checkpointCompleted = completed.size; await fs.rm(outputPath, { force: true }).catch(() => undefined); await saveManifest().catch(() => undefined);
    }
  })();
}
function route(handler: (req: express.Request, res: express.Response) => Promise<void>) { return (req: express.Request, res: express.Response) => { handler(req, res).catch((error) => res.status(500).json({ error: error instanceof Error ? error.message : String(error) })); }; }

function clipForRange(project: Project, range: { start: number; end: number }) { const clip = clipAtTimelineTime(project, Math.min(range.end - 0.0001, range.start + 0.0001)); if (!clip || range.end > clip.timelineEnd + 0.001) throw new Error('Render range crosses a source clip boundary'); return clip; }
function timelineAudioArgs(project: Project, segments: Array<{ start: number; end: number }>, outputPath: string) {
  const pieces = segments.flatMap((segment) => splitTimelineRange(project, segment.start, segment.end)); if (!pieces.length) throw new Error('The audio timeline is empty');
  const inputs = pieces.flatMap((piece) => ['-ss', piece.localStart.toFixed(6), '-t', (piece.localEnd - piece.localStart).toFixed(6), '-i', piece.clip.sourcePath]);
  if (pieces.length === 1) return [...inputs, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '256k', outputPath];
  const prepared = pieces.map((_piece, index) => `[${index}:a]asetpts=PTS-STARTPTS[a${index}]`).join(';'); const labels = pieces.map((_piece, index) => `[a${index}]`).join(''); const filter = `${prepared};${labels}concat=n=${pieces.length}:v=0:a=1[aout]`;
  return [...inputs, '-filter_complex', filter, '-map', '[aout]', '-vn', '-c:a', 'aac', '-b:a', '256k', outputPath];
}

function localPlanForClip(plan: BrollPlan, clip: ProjectClip) {
  const scenes = plan.scenes.filter((scene) => scene.enabled && scene.sourceEnd > clip.timelineStart && scene.sourceStart < clip.timelineEnd).map((scene) => ({ ...scene, sourceStart: Math.max(scene.sourceStart, clip.timelineStart) - clip.timelineStart, sourceEnd: Math.min(scene.sourceEnd, clip.timelineEnd) - clip.timelineStart }));
  return { ...plan, settings: { ...plan.settings, workflowMode: 'raw-video' as const }, scenes };
}
function presenterMatteSpecForClip(plan: BrollPlan, clip: ProjectClip): PresenterMatteSpecInput {
  const localPlan = localPlanForClip(plan, clip);
  const defaultTemplate = localPlan.settings.displayTemplate || 'full-frame';
  const windows = localPlan.scenes
    .filter((scene) => scene.enabled && (scene.imageFile || scene.videoFile) && displayTemplateNeedsPresenterMatte(scene.displayTemplate || defaultTemplate))
    .map((scene) => ({ start: scene.sourceStart, end: scene.sourceEnd }));
  return {
    fps: clip.media.frameRate || 30,
    sourceDuration: clip.media.duration,
    width: clip.media.width || 1080,
    height: clip.media.height || 1920,
    windows,
  };
}
async function ensureProjectPresenterMattes(project: Project, plan: BrollPlan, ffmpegBin: string, onProgress?: (completed: number, total: number, clip: ProjectClip) => void) {
  const result = new Map<string, string>();
  const clips = projectClips(project).filter((clip) => planNeedsPresenterMatte(localPlanForClip(plan, clip)));
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]; onProgress?.(index, clips.length, clip); const clipDir = path.join(project.workDir, 'clips', clip.id); const matte = await ensurePresenterMatte({ workDir: clipDir, sourcePath: clip.sourcePath, proxyPath: clip.proxyPath, width: clip.media.width, height: clip.media.height, ffmpegBin, spec: presenterMatteSpecForClip(plan, clip) }); if (!matte.maskPath) throw new Error(`Presenter matte was not created for ${clip.sourceName}`); result.set(clip.id, matte.maskPath); onProgress?.(index + 1, clips.length, clip);
  }
  return result;
}

app.get('/api/system/status', route(async (_req, res) => { res.json(await systemStatus()); }));
app.get('/api/settings', route(async (_req, res) => { const status = await systemStatus(); res.json({ ...status, overrides: { codexBin: localSettings.codexBin ?? '', grokBin: localSettings.grokBin ?? '', gflowBin: localSettings.gflowBin ?? '', ffmpegBin: localSettings.ffmpegBin ?? '', ffprobeBin: localSettings.ffprobeBin ?? '', projectsDir: localSettings.projectsDir ?? '', imageProvider: localSettings.imageProvider ?? '', openAiImageModel: localSettings.openAiImageModel ?? '', geminiImageModel: localSettings.geminiImageModel ?? '', grokModel: localSettings.grokModel ?? '', grokVideoModel: localSettings.grokVideoModel ?? '', gflowProfile: localSettings.gflowProfile ?? '', gflowVideoModel: localSettings.gflowVideoModel ?? '', magnificVideoModel: localSettings.magnificVideoModel ?? '', magnificVideoEndpoint: localSettings.magnificVideoEndpoint ?? '' } }); }));
app.put('/api/settings', route(async (req, res) => {
  const body = req.body ?? {}; const previousProjectsDir = (await resolvedSettings()).projectsDir;
  if (typeof body.elevenLabsApiKey === 'string' && body.elevenLabsApiKey.trim()) localSettings.elevenLabsApiKey = body.elevenLabsApiKey.trim(); if (typeof body.openAiApiKey === 'string' && body.openAiApiKey.trim()) localSettings.openAiApiKey = body.openAiApiKey.trim(); if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()) localSettings.geminiApiKey = body.geminiApiKey.trim(); if (typeof body.magnificApiKey === 'string' && body.magnificApiKey.trim()) localSettings.magnificApiKey = body.magnificApiKey.trim(); if (typeof body.imageProvider === 'string') localSettings.imageProvider = providerValue(body.imageProvider);
  for (const key of ['codexBin', 'grokBin', 'gflowBin', 'ffmpegBin', 'ffprobeBin', 'projectsDir', 'openAiImageModel', 'geminiImageModel', 'grokModel', 'grokVideoModel', 'gflowProfile', 'gflowVideoModel', 'magnificVideoModel', 'magnificVideoEndpoint'] as const) if (typeof body[key] === 'string') localSettings[key] = body[key].trim() || undefined;
  capabilityCache.clear(); await saveSettings(); const nextProjectsDir = (await resolvedSettings()).projectsDir; if (nextProjectsDir !== previousProjectsDir) await hydrateProjects(true); res.json(await systemStatus());
}));

app.get('/api/projects', route(async (_req, res) => {
  await hydrateProjects(true);
  const summaries = await Promise.all([...projects.values()].map(async (project) => summarizeProject(project, brollPlans.get(project.id))));
  summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  res.json(summaries);
}));

app.post('/api/projects/select', route(async (_req, res) => {
  const sourcePaths = await pickNativeFiles(); if (!sourcePaths.length) return void res.status(400).json({ error: 'No video clips selected' }); const probed = await Promise.all(sourcePaths.map(async (sourcePath) => ({ sourcePath, media: await probe(sourcePath) }))); assertCompatibleClips(probed);
  const settings = await resolvedSettings(); const id = randomUUID(); const workDir = path.join(settings.projectsDir, id); await fs.mkdir(workDir, { recursive: true }); const now = new Date().toISOString(); const firstName = path.basename(sourcePaths[0]);
  const clips: ProjectClip[] = probed.map((item, index) => ({ id: `clip-${String(index + 1).padStart(3, '0')}`, sourcePath: item.sourcePath, sourceName: path.basename(item.sourcePath), media: item.media, timelineStart: 0, timelineEnd: 0 }));
  const project: Project = { id, name: firstName.replace(/\.[^.]+$/, ''), createdAt: now, updatedAt: now, sourcePath: sourcePaths[0], sourceName: firstName, clips, workDir, media: { ...probed[0].media } }; syncProjectTimeline(project);
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
  const project = getProject(routeParam(req.params.id)); const clips = projectClips(project); let target = clips[0];
  for (const clip of clips) { const available = await fs.stat(clip.sourcePath).then((stat) => stat.isFile()).catch(() => false); if (!available) { target = clip; break; } }
  const sourcePath = await pickNativeFile(`Relink ${target.sourceName}`); if (!sourcePath) return void res.status(400).json({ error: 'Relink cancelled' }); const media = await probe(sourcePath); const durationTolerance = Math.max(1.5, (target.media.duration || 0) * 0.02); const durationMismatch = Math.abs((media.duration || 0) - (target.media.duration || 0)) > durationTolerance; const dimensionsMismatch = Boolean(target.media.width && target.media.height && media.width && media.height && (target.media.width !== media.width || target.media.height !== media.height));
  if (durationMismatch || dimensionsMismatch) return void res.status(409).json({ error: `Selected video does not match ${target.sourceName}. Expected roughly ${target.media.width || '?'}×${target.media.height || '?'} and ${target.media.duration.toFixed(1)}s.` });
  target.sourcePath = sourcePath; target.sourceName = path.basename(sourcePath); target.media = { ...target.media, ...media }; syncProjectTimeline(project); await touchProject(project); res.json(await summarizeProject(project, brollPlans.get(project.id)));
}));

app.post('/api/projects/:id/clips', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const sourcePaths = await pickNativeFiles('Add one or more base clips in playback order');
  if (!sourcePaths.length) return void res.status(400).json({ error: 'No additional video clips selected' });
  const existing = projectClips(project); const existingPaths = new Set(existing.map((clip) => path.resolve(clip.sourcePath)));
  const uniquePaths = sourcePaths.filter((sourcePath) => !existingPaths.has(path.resolve(sourcePath)));
  if (!uniquePaths.length) return void res.status(409).json({ error: 'Those clips are already in this project' });
  const added = await Promise.all(uniquePaths.map(async (sourcePath) => ({ sourcePath, media: await probe(sourcePath) })));
  assertCompatibleClips([...existing.map((clip) => ({ sourcePath: clip.sourcePath, media: clip.media })), ...added]);
  let nextNumber = existing.reduce((highest, clip) => Math.max(highest, Number(clip.id.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
  project.clips = [...existing, ...added.map((item) => ({ id: `clip-${String(nextNumber++).padStart(3, '0')}`, sourcePath: item.sourcePath, sourceName: path.basename(item.sourcePath), media: item.media, timelineStart: 0, timelineEnd: 0 }))];
  syncProjectTimeline(project); await invalidateSourceDerivedState(project); res.json(await summarizeProject(project, null));
}));

app.put('/api/projects/:id/clips/order', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const clips = projectClips(project); const clipIds: string[] = Array.isArray(req.body?.clipIds) ? req.body.clipIds.map(String) : [];
  if (clipIds.length !== clips.length || new Set(clipIds).size !== clips.length || clips.some((clip) => !clipIds.includes(clip.id))) throw new Error('The clip order must contain every project clip exactly once');
  const byId = new Map(clips.map((clip) => [clip.id, clip])); project.clips = clipIds.map((id) => byId.get(id)!);
  syncProjectTimeline(project); await invalidateSourceDerivedState(project); res.json(await summarizeProject(project, null));
}));

app.delete('/api/projects/:id/clips/:clipId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const clips = projectClips(project);
  if (clips.length <= 1) throw new Error('A project must keep at least one base clip');
  const clipId = routeParam(req.params.clipId); const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('Base clip not found');
  project.clips = clips.filter((candidate) => candidate.id !== clipId); syncProjectTimeline(project);
  await fs.rm(path.join(project.workDir, 'clips', clip.id), { recursive: true, force: true });
  await invalidateSourceDerivedState(project); res.json(await summarizeProject(project, null));
}));

app.post('/api/projects/:id/prepare', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const result = await prepareProjectMedia(project, true); res.json({ proxyUrl: `/api/projects/${project.id}/proxy`, proxy: { width: result.dimensions.width, height: result.dimensions.height, fps: 30, hardware: result.hardware } });
}));
app.get('/api/projects/:id/proxy', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); if (!project.proxyPath) throw new Error('Proxy has not been generated yet'); res.sendFile(project.proxyPath); }));
app.post('/api/projects/:id/transcribe', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const transcript = await transcribeProject(project); res.json({ transcript, edl: project.edl }); }));
app.post('/api/projects/:id/clean', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const intensity = ['light', 'balanced', 'aggressive'].includes(req.body?.intensity) ? req.body.intensity : 'balanced'; if (!project.transcript) await transcribeProject(project); if (!settings.codexBin) throw new Error('Codex CLI was not found.');
  const schemaPath = path.join(project.workDir, 'edl.schema.json'); const outputPath = path.join(project.workDir, 'codex-edl.json'); await atomicWriteJson(schemaPath, EDL_SCHEMA); const transcript = project.transcript!.words.map((word) => `[${word.id} ${word.start.toFixed(3)}-${word.end.toFixed(3)}] ${word.text}`).join('\n'); const prompt = `You are a decisive professional talking-head dialogue editor. Produce a concise, natural final narration containing only material that earns its place.\n\nThis is DELETE-ONLY editing. Never invent, paraphrase, replace, reorder, or combine spoken words. Keep source chronology. Return only ranges of ORIGINAL words to keep, and never cut inside a word.\n\nREMOVE ALL NON-ESSENTIAL MATERIAL:\n- Silence, dead air, setup time, and unnecessarily long pauses. Infer silence from the timestamp gap between consecutive words. Split keep ranges around removable gaps instead of returning one range that bridges them.\n- Repeated sentences, repeated ideas, duplicate takes, and attempts where the speaker says the same thing again. Keep only the clearest, most complete, most natural version.\n- Fillers, verbal clutter, false starts, abandoned phrases, self-corrections, stumbles, off-topic remarks, production chatter, and low-value tangents.\n- Redundant lead-ins and conclusions that do not add meaning.\n\nPRESERVE:\n- The complete intended meaning, important facts, necessary context, and the speaker's natural voice.\n- Short pauses that make speech understandable or emotionally natural. Make cuts at safe phrase/sentence boundaries so the result remains grammatical and does not sound rushed.\n\nCleanup intensity: ${intensity}.\nLight: remove obvious mistakes, duplicate takes, fillers, and long silence while retaining relaxed pacing.\nBalanced: remove all clear repetition and non-essential wording, tighten ordinary pauses, and preserve only useful context.\nAggressive: keep the shortest coherent version of every necessary idea and remove nearly all avoidable pause or redundancy.\n\nFor every returned keep range, provide a short reason describing why that exact passage is necessary. In notes, summarize removed duplicate takes and major silence cleanup.\n\nSOURCE WORDS:\n${transcript}`;
  await run(settings.codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt); project.edl = validateEdl(project.transcript!.words, JSON.parse(await fs.readFile(outputPath, 'utf8'))); await invalidateBroll(project); await Promise.all([atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl), touchProject(project)]); res.json(project.edl);
}));
app.put('/api/projects/:id/edl', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); if (!project.transcript) throw new Error('Missing transcript'); project.edl = validateEdl(project.transcript.words, { keepRanges: req.body?.keepRanges, notes: ['Manually adjusted'] }); await invalidateBroll(project); await atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl); res.json(project.edl); }));

app.post('/api/projects/:id/broll/plan', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); if (!settings.codexBin) throw new Error('Codex CLI was not found; it is required for B-roll scene planning.'); const transcript = await transcribeProject(project); const requested = (req.body?.settings ?? {}) as Partial<BrollPlanSettings>; const workflowMode = ['cleaned-video', 'raw-video', 'assets-only'].includes(String(requested.workflowMode)) ? requested.workflowMode : 'cleaned-video'; const keepRanges = workflowMode === 'cleaned-video' ? project.edl?.keepRanges : undefined; const orientation = (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape'; const plan = await createBrollPlan({ codexBin: settings.codexBin, workDir: project.workDir, words: transcript.words, keepRanges, orientation, settings: { ...requested, provider: requested.provider || settings.imageProvider } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ plan, transcript, edl: project.edl }); }));
app.get('/api/projects/:id/broll', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const cached = brollPlans.get(project.id); if (cached) return void res.json(cached); const plan = await loadBrollPlan(project.workDir); if (!plan) return void res.status(404).json({ error: 'B-roll plan has not been created yet' }); brollPlans.set(project.id, plan); res.json(plan); }));
app.put('/api/projects/:id/broll/settings', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const patch: Partial<Pick<BrollPlanSettings, 'videoProvider' | 'returnVideoWithAudio'>> = {}; if (typeof req.body?.videoProvider === 'string') patch.videoProvider = videoProviderValue(req.body.videoProvider); if (typeof req.body?.returnVideoWithAudio === 'boolean') patch.returnVideoWithAudio = req.body.returnVideoWithAudio; const updated = await updateBrollSettings(project.workDir, plan, patch); brollPlans.set(project.id, updated); await touchProject(project); res.json(updated); }));
app.put('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const sceneId = routeParam(req.params.sceneId); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const displayTemplate = req.body?.displayTemplate === 'default' ? 'default' : typeof req.body?.displayTemplate === 'string' ? displayTemplateValue(req.body.displayTemplate) : undefined;
  const assetAspectRatio = ['auto', '9:16', '16:9'].includes(String(req.body?.assetAspectRatio)) ? req.body.assetAspectRatio as 'auto' | '9:16' | '16:9' : undefined;
  const scene = await updateBrollScene(project.workDir, plan, sceneId, { title: typeof req.body?.title === 'string' ? req.body.title : undefined, imagePrompt: typeof req.body?.imagePrompt === 'string' ? req.body.imagePrompt : undefined, videoPrompt: typeof req.body?.videoPrompt === 'string' ? req.body.videoPrompt : undefined, sourceStart: Number.isFinite(Number(req.body?.sourceStart)) ? Number(req.body.sourceStart) : undefined, sourceEnd: Number.isFinite(Number(req.body?.sourceEnd)) ? Number(req.body.sourceEnd) : undefined, enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined, displayTemplate, assetAspectRatio }); brollPlans.set(project.id, plan); await touchProject(project); res.json(scene);
}));
app.delete('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const updated = await deleteBrollScene(project.workDir, plan, routeParam(req.params.sceneId)); brollPlans.set(project.id, updated); await touchProject(project); res.json(updated); }));

app.get('/api/projects/:id/presenter-matte', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan || !planNeedsPresenterMatte(plan)) return void res.json({ ready: false, stale: false }); const statuses = [];
  for (const clip of projectClips(project)) { const clipPlan = localPlanForClip(plan, clip); if (planNeedsPresenterMatte(clipPlan)) statuses.push(await presenterMatteStatus(path.join(project.workDir, 'clips', clip.id), clip.sourcePath, presenterMatteSpecForClip(plan, clip))); }
  res.json({ ready: statuses.length > 0 && statuses.every((status) => status.ready), stale: statuses.some((status) => status.stale), generatedAt: statuses.map((status) => status.generatedAt).filter(Boolean).sort().at(-1) });
}));
app.post('/api/projects/:id/presenter-matte', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.'); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan || !planNeedsPresenterMatte(plan)) return void res.json({ ready: false, stale: false }); const mattes = await ensureProjectPresenterMattes(project, plan, settings.ffmpegBin); await touchProject(project); res.json({ ready: mattes.size > 0, stale: false, generatedAt: new Date().toISOString(), clips: mattes.size });
}));

app.post('/api/projects/:id/broll/scenes/:sceneId/generate', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const sceneId = routeParam(req.params.sceneId); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const regenerationComment = typeof req.body?.regenerationComment === 'string' ? req.body.regenerationComment.trim().slice(0, 2000) : undefined;
  const scene = await generateBrollImage({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { openAiApiKey: settings.openAiApiKey, openAiModel: settings.openAiImageModel, geminiApiKey: settings.geminiApiKey, geminiModel: settings.geminiImageModel, grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` });
}));
app.post('/api/projects/:id/broll/scenes/:sceneId/manual-image', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sourcePath = await pickNativeImageFile(); if (!sourcePath) return void res.status(400).json({ error: 'No image selected' }); const scene = await importBrollImage({ workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), sourcePath, ffmpegBin: settings.ffmpegBin }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` }); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/manual-video', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sourcePath = await pickNativeFile('Choose a completed B-roll video'); if (!sourcePath) return void res.status(400).json({ error: 'No video selected' }); const media = await probe(sourcePath); if (!media.videoCodec) throw new Error('The selected file does not contain a video stream.'); const scene = await importBrollVideo({ workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), sourcePath, ffmpegBin: settings.ffmpegBin }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` }); }));
app.get('/api/projects/:id/broll/scenes/:sceneId/image', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const scene = plan?.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId)); if (!scene?.imageFile) return void res.status(404).json({ error: 'B-roll image has not been generated yet' }); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(scene.imageFile); }));

app.post('/api/projects/:id/broll/scenes/:sceneId/video-prompt', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); if (!settings.codexBin) throw new Error('Codex CLI was not found'); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const scene = await createVideoPrompt({ codexBin: settings.codexBin, workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId) }); brollPlans.set(project.id, plan); await touchProject(project); res.json(scene); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/video', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sceneId = routeParam(req.params.sceneId); let scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.videoPrompt) { if (!settings.codexBin) throw new Error('Codex CLI was not found'); scene = await createVideoPrompt({ codexBin: settings.codexBin, workDir: project.workDir, plan, sceneId }); }
  const regenerationComment = typeof req.body?.regenerationComment === 'string' ? req.body.regenerationComment.trim().slice(0, 2000) : undefined;
  const videoProvider = plan.settings.videoProvider || 'grok-cli';
  scene = videoProvider === 'google-flow'
    ? await generateBrollVideoWithGoogleFlow({ workDir: project.workDir, projectName: project.name, plan, sceneId, regenerationComment, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, gflowVideoModel: settings.gflowVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } })
    : videoProvider === 'magnific'
      ? await generateBrollVideoWithMagnific({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { magnificApiKey: settings.magnificApiKey, magnificVideoModel: settings.magnificVideoModel, magnificVideoEndpoint: settings.magnificVideoEndpoint, ffmpegBin: settings.ffmpegBin } })
      : await generateBrollVideoWithGrokCli({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` });
}));
app.post('/api/projects/:id/broll/google-flow/sync', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const unmatched = await listGoogleFlowProjectVideos({ workDir: project.workDir, plan, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); res.json({ plan, unmatched }); }));
app.post('/api/projects/:id/broll/google-flow/assign', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const mediaId = String(req.body?.mediaId ?? ''); const sceneId = String(req.body?.sceneId ?? ''); const videos = await listGoogleFlowProjectVideos({ workDir: project.workDir, plan, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, ffmpegBin: settings.ffmpegBin } }); const video = videos.find((candidate) => candidate.mediaId === mediaId); if (!video) throw new Error('That Flow video is already assigned or was not found in this project. Sync and try again.'); if (!video.localPath || !(await fs.stat(video.localPath).catch(() => null))?.isFile()) throw new Error('This Flow video is not downloaded locally. Download it from Flow, then use “Add video manually” on the scene.'); const scene = await importBrollVideo({ workDir: project.workDir, plan, sceneId, sourcePath: video.localPath, ffmpegBin: settings.ffmpegBin, source: 'flow-catalog', flowMediaId: video.mediaId }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` }); }));
app.get('/api/projects/:id/broll/scenes/:sceneId/video', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const scene = plan?.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId)); if (!scene?.videoFile) return void res.status(404).json({ error: 'B-roll video has not been created yet' }); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(scene.videoFile); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/preview', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const sceneId = routeParam(req.params.sceneId); const result = await renderBrollScenePreview(project, plan, sceneId, settings.ffmpegBin); res.json({ previewUrl: `/api/projects/${project.id}/broll/scenes/${sceneId}/preview?v=${result.cacheKey}`, duration: result.duration, cached: result.cached });
}));
app.get('/api/projects/:id/broll/scenes/:sceneId/preview', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const previewPath = path.join(project.workDir, 'previews', routeParam(req.params.sceneId), 'preview.mp4'); const stat = await fs.stat(previewPath).catch(() => null); if (!stat?.isFile() || stat.size < 10_000) return void res.status(404).json({ error: 'B-roll scene preview has not been rendered yet' }); res.setHeader('Cache-Control', 'private, no-cache'); res.sendFile(previewPath);
}));

app.post('/api/projects/:id/broll/export-assets', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const selectedFolder = await pickFolderPath(); if (!selectedFolder) return void res.status(400).json({ error: 'Export cancelled' }); const destination = path.join(selectedFolder, `video-cleaner-broll-${project.id.slice(0, 8)}`); await fs.mkdir(destination, { recursive: true }); const scenes = [];
  for (const scene of plan.scenes) { let imageFile: string | null = null; let videoFile: string | null = null; if (scene.imageFile) { imageFile = `${scene.id}.png`; await fs.copyFile(scene.imageFile, path.join(destination, imageFile)); } if (scene.videoFile) { videoFile = `${scene.id}.mp4`; await fs.copyFile(scene.videoFile, path.join(destination, videoFile)); } scenes.push({ id: scene.id, title: scene.title, enabled: scene.enabled, sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd, startWordId: scene.startWordId, endWordId: scene.endWordId, narration: scene.narration, visualIntent: scene.visualIntent, shotType: scene.shotType, imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt || null, displayTemplate: scene.displayTemplate || plan.settings.displayTemplate || 'full-frame', assetAspectRatio: scene.assetAspectRatio || 'auto', generatedAspectRatio: scene.generatedAspectRatio || null, orientationChanged: Boolean(scene.orientationChanged), provider: scene.provider || plan.settings.provider, model: scene.model || null, imageFile, videoFile, videoModel: scene.videoModel || null }); }
  const timing = { version: 2, sourceName: project.sourceName, clips: projectClips(project).map((clip) => ({ id: clip.id, sourceName: clip.sourceName, timelineStart: clip.timelineStart, timelineEnd: clip.timelineEnd })), workflowMode: plan.settings.workflowMode, orientation: plan.orientation, settings: plan.settings, scenes }; await atomicWriteJson(path.join(destination, 'broll-timing.json'), timing); await fs.writeFile(path.join(destination, 'README.txt'), 'B-roll images/videos and editable timing data exported by Video Cleaner. Edit broll-timing.json or import the files into any editor.\n'); res.json({ destination, sceneCount: scenes.length });
}));

app.post('/api/projects/:id/broll/export-video', route(async (req, res) => {
  const projectId = routeParam(req.params.id); const project = getProject(projectId); await requireSource(project); const settings = await resolvedSettings(); const storedPlan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!storedPlan) throw new Error('B-roll plan has not been created yet'); if (storedPlan.settings.workflowMode === 'assets-only') throw new Error('Assets-only projects export files and timing JSON, not a rendered video'); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const active = exportJobs.get(projectId); if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' }); const outputPath = await pickExportPath('video-with-broll.mp4', 'Export video with B-roll'); if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' }); const plan = storedPlan;
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality'; const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30; const cleanedSegments = plan.settings.workflowMode === 'cleaned-video' ? rangesToSeconds(project) : undefined; const rawSegments = cleanedSegments?.length ? cleanedSegments : [{ start: 0, end: project.media.duration }]; const sourceSegments = splitSegmentsAtClipBoundaries(project, rawSegments);
  const activeScenes = plan.scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile)); const needsPresenterMatte = planNeedsPresenterMatte(plan);
  const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const outputHdr = project.media.hdr; const encoding = encodingArgs(project, capabilities, mode, !outputHdr); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const ranges = checkpointRanges(sourceSegments, activeScenes); if (!ranges.length) throw new Error('The export timeline is empty');
  const preparingJob: ExportJob = { state: 'running', progress: 0, outTime: '00:00:00.000000', speed: needsPresenterMatte ? 'Preparing presenter cutouts…' : 'Preparing render checkpoints…', frame: 0, outputPath, encoder: encoding.encoder, checkpointCompleted: 0, checkpointTotal: ranges.length, resumable: false, startedAt: Date.now() }; exportJobs.set(projectId, preparingJob);

  void (async () => {
    try {
      const mattePaths = needsPresenterMatte ? await ensureProjectPresenterMattes(project, plan, settings.ffmpegBin!, (completed, total, clip) => {
        preparingJob.speed = `Preparing presenter cutouts ${Math.min(completed + 1, total)}/${total} · ${clip.sourceName}`;
      }) : new Map<string, string>();
      preparingJob.speed = 'Preparing render checkpoints…';
      const fingerprint = await checkpointFingerprint({ project, plan, mattePaths: [...mattePaths.values()], mode, segments: sourceSegments, encodingArgs: encoding.args, fps }); const checkpointRoot = path.join(project.workDir, 'render-checkpoints'); const sessionDir = path.join(checkpointRoot, fingerprint); await fs.mkdir(checkpointRoot, { recursive: true });
      for (const entry of await fs.readdir(checkpointRoot, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== fingerprint) await fs.rm(path.join(checkpointRoot, entry.name), { recursive: true, force: true }); await fs.mkdir(sessionDir, { recursive: true });
      const buildPartArgs = (range: CheckpointRange, partOutputPath: string) => {
        const clip = clipForRange(project, range); const localStart = range.start - clip.timelineStart; const prepared = activeScenes.filter((scene) => scene.sourceEnd > range.start && scene.sourceStart < range.end).map((scene) => ({ original: scene, local: { ...scene, sourceStart: Math.max(scene.sourceStart, range.start) - range.start, sourceEnd: Math.min(scene.sourceEnd, range.end) - range.start } })); const chunkPlan: BrollPlan = { ...plan, settings: { ...plan.settings, workflowMode: 'raw-video' }, scenes: prepared.map((item) => item.local) }; const needsPresenter = planNeedsPresenterMatte(chunkPlan); const baseVideoFilter = outputHdr ? hlgBt2020VideoFilter() : sdrBt709VideoFilter(clip.media); const filter = prepared.length ? buildBrollOverlayFilter({ plan: chunkPlan, width: project.media.width || 1920, height: project.media.height || 1080, fps, presenterInputIndex: needsPresenter ? prepared.length + 1 : undefined, includeAudio: false, baseVideoFilter, outputHdr }).filter : `[0:v]${baseVideoFilter},setpts=PTS-STARTPTS[vout]`;
        const brollInputs = prepared.flatMap(({ original }) => { const offset = Math.max(0, range.start - original.sourceStart); return original.videoFile ? ['-stream_loop', '-1', ...(offset > 0.001 ? ['-ss', offset.toFixed(6)] : []), ...inputAcceleration, '-i', original.videoFile] : ['-loop', '1', '-framerate', String(Math.min(30, fps)), '-i', original.imageFile!]; }); const mattePath = mattePaths.get(clip.id); const presenterInput = needsPresenter && mattePath ? ['-ss', localStart.toFixed(6), '-t', range.duration.toFixed(6), ...inputAcceleration, '-i', mattePath] : [];
        return ['-ss', localStart.toFixed(6), '-t', range.duration.toFixed(6), ...inputAcceleration, '-i', clip.sourcePath, ...brollInputs, ...presenterInput, '-filter_complex', filter, '-map', '[vout]', '-an', '-t', range.duration.toFixed(6), '-fps_mode', 'passthrough', ...encoding.args, ...(outputHdr ? colorArgs(project) : bt709ColorArgs()), '-movflags', '+faststart', partOutputPath];
      };
      const audioArgs = (audioOutputPath: string) => timelineAudioArgs(project, sourceSegments, audioOutputPath);
      launchCheckpointExport({ projectId, command: settings.ffmpegBin!, sessionDir, fingerprint, outputPath, encoder: encoding.encoder, ranges, buildPartArgs, audioArgs });
    } catch (error) {
      preparingJob.state = 'failed'; preparingJob.speed = ''; preparingJob.error = error instanceof Error ? error.message : String(error);
    }
  })();
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, brollScenes: activeScenes.length, presenterMatte: needsPresenterMatte, checkpoints: ranges.length, clips: projectClips(project).length });
}));

app.post('/api/projects/:id/export', route(async (req, res) => {
  const projectId = routeParam(req.params.id); const project = getProject(projectId); await requireSource(project); const settings = await resolvedSettings(); if (!project.transcript || !project.edl) throw new Error('Missing transcript or edit decision list'); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const active = exportJobs.get(projectId); if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' }); const outputPath = await pickExportPath(); if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' });
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality'; const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30; const sourceSegments = splitSegmentsAtClipBoundaries(project, rangesToSeconds(project)); const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const encoding = encodingArgs(project, capabilities, mode); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const ranges = checkpointRanges(sourceSegments, []); if (!ranges.length) throw new Error('The export timeline is empty'); const fingerprint = await checkpointFingerprint({ project, mode, segments: sourceSegments, encodingArgs: encoding.args, fps }); const checkpointRoot = path.join(project.workDir, 'render-checkpoints'); const sessionDir = path.join(checkpointRoot, fingerprint); await fs.mkdir(checkpointRoot, { recursive: true });
  for (const entry of await fs.readdir(checkpointRoot, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== fingerprint) await fs.rm(path.join(checkpointRoot, entry.name), { recursive: true, force: true }); await fs.mkdir(sessionDir, { recursive: true });
  const buildPartArgs = (range: CheckpointRange, partOutputPath: string) => { const clip = clipForRange(project, range); const localStart = range.start - clip.timelineStart; return ['-ss', localStart.toFixed(6), '-t', range.duration.toFixed(6), ...inputAcceleration, '-i', clip.sourcePath, '-map', '0:v:0', '-an', '-t', range.duration.toFixed(6), '-fps_mode', 'passthrough', ...encoding.args, ...colorArgs(project), '-movflags', '+faststart', partOutputPath]; };
  launchCheckpointExport({ projectId, command: settings.ffmpegBin, sessionDir, fingerprint, outputPath, encoder: encoding.encoder, ranges, buildPartArgs, audioArgs: (audioOutputPath) => timelineAudioArgs(project, sourceSegments, audioOutputPath) });
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, checkpoints: ranges.length, clips: projectClips(project).length });
}));
app.get('/api/projects/:id/export-status', route(async (req, res) => { res.json(exportJobs.get(routeParam(req.params.id)) ?? { state: 'idle', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0 }); }));
app.post('/api/projects/:id/export-stop', route(async (req, res) => { const projectId = routeParam(req.params.id); const job = exportJobs.get(projectId); if (!job || job.state !== 'running') return void res.status(409).json({ error: 'No export is currently running' }); job.stopRequested = true; job.speed = job.resumable ? 'Stopping after preserving checkpoints…' : 'Stopping…'; const child = exportProcesses.get(projectId); if (child) child.kill('SIGTERM'); res.status(202).json({ stopping: true, resumable: Boolean(job.resumable) }); }));

const PORT = Number(process.env.PORT || 3001); await loadSettings(); await hydrateProjects(true);
if (process.env.NODE_ENV === 'production') { const distDir = path.resolve('dist'); app.use(express.static(distDir)); app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html'))); }
app.listen(PORT, '127.0.0.1', () => { console.log(`Video Cleaner local server: http://127.0.0.1:${PORT} · ${projects.size} local project${projects.size === 1 ? '' : 's'} restored`); });
