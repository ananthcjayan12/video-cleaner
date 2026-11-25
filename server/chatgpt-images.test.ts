import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserEngineArgs, chatGptImagePrompt, DEFAULT_PICTURES_ENGINE } from './chatgpt-images.js';

test('Claude drives Chrome with --chrome plus the chosen model and effort (story-reels defaults)', () => {
  const { bin, args } = browserEngineArgs({ ...DEFAULT_PICTURES_ENGINE, claudeBin: '/bin/claude' }, 'PROMPT');
  assert.equal(bin, '/bin/claude');
  assert.deepEqual(args.slice(-5), ['--chrome', '--model', 'claude-sonnet-5-5', '--effort', 'medium']);
  assert.ok(args.includes('--permission-mode') && args.includes('auto'));
});

test('Codex gets its browser preamble, model and reasoning effort', () => {
  const { bin, args } = browserEngineArgs({ provider: 'codex', model: 'gpt-x', effort: 'high', codexBin: '/bin/codex' }, 'PROMPT');
  assert.equal(bin, '/bin/codex');
  assert.ok(args.includes('--model') && args.includes('gpt-x'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.match(args.at(-1)!, /Codex Chrome\/browser plugin[\s\S]*PROMPT$/);
});

test('missing CLI is a clear error, and the prompt lists every picture with its save path', () => {
  assert.throws(() => browserEngineArgs({ provider: 'claude' }, 'x'), /Claude CLI was not found/);
  const prompt = chatGptImagePrompt([{ id: 'scene-001', prompt: 'a dentist', outputPath: '/tmp/a.png', aspect: '9:16' }]);
  assert.match(prompt, /scene-001 -> save as \/tmp\/a\.png/);
  assert.match(prompt, /vertical 9:16/);
});
