import assert from 'node:assert/strict';
import test from 'node:test';
import type { CJCutProject } from '@cjcut/editor';
import type { BrollPlan, Edl, EmotionCue, MotionPlan, MotionScene, Project, Word } from './api';
import { emotionClipGeometry, freshProject, reconcileSaved } from './editor-timeline';

const project = { id: 'p', name: 'P', sourceName: 's.mp4', updatedAt: '1', sourceAvailable: true, media: { width: 1080, height: 1920, frameRate: 30, duration: 60 }, clips: [{ id: 'c1', sourceName: 's.mp4', duration: 60, timelineStart: 0, timelineEnd: 60 }] } as unknown as Project;
const graphic = (id: string, start: number, over: Partial<MotionScene> = {}) => ({ id, title: id, enabled: true, status: 'ready', videoFile: `/x/${id}.webm`, renderedAt: 't1', sourceStart: start, sourceEnd: start + 3, ...over }) as MotionScene;
const plan = (...scenes: MotionScene[]) => ({ version: 1, orientation: 'portrait', scenes } as unknown as MotionPlan);
const ids = (timeline: CJCutProject) => timeline.tracks.map((track) => `${track.id.replace('vc-motion-track-', 'm:')}:${track.clips.length}`);

test('ready motion graphics get top-most tracks above the talking head', () => {
  const timeline = freshProject(project, [], null, null, plan(graphic('motion-001', 5), graphic('motion-002', 20, { status: 'generating' })));
  assert.deepEqual(ids(timeline), ['m:motion-001:1', 'vc-base:1']);
  assert.equal(timeline.tracks[0].clips[0].metadata?.motionId, 'motion-001');
});

test('a graphic that was re-rendering when the timeline was saved comes back with its clip, on top', () => {
  const rendering = plan(graphic('motion-001', 5, { status: 'generating' }), graphic('motion-002', 20));
  const saved = freshProject(project, [], null, null, plan(graphic('motion-001', 5), graphic('motion-002', 20)));
  // Saving while motion-001 re-renders: its clip is refreshed away but the empty track remains in the saved file.
  const savedWhileRendering = reconcileSaved(saved, freshProject(project, [], null, null, rendering), null, rendering, 'p');
  assert.ok(ids(savedWhileRendering).includes('m:motion-001:0') === false, 'emptied motion track must be dropped');
  const ready = plan(graphic('motion-001', 5, { renderedAt: 't2' }), graphic('motion-002', 20));
  const merged = reconcileSaved(savedWhileRendering, freshProject(project, [], null, null, ready), null, ready, 'p');
  assert.deepEqual(ids(merged).sort(), ['m:motion-001:1', 'm:motion-002:1', 'vc-base:1'].sort());
  assert.equal(merged.tracks.at(-1)!.id, 'vc-base', 'talking head stays at the bottom');
  assert.match(merged.tracks.find((track) => track.id.endsWith('motion-001'))!.clips[0].url!, /v=t2/, 'a re-render refreshes the clip URL');
});

test('motion tracks added to an older saved timeline are placed above B-roll and the base', () => {
  const oldSaved = { name: 'x', width: 1080, height: 1920, fps: 30, duration: 60, tracks: [
    { id: 'vc-broll-track-scene-001', externalId: 'scene-001', role: 'broll', name: 'b', type: 'image', visible: true, locked: false, clips: [] },
    { id: 'vc-base', externalId: 'vc-base', role: 'base', name: 'base', type: 'video', visible: true, locked: false, clips: [] },
  ] } as unknown as CJCutProject;
  const fresh = freshProject(project, [], null, null, plan(graphic('motion-001', 5)));
  const merged = reconcileSaved(oldSaved, fresh, null, plan(graphic('motion-001', 5)), 'p');
  assert.equal(merged.tracks[0].id, 'vc-motion-track-motion-001');
});

test('a graphic that is disabled or no longer rendered disappears from the timeline', () => {
  const both = plan(graphic('motion-001', 5), graphic('motion-002', 20));
  const saved = freshProject(project, [], null, null, both);
  const now = plan(graphic('motion-001', 5, { enabled: false }), graphic('motion-002', 20, { status: 'none' }));
  assert.deepEqual(ids(reconcileSaved(saved, freshProject(project, [], null, null, now), null, now, 'p')), ['vc-base:1']);
});

