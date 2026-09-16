import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadBrollPlan, type BrollPlan, type BrollScene } from './broll.js';

export type Word = { id: string; text: string; start: number; end: number };
export type KeepRange = { startWordId: string; endWordId: string; reason?: string };
export type MediaProfile = {
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
  colorRange?: string;
  rotation?: number;
  hdr: boolean;
};

export type ProjectClip = {
  id: string;
  sourcePath: string;
  sourceName: string;
  media: MediaProfile;
  timelineStart: number;
  timelineEnd: number;
  proxyPath?: string;
  audioPath?: string;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourcePath: string;
  workDir: string;
  sourceName: string;
  clips?: ProjectClip[];
  proxyPath?: string;
  audioPath?: string;
  transcript?: { text: string; words: Word[] };
  edl?: { keepRanges: KeepRange[]; notes?: string[] };
  media: MediaProfile;
};

export type ProjectSummary = {
  id: string;
  name: string;
  sourceName: string;
  clipCount: number;
  clips: Array<{ id: string; sourceName: string; duration: number; timelineStart: number; timelineEnd: number }>;
  createdAt: string;
  updatedAt: string;
  media: MediaProfile;
  sourceAvailable: boolean;
  proxyUrl?: string;
  state: {
    proxyReady: boolean;
    transcriptReady: boolean;
    cleaned: boolean;
    brollPlanned: boolean;
    brollScenes: number;
    brollImages: number;
    brollVideos: number;
    missingImages: number;
    missingVideos: number;
  };
};

const projectWriteChains = new Map<string, Promise<void>>();

async function statFile(filePath?: string) {
  if (!filePath) return null;
  const stat = await fs.stat(filePath).catch(() => null);
  return stat?.isFile() ? stat : null;
}
async function exists(filePath?: string) { return Boolean(await statFile(filePath)); }

type BrollAssetKind = 'image' | 'video';

function absoluteProjectPath(workDir: string, filePath?: string) {
  if (!filePath) return undefined;
  return path.isAbsolute(filePath) ? filePath : path.resolve(workDir, filePath);
}

async function matchingFiles(directory: string, prefix: string, extensions: Set<string>) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const matches: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!extensions.has(extension)) continue;
    const filePath = path.join(directory, entry.name);
    const stat = await statFile(filePath);
    if (stat) matches.push({ path: filePath, mtimeMs: stat.mtimeMs });
  }
  return matches.sort((a, b) => b.mtimeMs - a.mtimeMs).map((match) => match.path);
}

async function resolvedBrollAsset(workDir: string, scene: BrollScene, kind: BrollAssetKind) {
  const brollDir = path.join(workDir, 'broll');
  const candidates: string[] = [];
  const add = (filePath?: string) => {
    const absolute = absoluteProjectPath(workDir, filePath);
    if (absolute && !candidates.includes(absolute)) candidates.push(absolute);
  };

  const imageRevision = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
  const currentVideo = kind === 'video'
    ? scene.videoStatus !== 'stale' && (scene.videoSourceImageRevision === undefined || scene.videoSourceImageRevision === imageRevision)
    : true;

  if (kind === 'image') add(scene.imageFile);
  else if (currentVideo) add(scene.videoFile);

  if (kind === 'video' && currentVideo) {
    const attempts = (scene.videoAttempts ?? [])
      .filter((attempt) => attempt.status === 'completed' && (attempt.sourceImageRevision === undefined || attempt.sourceImageRevision === imageRevision))
      .sort((a, b) => (a.id === scene.activeVideoAttemptId ? -1 : 0) - (b.id === scene.activeVideoAttemptId ? -1 : 0) || String(b.completedAt ?? b.startedAt).localeCompare(String(a.completedAt ?? a.startedAt)));
    for (const attempt of attempts) add(attempt.localFile);
  }

  add(path.join(brollDir, `${scene.id}${kind === 'image' ? '.png' : '.mp4'}`));
  const extensions = kind === 'image' ? new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif']) : new Set(['.mp4', '.mov', '.m4v', '.webm']);
  const canonicalMatches = kind === 'video' && !currentVideo ? [] : await matchingFiles(brollDir, `${scene.id}.`, extensions);
  for (const match of canonicalMatches) add(match);
  if (kind === 'video' && currentVideo) {
    const attemptMatches = await matchingFiles(path.join(brollDir, 'video-attempts'), `${scene.id}-`, extensions);
    for (const match of attemptMatches) add(match);
  }

  for (const candidate of candidates) if (await statFile(candidate)) return candidate;
  return undefined;
}

export async function resolveBrollAssetPath(workDir: string, scene: BrollScene, kind: BrollAssetKind) {
  return resolvedBrollAsset(workDir, scene, kind);
}

