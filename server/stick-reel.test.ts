import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSfxCredits } from './openverse-sfx.js';
import { makeStickDraft, validateStickDraft } from './stick-reel.js';

test('stick drafts anchor v2 scenes to spoken words and preserve edited caption timing', () => {
  const words = [
    { id: 'w1', text: 'ഇന്ന്', start: 0.1, end: 0.5 },
    { id: 'w2', text: 'desktop', start: 4.2, end: 4.6 },
    { id: 'w3', text: 'app', start: 4.6, end: 5.0 },
  ];
  const draft = makeStickDraft(words);
  assert.equal(draft.version, 2);
  assert.deepEqual(draft.scenes.map(scene => scene.at), [0, 4.2]);
  draft.words = words.map(word => (word.id === 'w2' ? { ...word, text: 'Desktop' } : word));
  const validated = validateStickDraft(draft, 5);
  assert.deepEqual(validated.words[1], { ...words[1], text: 'Desktop' });
  draft.scenes[1].at = 0;
  assert.throws(() => validateStickDraft(draft, 5), /scene 2/);
});

test('validateStickDraft upgrades legacy v1 5-tuple scenes to v2 seamlessly', () => {
  const legacy = {
    scenes: [
      [0, 'Hook', 'First beat', 0, 'neutral'],
      [3.5, 'Metric', 'Big jump', 2, 'surprised'],
    ],
    words: [{ id: 'w1', text: 'Hello', start: 0.1, end: 0.4 }],
    music: 0.25,
    sfx: 0.7,
  };
  const upgraded = validateStickDraft(legacy, 8);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.scenes[0].template, 'hero_icon');
  assert.equal(upgraded.scenes[1].template, 'metric');
  assert.equal(upgraded.scenes[1].face, 'surprised');
});

test('validateStickDraft preserves mid-scene beats and rejects invalid poses gracefully', () => {
  const draft = makeStickDraft([{ id: 'w1', text: 'Hi', start: 0.1, end: 0.4 }]);
  draft.scenes[0].template = 'compare';
  draft.scenes[0].pose = 'celebrate';
  draft.scenes[0].beats = [
    { at: 1.5, wordId: 'w1', pose: 'shrug', face: 'surprised', sfxQuery: 'camera shutter', punch: true },
  ];
  const validated = validateStickDraft(draft, 6);
  assert.equal(validated.scenes[0].beats?.length, 1);
  assert.equal(validated.scenes[0].beats?.[0].sfxQuery, 'camera shutter');
});

test('formatSfxCredits deduplicates Openverse attributions', () => {
  const entry = {
    id: 'abc123',
    title: 'Shutter',
    query: 'camera shutter',
    file: 'ov-abc123.mp3',
    source: 'freesound',
    license: 'by',
    attribution: '"Shutter" by TestUser (CC BY 4.0)',
    duration: 0.5,
    peakTime: 0.05,
    peakDb: -3,
    loudnessDb: -18,
    cachedAt: '2026-11-26T00:00:00Z',
  };
  const text = formatSfxCredits([entry, entry]);
  assert.equal(text.split('"Shutter"').length - 1, 1);
});
