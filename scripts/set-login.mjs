#!/usr/bin/env node
// Set (or change) the username + password for logging in to Video Cleaner from a phone or another computer.
// Run on this computer:  node scripts/set-login.mjs
// The password is typed without showing on screen and is stored only as a salted scrypt hash in
// ~/.video-cleaner/auth.json (readable only by you). Changing it logs out every device.
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }; // must match server/auth.ts
const file = process.env.VIDEO_CLEANER_AUTH_FILE || path.join(os.homedir(), '.video-cleaner', 'auth.json');

// One reader for every question (a new reader per question loses piped input). Hidden answers are not echoed.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (text) => { if (!muted) write ? write(text) : process.stdout.write(text); };
const lines = rl[Symbol.asyncIterator]();
async function ask(question, hidden = false) {
  process.stdout.write(question); muted = hidden;
  const { value } = await lines.next(); muted = false;
  if (hidden) process.stdout.write('\n');
  return value ?? '';
}

const existing = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const username = ((await ask(`Username${existing?.username ? ` [${existing.username}]` : ''}: `)).trim() || existing?.username || '').trim();
if (!username) { console.error('A username is required.'); process.exit(1); }
const password = await ask('Password (at least 10 characters, hidden): ', true);
if (password.length < 10) { console.error('Too short: use at least 10 characters.'); process.exit(1); }
if (await ask('Type the password again: ', true) !== password) { console.error('The two passwords do not match. Nothing was changed.'); process.exit(1); }

const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64, SCRYPT);
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify({ username, salt: salt.toString('base64'), hash: hash.toString('base64'), sessionSecret: randomBytes(32).toString('base64url'), updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
await fs.chmod(file, 0o600);
rl.close();
console.log(`Saved. Log in at https://editor.srshti.co.in as "${username}". (Other devices were logged out.)`);
