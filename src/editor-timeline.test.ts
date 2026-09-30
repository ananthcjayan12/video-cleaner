import assert from 'node:assert/strict';
import test from 'node:test';
import type { CJCutProject } from '@cjcut/editor';
import type { BrollPlan, MotionPlan, MotionScene, Project } from './api';
import { freshProject, reconcileSaved } from './editor-timeline';

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