export function projectClips(project: Project): ProjectClip[] {
  if (project.clips?.length) return project.clips;
  return [{
    id: 'clip-001', sourcePath: project.sourcePath, sourceName: project.sourceName, media: { ...project.media },
    timelineStart: 0, timelineEnd: Math.max(0, project.media.duration || 0), proxyPath: project.proxyPath, audioPath: project.audioPath,
  }];
}

export function syncProjectTimeline(project: Project) {
  const clips = projectClips(project).map((clip, index) => ({ ...clip, id: clip.id || `clip-${String(index + 1).padStart(3, '0')}` }));
  let cursor = 0;
  for (const clip of clips) {
    clip.timelineStart = cursor;
    cursor += Math.max(0, Number(clip.media.duration) || 0);
    clip.timelineEnd = cursor;
  }
  const first = clips[0];
  if (first) {
    project.sourcePath = first.sourcePath;
    project.sourceName = first.sourceName;
    project.media = {
      ...first.media,
      duration: cursor,
      size: clips.reduce((sum, clip) => sum + Math.max(0, Number(clip.media.size) || 0), 0),
      bitRate: undefined,
    };
  }
  project.clips = clips;
  return clips;
}

export function clipAtTimelineTime(project: Project, time: number) {
  const clips = syncProjectTimeline(project);
  const safe = Math.max(0, time);
  return clips.find((clip, index) => safe >= clip.timelineStart && (safe < clip.timelineEnd || index === clips.length - 1)) ?? clips.at(-1);
}

export function splitTimelineRange(project: Project, start: number, end: number) {
  const clips = syncProjectTimeline(project);
  const pieces: Array<{ clip: ProjectClip; start: number; end: number; localStart: number; localEnd: number }> = [];
  for (const clip of clips) {
    const pieceStart = Math.max(start, clip.timelineStart);
    const pieceEnd = Math.min(end, clip.timelineEnd);
    if (pieceEnd - pieceStart <= 0.001) continue;
    pieces.push({ clip, start: pieceStart, end: pieceEnd, localStart: pieceStart - clip.timelineStart, localEnd: pieceEnd - clip.timelineStart });
  }
  return pieces;
}

export async function atomicWriteJson(filePath: string, value: unknown) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const previous = projectWriteChains.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, payload);
    await fs.rename(tempPath, filePath);
  });
  projectWriteChains.set(filePath, next);
  try {
    await next;
  } finally {
    if (projectWriteChains.get(filePath) === next) projectWriteChains.delete(filePath);
  }
}

export async function saveProject(project: Project, touch = true) {
  syncProjectTimeline(project);
  if (touch) project.updatedAt = new Date().toISOString();
  await atomicWriteJson(path.join(project.workDir, 'project.json'), project);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function loadProjectDirectory(workDir: string): Promise<Project | null> {
  const raw = await readJson<Partial<Project> & { id?: string; sourcePath?: string; sourceName?: string; media?: MediaProfile }>(path.join(workDir, 'project.json'));
  if (!raw?.id || !raw.sourcePath || !raw.media) return null;

  const now = new Date().toISOString();
  const project: Project = {
    id: raw.id,
    name: String(raw.name || raw.sourceName || path.basename(raw.sourcePath)).replace(/\.[^.]+$/, ''),
    createdAt: raw.createdAt || raw.updatedAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now,
    sourcePath: raw.sourcePath,
    sourceName: raw.sourceName || path.basename(raw.sourcePath),
    clips: Array.isArray(raw.clips) ? raw.clips.map((clip, index) => ({
      id: clip.id || `clip-${String(index + 1).padStart(3, '0')}`,
      sourcePath: clip.sourcePath,
      sourceName: clip.sourceName || path.basename(clip.sourcePath),
      media: clip.media,
      timelineStart: Number(clip.timelineStart) || 0,
      timelineEnd: Number(clip.timelineEnd) || Number(clip.media?.duration) || 0,
      proxyPath: clip.proxyPath,
      audioPath: clip.audioPath,
    })).filter((clip) => Boolean(clip.sourcePath && clip.media)) : undefined,
    workDir,
    proxyPath: raw.proxyPath,
    audioPath: raw.audioPath,
    transcript: raw.transcript,
    edl: raw.edl,
    media: raw.media,
  };
  syncProjectTimeline(project);

  const proxyCandidate = project.proxyPath || path.join(workDir, 'proxy.mp4');
  if (await exists(proxyCandidate)) project.proxyPath = proxyCandidate;
  else project.proxyPath = undefined;

  const audioCandidate = project.audioPath || path.join(workDir, 'analysis.m4a');
  if (await exists(audioCandidate)) project.audioPath = audioCandidate;
  else project.audioPath = undefined;

  for (const clip of project.clips ?? []) {
    const clipDir = path.join(workDir, 'clips', clip.id);
    const clipProxy = clip.proxyPath || path.join(clipDir, 'proxy.mp4');
    const clipAudio = clip.audioPath || path.join(clipDir, 'analysis.m4a');
    clip.proxyPath = await exists(clipProxy) ? clipProxy : undefined;
    clip.audioPath = await exists(clipAudio) ? clipAudio : undefined;
  }

  if (!project.transcript) project.transcript = await readJson(path.join(workDir, 'transcript.json'));
  if (!project.edl) project.edl = await readJson(path.join(workDir, 'edl.json'));

  return project;
}

export async function scanProjects(projectsDir: string) {
  await fs.mkdir(projectsDir, { recursive: true });
  const entries = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const loaded = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => loadProjectDirectory(path.join(projectsDir, entry.name))));
  return loaded.filter((project): project is Project => Boolean(project));
}

