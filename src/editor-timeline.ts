import type { CJCutClip, CJCutProject, CJCutTrack } from '@cjcut/editor';
import { api, type BrollDisplayTemplate, type BrollPlan, type BrollScene, type Edl, type MotionPlan, type MotionScene, type Project, type Word } from './api';

type TimelineSegment = { sourceStart: number; sourceEnd: number; timelineStart: number; timelineEnd: number };

export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

/**
 * How far a B-roll clip may be stretched. CJCut caps a clip at sourceDuration - sourceStart, so this must be the real
 * media length (not the short planned window) or the editor can only ever shorten a generated clip.
 */
export function brollSourceDuration(scene: BrollScene, type: 'video' | 'image', fallback: number) {
  if (type === 'image') return Math.max(fallback, STILL_MAX_SECONDS);
  return Math.max(fallback, scene.videoDuration ?? 0);
}
const STILL_MAX_SECONDS = 120;

export function hasCurrentVideo(scene: BrollScene) {
  if (!scene.videoFile || scene.videoStatus === 'stale' || scene.imageStatus === 'generating' || scene.imageStatus === 'failed') return false;
  if (scene.videoTreatment === 'still' && scene.videoProvider !== 'still-effect') return false;
  if (scene.videoTreatment === 'ai' && scene.videoProvider === 'still-effect') return false;
  const imageRevision = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
  return scene.videoSourceImageRevision === undefined || scene.videoSourceImageRevision === imageRevision;
}

function cleanedSegments(words: Word[], edl: Edl | null, duration: number): TimelineSegment[] {
  if (!words.length || !edl?.keepRanges?.length) return [{ sourceStart: 0, sourceEnd: duration, timelineStart: 0, timelineEnd: duration }];
  const index = new Map(words.map((word, i) => [word.id, i]));
  const source = edl.keepRanges.flatMap((range) => {
    const startIndex = index.get(range.startWordId); const endIndex = index.get(range.endWordId);
    if (startIndex === undefined || endIndex === undefined || startIndex > endIndex) return [];
    return [{ sourceStart: words[startIndex].start, sourceEnd: words[endIndex].end }];
  }).sort((a, b) => a.sourceStart - b.sourceStart);
  let cursor = 0;
  return source.map((segment) => {
    const length = Math.max(0, segment.sourceEnd - segment.sourceStart);
    const result = { ...segment, timelineStart: cursor, timelineEnd: cursor + length };
    cursor += length;
    return result;
  });
}

function sourceToTimeline(time: number, segments: TimelineSegment[]) {
  for (const segment of segments) {
    if (time >= segment.sourceStart - 0.001 && time <= segment.sourceEnd + 0.001) {
      return segment.timelineStart + Math.max(0, Math.min(segment.sourceEnd, time) - segment.sourceStart);
    }
  }
  const before = [...segments].reverse().find((segment) => segment.sourceEnd < time);
  if (before) return before.timelineEnd;
  return Math.max(0, time);
}

function layoutTransform(layout: BrollDisplayTemplate | undefined) {
  switch (layout) {
    case 'picture-in-picture': return { x: 78, y: 25, scale: 0.34 };
    case 'top-card':
    case 'top-card-presenter': return { x: 50, y: 25, scale: 0.48 };
    case 'split-top':
    case 'stacked-talking-top': return { x: 50, y: 74, scale: 0.5 };
    case 'stacked-broll-top': return { x: 50, y: 26, scale: 0.5 };
    case 'presenter-overlay':
    case 'stacked-cards-cutout': return { x: 50, y: 50, scale: 1 };
    default: return { x: 50, y: 50, scale: 1 };
  }
}

export const usableMotion = (scene: MotionScene) => scene.enabled && scene.status === 'ready' && Boolean(scene.videoFile);

