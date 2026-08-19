import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

type Word = { id: string; text: string; start: number; end: number };
type KeepRange = { startWordId: string; endWordId: string; reason?: string };
type Project = {
  id: string;
  sourcePath: string;
  workDir: string;
  proxyPath?: string;
  audioPath?: string;
  transcript?: { text: string; words: Word[] };
  edl?: { keepRanges: KeepRange[]; notes?: string[] };
  media: Record<string, unknown>;
};

const projects = new Map<string, Project>();

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

function run(command: string, args: string[], stdin?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`));
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

async function probe(sourcePath: string) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourcePath,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream: any) => stream.codec_type === 'video') ?? {};
  const audio = data.streams?.find((stream: any) => stream.codec_type === 'audio') ?? {};
  const hdr = ['smpte2084', 'arib-std-b67'].includes(video.color_transfer);
  return {
    duration: Number(data.format?.duration ?? video.duration ?? 0),
    size: Number(data.format?.size ?? 0),
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    audioCodec: audio.codec_name,
    pixelFormat: video.pix_fmt,
    colorTransfer: video.color_transfer,
    colorPrimaries: video.color_primaries,
    colorSpace: video.color_space,
    hdr,
  };
}

function getProject(id: string) {
  const project = projects.get(id);
  if (!project) throw new Error('Project not found');
  return project;
}

function toMediaUrl(filePath: string) {
  return `media://local/${encodeURIComponent(filePath)}`;
}

function validateEdl(words: Word[], raw: any) {
  const index = new Map(words.map((word, i) => [word.id, i]));
  let previousEnd = -1;
  const ranges: KeepRange[] = [];
  for (const range of raw.keepRanges ?? []) {
    const start = index.get(range.startWordId);
    const end = index.get(range.endWordId);
    if (start === undefined || end === undefined || start > end) throw new Error('Codex returned an invalid word range');
    if (start <= previousEnd) throw new Error('Codex returned overlapping or reordered ranges');
    previousEnd = end;
    ranges.push({ startWordId: range.startWordId, endWordId: range.endWordId, reason: range.reason ?? '' });
  }
  if (!ranges.length) throw new Error('Codex removed the entire video');
  return { keepRanges: ranges, notes: Array.isArray(raw.notes) ? raw.notes : [] };
}

function rangesToSeconds(words: Word[], ranges: KeepRange[]) {
  const index = new Map(words.map((word, i) => [word.id, i]));
  const seconds = ranges.map((range) => {
    const startWord = words[index.get(range.startWordId)!];
    const endWord = words[index.get(range.endWordId)!];
    return { start: Math.max(0, startWord.start - 0.08), end: endWord.end + 0.12 };
  });
  const merged: { start: number; end: number }[] = [];
  for (const segment of seconds) {
    const prev = merged.at(-1);
    if (prev && segment.start - prev.end < 0.2) prev.end = Math.max(prev.end, segment.end);
    else merged.push({ ...segment });
  }
  return merged;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (app.isPackaged) win.loadFile(path.join(__dirname, '../dist/index.html'));
  else win.loadURL('http://localhost:5173');
}

