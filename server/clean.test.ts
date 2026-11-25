import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanPrompt, cleanIntensityValue, keptDuration, targetDurationValue, targetFeedback } from './clean.js';

const words = [
  { id: 'w1', text: 'ഹലോ', start: 0.1, end: 0.6 }, { id: 'w2', text: 'ഈ', start: 1.6, end: 1.8 },
  { id: 'w3', text: 'video', start: 1.9, end: 2.3 }, { id: 'w4', text: 'okay', start: 10, end: 10.4 },
];

test('aggressive is the default and unknown values fall back to it', () => {
  assert.equal(cleanIntensityValue(undefined), 'aggressive');
  assert.equal(cleanIntensityValue('balanced'), 'balanced');
  assert.equal(cleanIntensityValue('extreme'), 'aggressive');
});

test('target length accepts 10-600 s only', () => {
  assert.equal(targetDurationValue('50'), 50);
  assert.equal(targetDurationValue(49.6), 50);
  assert.equal(targetDurationValue(5), undefined);
  assert.equal(targetDurationValue('abc'), undefined);
});

test('kept duration sums each range from first word start to last word end', () => {
  assert.equal(keptDuration(words, [{ startWordId: 'w2', endWordId: 'w3' }]).toFixed(2), '0.70');
  assert.equal(keptDuration(words, [{ startWordId: 'w1', endWordId: 'w1' }, { startWordId: 'w4', endWordId: 'w4' }]).toFixed(2), '0.90');
  assert.equal(keptDuration(words, [{ startWordId: 'missing', endWordId: 'w4' }]), 0);
});

test('retry feedback only when the edit clearly misses the target', () => {
  assert.equal(targetFeedback(55, 50), undefined);
  assert.match(targetFeedback(70, 50)!, /over the 50 s target/);
  assert.match(targetFeedback(30, 50)!, /under the 50 s target/);
  assert.equal(targetFeedback(90, undefined), undefined);
});

test('aggressive prompt carries the approved story rules, the target and all source words', () => {
  const prompt = buildCleanPrompt(words, 'aggressive', 50);
  assert.match(prompt, /keep each idea exactly ONCE/);
  assert.match(prompt, /hook .* call to action/);
  assert.match(prompt, /TARGET LENGTH: about 50 seconds/);
  assert.match(prompt, /DELETE-ONLY/);
  for (const word of words) assert.ok(prompt.includes(`[${word.id} `));
  assert.match(buildCleanPrompt(words, 'light'), /No fixed length/);
  assert.match(buildCleanPrompt(words, 'aggressive', 50, 'kept 70 s'), /YOUR PREVIOUS ATTEMPT: kept 70 s/);
});

test("the owner's review notes and the reviewed edit are passed to the AI and override the rules", () => {
  const prompt = buildCleanPrompt(words, 'aggressive', undefined, undefined, { notes: 'Keep the hello at the start.', previous: [{ startWordId: 'w2', endWordId: 'w3' }] });
  assert.match(prompt, /THE OWNER REVIEWED THE EDIT[\s\S]*Keep the hello at the start\./);
  assert.match(prompt, /kept these ranges \(start-end word ids\): w2-w3/);
  assert.doesNotMatch(buildCleanPrompt(words, 'aggressive'), /OWNER REVIEWED/);
});
