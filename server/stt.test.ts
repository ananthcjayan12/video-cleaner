import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_STT_PROMPT, parseSilences, placeChunkWords, planChunks, sttProviderValue } from './stt.js';

test('silencedetect output becomes start/end pairs', () => {
  const stderr = '[silencedetect @ 0x1] silence_start: 0.96\n[silencedetect @ 0x1] silence_end: 1.6 | silence_duration: 0.64\n'
    + '[silencedetect @ 0x1] silence_start: 15.38\n[silencedetect @ 0x1] silence_end: 15.77 | silence_duration: 0.39\n[silencedetect @ 0x1] silence_start: 99.9\n';
  assert.deepEqual(parseSilences(stderr), [[0.96, 1.6], [15.38, 15.77]]);
});

test('chunks cut in the middle of pauses near the target length and cover the whole audio', () => {
  const silences: Array<[number, number]> = [[5.4, 5.8], [15.38, 15.77], [21.16, 21.7], [32.14, 32.62], [52.02, 52.44], [56.17, 56.76], [68.75, 69.32], [82.4, 83.23], [97.94, 98.89]];
  const chunks = planChunks(silences, 100.33);
  assert.equal(chunks[0][0], 0);
  assert.equal(chunks.at(-1)![1], 100.33);
  for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i][0], chunks[i - 1][1], 'chunks are contiguous');
  for (const [a, b] of chunks.slice(0, -1)) {
    assert.ok(b - a >= 8 && b - a <= 28, `chunk ${a}-${b} has a usable length`);
    assert.ok(silences.some(([s, e]) => Math.abs((s + e) / 2 - b) < 1e-9), `cut at ${b} is inside a pause`);
  }
});

test('with no pauses the audio is still split into bounded chunks', () => {
  const chunks = planChunks([], 70);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every(([a, b]) => b - a <= 28));
});

test('short audio is one chunk', () => {
  assert.deepEqual(planChunks([[3, 4]], 20), [[0, 20]]);
});

test('chunk words move onto the source timeline, stay in order and inside the chunk', () => {
  const words = placeChunkWords([
    { text: 'ഈ', start: 0.2, end: 0.4 }, { text: 'video', start: 0.1, end: 0.5 }, { text: ' ', start: 1, end: 2 },
    { text: 'late', start: 30, end: 31 }, { text: 'noend', start: 2 },
  ], 15.6, 32.4);
  assert.deepEqual(words.map((w) => w.text), ['ഈ', 'video', 'late', 'noend']);
  assert.equal(words[0].start, 15.8);
  assert.ok(words[1].start >= words[0].start, 'never moves backwards');
  assert.equal(words[2].end, 32.4, 'clamped to the chunk end');
  assert.ok(words.every((w) => w.end > w.start));
});

test('provider values fall back safely and the prompt keeps English in English letters', () => {
  assert.equal(sttProviderValue('gemini', 'elevenlabs'), 'gemini');
  assert.equal(sttProviderValue('whisper', 'elevenlabs'), 'elevenlabs');
  assert.match(GEMINI_STT_PROMPT, /English letters/);
  assert.match(GEMINI_STT_PROMPT, /Doctors-നും/);
});
