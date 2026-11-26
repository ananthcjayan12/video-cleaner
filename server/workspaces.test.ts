import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCredentials, issueSession, verifySession } from './auth.js';
import { generateStructuredText } from './text-models.js';
import {
  assertImageEngineAllowed, EngineNotAllowedError, priceUsage, readUsage, recordUsage, runWithUsage, summarizeUsage, usageFile, withTask,
} from './usage.js';
import {
  addMember, allowedProfiles, createWorkspace, effectiveProfile, loadWorkspaces, memberAuth, memberRoute, reelsThisMonth, removeMember, saveWorkspaces, sessionUsername, updateWorkspace,
} from './workspaces.js';

test('an api account can never run a subscription engine', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-guard-'));
  const call = (provider: 'claude-cli' | 'codex-cli' | 'agy-cli') => generateStructuredText({ choice: { provider, model: '' }, config: { claudeBin: '/bin/false', codexBin: '/bin/false', agyBin: '/bin/false' }, workDir, prompt: 'x', schema: {}, outputName: 'x' });
  for (const provider of ['claude-cli', 'codex-cli', 'agy-cli'] as const) {
    await assert.rejects(runWithUsage({ profile: 'api' }, () => call(provider)), EngineNotAllowedError, provider);
  }
  assert.throws(() => runWithUsage({ profile: 'api' }, () => assertImageEngineAllowed('chatgpt-browser')), EngineNotAllowedError);
  assert.doesNotThrow(() => runWithUsage({ profile: 'api' }, () => assertImageEngineAllowed('gemini')));
  assert.doesNotThrow(() => runWithUsage({ profile: 'in-house' }, () => assertImageEngineAllowed('chatgpt-browser')));
  await assert.rejects(runWithUsage({ profile: 'api' }, () => generateStructuredText({ choice: { provider: 'anthropic', model: '' }, config: {}, workDir, prompt: 'x', schema: {}, outputName: 'x' })), /Claude API key is missing/);
});

test('prices: subscriptions cost nothing now but show their API price', () => {
  const cli = priceUsage({ kind: 'text', provider: 'claude-cli', inputTokens: 1_000_000, outputTokens: 100_000 }, 'claude-opus-5-5');
  assert.equal(cli.costUsd, 0); assert.equal(cli.apiUsd, 4 + 2);
  const api = priceUsage({ kind: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.deepEqual(api, { costUsd: 12, apiUsd: 12 });
  assert.equal(priceUsage({ kind: 'image', provider: 'chatgpt-browser', images: 6 }).costUsd, 0);
  assert.ok(Math.abs(priceUsage({ kind: 'image', provider: 'gemini', images: 6 }).costUsd - 0.402) < 1e-9);
  const render = priceUsage({ kind: 'render', provider: 'this computer', renderSeconds: 480 });
  assert.equal(render.costUsd, 0); assert.ok(render.apiUsd > 0.04 && render.apiUsd < 0.05);
});

test('usage is written to the current reel, per task, and summed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-usage-')); const file = usageFile(dir);
  await runWithUsage({ file, profile: 'api' }, async () => {
    await withTask('clean', () => recordUsage({ kind: 'text', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 10_000, outputTokens: 2_000 }));
    await withTask('broll-images', () => recordUsage({ kind: 'image', provider: 'gemini', images: 2 }));
  });
  await recordUsage({ kind: 'image', provider: 'gemini', images: 5 }); // no reel context: not written
  const entries = await readUsage(file); const summary = summarizeUsage(entries);
  assert.equal(entries.length, 2); assert.equal(entries[0].profile, 'api');
  assert.deepEqual(Object.keys(summary.byTask).sort(), ['broll-images', 'clean']);
  assert.equal(summary.images, 2); assert.ok(Math.abs(summary.costUsd - (0.04 + 0.04 + 0.134)) < 1e-4);
});

test('profiles: a cloud server set to api never runs in-house accounts on subscriptions', () => {
  assert.deepEqual(allowedProfiles(undefined), ['in-house', 'api']);
  assert.deepEqual(allowedProfiles('api'), ['api']);
  assert.equal(effectiveProfile({ profile: 'in-house' }, ['in-house', 'api']), 'in-house');
  assert.equal(effectiveProfile({ profile: 'in-house' }, ['api']), 'api');
  assert.throws(() => effectiveProfile({ profile: 'api' }, ['in-house']));
  const previous = process.env.ALLOWED_ENGINES; process.env.ALLOWED_ENGINES = 'api';
  try { assert.equal(runWithUsage({}, () => assertDefault()), 'api'); } finally { if (previous === undefined) delete process.env.ALLOWED_ENGINES; else process.env.ALLOWED_ENGINES = previous; }
  function assertDefault() { try { assertImageEngineAllowed('chatgpt-browser'); return 'in-house'; } catch { return 'api'; } }
});

