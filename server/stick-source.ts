import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseModelJson } from './text-models.js';
import { recordUsage } from './usage.js';

/**
 * "From a link": an Instagram / YouTube / Facebook / TikTok reel is downloaded with yt-dlp. Instagram links use the
 * owner's Instagram login from Chrome on this laptop (yt-dlp reads Chrome's cookies in memory for that request; nothing
 * is copied to disk). INSTAGRAM_COOKIES_BROWSER picks the browser[:profile] (default "chrome"), "off" downloads logged out.
 * shrunk, and watched by Gemini, which returns what it says and how it is built. The script writer then makes OUR
 * OWN version from that; the source video is deleted straight after.
 */

export type ReelSource = {
  url: string; platform: string; title: string; uploader: string; durationSec: number; caption: string;
  language: string; topic: string; hook: string; summary: string; structure: string[]; keyPoints: string[];
  onScreenText: string[]; visualStyle: string; transcript: string;
};
export type SourceJob = { id: string; state: 'running' | 'ready' | 'failed'; stage: string; source?: ReelSource; error?: string; startedAt: number; abort?: AbortController };
export const sourceJobs = new Map<string, SourceJob>();

const HOSTS = /(^|\.)(instagram\.com|instagr\.am|youtube\.com|youtu\.be|facebook\.com|fb\.watch|tiktok\.com)$/i;
export function cleanReelUrl(input: string): { url: string; platform: string } {
  const match = /https?:\/\/\S+/i.exec(input.trim());
  if (!match) throw new Error('Paste an Instagram or YouTube link.');
  let url: URL;
  try { url = new URL(match[0].replace(/[),.]+$/, '')); } catch { throw new Error('That link does not look right.'); }
  if (!HOSTS.test(url.hostname)) throw new Error('Only Instagram, YouTube, Facebook and TikTok links are supported.');
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const platform = /instagr/.test(host) ? 'Instagram' : /youtu/.test(host) ? 'YouTube' : /tiktok/.test(host) ? 'TikTok' : 'Facebook';
  if (platform === 'Instagram') { url.search = ''; url.hash = ''; }
  else for (const key of [...url.searchParams.keys()]) if (/^(si|igsh|igshid|utm_.*|feature|fbclid)$/i.test(key)) url.searchParams.delete(key);
  return { url: url.toString(), platform };
}

/** yt-dlp: YTDLP_BIN, then PractiReel's own copy (~/.video-cleaner/ytdlp-venv, has the keyring module needed to read
 * Chrome's encrypted cookies), then PATH, then the copy in story-reels' Python environment. */
export function findYtDlp(): string | null {
  const candidates = [process.env.YTDLP_BIN, path.join(os.homedir(), '.video-cleaner/ytdlp-venv/bin/yt-dlp'), ...String(process.env.PATH ?? '').split(':').map((dir) => dir && path.join(dir, 'yt-dlp')), path.join(os.homedir(), '.local/bin/yt-dlp'), path.join(os.homedir(), 'story-reels/.venv/bin/yt-dlp')];
  return candidates.find((file): file is string => Boolean(file) && existsSync(file!)) ?? null;
}

function run(bin: string, args: string[], timeoutMs: number, currentSignal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (currentSignal?.aborted) return reject(new Error('Stopped.'));
    const child = spawn(bin, args, { shell: false, signal: currentSignal });
    let out = ''; let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (chunk) => { out += String(chunk); if (out.length > 20_000_000) child.kill('SIGTERM'); });
    child.stderr.on('data', (chunk) => { err += String(chunk); if (err.length > 200_000) err = err.slice(-100_000); });
    child.on('error', (error) => { clearTimeout(timer); reject(currentSignal?.aborted ? new Error('Stopped.') : error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const lines = err.split('\n').map((line) => line.trim()).filter(Boolean);
      reject(new Error(lines.reverse().find((line) => line.includes('ERROR')) ?? lines[0] ?? `${path.basename(bin)} exited ${code}`));
    });
  });
}

const ASK = `Watch this short video (a reel). It is a REFERENCE for a creator who will make their own, different version on the same topic.
Return JSON with:
- language: the language spoken (e.g. "Malayalam", "English", "Manglish")
- topic: what it is about, one line
- hook: what happens / is said in the first 3 seconds that grabs attention
- summary: 2-3 sentences on the message and the twist or payoff
- structure: the beats in order, one short line each (e.g. "hook question", "common myth", "real reason", "tip", "CTA")
- keyPoints: the facts or claims made, one per item
- onScreenText: notable text shown on screen
- visualStyle: one line on how it is shot or animated
- transcript: everything said, word for word, in the language spoken and its own script (Malayalam in Malayalam script; English words said inside Malayalam stay in English letters). Empty if nothing is said.`;

