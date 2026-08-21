import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BROLL_STYLE_PRESET, saveBrollPlan, type BrollPlan, type BrollScene, type ImageProvider } from '../server/broll.js';

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function statFile(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  return stat?.isFile() ? stat : null;
}

const workDir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: tsx scripts/recover-broll-plan.ts <project-work-dir>');

const planPath = path.join(workDir, 'broll-plan.json');
if (await statFile(planPath)) throw new Error('Refusing to overwrite an existing broll-plan.json');

const transcript = await readJson<{ words: Array<{ id: string; text: string; start: number; end: number }> }>(path.join(workDir, 'transcript.json'));
const edl = await readJson<{ keepRanges: Array<{ startWordId: string; endWordId: string }> }>(path.join(workDir, 'edl.json'));
const rawPlan = await readJson<{ scenes: Array<Record<string, unknown>>; notes?: unknown[] }>(path.join(workDir, 'codex-broll-plan.json'));
const project = await readJson<{ media: { width?: number; height?: number } }>(path.join(workDir, 'project.json'));

const wordIndex = new Map(transcript.words.map((word, index) => [word.id, index]));
const kept = new Set<number>();
for (const range of edl.keepRanges) {
  const start = wordIndex.get(range.startWordId);
  const end = wordIndex.get(range.endWordId);
  if (start === undefined || end === undefined || start > end) continue;
  for (let index = start; index <= end; index += 1) kept.add(index);
}

const provider: ImageProvider = await statFile(path.join(workDir, 'broll', 'codex-work', 'scene-001', 'scene-001.raw.png')) ? 'codex-cli' : 'gemini';
const scenes: BrollScene[] = [];
let previousStart = -1;
for (const candidate of rawPlan.scenes) {
  const start = wordIndex.get(String(candidate.startWordId ?? ''));
  const end = wordIndex.get(String(candidate.endWordId ?? ''));
  if (start === undefined || end === undefined || start > end || start < previousStart || !kept.has(start) || !kept.has(end)) continue;

  const narration = transcript.words.slice(start, end + 1).filter((_word, index) => kept.has(start + index)).map((word) => word.text).join(' ');
  const sceneNumber = scenes.length + 1;
  const id = `scene-${String(sceneNumber).padStart(3, '0')}`;
  const imagePath = path.join(workDir, 'broll', `${id}.png`);
  const videoPath = path.join(workDir, 'broll', `${id}.mp4`);
  const videoPromptPath = path.join(workDir, `${id}-video-prompt.json`);
  const [imageStat, videoStat, videoPrompt] = await Promise.all([
    statFile(imagePath),
    statFile(videoPath),
    readJson<{ videoPrompt?: string }>(videoPromptPath).catch(() => ({})),
  ]);

  scenes.push({
    id,
    title: String(candidate.title ?? `Scene ${sceneNumber}`).trim().slice(0, 100) || `Scene ${sceneNumber}`,
    startWordId: transcript.words[start].id,
    endWordId: transcript.words[end].id,
    sourceStart: transcript.words[start].start,
    sourceEnd: transcript.words[end].end,
    narration,
    visualIntent: String(candidate.visualIntent ?? '').trim(),
    shotType: String(candidate.shotType ?? '').trim(),
    imagePrompt: String(candidate.imagePrompt ?? '').trim(),
    videoPrompt: videoPrompt.videoPrompt?.trim() || undefined,
    enabled: true,
    ...(imageStat ? { imageFile: imagePath, generatedAt: imageStat.mtime.toISOString(), provider, model: provider === 'codex-cli' ? 'Codex $imagegen (recovered)' : 'recovered' } : {}),
    ...(videoStat ? { videoFile: videoPath, videoGeneratedAt: videoStat.mtime.toISOString(), videoModel: 'grok-imagine-video-1.5' } : {}),
  });
  previousStart = start;
}

if (!scenes.length) throw new Error('No valid scenes could be reconstructed');

const plan: BrollPlan = {
  version: 2,
  orientation: (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape',
  stylePreset: BROLL_STYLE_PRESET,
  settings: {
    workflowMode: 'cleaned-video',
    provider,
    countMode: 'auto',
    targetCount: 6,
    imagesPerMinute: 5,
    minSceneDuration: 3,
    maxSceneDuration: 8,
    aspectRatio: 'auto',
    displayTemplate: 'full-frame',
  },
  scenes,
  notes: [...(rawPlan.notes ?? []).map(String), 'Recovered from codex-broll-plan.json and existing B-roll assets.'],
};

await saveBrollPlan(workDir, plan);
const imageCount = scenes.filter((scene) => scene.imageFile).length;
const videoCount = scenes.filter((scene) => scene.videoFile).length;
console.log(`Recovered ${scenes.length} scenes with ${imageCount} images and ${videoCount} videos.`);
