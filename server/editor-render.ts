import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project } from './project-store.js';
import { projectClips } from './project-store.js';
import type { BrollPlan, BrollScene } from './broll.js';

export type EditorClip = {
  id: string; trackId: string; type: 'video' | 'image' | 'audio' | 'text'; name: string;
  role?: string; externalId?: string; url?: string; text?: string;
  start: number; duration: number; sourceStart: number; sourceDuration: number;
  x: number; y: number; scale: number; rotation: number; opacity: number; volume: number; speed: number;
  metadata?: Record<string, unknown>;
};
export type EditorTrack = {
  id: string; name: string; type: string; role?: string; visible: boolean; locked: boolean; clips: EditorClip[];
};
export type EditorTimeline = {
  name: string; width: number; height: number; fps: number; duration: number; tracks: EditorTrack[];
};
type ResolvedClip = EditorClip & { filePath?: string; hasAudio: boolean; role: string };
export type EditorRender = {
  args: string[];
  duration: number;
  visualClips: number;
  audioClips: number;
  outputPath: string;
};
export type MediaInfo = { duration?: number; audioCodec?: string };

const MAX_CLIPS = 250;
const MIN_LENGTH = 0.04;
const numeric = (value: unknown, fallback: number, min: number, max: number, field: string) => {
  const result = Number(value ?? fallback);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error('Invalid editor ' + field);
  return result;
};
const seconds = (value: number) => value.toFixed(6);
const escapeFilter = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "'\\''").replaceAll(',', '\\,').replaceAll('[', '\\[').replaceAll(']', '\\]');
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const exists = async (filePath: string) => Boolean((await fs.stat(filePath).catch(() => null))?.isFile());

function currentBrollVideo(scene: BrollScene) {
  if (!scene.videoFile || scene.imageStatus === 'failed' || scene.imageStatus === 'generating' || scene.videoStatus === 'stale') return false;
  const rev = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
  return scene.videoSourceImageRevision === undefined || scene.videoSourceImageRevision === rev;
}

function validateTimeline(input: unknown): EditorTimeline {
  if (!input || typeof input !== 'object') throw new Error('No saved CJCut project. Open Live Editor and save the timeline first.');
  const editor = input as EditorTimeline;
  if (!Array.isArray(editor.tracks) || editor.tracks.length > 80) throw new Error('Invalid CJCut tracks');
  numeric(editor.width, 1080, 16, 7680, 'width');
  numeric(editor.height, 1920, 16, 7680, 'height');
  numeric(editor.fps, 30, 1, 120, 'fps');
  let count = 0;
  for (const track of editor.tracks) {
    if (!track || typeof track.id !== 'string' || !Array.isArray(track.clips)) throw new Error('Invalid CJCut track');
    for (const clip of track.clips) {
      if (++count > MAX_CLIPS) throw new Error('Editor timeline has too many clips to render');
      if (!clip || typeof clip.id !== 'string' || typeof clip.type !== 'string') throw new Error('Invalid CJCut clip');
      numeric(clip.start, 0, 0, 14400, 'clip start');
      numeric(clip.duration, 0, MIN_LENGTH, 14400, 'clip duration');
      numeric(clip.sourceStart, 0, 0, 14400, 'source start');
      numeric(clip.speed, 1, 0.25, 4, 'playback speed');
      numeric(clip.scale, 1, 0.05, 2.5, 'scale');
      numeric(clip.x, 50, -500, 500, 'x position');
      numeric(clip.y, 50, -500, 500, 'y position');
      numeric(clip.rotation, 0, -360, 360, 'rotation');
      numeric(clip.opacity, 1, 0, 1, 'opacity');
      numeric(clip.volume, 1, 0, 1, 'volume');
    }
  }
  return editor;
}

function sceneId(clip: EditorClip): string | undefined {
  if (typeof clip.metadata?.sceneId === 'string') return clip.metadata.sceneId;
  if (clip.externalId?.startsWith('scene-')) return clip.externalId;
  return clip.externalId;
}

