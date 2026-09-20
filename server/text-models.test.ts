import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgyModels, parseModelJson } from './text-models.js';

test('parseAgyModels reads the current tab-separated AGY catalog', () => {
  const models = parseAgyModels([
    'Fetching available models...',
    'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
    'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
    'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  ].join('\n'));
  assert.deepEqual(models, [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ]);
});

test('parseAgyModels remains compatible with aligned columns and ANSI output', () => {
  const models = parseAgyModels([
    '\u001b[2Kauto  Automatic selection',
    'model-v2    Model Version 2',
    'model-v2    Duplicate row',
    'Unrelated status line',
  ].join('\n'));
  assert.deepEqual(models, [
    { id: 'auto', label: 'Automatic selection' },
    { id: 'model-v2', label: 'Model Version 2' },
  ]);
});

test('parseModelJson reads AGY fenced JSON before its trailing tool-status object', () => {
  const response = [
    '```json',
    '{"scenes":[{"id":"scene-001"}],"notes":[]}',
    '```',
    '{"ok":true,"toolAction":"Finishing task","toolSummary":"Task completion"}',
  ].join('\n');
  assert.deepEqual(parseModelJson(response), { scenes: [{ id: 'scene-001' }], notes: [] });
});

test('parseModelJson finds balanced JSON surrounded by commentary', () => {
  const response = 'Result: {"message":"a brace } inside a string","items":[1,2]} finished.';
  assert.deepEqual(parseModelJson(response), { message: 'a brace } inside a string', items: [1, 2] });
});

test('parseModelJson reports when a response contains no valid JSON', () => {
  assert.throws(() => parseModelJson('I was unable to create the requested plan.'), /No valid JSON/);
});
