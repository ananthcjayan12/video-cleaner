import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BrollPlan } from './broll.js';
import { projectClips, reconcileBrollFiles, resolveBrollAssetPath, type Project, type Word } from './project-store.js';

export type ProjectExportContents = {
  clips: number;
  words: number;
  brollImages: number;
  brollVideos: number;
  files: number;
};

export type ProjectZipExportResult = ProjectExportContents & {
  destination: string;
  archiveBytes: number;
};

export type ProjectExportOptions = {
  talkingHeadVideo: boolean;
  proxyPreview: boolean;
  analysisAudio: boolean;
  subtitles: boolean;
  transcriptText: boolean;
  wordTimestamps: boolean;
  editTimeline: boolean;
  brollImages: boolean;
  brollVideos: boolean;
  brollTiming: boolean;
};

export const DEFAULT_PROJECT_EXPORT_OPTIONS: ProjectExportOptions = {
  talkingHeadVideo: true,
  proxyPreview: true,
  analysisAudio: true,
  subtitles: true,
  transcriptText: true,
  wordTimestamps: true,
  editTimeline: true,
  brollImages: true,
  brollVideos: true,
  brollTiming: true,
};

export function normalizeProjectExportOptions(value: unknown): ProjectExportOptions {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_PROJECT_EXPORT_OPTIONS };
  for (const key of Object.keys(result) as Array<keyof ProjectExportOptions>) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key] as boolean;
  }
  return result;
}

type SubtitleCue = { start: number; end: number; text: string };

async function isFile(filePath?: string) {
  if (!filePath) return false;
  const stat = await fs.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile());
}

function safeFileName(value: string, fallback = 'project') {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return cleaned || fallback;
}

function archivePath(...parts: string[]) {
  return parts.join('/');
}

async function linkOrCopy(sourcePath: string, destinationPath: string) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.rm(destinationPath, { force: true });
  try {
    await fs.link(sourcePath, destinationPath);
  } catch {
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

async function writeJson(filePath: string, value: unknown) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function subtitleCues(words: Word[]) {
  const cues: SubtitleCue[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    cues.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((word) => word.text).join(' ').replace(/\s+([,.;:!?])/g, '$1'),
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    const duration = current[current.length - 1].end - current[0].start;
    if (current.length >= 8 || duration >= 4.25 || /[.!?…]$/.test(word.text)) flush();
  }
  flush();
  return cues;
}

function formatTimestamp(seconds: number, separator: ',' | '.') {
  const totalMs = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

function toSrt(cues: SubtitleCue[]) {
  return cues.map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n${cue.text}\n`).join('\n');
}

function toVtt(cues: SubtitleCue[]) {
  const body = cues.map((cue) => `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n${cue.text}\n`).join('\n');
  return `WEBVTT\n\n${body}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function wordCsv(words: Word[]) {
  return [
    'id,text,start_seconds,end_seconds,duration_seconds',
    ...words.map((word) => [word.id, word.text, word.start.toFixed(6), word.end.toFixed(6), Math.max(0, word.end - word.start).toFixed(6)].map(csvCell).join(',')),
  ].join('\n') + '\n';
}

function cleanedTimeline(project: Project) {
  if (!project.transcript?.words?.length || !project.edl?.keepRanges?.length) return [];
  const words = project.transcript.words;
  const byId = new Map(words.map((word) => [word.id, word]));
  return project.edl.keepRanges.flatMap((range, index) => {
    const start = byId.get(range.startWordId);
    const end = byId.get(range.endWordId);
    if (!start || !end) return [];
    return [{
      index: index + 1,
      startWordId: range.startWordId,
      endWordId: range.endWordId,
      sourceStart: start.start,
      sourceEnd: end.end,
      duration: Math.max(0, end.end - start.start),
      reason: range.reason || '',
    }];
  });
}

function psQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runProcess(command: string, args: string[], cwd?: string) {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-8000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})${stderr ? `\n${stderr}` : ''}`)));
  });
}

async function createZipArchive(sourceDirectory: string, destination: string) {
  const absoluteDestination = path.resolve(destination);
  await fs.mkdir(path.dirname(absoluteDestination), { recursive: true });
  await fs.rm(absoluteDestination, { force: true });

  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Compress-Archive -LiteralPath ${psQuote(sourceDirectory)} -DestinationPath ${psQuote(absoluteDestination)} -Force`,
    ].join('; ');
    await runProcess('powershell', ['-NoProfile', '-Command', script]);
    return;
  }

  const parent = path.dirname(sourceDirectory);
  const folderName = path.basename(sourceDirectory);
  try {
    await runProcess('zip', ['-0', '-X', '-q', '-r', absoluteDestination, folderName], parent);
  } catch (zipError) {
    try {
      await runProcess('python3', ['-m', 'zipfile', '-c', absoluteDestination, folderName], parent);
    } catch {
      throw new Error(`Could not create ZIP archive. Install the "zip" command (or Python 3). Original error: ${zipError instanceof Error ? zipError.message : String(zipError)}`);
    }
  }
}

