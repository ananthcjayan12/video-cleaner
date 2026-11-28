import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animatedFor, motionStates, timeTheMotion, validateMotionPlan } from './reel-motion.js';
import type { Word } from './project-store.js';

// 60 words, one every 0.5 s, all kept in one range: edited time = source time.
const words: Word[] = Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
const ranges = [{ words: [0, 59] as [number, number], start: 0, end: 30 }];
const ids = new Set(words.map((word) => word.id));

test('a sloppy AI plan is cleaned: unknown words, sounds, kinds and long texts are dropped or fixed', () => {
  const plan = validateMotionPlan({
    hook: { tag: 'dental tips', line: '  പല്ല്   Clean ചെയ്താൽ ', ribbon: 'Enamel പോകുമോ?', emoji: '🦷', sfx: 'not-a-sound' },
    graphics: [
      { kind: 'mythfact', wordId: 'w10', factWordId: 'w14', myth: 'Cleaning damages enamel', fact: 'No damage at all', sfx: '' },
      { kind: 'counter', wordId: 'w20', value: 12, from: 0, label: 'MONTHS', sub: '6-12 months', sfx: 'ui-chime' },
      { kind: 'checklist', wordId: 'w30', title: 'Remember', items: [{ text: 'One', wordId: 'w31' }], sfx: '' }, // one item: dropped
      { kind: 'chart', wordId: 'w40', sfx: '' }, // unknown kind: dropped
      { kind: 'counter', wordId: 'nope', value: 3, sfx: '' }, // unknown word: dropped
    ],
    punches: [{ wordId: 'w10', text: '6 MONTHS', emotion: 'shock', sfx: 'impacts-impact-hit-2' }, { wordId: 'nope', text: 'X', emotion: 'joy', sfx: '' }],
    kicks: [{ wordId: 'w20', emotion: 'made-up', sfx: 'nope' }],
    cta: { wordId: '', keyword: '', line: '', sfx: '' },
    transitions: [{ sceneId: 's1', kind: 'split', title: '' }, { sceneId: 's2', kind: 'spin' }],
  }, ids, ['s1', 's2']);
  assert.deepEqual(plan.hook, { tag: 'DENTAL TIPS', line: 'പല്ല് Clean ചെയ്താൽ', ribbon: 'Enamel പോകുമോ?', emoji: '🦷', sfx: 'impacts-deep-hit-2' });
  assert.deepEqual(plan.graphics.map((g) => g.kind), ['mythfact', 'counter']);
  assert.deepEqual(plan.punches.map((p) => p.wordId), ['w10']);
  assert.equal(plan.kicks[0].emotion, 'emphasis');
  assert.equal(plan.cta, undefined);
  // A split screen needs a title; an unknown kind falls back to the rotation.
  assert.deepEqual(plan.transitions, [{ sceneId: 's1', kind: 'slide' }, { sceneId: 's2', kind: 'slide' }]);
});