export function freshProject(project: Project, words: Word[], edl: Edl | null, broll: BrollPlan | null, motion: MotionPlan | null): CJCutProject {
  const width = project.media.width || 1080;
  const height = project.media.height || 1920;
  const fps = project.media.frameRate || 30;
  const useCleaned = Boolean(edl?.keepRanges?.length);
  const segments = cleanedSegments(words, useCleaned ? edl : null, project.media.duration);
  const duration = Math.max(0.1, segments.at(-1)?.timelineEnd || project.media.duration || 30);
  const sourceClips = project.clips?.length ? project.clips : [{
    id: '__base_video__',
    sourceName: project.sourceName,
    duration: project.media.duration,
    timelineStart: 0,
    timelineEnd: project.media.duration,
  }];
  const baseClips: CJCutClip[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    for (const sourceClip of sourceClips) {
      const intersectionStart = Math.max(segment.sourceStart, sourceClip.timelineStart);
      const intersectionEnd = Math.min(segment.sourceEnd, sourceClip.timelineEnd);
      if (intersectionEnd <= intersectionStart + 0.001) continue;
      const externalId = `vc-base-${sourceClip.id}-${segmentIndex}`;
      baseClips.push({
        id: externalId,
        externalId,
        role: 'base',
        trackId: 'vc-base',
        type: 'video',
        name: sourceClips.length > 1 ? sourceClip.sourceName : 'Talking head',
        url: sourceClip.id === '__base_video__'
          ? api.editorBaseVideoUrl(project.id, project.updatedAt)
          : api.editorBaseClipUrl(project.id, sourceClip.id, project.updatedAt),
        start: segment.timelineStart + (intersectionStart - segment.sourceStart),
        duration: Math.max(0.05, intersectionEnd - intersectionStart),
        sourceStart: Math.max(0, intersectionStart - sourceClip.timelineStart),
        sourceDuration: sourceClip.duration,
        x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1,
        metadata: {
          sourceClipId: sourceClip.id,
          sourceStart: intersectionStart,
          sourceEnd: intersectionEnd,
          managed: true,
        },
      });
    }
  }
  const baseTrack: CJCutTrack = {
    id: 'vc-base',
    externalId: 'vc-base',
    role: 'base',
    name: 'Talking head',
    type: 'video',
    visible: true,
    locked: false,
    clips: baseClips,
  };

  const brollTracks: CJCutTrack[] = [];
  for (const scene of broll?.scenes ?? []) {
    if (!scene.enabled || scene.imageStatus === 'generating' || scene.imageStatus === 'failed') continue;
    const useVideo = hasCurrentVideo(scene);
    const hasImage = Boolean(scene.imageFile);
    if (!useVideo && !hasImage) continue;
    const start = useCleaned ? sourceToTimeline(scene.sourceStart, segments) : scene.sourceStart;
    const end = useCleaned ? sourceToTimeline(scene.sourceEnd, segments) : scene.sourceEnd;
    const clipDuration = Math.max(0.15, end - start);
    const layout = scene.displayTemplate ?? broll?.settings.displayTemplate;
    const transform = layoutTransform(layout);
    const type = useVideo ? 'video' : 'image';
    const url = useVideo
      ? api.brollVideoUrl(project.id, scene.id, scene.videoGeneratedAt)
      : api.brollImageUrl(project.id, scene.id, scene.generatedAt);
    brollTracks.push({
      id: `vc-broll-track-${scene.id}`,
      externalId: scene.id,
      role: 'broll',
      name: `B-roll · ${scene.title}`,
      type,
      visible: true,
      locked: false,
      clips: [{
        id: `vc-broll-${scene.id}`,
        externalId: scene.id,
        role: 'broll',
        trackId: `vc-broll-track-${scene.id}`,
        type,
        name: scene.title,
        url,
        start,
        duration: clipDuration,
        sourceStart: 0,
        sourceDuration: brollSourceDuration(scene, type, clipDuration),
        x: transform.x, y: transform.y, scale: transform.scale, rotation: 0, opacity: 1, volume: 0, speed: 1,
        metadata: {
          managed: true,
          sceneId: scene.id,
          assetKind: type,
          assetVersion: useVideo ? (scene.videoGeneratedAt || '') : (scene.generatedAt || ''),
          layout: layout || 'full-frame',
        },
      }],
    });
  }

  // Motion graphics sit above B-roll. Their WebM carries an alpha channel, so the presenter shows through.
  const motionTracks: CJCutTrack[] = [];
  for (const scene of motion?.scenes ?? []) {
    if (!usableMotion(scene)) continue;
    const start = useCleaned ? sourceToTimeline(scene.sourceStart, segments) : scene.sourceStart;
    const end = useCleaned ? sourceToTimeline(scene.sourceEnd, segments) : scene.sourceEnd;
    const clipDuration = Math.max(0.15, end - start);
    motionTracks.push({
      id: `${MOTION_TRACK_PREFIX}${scene.id}`,
      externalId: scene.id,
      role: 'overlay',
      name: `Motion · ${scene.title}`,
      type: 'video',
      visible: true,
      locked: false,
      clips: [{
        id: `vc-motion-${scene.id}`,
        externalId: scene.id,
        role: 'overlay',
        trackId: `${MOTION_TRACK_PREFIX}${scene.id}`,
        type: 'video',
        name: scene.title,
        url: api.motionVideoUrl(project.id, scene.id, scene.renderedAt),
        start,
        duration: clipDuration,
        sourceStart: 0,
        sourceDuration: Math.max(clipDuration, scene.sourceEnd - scene.sourceStart),
        x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 0, speed: 1,
        metadata: { managed: true, motionId: scene.id, assetVersion: scene.renderedAt || '' },
      }],
    });
  }

  return {
    name: `${project.name} · Live edit`,
    width,
    height,
    fps,
    duration: Math.max(duration, ...[...motionTracks, ...brollTracks].flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)), 1),
    tracks: [...motionTracks, ...brollTracks, baseTrack],
  };
}

const MOTION_TRACK_PREFIX = 'vc-motion-track-';
const isMotionTrack = (track: CJCutTrack) => track.id.startsWith(MOTION_TRACK_PREFIX) || track.clips.some(clip => typeof clip.metadata?.motionId === 'string');