/** Download, shrink (5 min, 360p, low fps), let Gemini watch it, delete the video. */
export async function fetchReelSource(options: {
  input: string; workDir: string; ffmpeg: string; geminiApiKey: string; model: string; progress: (stage: string) => void; signal?: AbortSignal;
}): Promise<ReelSource> {
  const { url, platform } = cleanReelUrl(options.input);
  const ytdlp = findYtDlp(); if (!ytdlp) throw new Error('yt-dlp is not installed on this computer.');
  if (!options.geminiApiKey) throw new Error('Add a Gemini API key to read the video.');
  await fs.mkdir(options.workDir, { recursive: true });
  try {
    const browser = process.env.INSTAGRAM_COOKIES_BROWSER ?? 'chrome';
    const auth = platform === 'Instagram' && browser !== 'off' ? ['--cookies-from-browser', browser] : [];
    options.progress(`Reading the ${platform} post${auth.length ? ' (with your Instagram login)' : ''}…`);
    const meta = JSON.parse(await run(ytdlp, ['--no-warnings', '--no-playlist', ...auth, '--dump-single-json', url], 120_000, options.signal).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (auth.length && /login|empty media|cookies|private|rate|not available|unavailable/i.test(message)) throw new Error(`Instagram would not share this reel. Make sure Instagram is signed in in Chrome on the laptop (open instagram.com there and log in once), then try again. If it is signed in, the post may be private or Instagram is rate-limiting: wait a few minutes. (${message.slice(0, 140)})`);
      throw new Error(/login|private|rate|not available|unavailable/i.test(message) ? `${platform} would not share this video without a login (private, age-restricted or rate-limited). Try another public link, or upload the video. (${message.slice(0, 160)})` : message);
    })) as { title?: string; description?: string; uploader?: string; channel?: string; duration?: number };
    if ((meta.duration ?? 0) > 20 * 60) throw new Error('That video is over 20 minutes. Use a reel or a short.');

    options.progress('Downloading the video…');
    await run(ytdlp, ['--no-warnings', '--no-playlist', '-q', ...auth, '-f', 'best[height<=720]/bv*[height<=720]+ba/best', '--max-filesize', '400M', '-o', path.join(options.workDir, 'source.%(ext)s'), url], 600_000, options.signal);
    const file = (await fs.readdir(options.workDir)).find((name) => name.startsWith('source.'));
    if (!file) throw new Error('The download finished without a video file.');

    options.progress('Preparing it for the AI…');
    const small = path.join(options.workDir, 'small.mp4');
    await run(options.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(options.workDir, file), '-t', '300', '-vf', 'scale=-2:360,fps=2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-c:a', 'aac', '-ac', '1', '-b:a', '40k', small], 300_000, options.signal);
    await fs.rm(path.join(options.workDir, file), { force: true });
    const bytes = await fs.readFile(small);
    if (bytes.length > 19 * 1024 * 1024) throw new Error('The video is too long to read in one go. Use a reel under 5 minutes.');

    options.progress('The AI is watching it…');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.geminiApiKey }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: bytes.toString('base64') } }, { text: ASK }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; error?: { message?: string } };
    if (!response.ok) throw new Error('Gemini: ' + (body.error?.message || response.status));
    await recordUsage({ kind: 'text', provider: 'gemini', model: options.model, inputTokens: body.usageMetadata?.promptTokenCount, outputTokens: body.usageMetadata?.candidatesTokenCount, task: 'read reel link' });
    const raw = parseModelJson((body.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('')) as Partial<Record<keyof ReelSource, unknown>>;
    const str = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
    const list = (value: unknown, max: number) => (Array.isArray(value) ? value.map((item) => str(item, 300)).filter(Boolean).slice(0, max) : []);
    return {
      url, platform, title: str(meta.title, 200), uploader: str(meta.uploader ?? meta.channel, 100), durationSec: Math.round(meta.duration ?? 0), caption: str(meta.description, 2000),
      language: str(raw.language, 40), topic: str(raw.topic, 300), hook: str(raw.hook, 400), summary: str(raw.summary, 1200),
      structure: list(raw.structure, 12), keyPoints: list(raw.keyPoints, 12), onScreenText: list(raw.onScreenText, 12), visualStyle: str(raw.visualStyle, 300), transcript: str(raw.transcript, 6000),
    };
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Stopped.');
    throw error;
  } finally {
    await fs.rm(options.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function newSourceJob(): SourceJob {
  for (const [id, job] of sourceJobs) if (Date.now() - job.startedAt > 6 * 3600_000) sourceJobs.delete(id);
  const job: SourceJob = { id: randomUUID(), state: 'running', stage: 'Starting…', startedAt: Date.now(), abort: new AbortController() };
  sourceJobs.set(job.id, job);
  return job;
}

/** What the script writer is told about the reference reel. */
export function sourceBrief(source: ReelSource): string {
  return [
    `REFERENCE REEL (${source.platform}${source.uploader ? `, by ${source.uploader}` : ''}). Make OUR OWN original version on the same topic: same kind of value for the viewer, a fresh hook and our own words. Never copy its sentences, jokes or structure line by line, and never mention the other creator. If a claim in it is wrong, exaggerated or unsafe, leave it out or correct it.`,
    source.topic && `Topic: ${source.topic}`,
    source.hook && `Its hook: ${source.hook}`,
    source.summary && `What it says: ${source.summary}`,
    source.structure.length ? `Its beats: ${source.structure.join(' → ')}` : '',
    source.keyPoints.length ? `Its points:\n${source.keyPoints.map((p) => `- ${p}`).join('\n')}` : '',
    source.transcript && `Its words (for understanding only, do not reuse):\n${source.transcript.slice(0, 3000)}`,
  ].filter(Boolean).join('\n');
}

/** Accept a source sent back by the browser, keeping only known fields at safe lengths. */
export function sourceFromBody(value: unknown): ReelSource | undefined {
  const raw = value as Partial<Record<keyof ReelSource, unknown>> | undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') return undefined;
  const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((item) => str(item, 300)).slice(0, 12) : []);
  return {
    url: str(raw.url, 500), platform: str(raw.platform, 20), title: str(raw.title, 200), uploader: str(raw.uploader, 100), durationSec: Number(raw.durationSec) || 0, caption: str(raw.caption, 2000),
    language: str(raw.language, 40), topic: str(raw.topic, 300), hook: str(raw.hook, 400), summary: str(raw.summary, 1200),
    structure: list(raw.structure), keyPoints: list(raw.keyPoints), onScreenText: list(raw.onScreenText), visualStyle: str(raw.visualStyle, 300), transcript: str(raw.transcript, 6000),
  };
}
