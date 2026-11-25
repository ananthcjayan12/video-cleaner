import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

/**
 * Cloudflare Access check for requests that come through the tunnel. Access puts a signed JWT in the
 * Cf-Access-Jwt-Assertion header after the user logs in; we verify its signature against the team's public keys,
 * the audience tag of this Access application, the issuer and the expiry. Without a valid token a remote request
 * is refused, so a tunnel without an Access policy cannot expose the app.
 */
export type AccessConfig = { teamDomain: string; aud: string; allowedEmails?: string[] };
type Jwk = JsonWebKey & { kid?: string };

const b64url = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
let keyCache: { team: string; at: number; keys: Jwk[] } | null = null;

export function normalizeTeamDomain(value: string) {
  const host = value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) return '';
  return host.includes('.') ? host : `${host}.cloudflareaccess.com`;
}

async function teamKeys(team: string, fetcher: typeof fetch): Promise<Jwk[]> {
  if (keyCache && keyCache.team === team && Date.now() - keyCache.at < 60 * 60 * 1000) return keyCache.keys;
  const response = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Could not load Cloudflare Access keys (${response.status})`);
  const body = await response.json() as { keys?: Jwk[] };
  keyCache = { team, at: Date.now(), keys: body.keys ?? [] };
  return keyCache.keys;
}

/** Returns the verified email (or subject); throws with a short reason when the token is not acceptable. */
export async function verifyAccessJwt(token: string | undefined, config: AccessConfig, now = Date.now(), fetcher: typeof fetch = fetch): Promise<string> {
  if (!token) throw new Error('No Cloudflare Access login on this request');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed Access token');
  const header = JSON.parse(b64url(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
  const payload = JSON.parse(b64url(parts[1]).toString('utf8')) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; sub?: string };
  if (header.alg !== 'RS256') throw new Error('Unexpected Access token algorithm');
  const team = normalizeTeamDomain(config.teamDomain);
  const keys = await teamKeys(team, fetcher);
  const jwk = keys.find((key) => key.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) throw new Error('Access token signed with an unknown key');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  if (!ok) throw new Error('Access token signature is invalid');
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.aud)) throw new Error('Access token is for a different application');
  if (payload.iss !== `https://${team}`) throw new Error('Access token issuer does not match the team');
  const seconds = now / 1000;
  if (!payload.exp || payload.exp < seconds - 30) throw new Error('Access login has expired');
  if (payload.nbf && payload.nbf > seconds + 30) throw new Error('Access token is not valid yet');
  const who = payload.email || payload.sub || '';
  if (config.allowedEmails?.length && !config.allowedEmails.map((e) => e.toLowerCase()).includes(who.toLowerCase())) throw new Error('This account is not allowed');
  return who;
}

export function resetAccessKeyCache() { keyCache = null; }