async function resolveClips(options: {
  project: Project; editor: EditorTimeline; broll: BrollPlan | null;
  probe: (file: string) => Promise<MediaInfo>;
}): Promise<Array<{ clip: ResolvedClip; trackIndex: number }>> {
  const { project, editor, broll } = options;
  const sourceClips = projectClips(project);
  const sceneMap = new Map((broll?.scenes ?? []).map(scene => [scene.id, scene]));
  const mediaInfo = new Map<string, MediaInfo>();
  const resolved: Array<{ clip: ResolvedClip; trackIndex: number }> = [];
  const probe = async (file: string) => {
    if (!mediaInfo.has(file)) mediaInfo.set(file, await options.probe(file));
    return mediaInfo.get(file)!;
  };
  for (let trackIndex = editor.tracks.length - 1; trackIndex >= 0; trackIndex -= 1) {
    const track = editor.tracks[trackIndex];
    if (!track.visible) continue;
    for (const clip of track.clips) {
      if (clip.duration < MIN_LENGTH || clip.opacity === 0 && clip.type !== 'audio') continue;
      const role = clip.role || track.role || (clip.type === 'text' ? 'caption' : '');
      if (clip.type === 'text') {
        if (clip.text && clip.text.trim()) resolved.push({ clip: { ...clip, role, hasAudio: false }, trackIndex });
        continue;
      }
      let filePath: string;
      let audioAllowed = false;
      let sourceDuration = clip.sourceDuration;
      if (role === 'base') {
        const sourceClipId = clip.metadata?.sourceClipId;
        const base = typeof sourceClipId === 'string' ? sourceClips.find(item => item.id === sourceClipId) : sourceClips.length === 1 ? sourceClips[0] : undefined;
        if (!base) throw new Error('Talking-head clip ' + clip.name + ' cannot be matched to its original source.');
        filePath = base.sourcePath;
        sourceDuration = base.media.duration;
        audioAllowed = Boolean(base.media.audioCodec);
      } else if (role === 'broll') {
        const id = sceneId(clip);
        const scene = id ? sceneMap.get(id) : undefined;
        if (!scene?.enabled) throw new Error('B-roll scene ' + (id || clip.name) + ' is missing or disabled. Refresh the editor.');
        if (scene.imageStatus === 'generating' || scene.imageStatus === 'failed') throw new Error('B-roll ' + scene.title + ' is not ready. Finish image generation or remove its clip.');
        if (clip.type === 'video') {
          if (!currentBrollVideo(scene)) throw new Error('Video for ' + scene.title + ' is stale or missing. Refresh the editor.');
          filePath = scene.videoFile!;
          audioAllowed = clip.volume > 0 && Boolean((await probe(filePath)).audioCodec);
        } else {
          if (!scene.imageFile) throw new Error('Image for ' + scene.title + ' is missing. Refresh the editor.');
          filePath = scene.imageFile;
        }
      } else {
        throw new Error('Unsupported editor media: ' + clip.name + '. Only project base and generated B-roll media are currently available.');
      }
      if (!await exists(filePath)) throw new Error('Missing media file for ' + clip.name + ': ' + path.basename(filePath));
      if (clip.type !== 'image' && clip.sourceStart >= sourceDuration - 0.001 && role === 'base') throw new Error('Talking-head trim exceeds the source in ' + clip.name);
      if (clip.type !== 'image' && role === 'base' && clip.sourceStart + clip.duration * clip.speed > sourceDuration + 0.05) {
        throw new Error('Talking-head trim/speed extends past the source in ' + clip.name);
      }
      resolved.push({ clip: { ...clip, role, filePath, hasAudio: audioAllowed && clip.volume > 0 }, trackIndex });
    }
  }
  return resolved;
}

/**
 * Translate the saved CJCut timeline into a single FFmpeg video+audio filtergraph.
 * All file paths come from ProjectClip / BrollScene, never from editor JSON URLs.
 * Track 0 is topmost, last track is bottommost, just like the CJCut preview.
 */
