import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Thumbnail + Instagram post caption for a finished Auto reel.
 * Frames come from the edited talking-head video (before captions and B-roll), so every candidate shows the speaker.
 */
export const FRAME_COUNT = 6;

function ffmpeg(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; child.stderr.on('data', (chunk) => { err += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-400)}`)));
  });
}

export const framePaths = (dir: string, n: number) => ({ full: path.join(dir, `frame-${n}.jpg`), small: path.join(dir, `frame-${n}-small.jpg`) });

/** Pull FRAME_COUNT stills spread over the reel (skipping the very start and end): full size for the cover, small for the AI and the phone. */
export async function extractCandidateFrames(ffmpegBin: string, videoPath: string, duration: number, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  for (let n = 0; n < FRAME_COUNT; n += 1) {
    const t = Math.max(0.3, duration * (0.06 + 0.8 * n / (FRAME_COUNT - 1)));
    const { full, small } = framePaths(dir, n);
    // One decoded frame each (fast seek): no whole-video decode.
    await ffmpeg(ffmpegBin, ['-ss', t.toFixed(2), '-i', videoPath, '-frames:v', '1', '-q:v', '2', full]);
    await ffmpeg(ffmpegBin, ['-i', full, '-vf', 'scale=360:-2', '-q:v', '4', small]);
  }
  return Array.from({ length: FRAME_COUNT }, (_, n) => framePaths(dir, n).small);
}

export const PACKAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['frame', 'faces', 'lines', 'label', 'badges', 'caption', 'hashtags'],
  properties: {
    frame: { type: 'integer', minimum: 0, maximum: FRAME_COUNT - 1 },
    faces: { type: 'array', minItems: FRAME_COUNT, maxItems: FRAME_COUNT, items: { type: 'number', minimum: 0, maximum: 1 } },
    lines: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    label: { type: 'string' },
    badges: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['icon', 'label'], properties: { icon: { type: 'string' }, label: { type: 'string' } } } },
    caption: { type: 'string' },
    hashtags: { type: 'array', maxItems: 12, items: { type: 'string' } },
  },
} as const;

export function buildPackagePrompt(transcript: string, frameFiles: string[], notes?: string) {
  return `You package a finished Instagram Reel / YouTube Short: pick the cover frame, write the cover text and write the post caption.

WHAT THE SPEAKER SAYS IN THE REEL (already edited):
"""${transcript}"""

COVER FRAMES (look at every one): ${frameFiles.map((file, i) => `${i}: ${path.basename(file)}`).join(', ')}
frame: index of the best cover frame: face sharp, eyes open, looking at the camera, mouth closed or a natural expression (not mid-word), no blur.
faces: for EVERY frame in order, where the centre of the face is across the picture, 0 = left edge, 0.5 = middle, 1 = right edge.

COVER TEXT (big bold headline over the top of the frame, like popular creator covers):
- lines: exactly 3 short lines. Line 2 is printed on a bright highlight block, so it carries the strongest word or number.
  Together they make one hook that promises the payoff of the reel or opens a curiosity gap. Max ~16 characters per line.
  Use the reel's own language: Malayalam words in Malayalam script and English words in English letters (as people write them, e.g. "Doctors-നും"). Plain English is fine when the speaker mostly uses English terms.
  A line may be "" when two lines are stronger.
- label: a short ALL-CAPS strip lower on the cover, 2-4 words, e.g. "WATCH TILL THE END", "SAVE THIS · FREE TIP". English.
- badges: 0-2 small icon cards beside the face. Each is ONE emoji that fits the topic plus a label of max 8 characters (a number or a word, may be ""). Use [] if nothing fits.

POST CAPTION:
- caption: the text posted under the reel, in the speaker's language (same script rules). First line is a scroll-stopping hook (not the same words as the cover).
  Then 2-5 short lines with the key point(s) from the talk, and a last line that asks a question or invites a save/share. Line breaks between lines. 0-3 emoji in total. No hashtags here.
- hashtags: 6-10 relevant hashtags without spaces, each starting with #, mixing broad and niche (English, plus Malayalam-audience tags like #malayalam where they fit).

RULES: only claims the speaker actually makes; no invented numbers; no "guaranteed", "best", "painless", "100%" or miracle promises; no clickbait that the reel does not pay off.${notes ? `\n\nTHE OWNER ASKED FOR THIS (follow it): ${notes}` : ''}`;
}

export type PackageText = { frame: number; faces: number[]; lines: string[]; label: string; badges: Array<{ icon: string; label: string }>; caption: string; hashtags: string[] };

export function cleanPackage(raw: unknown): PackageText {
  const value = (raw ?? {}) as Record<string, any>;
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x : '').trim().slice(0, max);
  const lines = (Array.isArray(value.lines) ? value.lines : []).slice(0, 3).map((line: unknown) => text(line, 40));
  while (lines.length < 3) lines.push('');
  return {
    frame: Math.min(FRAME_COUNT - 1, Math.max(0, Math.round(Number(value.frame) || 0))),
    faces: Array.from({ length: FRAME_COUNT }, (_, i) => { const x = Number(Array.isArray(value.faces) ? value.faces[i] : NaN); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5; }),
    lines, label: text(value.label, 40),
    badges: (Array.isArray(value.badges) ? value.badges : []).slice(0, 2).map((badge: any) => ({ icon: text(badge?.icon, 8), label: text(badge?.label, 10) })).filter((badge: { icon: string }) => badge.icon),
    caption: text(value.caption, 2200),
    hashtags: (Array.isArray(value.hashtags) ? value.hashtags : []).map((tag: unknown) => text(tag, 40).replace(/\s+/g, '')).filter(Boolean).map((tag: string) => tag.startsWith('#') ? tag : `#${tag}`).slice(0, 12),
  };
}
