import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editedTime, keepIndexRanges, newAutoJob, placeBroll } from './auto-reel.js';

const words = Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, text: `t${i}`, start: i, end: i + 0.8 }));

test('keep ranges become sorted word-index pairs; unknown ids are dropped', () => {
  assert.deepEqual(keepIndexRanges(words, [{ startWordId: 'w10', endWordId: 'w12' }, { startWordId: 'w1', endWordId: 'w3' }, { startWordId: 'x', endWordId: 'w5' }]), [[1, 3], [10, 12]]);
});

test('edited time skips removed passages', () => {
  const ranges = [{ words: [0, 9] as [number, number], start: 0, end: 9.8 }, { words: [20, 39] as [number, number], start: 19.9, end: 39.8 }];
  assert.equal(editedTime(words, ranges, 5), 5);
  assert.equal(editedTime(words, ranges, 15), undefined, 'cut word');
  assert.ok(Math.abs(editedTime(words, ranges, 21)! - (9.8 + 1.1)) < 1e-9);
});

test('B-roll stays out of the hook and the ending, is short, and leaves the speaker on screen between cutaways', () => {
  const ranges = [{ words: [0, 39] as [number, number], start: 0, end: 39.8 }];
  const scenes = [
    { id: 'a', startWordId: 'w0', sourceStart: 0, sourceEnd: 5, image: 'a.jpg' },
    { id: 'b', startWordId: 'w3', sourceStart: 3, sourceEnd: 4, image: 'b.jpg' },
    { id: 'c', startWordId: 'w10', sourceStart: 10, sourceEnd: 20, image: 'c.jpg' },
    { id: 'd', startWordId: 'w20', sourceStart: 20, sourceEnd: 22 },
    { id: 'e', startWordId: 'w38', sourceStart: 38, sourceEnd: 39, image: 'e.jpg' },
  ];
  const placed = placeBroll(words, ranges, scenes, 39.8);
  assert.deepEqual(placed.map((p) => p.id), ['a', 'b', 'c']);
  assert.ok(placed[0].start >= 1.5, 'not in the hook');
  for (const p of placed) assert.ok(p.end - p.start >= 1.79 && p.end - p.start <= 2.61);
  for (let i = 1; i < placed.length; i += 1) assert.ok(placed[i].start - placed[i - 1].end >= 1.49);
});

test('a new job skips B-roll and caption stages when they are switched off', () => {
  const job = newAutoJob({ imageProvider: 'gemini', broll: false, captions: false, review: false });
  assert.deepEqual(job.stages.filter((s) => s.state === 'skipped').map((s) => s.id), ['review', 'broll-plan', 'broll-images', 'captions']);
});