app.whenReady().then(async () => {
  protocol.handle('media', (request) => {
    const encoded = request.url.replace(/^media:\/\/local\//, '');
    const filePath = decodeURIComponent(encoded);
    return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers });
  });

  ipcMain.handle('project:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mov', 'mp4', 'm4v', 'webm'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const id = randomUUID();
    const workDir = path.join(app.getPath('userData'), 'projects', id);
    await fs.mkdir(workDir, { recursive: true });
    const media = await probe(sourcePath);
    const project: Project = { id, sourcePath, workDir, media };
    projects.set(id, project);
    return { ...project, sourceUrl: toMediaUrl(sourcePath) };
  });

  ipcMain.handle('project:prepare', async (_event, id: string) => {
    const project = getProject(id);
    const audioPath = path.join(project.workDir, 'analysis.m4a');
    const proxyPath = path.join(project.workDir, 'proxy.mp4');
    const proxyEncoder = process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-b:v', '2500k'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27'];

    await Promise.all([
      run('ffmpeg', ['-y', '-i', project.sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath]),
      run('ffmpeg', ['-y', '-i', project.sourcePath, '-vf', 'scale=-2:720', ...proxyEncoder, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath]),
    ]);

    project.audioPath = audioPath;
    project.proxyPath = proxyPath;
    return { proxyUrl: toMediaUrl(proxyPath) };
  });

  ipcMain.handle('project:transcribe', async (_event, id: string, apiKey: string) => {
    const project = getProject(id);
    if (!project.audioPath) throw new Error('Prepare the project first');
    if (!apiKey) throw new Error('ElevenLabs API key is required');
    const bytes = await fs.readFile(project.audioPath);
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('timestamps_granularity', 'word');
    form.append('file', new Blob([bytes]), 'analysis.m4a');
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
    if (!response.ok) throw new Error(`ElevenLabs failed: ${response.status} ${await response.text()}`);
    const raw: any = await response.json();
    const words: Word[] = (raw.words ?? [])
      .filter((word: any) => word.type === 'word' && Number.isFinite(word.start) && Number.isFinite(word.end))
      .map((word: any, i: number) => ({ id: `w${String(i + 1).padStart(6, '0')}`, text: word.text, start: word.start, end: word.end }));
    if (!words.length) throw new Error('No timestamped words returned by ElevenLabs');
    project.transcript = { text: raw.text ?? words.map((word) => word.text).join(' '), words };
    project.edl = { keepRanges: [{ startWordId: words[0].id, endWordId: words.at(-1)!.id, reason: 'Original recording' }], notes: [] };
    await fs.writeFile(path.join(project.workDir, 'transcript.json'), JSON.stringify(project.transcript, null, 2));
    return { transcript: project.transcript, edl: project.edl };
  });

  ipcMain.handle('project:clean', async (_event, id: string, intensity: 'light' | 'balanced' | 'aggressive') => {
    const project = getProject(id);
    if (!project.transcript) throw new Error('Transcribe the project first');
    const schemaPath = path.join(project.workDir, 'edl.schema.json');
    const outputPath = path.join(project.workDir, 'codex-edl.json');
    await fs.writeFile(schemaPath, JSON.stringify(EDL_SCHEMA, null, 2));
    const transcript = project.transcript.words.map((w) => `[${w.id} ${w.start.toFixed(3)}-${w.end.toFixed(3)}] ${w.text}`).join('\n');
    const prompt = `You are a professional talking-head dialogue cleaning editor.\n\nThis is DELETE-ONLY editing. Never invent, paraphrase, replace, reorder, or combine spoken words. Keep source chronology. Return only ranges of ORIGINAL words to keep.\n\nCleanup intensity: ${intensity}.\nLight: remove clear fillers, abandoned false starts, duplicate takes, and excessive dead space only.\nBalanced: also remove low-value repetition and concise tangents while preserving natural speech.\nAggressive: optimize pacing strongly, but preserve meaning and grammatical continuity.\n\nPrefer natural cut points. Do not remove a word merely because it is imperfect if the resulting edit sounds unnatural.\n\nSOURCE WORDS:\n${transcript}`;
    await run('codex', ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt);
    const raw = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    project.edl = validateEdl(project.transcript.words, raw);
    await fs.writeFile(path.join(project.workDir, 'edl.json'), JSON.stringify(project.edl, null, 2));
    return project.edl;
  });

  ipcMain.handle('project:set-edl', async (_event, id: string, keepRanges: KeepRange[]) => {
    const project = getProject(id);
    if (!project.transcript) throw new Error('Missing transcript');
    project.edl = validateEdl(project.transcript.words, { keepRanges, notes: ['Manually adjusted'] });
    await fs.writeFile(path.join(project.workDir, 'edl.json'), JSON.stringify(project.edl, null, 2));
    return project.edl;
  });

  ipcMain.handle('project:export', async (_event, id: string, mode: 'fast' | 'quality') => {
    const project = getProject(id);
    if (!project.transcript || !project.edl) throw new Error('Missing transcript or edit decision list');
    const output = await dialog.showSaveDialog({ defaultPath: 'cleaned-video.mp4', filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (output.canceled || !output.filePath) return null;
    const segments = rangesToSeconds(project.transcript.words, project.edl.keepRanges);
    const chains: string[] = [];
    const refs: string[] = [];
    segments.forEach((segment, i) => {
      chains.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${i}]`);
      chains.push(`[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${i}]`);
      refs.push(`[v${i}][a${i}]`);
    });
    chains.push(`${refs.join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`);
    const videoArgs = mode === 'fast' && process.platform === 'darwin'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '35M']
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16'];
    await run('ffmpeg', [
      '-y', '-i', project.sourcePath,
      '-filter_complex', chains.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      ...videoArgs, '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', output.filePath,
    ]);
    return output.filePath;
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