export function reconcileSaved(saved: CJCutProject | null, fresh: CJCutProject, broll: BrollPlan | null, motion: MotionPlan | null, projectId: string): CJCutProject {
  if (!saved) return fresh;
  const freshTracksByExternal = new Map(fresh.tracks.filter(track => track.externalId).map(track => [track.externalId!, track]));
  const freshClipsByExternal = new Map(fresh.tracks.flatMap(track => track.clips).filter(clip => clip.externalId).map(clip => [clip.externalId!, clip]));
  const scenesById = new Map((broll?.scenes ?? []).map(scene => [scene.id, scene]));
  const motionById = new Map((motion?.scenes ?? []).map(scene => [scene.id, scene]));
  const seenTracks = new Set<string>();
  const suppressed = new Set(saved.suppressedManagedTrackIds ?? []);

  const refreshClip = (clip: CJCutClip, trackId: string): CJCutClip | null => {
    if (!clip.externalId || clip.role === 'imported') return { ...clone(clip), trackId };
    if (typeof clip.metadata?.motionId === 'string') {
      const graphic = motionById.get(clip.metadata.motionId);
      if (!graphic || !usableMotion(graphic)) return null;
      return {
        ...clone(clip), trackId, type: 'video', url: api.motionVideoUrl(projectId, graphic.id, graphic.renderedAt),
        metadata: { ...clip.metadata, assetVersion: graphic.renderedAt || '' },
      };
    }
    if (clip.role === 'broll') {
      const scene = scenesById.get(String(clip.metadata?.sceneId || clip.externalId));
      if (!scene?.enabled || scene.imageStatus === 'generating' || scene.imageStatus === 'failed') return null;
      const managedSceneTrack = trackId === `vc-broll-track-${scene.id}`;
      const wantsImage = !managedSceneTrack && (clip.type === 'image' || clip.metadata?.assetKind === 'image');
      if (wantsImage && scene.imageFile) return {
        ...clone(clip), trackId, type: 'image', sourceDuration: brollSourceDuration(scene, 'image', clip.duration),
        url: api.brollImageUrl(projectId, scene.id, scene.generatedAt),
        metadata: { ...clip.metadata, assetKind: 'image', assetVersion: scene.generatedAt || '' },
      };
      if (hasCurrentVideo(scene)) return {
        ...clone(clip), trackId, type: 'video', sourceDuration: brollSourceDuration(scene, 'video', clip.duration),
        url: api.brollVideoUrl(projectId, scene.id, scene.videoGeneratedAt),
        metadata: { ...clip.metadata, assetKind: 'video', assetVersion: scene.videoGeneratedAt || '' },
      };
      if (scene.imageFile) return {
        ...clone(clip), trackId, type: 'image', sourceDuration: brollSourceDuration(scene, 'image', clip.duration),
        url: api.brollImageUrl(projectId, scene.id, scene.generatedAt),
        metadata: { ...clip.metadata, assetKind: 'image', assetVersion: scene.generatedAt || '' },
      };
      return null;
    }
    const current = freshClipsByExternal.get(clip.externalId);
    if (!current) return null;
    return { ...clone(clip), trackId, type: current.type, url: current.url, sourceDuration: current.sourceDuration, metadata: current.metadata };
  };

  const tracks: CJCutTrack[] = saved.tracks.flatMap(track => {
    if (track.externalId && suppressed.has(track.externalId)) return [];
    const currentTrack = track.externalId ? freshTracksByExternal.get(track.externalId) : undefined;
    if (track.externalId && !currentTrack) return [];
    if (track.externalId) seenTracks.add(track.externalId);
    const clips = track.clips.flatMap(clip => {
      const refreshed = refreshClip(clip, track.id);
      return refreshed ? [refreshed] : [];
    });
    // A motion graphic drops out of the timeline while it is being re-rendered. Its emptied track must go too, otherwise the
    // graphic is never re-added when it is ready again (fresh tracks are only added for ids the saved timeline does not have).
    if (isMotionTrack(track) && !clips.length) { seenTracks.delete(track.externalId ?? ''); return []; }
    return [{ ...clone(track), type: currentTrack?.type ?? track.type, role: currentTrack?.role ?? track.role, clips }];
  });
  for (const track of fresh.tracks) {
    if (track.externalId && !seenTracks.has(track.externalId) && !suppressed.has(track.externalId)) tracks.push(clone(track));
  }
  // Track 0 is the top layer. New tracks are appended above, so motion graphics added to an older saved
  // timeline would otherwise land beneath the talking head and never show. Keep them on top.
  tracks.sort((a, b) => Number(isMotionTrack(b)) - Number(isMotionTrack(a)));
  const duration = Math.max(fresh.duration, ...tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration)), 1);
  return { ...clone(saved), name: fresh.name, width: fresh.width, height: fresh.height, fps: fresh.fps, duration, tracks };
}
