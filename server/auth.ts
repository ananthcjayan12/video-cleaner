import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Username + password login for requests that come from outside this computer (the Cloudflare tunnel).
 * The password is stored only as a salted scrypt hash in ~/.video-cleaner/auth.json (mode 600), set with
 * `node scripts/set-login.mjs` on this computer. A successful login gets a signed, HttpOnly session cookie.
 */
const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'vc_session';
export const SESSION_DAYS = 30;

export type AuthFile = { username: string; salt: string; hash: string; sessionSecret: string; updatedAt: string };
export const authPath = () => process.env.VIDEO_CLEANER_AUTH_FILE || path.join(os.homedir(), '.video-cleaner', 'auth.json');

export async function loadAuth(file = authPath()): Promise<AuthFile | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as AuthFile;
    return value.username && value.salt && value.hash && value.sessionSecret ? value : null;
  } catch { return null; }
}

export async function hashPassword(password: string, salt = randomBytes(16)) {
  return { salt: salt.toString('base64'), hash: (await scrypt(password, salt, 64, SCRYPT)).toString('base64') };
}

export async function checkCredentials(auth: AuthFile, username: string, password: string) {
  const expected = Buffer.from(auth.hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(auth.salt, 'base64'), expected.length, SCRYPT);
  const userOk = timingSafeEqual(Buffer.from(createHmac('sha256', 'u').update(String(username).trim().toLowerCase()).digest()), Buffer.from(createHmac('sha256', 'u').update(auth.username.toLowerCase()).digest()));
  return timingSafeEqual(actual, expected) && userOk;
}

const sign = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('base64url');

/** Cookie value: base64url(username).expiryMs.signature — signed with the secret that changes whenever the password does. */
export function issueSession(auth: AuthFile, now = Date.now()) {
  const value = `${Buffer.from(auth.username).toString('base64url')}.${now + SESSION_DAYS * 86400_000}`;
  return `${value}.${sign(auth.sessionSecret, value)}`;
}

export function verifySession(auth: AuthFile, token: string | undefined, now = Date.now()) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const expected = Buffer.from(sign(auth.sessionSecret, `${parts[0]}.${parts[1]}`));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  if (Buffer.from(parts[0], 'base64url').toString() !== auth.username) return false;
  return Number(parts[1]) > now;
}

export function readCookie(header: string | undefined, name: string) {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** At most `limit` failed logins per client in a sliding window; successful logins clear the count. */
export class LoginLimiter {
  private failures = new Map<string, number[]>();
  constructor(private limit = 8, private windowMs = 15 * 60_000) {}
  blocked(key: string, now = Date.now()) {
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, recent);
    return recent.length >= this.limit;
  }
  fail(key: string, now = Date.now()) { this.failures.set(key, [...(this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs), now]); }
  clear(key: string) { this.failures.delete(key); }
}

export const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1115"><title>Video Cleaner · Log in</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;
background:#0f1115;color:#f3f4f6;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
form{width:100%;max-width:380px;background:#171a21;border:1px solid #262b36;border-radius:20px;padding:28px 22px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
h1{margin:0 0 4px;font-size:22px}p{margin:0 0 22px;color:#9aa3b2;font-size:14px}
label{display:block;font-size:13px;color:#c4cad4;margin:14px 0 6px}
input{width:100%;font-size:17px;padding:14px 14px;border-radius:12px;border:1px solid #2f3542;background:#0f1115;color:#fff;outline:none}
input:focus{border-color:#7fe3d6;box-shadow:0 0 0 3px rgba(127,227,214,.18)}
button{margin-top:22px;width:100%;font-size:17px;font-weight:600;padding:15px;border:0;border-radius:12px;background:#7fe3d6;color:#0b1312}
button:disabled{opacity:.6}.error{color:#ff8a80;font-size:14px;min-height:20px;margin-top:12px}
</style></head><body>
<form id="f" autocomplete="on"><h1>Video Cleaner</h1><p>Log in to continue.</p>
<label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button id="b" type="submit">Log in</button><div class="error" id="e" role="alert"></div></form>
<script>
const f=document.getElementById('f'),b=document.getElementById('b'),e=document.getElementById('e');
f.addEventListener('submit',async(ev)=>{ev.preventDefault();b.disabled=true;e.textContent='';
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.username.value,password:f.password.value})});
const d=await r.json().catch(()=>({}));if(r.ok){location.replace(new URLSearchParams(location.search).get('next')||'/');return}e.textContent=d.error||'Login failed';}
catch{e.textContent='Network problem, try again';}b.disabled=false;});
</script></body></html>`;
