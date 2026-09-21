import assert from 'node:assert/strict';
import test from 'node:test';
import { splitTimelineClip } from '@cjcut/editor/timeline';
import type { CJCutProject } from '@cjcut/editor';

function fixture(): CJCutProject {
  return {
    name: 'Video Cleaner split integration', width: 1080, height: 1920, fps: 30, duration: 8,
    tracks: [{
      id: 'broll-track', role: 'broll', externalId: 'scene-001', name: 'B-roll', type: 'video', visible: true, locked: false,
      clips: [{
        id: 'broll-clip', externalId: 'scene-001', role: 'broll', trackId: 'broll-track',
        type: 'video', name: 'Educational animation', url: '/api/projects/demo/broll/scenes/scene-001/video',
        start: 2, duration: 4, sourceStart: 0.4, sourceDuration: 8, speed: 1.5,
        x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 0,
        metadata: { sceneId: 'scene-001', assetKind: 'video', managed: true },
      }],
    }],
  };
}

test('CJCut split makes two independent timeline clips while preserving B-roll mapping', () => {
  const input = fixture();
  const result = splitTimelineClip(input, 'broll-clip', 3.5, 'right-clip');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(input.tracks[0].clips.length, 1, 'incoming saved timeline must not be mutated');
  const [left, right] = result.project.tracks[0].clips;
  assert.equal(left.duration, 1.5);
  assert.equal(right.duration, 2.5);
  assert.equal(right.start, 3.5);
  assert.ok(Math.abs(right.sourceStart - 2.65) < 0.00001);
  assert.equal(right.id, 'right-clip');
  assert.equal(right.externalId, 'scene-001');
  assert.equal(right.metadata?.sceneId, 'scene-001');
  assert.equal(right.trackId, left.trackId);
  assert.equal(left.start + left.duration, right.start);
});

test('CJCut split fails clearly when the playhead is outside the selected clip', () => {
  const original = fixture();
  const result = splitTimelineClip(original, 'broll-clip', 0, 'right-clip');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /playhead/i);
  assert.equal(original.tracks[0].clips.length, 1);
});

test('CJCut split never changes locked tracks', () => {
  const project = fixture(); project.tracks[0].locked = true;
  const result = splitTimelineClip(project, 'broll-clip', 3.5, 'right-clip');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /unlock/i);
});
