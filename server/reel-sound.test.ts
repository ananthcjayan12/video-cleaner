import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reelSoundCues } from './reel-sound.js';

const phrase = (start: number, key: boolean) => ({ start, end: start + 1, words: [{ text: 'x', at: start, key }] });

test('talking-head reels get a start hit, a whoosh in and out of each B-roll, and sparing pops', () => {
  const phrases = [phrase(0.2, false), phrase(3, true), phrase(4, true), phrase(9, true), phrase(12.5, true), phrase(19.8, true)];
  const cues = reelSoundCues([{ start: 12, end: 14 }, { start: 20, end: 20.3 }], phrases, 20.5);
  assert.deepEqual(cues.map((cue) => [cue.at, cue.sfx]), [
    [0.2, 'impacts-deep-hit-2'],
    [3, 'ui-pop-sound'],           // 4 s is too soon after it
    [9, 'ui-pop-sound'],
    [12, 'whoosh-transitions-swoosh-quick-low'], // 12.5 pop skipped: too close to the whoosh
    [14, 'whoosh-transitions-swish-1'],
    [20, 'whoosh-transitions-simple-whoosh-1'],  // B-roll running to the end gets no swish out
  ]);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].at - cues[i - 1].at >= 0.45);
});