export async function buildProjectExportDirectory(options: {
  project: Project;
  plan: BrollPlan | null;
  directory: string;
  exportOptions?: Partial<ProjectExportOptions>;
}): Promise<ProjectExportContents> {
  const { project, directory } = options;
  const plan = options.plan ? await reconcileBrollFiles(project, options.plan) : null;
  const selection = normalizeProjectExportOptions(options.exportOptions);
  if (!Object.values(selection).some(Boolean)) throw new Error('Select at least one item to export.');
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });

  let fileCount = 0;
  const register = () => { fileCount += 1; };
  const clips = projectClips(project);
  const clipManifest: Array<Record<string, unknown>> = [];
  let exportedClips = 0;

  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const sourceAvailable = await isFile(clip.sourcePath);
    let relative: string | null = null;
    if (selection.talkingHeadVideo && sourceAvailable) {
      const sourceExt = path.extname(clip.sourceName || clip.sourcePath) || path.extname(clip.sourcePath) || '.mp4';
      const sourceBase = safeFileName(path.basename(clip.sourceName || clip.sourcePath, sourceExt), `clip-${index + 1}`);
      relative = archivePath('talking-head', `${String(index + 1).padStart(3, '0')}-${sourceBase}${sourceExt.toLowerCase()}`);
      await linkOrCopy(clip.sourcePath, path.join(directory, relative));
      register();
      exportedClips += 1;
    }
    clipManifest.push({
      id: clip.id,
      originalName: clip.sourceName,
      sourceAvailable,
      requested: selection.talkingHeadVideo,
      file: relative,
      timelineStart: clip.timelineStart,
      timelineEnd: clip.timelineEnd,
      duration: clip.media.duration,
      width: clip.media.width,
      height: clip.media.height,
      frameRate: clip.media.frameRate,
      videoCodec: clip.media.videoCodec,
      audioCodec: clip.media.audioCodec,
    });
  }

  let proxyFile: string | null = null;
  if (selection.proxyPreview && await isFile(project.proxyPath)) {
    proxyFile = archivePath('talking-head', 'proxy-preview.mp4');
    await linkOrCopy(project.proxyPath!, path.join(directory, proxyFile));
    register();
  }

  let analysisAudioFile: string | null = null;
  if (selection.analysisAudio && await isFile(project.audioPath)) {
    const extension = path.extname(project.audioPath!) || '.m4a';
    analysisAudioFile = archivePath('audio', `analysis${extension.toLowerCase()}`);
    await linkOrCopy(project.audioPath!, path.join(directory, analysisAudioFile));
    register();
  }

  const transcript = project.transcript;
  const words = transcript?.words ?? [];
  let transcriptFiles: Record<string, string> | null = null;
  if (words.length && (selection.subtitles || selection.transcriptText || selection.wordTimestamps)) {
    const cues = selection.subtitles ? subtitleCues(words) : [];
    transcriptFiles = {};
    if (selection.transcriptText) {
      transcriptFiles.text = archivePath('captions', 'transcript.txt');
      await writeText(path.join(directory, transcriptFiles.text), `${transcript?.text || words.map((word) => word.text).join(' ')}\n`);
      register();
    }
    if (selection.subtitles) {
      transcriptFiles.srt = archivePath('captions', 'captions.srt');
      transcriptFiles.vtt = archivePath('captions', 'captions.vtt');
      await writeText(path.join(directory, transcriptFiles.srt), toSrt(cues)); register();
      await writeText(path.join(directory, transcriptFiles.vtt), toVtt(cues)); register();
    }
    if (selection.wordTimestamps) {
      transcriptFiles.wordJson = archivePath('captions', 'word-level-timestamps.json');
      transcriptFiles.wordCsv = archivePath('captions', 'word-level-timestamps.csv');
      await writeJson(path.join(directory, transcriptFiles.wordJson), { version: 1, timeline: 'source', words }); register();
      await writeText(path.join(directory, transcriptFiles.wordCsv), wordCsv(words)); register();
    }
  }

  let edlFile: string | null = null;
  let cleanedTimelineFile: string | null = null;
  if (selection.editTimeline && project.edl) {
    edlFile = archivePath('timeline', 'edl.json');
    cleanedTimelineFile = archivePath('timeline', 'cleaned-timeline.json');
    await writeJson(path.join(directory, edlFile), project.edl); register();
    await writeJson(path.join(directory, cleanedTimelineFile), {
      version: 1,
      timeline: 'source',
      keepRanges: cleanedTimeline(project),
      notes: project.edl.notes ?? [],
    }); register();
  }

  const brollScenes: Array<Record<string, unknown>> = [];
  const missingBrollImages: string[] = [];
  const missingBrollVideos: string[] = [];
  let brollImages = 0;
  let brollVideos = 0;
  if (plan && (selection.brollImages || selection.brollVideos || selection.brollTiming)) {
    for (const scene of plan.scenes) {
      let imageFile: string | null = null;
      let videoFile: string | null = null;
      const imagePath = await resolveBrollAssetPath(project.workDir, scene, 'image');
      const videoPath = await resolveBrollAssetPath(project.workDir, scene, 'video');
      const imageAvailable = Boolean(imagePath);
      const videoAvailable = Boolean(videoPath);
      if (selection.brollImages && !imageAvailable) missingBrollImages.push(scene.id);
      if (selection.brollVideos && !videoAvailable) missingBrollVideos.push(scene.id);
      if (selection.brollImages && imageAvailable) {
        const extension = path.extname(imagePath!) || '.png';
        imageFile = archivePath('broll', 'images', `${safeFileName(scene.id, 'scene')}${extension.toLowerCase()}`);
        await linkOrCopy(imagePath!, path.join(directory, imageFile));
        register(); brollImages += 1;
      }
      if (selection.brollVideos && videoAvailable) {
        const extension = path.extname(videoPath!) || '.mp4';
        videoFile = archivePath('broll', 'videos', `${safeFileName(scene.id, 'scene')}${extension.toLowerCase()}`);
        await linkOrCopy(videoPath!, path.join(directory, videoFile));
        register(); brollVideos += 1;
      }
      brollScenes.push({
        id: scene.id,
        title: scene.title,
        enabled: scene.enabled,
        sourceStart: scene.sourceStart,
        sourceEnd: scene.sourceEnd,
        startWordId: scene.startWordId,
        endWordId: scene.endWordId,
        narration: scene.narration,
        visualIntent: scene.visualIntent,
        shotType: scene.shotType,
        imagePrompt: scene.imagePrompt,
        videoPrompt: scene.videoPrompt ?? null,
        displayTemplate: scene.displayTemplate || plan.settings.displayTemplate || 'full-frame',
        assetAspectRatio: scene.assetAspectRatio || 'auto',
        generatedAspectRatio: scene.generatedAspectRatio ?? null,
        orientationChanged: Boolean(scene.orientationChanged),
        imageProvider: scene.provider || plan.settings.provider,
        imageModel: scene.model ?? null,
        videoProvider: scene.videoProvider || plan.settings.videoProvider,
        videoModel: scene.videoModel ?? null,
        imageAvailable,
        videoAvailable,
        imageFile,
        videoFile,
      });
    }
  }

  let brollTimingFile: string | null = null;
  if (plan && selection.brollTiming) {
    brollTimingFile = archivePath('timeline', 'broll-timing.json');
    await writeJson(path.join(directory, brollTimingFile), {
      version: 2,
      timeline: 'source',
      workflowMode: plan.settings.workflowMode,
      orientation: plan.orientation,
      stylePreset: plan.stylePreset,
      settings: plan.settings,
      notes: plan.notes,
      scenes: brollScenes,
    });
    register();
  }

  const manifestFile = archivePath('project-manifest.json');
  await writeJson(path.join(directory, manifestFile), {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'Video Cleaner',
    selection,
    project: {
      id: project.id,
      name: project.name,
      sourceName: project.sourceName,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      duration: project.media.duration,
      width: project.media.width,
      height: project.media.height,
      frameRate: project.media.frameRate,
      hdr: project.media.hdr,
    },
    clips: clipManifest,
    talkingHead: { proxyPreview: proxyFile },
    audio: { analysis: analysisAudioFile },
    captions: transcriptFiles,
    timeline: {
      edl: edlFile,
      cleanedTimeline: cleanedTimelineFile,
      brollTiming: brollTimingFile,
      timebase: 'seconds on original/source timeline',
    },
    counts: {
      clips: exportedClips,
      words: words.length,
      brollScenes: plan?.scenes.length ?? 0,
      brollImages,
      brollVideos,
    },
    missing: {
      talkingHeadClips: selection.talkingHeadVideo ? clipManifest.filter((clip) => !clip.sourceAvailable).map((clip) => clip.originalName) : [],
      proxyPreview: selection.proxyPreview && !proxyFile,
      analysisAudio: selection.analysisAudio && !analysisAudioFile,
      transcript: (selection.subtitles || selection.transcriptText || selection.wordTimestamps) && words.length === 0,
      editTimeline: selection.editTimeline && !project.edl,
      brollPlan: (selection.brollImages || selection.brollVideos || selection.brollTiming) && !plan,
      brollImages: missingBrollImages,
      brollVideos: missingBrollVideos,
    },
  });
  register();

  const included = [
    selection.talkingHeadVideo && '- talking-head/ : original source-quality talking-head clip(s).',
    selection.proxyPreview && proxyFile && '- talking-head/proxy-preview.mp4 : local preview proxy.',
    selection.analysisAudio && analysisAudioFile && '- audio/ : lightweight analysis audio.',
    selection.brollImages && '- broll/images/ : generated or manually imported B-roll stills.',
    selection.brollVideos && '- broll/videos/ : generated or manually imported B-roll video clips.',
    selection.subtitles && '- captions/captions.srt + captions.vtt : editor-friendly subtitles.',
    selection.transcriptText && '- captions/transcript.txt : narration transcript.',
    selection.wordTimestamps && '- captions/word-level-timestamps.json + .csv : exact word timings.',
    selection.editTimeline && '- timeline/edl.json + cleaned-timeline.json : dialogue edit decisions and kept source ranges.',
    selection.brollTiming && '- timeline/broll-timing.json : B-roll source timing, prompts, layout and provider/model metadata.',
  ].filter(Boolean);
  const readme = [
    'VIDEO CLEANER — EDITABLE PROJECT EXPORT',
    '',
    'This ZIP is designed for manual finishing in editors such as DaVinci Resolve, Adobe Premiere Pro, Final Cut Pro or CapCut.',
    '',
    'Selected export contents:',
    ...included,
    '- project-manifest.json : portable index of this partial/full package.',
    '',
    'Timing convention:',
    'All exported timestamps use seconds on the original project source timeline. For multi-clip projects, each clip has timelineStart/timelineEnd in project-manifest.json even when source video was not selected.',
    '',
    'Tip:',
    'You can create multiple lightweight ZIPs from the same Video Cleaner project, for example subtitles-only, B-roll-only, or source-video + timing.',
    'If a selected asset is missing, Video Cleaner skips that file and still creates the ZIP. Check project-manifest.json -> missing for the skipped items.',
    '',
  ].join('\n');
  await writeText(path.join(directory, 'README.txt'), readme);
  register();

  return { clips: exportedClips, words: selection.wordTimestamps ? words.length : 0, brollImages, brollVideos, files: fileCount };
}

export async function exportProjectZip(options: {
  project: Project;
  plan: BrollPlan | null;
  destination: string;
  exportOptions?: Partial<ProjectExportOptions>;
}): Promise<ProjectZipExportResult> {
  const bundleName = `video-cleaner-${safeFileName(options.project.name, 'project').replace(/\s+/g, '-')}-${options.project.id.slice(0, 8)}`;
  const temporaryRoot = await fs.mkdtemp(path.join(options.project.workDir, '.editable-export-'));
  const bundleDirectory = path.join(temporaryRoot, bundleName);
  try {
    const contents = await buildProjectExportDirectory({ project: options.project, plan: options.plan, directory: bundleDirectory, exportOptions: options.exportOptions });
    await createZipArchive(bundleDirectory, options.destination);
    const stat = await fs.stat(options.destination);
    return { ...contents, destination: options.destination, archiveBytes: stat.size };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
