import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { normalizeTeamDomain, resetAccessKeyCache, verifyAccessJwt } from './access.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const fetcher = (async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as unknown as typeof fetch;
const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const config = { teamDomain: 'srshti', aud: 'aud-123' };
const now = 1_800_000_000_000;

function token(payload: Record<string, unknown>, kid = 'k1', key = privateKey) {
  const head = enc({ alg: 'RS256', kid }); const body = enc(payload);
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const good = { aud: ['aud-123'], iss: 'https://srshti.cloudflareaccess.com', exp: now / 1000 + 600, email: 'owner@example.com' };

test('team names become the Access host', () => {
  assert.equal(normalizeTeamDomain('srshti'), 'srshti.cloudflareaccess.com');
  assert.equal(normalizeTeamDomain('https://srshti.cloudflareaccess.com/'), 'srshti.cloudflareaccess.com');
});

test('a valid Access token returns the email', async () => {
  resetAccessKeyCache();
  assert.equal(await verifyAccessJwt(token(good), config, now, fetcher), 'owner@example.com');
});

test('missing, forged, expired, wrong-app and wrong-team tokens are refused', async () => {
  resetAccessKeyCache();
  await assert.rejects(verifyAccessJwt(undefined, config, now, fetcher), /No Cloudflare Access login/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyAccessJwt(token(good, 'k1', other), config, now, fetcher), /signature is invalid/);
  await assert.rejects(verifyAccessJwt(token({ ...good, exp: now / 1000 - 120 }), config, now, fetcher), /expired/);
  await assert.rejects(verifyAccessJwt(token({ ...good, aud: ['someone-else'] }), config, now, fetcher), /different application/);
  await assert.rejects(verifyAccessJwt(token({ ...good, iss: 'https://evil.cloudflareaccess.com' }), config, now, fetcher), /issuer/);
  await assert.rejects(verifyAccessJwt(token(good), { ...config, allowedEmails: ['someone@else.com'] }, now, fetcher), /not allowed/);
});