test('timing keeps graphics off pictures and apart, places the watermark in the gaps, and never repeats a sound', () => {
  const plan = validateMotionPlan({
    hook: { tag: 'TIPS', line: 'Hook', ribbon: '', emoji: '', sfx: 'impacts-deep-hit-2' },
    graphics: [
      { kind: 'mythfact', wordId: 'w8', factWordId: 'w12', myth: 'Myth', fact: 'Fact', sfx: 'ui-ui-sound-3' },          // 4 s, fact at 6 s
      { kind: 'counter', wordId: 'w14', value: 12, from: 0, label: 'MONTHS', sub: 'x', sfx: 'ui-chime' },               // 7 s: overlaps the myth card
      { kind: 'checklist', wordId: 'w34', title: 'List', items: [{ text: 'a', wordId: 'w35' }, { text: 'b', wordId: 'w37' }], sfx: 'ui-chime' }, // 17 s
    ],
    punches: [{ wordId: 'w20', text: 'UNDER PICTURE', emotion: 'shock', sfx: 'impacts-impact-hit' }, { wordId: 'w46', text: 'ONE', emotion: 'emphasis', sfx: 'ui-pop-sound' }],
    kicks: [{ wordId: 'w47', emotion: 'emphasis', sfx: 'ui-pop-sound' }, { wordId: 'w50', emotion: 'emphasis', sfx: 'ui-pop-sound' }],
    cta: { wordId: 'w58', keyword: 'CLEAN', line: 'Free PDF', sfx: 'ui-success' },
    transitions: [{ sceneId: 'b1', kind: 'flash' }],
  }, ids, ['b1']);
  const timed = timeTheMotion(plan, words, ranges, [{ id: 'b1', start: 9.5, end: 12, image: '/x.png' }], 30, { watermark: true });
  const shown = timed.graphics.filter((g) => g.kind !== 'watermark');
  assert.deepEqual(shown.map((g) => [g.kind, g.start]), [['headline', 0.1], ['mythfact', 4], ['checklist', 17], ['punch', 23], ['comment', 27.5]]);
  assert.equal(shown.find((g) => g.kind === 'mythfact')!.end, 8.4); // fact at 2 s + 2.4 s to read it
  assert.deepEqual(shown.find((g) => g.kind === 'checklist')!.itemAt, [0.5, 1.5]);
  assert.deepEqual(timed.kicks, [23, 25]); // w47 (23.5 s) is too close to the punch at 23 s
  assert.equal(timed.transitions.b1, 'flash');
  // Watermark only where the top of the frame is free.
  for (const mark of timed.graphics.filter((g) => g.kind === 'watermark')) for (const g of shown) assert.ok(mark.end <= g.start || mark.start >= g.end, `${mark.start}-${mark.end} vs ${g.kind}`);
  assert.ok(timed.graphics.some((g) => g.kind === 'watermark'));
  for (let i = 1; i < timed.sounds.length; i++) {
    assert.notEqual(timed.sounds[i].sfx, timed.sounds[i - 1].sfx);
    assert.ok(timed.sounds[i].at - timed.sounds[i - 1].at >= 0.45);
  }
});

test('a myth card right before a picture still fits, with its fact shown in time', () => {
  // Myth raised at 9.75 s, fact said at 20 s, a picture at 13.05 s (the case from the first real reel).
  const plan = validateMotionPlan({ graphics: [{ kind: 'mythfact', wordId: 'w20', factWordId: 'w40', myth: 'M', fact: 'F', sfx: '' },
    { kind: 'counter', wordId: 'w36', value: 6, label: 'MONTHS', sub: '', sfx: '' }] }, ids, ['b1', 'b2']);
  const timed = timeTheMotion(plan, words, ranges, [{ id: 'b1', start: 13.05, end: 15.6 }, { id: 'b2', start: 19.9, end: 22 }], 30);
  const myth = timed.graphics.find((g) => g.kind === 'mythfact')!;
  assert.equal(myth.end, 12.85);
  assert.ok(Number(myth.factAt) <= 12.85 - 10 - 1.6 + 1e-9);
  assert.equal(timed.graphics.find((g) => g.kind === 'counter')?.end, 19.7); // 1.7 s before the next picture: still shown
});

test('a split-screen picture becomes a graphic that carries its picture file', () => {
  const plan = validateMotionPlan({ transitions: [{ sceneId: 'b1', kind: 'split', title: 'How it works' }] }, ids, ['b1']);
  const timed = timeTheMotion(plan, words, ranges, [{ id: 'b1', start: 5, end: 8, image: '/pic.png' }], 30);
  assert.deepEqual(timed.graphics, [{ kind: 'split', start: 5, end: 8, title: 'How it works', pictureFile: '/pic.png' }]);
  assert.equal(timed.transitions.b1, 'split');
});

test('the motion layer is drawn once per distinct look', () => {
  const graphics = [{ kind: 'punch' as const, start: 1, end: 3, text: 'X' }];
  const { times, runs, totalFrames } = motionStates(graphics, 4);
  // blank + animated-in frames + one held look + fading-out frames (2.833-2.967 s)
  assert.equal(times.length, 1 + Math.round(animatedFor(graphics[0]) * 30) + 1 + 5);
  assert.equal(runs.reduce((sum, run) => sum + run.frames, 0), totalFrames);
});
