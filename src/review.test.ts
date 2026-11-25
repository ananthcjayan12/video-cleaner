import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagsToRanges, keepFlags, keptSeconds, sentences } from './review.js';

const words = ['ഹലോ.', 'ഈ', 'video', 'doctors-നും.', 'okay', 'അല്ല'].map((text, i) => ({ id: `w${i}`, text, start: i, end: i + 0.5 }));

test('keep ranges and per-word flags convert both ways', () => {
  const flags = keepFlags(words, [{ startWordId: 'w1', endWordId: 'w3' }, { startWordId: 'w5', endWordId: 'w5' }]);
  assert.deepEqual(flags, [false, true, true, true, false, true]);
  assert.deepEqual(flagsToRanges(words, flags).map((r) => [r.startWordId, r.endWordId]), [['w1', 'w3'], ['w5', 'w5']]);
  assert.deepEqual(flagsToRanges(words, words.map(() => true)).map((r) => [r.startWordId, r.endWordId]), [['w0', 'w5']]);
  assert.deepEqual(flagsToRanges(words, words.map(() => false)), []);
});

test('sentences break at full stops and pauses', () => {
  assert.deepEqual(sentences(words), [{ from: 0, to: 0 }, { from: 1, to: 3 }, { from: 4, to: 5 }]);
  const paused = words.map((w, i) => (i >= 2 ? { ...w, start: w.start + 2, end: w.end + 2 } : w));
  assert.deepEqual(sentences(paused), [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 3 }, { from: 4, to: 5 }]);
});

test('kept seconds add up each kept run', () => {
  assert.equal(keptSeconds(words, [false, true, true, true, false, true]), (3.5 - 1) + 0.5);
});
