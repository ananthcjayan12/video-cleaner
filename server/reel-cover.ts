/**
 * The reel's cover (Instagram thumbnail), designed by ChatGPT from the clinic's own posts: Claude writes the headline
 * from what the speaker says, then ChatGPT draws the cover with the clinic's post examples and logo attached as
 * references. The cover is added as the reel's last second, so it can be picked as the cover frame when posting, and
 * is also saved as the thumbnail image.
 *
 * References live per clinic, outside the repo: ~/.video-cleaner/brands/<workspaceId>/cover-refs/
 *   style.*  (example posts in the clinic's look; main style reference)
 *   posts.*  (more example posts, optional)
 *   logo.*   (the clinic's logo)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { brandDir } from './brand-theme.js';
import type { ChatGptImageRequest } from './chatgpt-images.js';
import { generateStructuredText, type TextModelChoice, type TextModelConfig } from './text-models.js';

/** Seconds the cover is shown at the end of the reel. */
export const COVER_SECONDS = 1;
export const coverFile = (workDir: string) => path.join(workDir, 'auto', 'cover.png');
export const coverRawFile = (workDir: string) => path.join(workDir, 'auto', 'cover.raw.png');

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** The clinic's reference images in a fixed order (style, more posts, logo); empty when it has none. */
export async function coverReferences(workspaceId: string | undefined) {
  if (!workspaceId) return { style: [] as string[], logo: undefined as string | undefined };
  const dir = path.join(brandDir(workspaceId), 'cover-refs');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => IMAGE.test(name)).sort();
  const pick = (stem: string) => files.filter((name) => name.toLowerCase().startsWith(stem)).map((name) => path.join(dir, name));
  return { style: [...pick('style'), ...pick('posts')], logo: pick('logo')[0] };
}

export type CoverText = { lines: string[]; picture: string };

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lines', 'picture'],
  properties: {
    lines: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
    picture: { type: 'string' },
  },
} as const;

export function buildCoverPrompt(transcript: string, field?: string) {
  return [
    `Write the cover headline for a short vertical video (an Instagram Reel)${field ? ` by a ${field}` : ''}. The speaker's words:`,
    `"""${transcript.slice(0, 6000)}"""`,
    '',
    'Return:',
    '- lines: the headline in 2 or 3 short lines (at most about 18 characters each), read top to bottom as one hook.',
    '  Usually the question the viewer has, the way the clinic posts it, e.g. "ചെറിയ ശീലങ്ങൾ" / "പല്ലിന്റെ നിരയെ" / "ബാധിക്കുമോ?".',
    '  Write in the language the speaker uses (Malayalam with the English words they say, like "Clean", "Enamel"), correct spelling.',
    '  Only say what the speaker says. No promises ("painless", "best", "guaranteed"), no prices or offers, no emoji.',
    '- picture: one sentence in English describing a realistic dental picture for the lower part of the cover that shows the topic',
    '  (for example "a dental model with a pencil pressing on the front teeth"). No people\'s faces, no text in the picture.',
  ].join('\n');
}

export function cleanCoverText(raw: unknown): CoverText {
  const value = (raw ?? {}) as { lines?: unknown; picture?: unknown };
  const lines = (Array.isArray(value.lines) ? value.lines : []).map((line) => String(line).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  if (lines.length < 2) throw new Error('The cover headline came back empty');
  const picture = String(value.picture ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'a clean, realistic close-up of healthy teeth';
  return { lines, picture };
}

export async function planCoverText(options: { textConfig: TextModelConfig; choice: TextModelChoice; workDir: string; transcript: string; field?: string }) {
  const raw = await generateStructuredText({ choice: options.choice, config: options.textConfig, workDir: options.workDir, prompt: buildCoverPrompt(options.transcript, options.field), schema: SCHEMA as unknown as Record<string, unknown>, outputName: 'reel-cover' });
  return cleanCoverText(raw);
}

/** What ChatGPT is asked to draw. */
export function coverImagePrompt(text: CoverText, options: { clinic?: string; hasStyle: boolean; hasLogo: boolean }) {
  const [first, ...rest] = text.lines;
  return [
    `Design a vertical 9:16 Instagram Reel cover${options.clinic ? ` for ${options.clinic}` : ''}.`,
    options.hasStyle
      ? 'Copy the design style of the attached example posts (my clinic\'s Instagram posts) as closely as possible: the same colours, the same heavy rounded lettering, the big slightly tilted headline with the first line in a white rounded box and the next lines in a teal rounded ribbon box, the softly blurred clinic background and a realistic dental picture below the headline.'
      : 'Style: clean modern dental clinic post, teal and white, heavy rounded lettering, the big slightly tilted headline with the first line in a white rounded box and the next lines in a teal rounded ribbon box, a softly blurred clinic background and a realistic dental picture below the headline.',
    options.hasLogo ? 'Put the attached logo small at the top centre, exactly as it is (do not redraw or change its text).' : '',
    'Headline, written exactly as given, letter for letter (it is Malayalam; keep every character and sign):',
    `  Line 1 (white box): ${first}`,
    ...rest.map((line, i) => `  Line ${i + 2} (teal ribbon): ${line}`),
    `Picture below the headline: ${text.picture.replace(/[.\s]+$/, "")}.`,
    'Keep the logo and the headline inside the middle three quarters of the height (Instagram crops the grid to 3:4), and leave the bottom eighth free of text.',
    'No other text: no phone numbers, prices, hashtags, watermarks or captions.',
  ].filter(Boolean).join('\n');
}

/** The ChatGPT request for the cover, or null when the clinic has no references yet. */
export async function coverRequest(options: { workDir: string; workspaceId?: string; text: CoverText; clinic?: string }): Promise<ChatGptImageRequest | null> {
  const refs = await coverReferences(options.workspaceId);
  if (!refs.style.length && !refs.logo) return null;
  // Copied into the reel's folder: the browser's upload tool only takes files from the folder the session runs in.
  const local = path.join(options.workDir, 'auto', 'cover-refs');
  await fs.mkdir(local, { recursive: true });
  const references: string[] = [];
  for (const file of [...refs.style.slice(0, 2), ...(refs.logo ? [refs.logo] : [])]) {
    const copy = path.join(local, path.basename(file)); await fs.copyFile(file, copy); references.push(copy);
  }
  return { id: 'cover', designed: true, aspect: '9:16', outputPath: coverRawFile(options.workDir), references,
    prompt: coverImagePrompt(options.text, { clinic: options.clinic, hasStyle: refs.style.length > 0, hasLogo: Boolean(refs.logo) }) };
}
