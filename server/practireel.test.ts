import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClaims, reviewSentences } from './claims.js';
import { IDEAS, NICHES, nicheValue, weeklyIdeas } from './ideas.js';
import { memberRoute } from './workspaces.js';
import { recipients, type PushSubscriber } from './push.js';

const words = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));

test('every field has ideas with a hook and three points, and none promise results', () => {
  for (const { id } of NICHES) {
    assert.ok(IDEAS[id].length >= 6, id);
    for (const idea of IDEAS[id]) {
      assert.equal(idea.points.length, 3, idea.id);
      assert.ok(idea.hook && idea.title, idea.id);
      assert.deepEqual(findClaims(words(`${idea.title} ${idea.hook} ${idea.points.join('. ')}.`)).map((f) => f.match), [], `${idea.id} reads as a promise`);
    }
  }
  assert.equal(nicheValue('physio'), 'physio'); assert.equal(nicheValue('x'), 'dental');
});

test('weekly ideas: three different ones, stable within a week, changing the next week', () => {
  const monday = new Date(2026, 10, 23, 9); const sunday = new Date(2026, 10, 29, 22); const next = new Date(2026, 10, 30, 9);
  const a = weeklyIdeas('dental', 'personal', monday).map((i) => i.id);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(weeklyIdeas('dental', 'personal', sunday).map((i) => i.id), a);
  assert.notDeepEqual(weeklyIdeas('dental', 'personal', next).map((i) => i.id), a);
});

test('claims: risky words are flagged per sentence, plain talk is not', () => {
  const w = words('Bleeding gums are a sign of inflammation. The treatment is painless and simple. Please get checked.');
  const flags = findClaims(w);
  assert.equal(flags.length, 1); assert.equal(flags[0].match.toLowerCase(), 'painless');
  const sentence = reviewSentences(w).find((s) => s.from === flags[0].from)!;
  assert.equal(w.slice(sentence.from, sentence.to + 1).map((x) => x.text).join(' '), 'The treatment is painless and simple.');
  assert.equal(findClaims(words('We are the best dentist in Kochi.'))[0]?.title, 'Promises a result');
  assert.deepEqual(findClaims(words('Brush twice a day with a soft brush.')), []);
});

test('customers can use ideas, notifications and "posted", nothing more', () => {
  assert.equal(memberRoute('GET', '/api/ideas').allowed, true);
  assert.equal(memberRoute('POST', '/api/push/subscribe').allowed, true);
  assert.equal(memberRoute('GET', '/api/push/key').allowed, true);
  assert.deepEqual(memberRoute('POST', '/api/projects/p1/posted'), { allowed: true, projectId: 'p1' });
  assert.equal(memberRoute('GET', '/api/projects/p1/posted').allowed, false);
});

test('notifications go to the account\'s logins; the owner hears about own reels and any failure', () => {
  const sub = (username: string, role: 'admin' | 'member', workspaceId?: string): PushSubscriber => ({ username, role, workspaceId, subscription: { endpoint: `https://push.example/${username}`, keys: { p256dh: 'x', auth: 'y' } }, createdAt: '' });
  const all = [sub('owner', 'admin'), sub('drmeera', 'member', 'smile'), sub('grace', 'member', 'grace-physio')];
  assert.deepEqual(recipients(all, 'smile').map((s) => s.username), ['drmeera']);
  assert.deepEqual(recipients(all, 'personal').map((s) => s.username), ['owner']);
  assert.deepEqual(recipients(all, 'smile', true).map((s) => s.username), ['owner', 'drmeera']);
});
