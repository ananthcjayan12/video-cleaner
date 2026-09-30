import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateStructuredText, parseAgyModels, parseModelJson } from './text-models.js';

test('Codex structured generation runs in a project folder without a Git repository', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-cleaner-codex-text-'));
  try {
    const fakeCodex = path.join(workDir, 'codex');
    await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'exec' || !args.includes('--skip-git-repo-check')) {
  process.stderr.write('Not inside a trusted directory and --skip-git-repo-check was not specified.');
  process.exit(1);
}
const output = args[args.indexOf('--output-last-message') + 1];
fs.writeFileSync(output, JSON.stringify({ motion: 'soft zoom' }));
`);
    await fs.chmod(fakeCodex, 0o755);
    const result = await generateStructuredText({
      choice: { provider: 'codex-cli', model: '' }, config: { codexBin: fakeCodex }, workDir,
      prompt: 'Describe a motion', schema: { type: 'object', properties: { motion: { type: 'string' } } }, outputName: 'scene-video-prompt',
    });
    assert.deepEqual(result, { motion: 'soft zoom' });
    await assert.rejects(fs.stat(path.join(workDir, '.git')), { code: 'ENOENT' });
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

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
