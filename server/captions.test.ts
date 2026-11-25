import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptionPhrases, displayWord, isEnglishWord } from './captions.js';

test('English words are detected, kept in English and title-cased', () => {
  assert.equal(isEnglishWord('doctors-നും'), true);
  assert.equal(isEnglishWord('സോഷ്യൽ'), false);
  assert.equal(displayWord('social'), 'Social');
  assert.equal(displayWord('doctors-നും.'), 'Doctors-നും');
  assert.equal(displayWord('വേണ്ടിയിട്ടുള്ളതാണ്.'), 'വേണ്ടിയിട്ടുള്ളതാണ്');
});

test('phrases break at pauses and sentence ends, stay short, and bridge small gaps', () => {
  const words = [
    { text: 'ഈ', start: 0, end: 0.2 }, { text: 'video', start: 0.25, end: 0.6 }, { text: 'doctors-നും.', start: 0.7, end: 1.4 },
    { text: 'അവരുടെ', start: 2.4, end: 2.8 }, { text: 'social', start: 2.85, end: 3.2 }, { text: 'media', start: 3.25, end: 3.6 },
  ];
  const phrases = buildCaptionPhrases(words, 5);
  assert.equal(phrases.length, 2);
  assert.deepEqual(phrases[0].words.map((w) => w.text), ['ഈ', 'Video', 'Doctors-നും']);
  assert.deepEqual(phrases[1].words.filter((w) => w.key).map((w) => w.text), ['Social', 'Media']);
  assert.equal(phrases[0].end, Math.min(5, 1.4 + 0.6), 'a long gap ends the phrase 0.6 s after the last word');
  assert.ok(phrases.every((p) => p.words.length <= 6));
});

test('a phrase shorter than 0.35 s is folded into its neighbour', () => {
  const words = [
    { text: 'ഈ', start: 0, end: 0.1 }, { text: 'okay.', start: 0.1, end: 0.2 },
    { text: 'അവരുടെ', start: 1.5, end: 1.9 }, { text: 'presence', start: 1.95, end: 2.4 },
  ];
  const phrases = buildCaptionPhrases(words, 3);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0].words.length, 4);
});