test('workspaces and member logins', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'vc-ws-')), 'workspaces.json');
  const data = await loadWorkspaces(file);
  assert.equal(data.workspaces[0].id, 'personal'); assert.equal(data.workspaces[0].profile, 'in-house');
  const clinic = createWorkspace(data, { name: 'Smile Dental, Kochi', reelsPerMonth: 10 });
  assert.equal(clinic.id, 'smile-dental-kochi'); assert.equal(clinic.profile, 'api', 'new accounts default to API engines');
  assert.equal(createWorkspace(data, { name: 'Smile Dental, Kochi' }).id, 'smile-dental-kochi-2');
  updateWorkspace(data, clinic.id, { reelsPerMonth: 0 }); assert.equal(clinic.reelsPerMonth, undefined);
  await assert.rejects(addMember(data, { username: 'x', password: 'long enough pw', workspaceId: clinic.id }), /3–60/);
  await assert.rejects(addMember(data, { username: 'drmeera', password: 'short', workspaceId: clinic.id }), /10 characters/);
  await assert.rejects(addMember(data, { username: 'admin', password: 'long enough pw', workspaceId: clinic.id }, 'Admin'), /owner/);
  const member = await addMember(data, { username: ' DrMeera ', password: 'long enough pw', workspaceId: clinic.id });
  assert.equal(member.username, 'drmeera');
  await saveWorkspaces(data, file);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const reloaded = await loadWorkspaces(file); const auth = memberAuth(reloaded.members[0]);
  assert.equal(await checkCredentials(auth, 'drmeera', 'long enough pw'), true);
  const token = issueSession(auth); assert.equal(sessionUsername(token), 'drmeera'); assert.equal(verifySession(auth, token), true);
  const reset = await addMember(reloaded, { username: 'drmeera', password: 'another long pw', workspaceId: clinic.id });
  assert.equal(verifySession(memberAuth(reset), token), false, 'a new password logs out old sessions');
  await assert.rejects(addMember(reloaded, { username: 'drmeera', password: 'another long pw', workspaceId: 'personal' }), /another account/);
  removeMember(reloaded, 'DRMEERA'); assert.equal(reloaded.members.length, 0);
});

test('customers reach only their own reel routes', () => {
  const ok = (method: string, url: string) => memberRoute(method, url).allowed;
  for (const [method, url] of [['GET', '/api/me'], ['POST', '/api/uploads'], ['PUT', '/api/uploads/abc'], ['GET', '/api/projects'], ['POST', '/api/projects/select'],
    ['POST', '/api/projects/p1/auto'], ['GET', '/api/projects/p1/auto'], ['POST', '/api/projects/p1/auto/review'], ['POST', '/api/projects/p1/auto/stop'],
    ['PUT', '/api/projects/p1/auto/package'], ['GET', '/api/projects/p1/auto/frames/3'], ['GET', '/api/projects/p1/exports/reel.mp4?inline=1'], ['DELETE', '/api/projects/p1']]) {
    assert.equal(ok(method, url), true, `${method} ${url}`);
  }
  for (const [method, url] of [['GET', '/api/settings'], ['PUT', '/api/settings'], ['GET', '/api/admin/workspaces'], ['POST', '/api/projects/p1/clean'], ['POST', '/api/projects/p1/broll/plan'],
    ['GET', '/api/projects/p1/usage'], ['GET', '/api/projects/p1/proxy'], ['POST', '/api/projects/p1/export'], ['GET', '/api/system/status'], ['DELETE', '/api/admin/members/x']]) {
    assert.equal(ok(method, url), false, `${method} ${url}`);
  }
  assert.equal(memberRoute('GET', '/api/projects/p%201/auto').projectId, 'p 1');
});

test('credits count reels finished this month', () => {
  const now = new Date(2026, 10, 25, 12);
  assert.equal(reelsThisMonth([new Date(2026, 10, 1).getTime(), new Date(2026, 9, 31, 23).getTime(), undefined, new Date(2026, 10, 24).getTime()], now), 2);
});