export async function reconcileBrollFiles(project: Project, plan: BrollPlan | null) {
  if (!plan) return null;
  let changed = false;
  for (const scene of plan.scenes) {
    const imagePath = await resolvedBrollAsset(project.workDir, scene, 'image');
    const imageStat = await statFile(imagePath);
    if (imagePath && (scene.imageFile !== imagePath || !scene.generatedAt)) {
      scene.imageFile = imagePath;
      scene.generatedAt ||= imageStat?.mtime.toISOString();
      changed = true;
    } else if (!imagePath && scene.imageFile) {
      scene.imageFile = undefined; scene.generatedAt = undefined; scene.model = undefined; changed = true;
    }

    scene.imageRevision = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
    const videoPath = await resolvedBrollAsset(project.workDir, scene, 'video');
    const videoStat = await statFile(videoPath);
    if (videoPath && (scene.videoFile !== videoPath || !scene.videoGeneratedAt || scene.videoStatus !== 'ready')) {
      scene.videoFile = videoPath;
      scene.videoGeneratedAt ||= videoStat?.mtime.toISOString();
      scene.videoSourceImageRevision ??= scene.imageRevision;
      scene.videoStatus = 'ready';
      changed = true;
    } else if (!videoPath && scene.videoFile) {
      scene.videoFile = undefined; scene.videoGeneratedAt = undefined; scene.videoModel = undefined; scene.videoProvider = undefined; scene.activeVideoAttemptId = undefined; scene.videoSourceImageRevision = undefined; scene.videoStatus = scene.imageFile ? 'stale' : 'none'; changed = true;
    }
  }
  if (changed) await atomicWriteJson(path.join(project.workDir, 'broll-plan.json'), plan);
  return plan;
}

async function allSourcesAvailable(project: Project) {
  const clips = syncProjectTimeline(project);
  const results = await Promise.all(clips.map((clip) => exists(clip.sourcePath)));
  return results.every(Boolean);
}

export async function summarizeProject(project: Project, brollPlan?: BrollPlan | null): Promise<ProjectSummary> {
  const clips = syncProjectTimeline(project);
  const loadedPlan = brollPlan === undefined ? await loadBrollPlan(project.workDir) : brollPlan;
  const plan = await reconcileBrollFiles(project, loadedPlan ?? null);
  const scenes = plan?.scenes ?? [];
  const brollImages = scenes.filter((scene) => Boolean(scene.imageFile)).length;
  const brollVideos = scenes.filter((scene) => Boolean(scene.videoFile) && scene.videoStatus !== 'stale' && (scene.videoSourceImageRevision === undefined || scene.videoSourceImageRevision === scene.imageRevision)).length;
  const videoEligible = scenes.filter((scene) => Boolean(scene.imageFile)).length;
  const sourceName = clips.length > 1 ? `${clips.length} clips · ${clips[0].sourceName}${clips.length > 1 ? ` + ${clips.length - 1} more` : ''}` : project.sourceName;
  return {
    id: project.id,
    name: project.name,
    sourceName,
    clipCount: clips.length,
    clips: clips.map((clip) => ({ id: clip.id, sourceName: clip.sourceName, duration: clip.media.duration, timelineStart: clip.timelineStart, timelineEnd: clip.timelineEnd })),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    media: project.media,
    sourceAvailable: await allSourcesAvailable(project),
    proxyUrl: await exists(project.proxyPath) ? `/api/projects/${project.id}/proxy` : undefined,
    state: {
      proxyReady: await exists(project.proxyPath),
      transcriptReady: Boolean(project.transcript?.words?.length),
      cleaned: await exists(path.join(project.workDir, 'edl.json')),
      brollPlanned: Boolean(plan),
      brollScenes: scenes.length,
      brollImages,
      brollVideos,
      missingImages: scenes.filter((scene) => !scene.imageFile).length,
      missingVideos: Math.max(0, videoEligible - brollVideos),
    },
  };
}

export async function loadProjectSnapshot(project: Project) {
  const broll = await reconcileBrollFiles(project, await loadBrollPlan(project.workDir));
  return {
    project: await summarizeProject(project, broll),
    transcript: project.transcript ?? null,
    edl: project.edl ?? null,
    broll,
    proxyUrl: await exists(project.proxyPath) ? `/api/projects/${project.id}/proxy` : null,
  };
}