export async function buildEditorRender(options: {
  project: Project; timeline: unknown; broll: BrollPlan | null;
  ffmpegBin: string; outputPath: string; workDir: string; mode: 'fast' | 'quality';
  inputVideoArgs?: string[]; outputVideoArgs?: string[]; outputColorArgs?: string[];
  probe: (file: string) => Promise<MediaInfo>;
}): Promise<EditorRender> {
  const editor = validateTimeline(options.timeline);
  const width = Math.round(numeric(editor.width, options.project.media.width || 1080, 16, 3840, 'width') / 2) * 2;
  const height = Math.round(numeric(editor.height, options.project.media.height || 1920, 16, 3840, 'height') / 2) * 2;
  const fps = numeric(editor.fps, 30, 1, 60, 'fps');
  const resolved = await resolveClips({ project: options.project, editor, broll: options.broll, probe: options.probe });
  const duration = Math.max(0, ...resolved.map(({ clip }) => clip.start + clip.duration));
  if (duration < MIN_LENGTH) throw new Error('The CJCut timeline contains no visible clips.');
  if (duration > 14400) throw new Error('CJCut timeline is longer than the four-hour render limit.');
  const args: string[] = [
    '-f', 'lavfi', '-i', 'color=c=black:s=' + width + 'x' + height + ':r=' + fps + ':d=' + seconds(duration),
  ];
  const filters: string[] = ['[0:v]setpts=PTS-STARTPTS,format=yuva420p[basecanvas]'];
  let videoLabel = 'basecanvas';
  const audioLabels: string[] = [];
  let visualClips = 0; let audioClips = 0; let inputIndex = 1;
  await fs.mkdir(options.workDir, { recursive: true });
  for (const { clip } of resolved) {
    if (clip.type === 'text') {
      const filename = path.join(options.workDir, 'text-' + String(visualClips++).padStart(3, '0') + '.txt');
      await fs.writeFile(filename, clip.text || '', 'utf8');
      const fontSize = Math.max(12, Math.round(width * 0.035 * clip.scale));
      const x = '(w-text_w)/2+' + seconds((clip.x - 50) * width / 100);
      const y = '(h-text_h)/2+' + seconds((clip.y - 50) * height / 100);
      const label = 'layer' + visualClips;
      filters.push('[' + videoLabel + ']drawtext=textfile=' + escapeFilter(filename) +
        ':fontsize=' + fontSize + ':fontcolor=white@' + seconds(clamp01(clip.opacity)) +
        ':borderw=' + Math.max(1, Math.round(fontSize * 0.07)) + ':bordercolor=black@0.75' +
        ':x=' + x + ':y=' + y +
        ':enable=between(t\\,' + seconds(clip.start) + '\\,' + seconds(clip.start + clip.duration) + ')[' + label + ']');
      videoLabel = label;
      continue;
    }
    const id = inputIndex++;
    const sourceSeconds = clip.sourceStart + clip.duration * clip.speed;
    if (clip.type === 'image') args.push('-loop', '1', '-framerate', String(fps), '-i', clip.filePath!);
    else args.push(...(clip.role === 'broll' ? ['-stream_loop', '-1'] : []), ...(options.inputVideoArgs ?? []), '-i', clip.filePath!);
    const trim = clip.type === 'image'
      ? 'trim=duration=' + seconds(clip.duration)
      : 'trim=start=' + seconds(clip.sourceStart) + ':end=' + seconds(sourceSeconds);
    const scaledW = Math.max(2, Math.round(width * clip.scale / 2) * 2);
    const scaledH = Math.max(2, Math.round(height * clip.scale / 2) * 2);
    const opacity = seconds(clamp01(clip.opacity));
    const angle = seconds(clip.rotation * Math.PI / 180);
    const rotate = Math.abs(clip.rotation) > 0.001 ? ',rotate=' + angle + ':ow=rotw(' + angle + '):oh=roth(' + angle + '):c=none' : '';
    const label = 'clip' + id;
    filters.push('[' + id + ':v]' + trim + ',setpts=(PTS-STARTPTS)/' + seconds(clip.speed) +
      '+' + seconds(clip.start) + '/TB,fps=' + fps +
      ',scale=' + scaledW + ':' + scaledH + ':force_original_aspect_ratio=decrease:flags=lanczos' +
      ',format=rgba,pad=' + scaledW + ':' + scaledH + ':(ow-iw)/2:(oh-ih)/2:color=black@0' +
      ',colorchannelmixer=aa=' + opacity + rotate + ',format=yuva420p[' + label + ']');
    const out = 'layer' + ++visualClips;
    const x = '(W*' + seconds(clip.x / 100) + '-w/2)';
    const y = '(H*' + seconds(clip.y / 100) + '-h/2)';
    filters.push('[' + videoLabel + '][' + label + ']overlay=x=' + x + ':y=' + y +
      ':eof_action=pass:repeatlast=0:format=auto:enable=between(t\\,' + seconds(clip.start) + '\\,' + seconds(clip.start + clip.duration) + ')[' + out + ']');
    videoLabel = out;
    if (clip.hasAudio && clip.type !== 'image') {
      const audioLabel = 'aud' + id;
      const delayMs = Math.round(clip.start * 1000);
      filters.push('[' + id + ':a]atrim=start=' + seconds(clip.sourceStart) + ':end=' + seconds(sourceSeconds) +
        ',asetpts=PTS-STARTPTS,atempo=' + seconds(clip.speed) +
        ',aresample=48000,volume=' + opacity + ',volume=' + seconds(clip.volume) +
        ',adelay=' + delayMs + ':all=1[' + audioLabel + ']');
      audioLabels.push(audioLabel); audioClips++;
    }
  }
  filters.push('[' + videoLabel + ']format=yuv420p[vout]');
  if (audioLabels.length) {
    filters.push(audioLabels.map(label => '[' + label + ']').join('') +
      (audioLabels.length > 1 ? 'amix=inputs=' + audioLabels.length + ':duration=longest:dropout_transition=0,' : '') +
      'atrim=duration=' + seconds(duration) + ',asetpts=PTS-STARTPTS[aout]');
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioLabels.length) args.push('-map', '[aout]');
  else args.push('-map', String(inputIndex) + ':a:0');
  const outputVideoArgs = options.outputVideoArgs ?? [
    '-c:v', 'libx264', '-preset', options.mode === 'quality' ? 'medium' : 'veryfast',
    '-crf', options.mode === 'quality' ? '18' : '23', '-pix_fmt', 'yuv420p',
  ];
  args.push(
    '-t', seconds(duration), '-r', String(fps), ...outputVideoArgs, ...(options.outputColorArgs ?? []),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', options.outputPath,
  );
  return { args, duration, visualClips, audioClips, outputPath: options.outputPath };
}