const brollPlan = (over: Record<string, unknown> = {}) => ({ settings: {}, scenes: [{ id: 'scene-001', title: 'B', enabled: true, imageStatus: 'ready', imageFile: '/i.png', videoFile: '/v.mp4', videoStatus: 'ready', imageRevision: 1, videoSourceImageRevision: 1, videoDuration: 5.8, sourceStart: 4, sourceEnd: 5.2, ...over }] }) as unknown as BrollPlan;

test('a generated B-roll clip can be stretched up to the full video, not just shortened', () => {
  const timeline = freshProject(project, [], null, brollPlan(), null);
  const clip = timeline.tracks[0].clips[0];
  assert.ok(Math.abs(clip.duration - 1.2) < 1e-6, 'starts at the planned window');
  assert.equal(clip.sourceDuration, 5.8, 'CJCut caps trimming at sourceDuration - sourceStart, so this must be the real length');
});

test('saved B-roll clips pick up the real video length on the next sync', () => {
  const stale = freshProject(project, [], null, brollPlan({ videoDuration: undefined }), null);
  assert.equal(stale.tracks[0].clips[0].sourceDuration, stale.tracks[0].clips[0].duration, 'legacy plans only know the window');
  const merged = reconcileSaved(stale, freshProject(project, [], null, brollPlan(), null), brollPlan(), null, 'p');
  assert.equal(merged.tracks[0].clips[0].sourceDuration, 5.8);
});

test('a saved image clip switches to its generated video without losing timeline edits', () => {
  const imageOnly = brollPlan({ videoFile: undefined, videoStatus: 'none', videoDuration: undefined });
  const saved = freshProject(project, [], null, imageOnly, null);
  saved.tracks[0].clips[0].start = 8;
  saved.tracks[0].clips[0].duration = 2;
  saved.tracks[0].clips[0].x = 42;
  const ready = brollPlan();
  const merged = reconcileSaved(saved, freshProject(project, [], null, ready, null), ready, null, 'p');
  const clip = merged.tracks[0].clips[0];
  assert.equal(clip.type, 'video');
  assert.match(clip.url!, /\/video(?:\?|$)/);
  assert.equal(clip.sourceDuration, 5.8);
  assert.equal(clip.start, 8);
  assert.equal(clip.duration, 2);
  assert.equal(clip.x, 42);
});

test('still-image B-roll can be held far longer than its planned window', () => {
  const timeline = freshProject(project, [], null, brollPlan({ videoFile: undefined, videoStatus: 'none', videoDuration: undefined }), null);
  assert.equal(timeline.tracks[0].clips[0].type, 'image');
  assert.ok(timeline.tracks[0].clips[0].sourceDuration >= 60);
});

test('motion sound is enabled for new/legacy clips and preserves subsequent user mute', () => {
  const ready = plan(graphic('motion-001', 5));
  const fresh = freshProject(project, [], null, null, ready);
  assert.equal(fresh.tracks[0].clips[0].volume, 1);
  const saved = structuredClone(fresh);
  saved.tracks[0].clips[0].volume = 0;
  assert.equal(reconcileSaved(saved, fresh, null, ready, 'p').tracks[0].clips[0].volume, 0);
  delete saved.tracks[0].clips[0].metadata!.motionAudio;
  assert.equal(reconcileSaved(saved, fresh, null, ready, 'p').tracks[0].clips[0].volume, 1);
});

const cue = (id: string, sourceTime: number, over: Partial<EmotionCue> = {}) => ({
  id, emotion: 'shock', soundId: 'impacts-impact-hit', intensity: 'medium', sourceTime, narration: '', reason: '', enabled: true,
  clip: { lead: 0.03, sourceOffset: 0, duration: 2.4, volume: 0.5, fadeIn: 0, fadeOut: 0.05, soundDuration: 2.4, label: 'Shock · Impact Hit' }, ...over,
}) as EmotionCue;
const withCues = (...cues: EmotionCue[]) => ({ ...plan(), emotionCues: cues }) as MotionPlan;
const sfxTracks = (timeline: CJCutProject) => timeline.tracks.filter((track) => track.id.startsWith('vc-emotion-track-'));

