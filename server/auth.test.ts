import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCredentials, hashPassword, issueSession, LoginLimiter, readCookie, verifySession, type AuthFile } from './auth.js';

async function auth(): Promise<AuthFile> {
  const { salt, hash } = await hashPassword('correct horse battery');
  return { username: 'ananthu', salt, hash, sessionSecret: 'secret-1', updatedAt: '' };
}

test('only the right username and password pass', async () => {
  const a = await auth();
  assert.equal(await checkCredentials(a, 'ananthu', 'correct horse battery'), true);
  assert.equal(await checkCredentials(a, ' Ananthu ', 'correct horse battery'), true, 'username ignores case and spaces');
  assert.equal(await checkCredentials(a, 'ananthu', 'wrong'), false);
  assert.equal(await checkCredentials(a, 'someone', 'correct horse battery'), false);
});

test('sessions are signed, expire, and die when the password (secret) changes', async () => {
  const a = await auth(); const now = 1_000_000;
  const token = issueSession(a, now);
  assert.equal(verifySession(a, token, now + 1000), true);
  assert.equal(verifySession(a, token, now + 31 * 86400_000), false, 'expired after 30 days');
  assert.equal(verifySession({ ...a, sessionSecret: 'secret-2' }, token, now), false, 'new password logs everyone out');
  const [user, expiry] = token.split('.');
  assert.equal(verifySession(a, `${user}.${Number(expiry) + 999999999}.${token.split('.')[2]}`, now), false, 'expiry cannot be extended');
  assert.equal(verifySession(a, undefined, now), false);
  assert.equal(verifySession(a, 'garbage', now), false);
});

test('cookie header parsing', () => {
  assert.equal(readCookie('a=1; vc_session=abc.def.ghi; b=2', 'vc_session'), 'abc.def.ghi');
  assert.equal(readCookie(undefined, 'vc_session'), undefined);
});

test('login attempts are limited per client', () => {
  const limiter = new LoginLimiter(3, 1000);
  for (let i = 0; i < 3; i += 1) limiter.fail('ip', 0);
  assert.equal(limiter.blocked('ip', 10), true);
  assert.equal(limiter.blocked('ip', 2000), false, 'window slides');
  limiter.fail('ip', 2000); limiter.clear('ip');
  assert.equal(limiter.blocked('ip', 2001), false);
});
