import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeStickDraft, validateStickDraft } from './stick-reel.js';

test('stick drafts anchor scenes to spoken words and preserve edited caption timing', () => {
  const words = [
    { id: 'w1', text: 'ഇന്ന്', start: .1, end: .5 },
    { id: 'w2', text: 'desktop', start: 4.2, end: 4.6 },
    { id: 'w3', text: 'app', start: 4.6, end: 5 },
  ];
  const draft = makeStickDraft(words);
  assert.deepEqual(draft.scenes.map(scene => scene[0]), [0, 4.2]);
  draft.words = words.map(word => word.id === 'w2' ? { ...word, text: 'Desktop' } : word);
  assert.deepEqual(validateStickDraft(draft, 5).words[1], { ...words[1], text: 'Desktop' });
  draft.scenes[1][0] = 0;
  assert.throws(() => validateStickDraft(draft, 5), /scene 2/);
});