test('each enabled emotion cue gets its own audio track below the picture, landing on its word', () => {
  const timeline = freshProject(project, [], null, null, withCues(cue('emo-001', 10), cue('emo-002', 30, { enabled: false }), cue('emo-003', 40, { soundId: 'ui-chime' })));
  assert.deepEqual(sfxTracks(timeline).map((track) => track.id), ['vc-emotion-track-emo-001', 'vc-emotion-track-emo-003']);
  assert.equal(timeline.tracks.at(-1)!.id.startsWith('vc-emotion-track-'), true, 'sound tracks sit after the talking head');
  assert.equal(timeline.tracks.find((track) => track.id === 'vc-base') !== undefined, true);
  const clip = sfxTracks(timeline)[0].clips[0];
  assert.deepEqual({ type: clip.type, role: clip.role, start: clip.start, volume: clip.volume, sourceStart: clip.sourceStart }, { type: 'audio', role: 'audio', start: 9.97, volume: 0.5, sourceStart: 0 });
  assert.equal(clip.metadata?.sfxSoundId, 'impacts-impact-hit'); assert.equal(clip.metadata?.emotionCueId, 'emo-001');
  assert.equal(clip.url, '/api/motion-sounds/impacts-impact-hit/audio');
});

test('a build-up too close to the start is trimmed at its head; a cue at the very end is cut and faded', () => {
  const build = cue('emo-001', 0, { clip: { lead: 2, sourceOffset: 1, duration: 3, volume: 0.4, fadeIn: 0.2, fadeOut: 0.05, soundDuration: 6, label: 'x' } });
  const early = emotionClipGeometry({ ...build, sourceTime: 0.5 }, 0.5, 60)!;
  assert.deepEqual({ start: early.start, sourceStart: early.sourceStart, duration: early.duration }, { start: 0, sourceStart: 2.5, duration: 1.5 });
  assert.ok(early.fadeIn >= 0.05);
  const late = emotionClipGeometry(cue('emo-002', 0), 59.5, 60)!;
  assert.ok(Math.abs(late.start + late.duration - 60) < 1e-9); assert.ok(late.fadeOut >= 0.15);
  assert.equal(emotionClipGeometry(cue('emo-003', 0), 59.99, 60), null, 'nothing audible would remain');
});

test('cues follow the cleaned edit: they move with their word and vanish when the word was cut', () => {
  const words = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, text: id, start: i, end: i + 1 })) as unknown as Word[];
  const edl = { keepRanges: [{ startWordId: 'a', endWordId: 'b' }, { startWordId: 'd', endWordId: 'd' }] } as unknown as Edl;
  const timeline = freshProject(project, words, edl, null, withCues(cue('emo-001', 3), cue('emo-002', 2.2)));
  assert.deepEqual(sfxTracks(timeline).map((track) => track.externalId), ['emo-001']);
  assert.ok(Math.abs(sfxTracks(timeline)[0].clips[0].start - 1.97) < 1e-9, 'word d starts at 3s in the source, 2s after the cut');
});

test('planner edits refresh a saved cue clip; timeline tweaks survive; removed cues drop out and new ones appear', () => {
  const first = withCues(cue('emo-001', 10), cue('emo-002', 20));
  const saved = freshProject(project, [], null, null, first);
  const tweaked = JSON.parse(JSON.stringify(saved)) as CJCutProject;
  const moved = sfxTracks(tweaked)[0].clips[0]; moved.start = 12; moved.volume = 0.2;
  const same = reconcileSaved(tweaked, freshProject(project, [], null, null, first), null, first, 'p');
  assert.deepEqual([sfxTracks(same)[0].clips[0].start, sfxTracks(same)[0].clips[0].volume], [12, 0.2], 'the editor\'s own move and volume are kept');

  const next = withCues(cue('emo-001', 10, { soundId: 'ui-chime', intensity: 'strong' }), cue('emo-003', 30));
  const merged = reconcileSaved(tweaked, freshProject(project, [], null, null, next), null, next, 'p');
  assert.deepEqual(sfxTracks(merged).map((track) => track.externalId).sort(), ['emo-001', 'emo-003'], 'emo-002 was deleted, emo-003 is new');
  const refreshed = sfxTracks(merged).find((track) => track.externalId === 'emo-001')!.clips[0];
  assert.equal(refreshed.metadata?.sfxSoundId, 'ui-chime'); assert.equal(refreshed.url, '/api/motion-sounds/ui-chime/audio');
  assert.deepEqual([refreshed.start, refreshed.volume], [9.97, 0.5], 'a change in the panel replaces the older position');
});
