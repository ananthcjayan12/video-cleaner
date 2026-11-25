import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Word } from './project-store.js';

/** Speech-to-text returns the project's transcript.json word schema: { id, text, start, end } in source seconds. */
export type SttProvider = 'gemini' | 'elevenlabs';
export type Transcript = { text: string; words: Word[]; language?: string; provider: SttProvider; model: string };
export type SttConfig = {
  provider: SttProvider; ffmpegBin: string; workDir: string;
  geminiApiKey?: string; geminiModel?: string; elevenLabsApiKey?: string;
  onProgress?: (done: number, total: number) => void;
};

export const DEFAULT_GEMINI_STT_MODEL = 'gemini-3.8-flash';

export function sttProviderValue(value: unknown, fallback: SttProvider): SttProvider {
  return value === 'gemini' || value === 'elevenlabs' ? value : fallback;
}

// Captions show English as English: Malayalam (or Hindi, Tamil…) in its own script, every English word in Latin letters.
export const GEMINI_STT_PROMPT = [
  'Transcribe this talking-head audio word for word for on-screen captions.',
  'Write words in the language spoken, in its own script (Malayalam in Malayalam script).',
  'EVERY English word the speaker says (including everyday loanwords like social media, video, doctors, clinic, digital marketing,',
  'reach, views, series, tips, tricks, okay) must be written in English letters with normal English spelling, never in another script.',
  "When a Malayalam suffix is attached to an English word, write the English word in English and the suffix in Malayalam joined with",
  "a hyphen, e.g. 'Doctors-നും', 'Clinic-ൽ', 'Video-യിൽ'. Keep fillers, repeats and false starts exactly as spoken; do not clean up.",
  'Give EVERY word with its start and end time in seconds from the start of this audio, as precise as you can (to 0.05 s).',
  'Return JSON only: {"language": string, "words": [{"text": string, "start": number, "end": number}]}',
].join(' ');

function run(command: string, args: string[]) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = []; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout: Buffer.concat(out), stderr }) : reject(new Error(`${path.basename(command)} failed (${code}): ${stderr.slice(-600)}`)));
  });
}

/** Parse FFmpeg silencedetect output into [start, end] pairs. */
export function parseSilences(stderr: string): Array<[number, number]> {
  const silences: Array<[number, number]> = []; let open: number | null = null;
  for (const match of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const value = Math.max(0, Number(match[2]));
    if (match[1] === 'start') open = value; else if (open !== null) { silences.push([open, value]); open = null; }
  }
  return silences;
}

/**
 * Choose chunk boundaries for transcription. Long audio makes word timestamps drift, so audio is cut into
 * ~target-second pieces, always in the middle of a pause so no word is split.
 */
export function planChunks(silences: Array<[number, number]>, duration: number, target = 18, min = 8, max = 28): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  let start = 0;
  while (duration - start > max) {
    const candidates = silences.map(([a, b]) => (a + b) / 2).filter((mid) => mid - start >= min && mid - start <= max);
    const cut = candidates.length ? candidates.reduce((best, mid) => Math.abs(mid - start - target) < Math.abs(best - start - target) ? mid : best) : start + target;
    chunks.push([start, cut]); start = cut;
  }
  chunks.push([start, duration]);
  return chunks.filter(([a, b]) => b - a > 0.05);
}

type RawWord = { text?: unknown; start?: unknown; end?: unknown };
/** Shift chunk-relative words onto the source timeline, keep them inside the chunk and in order. */
export function placeChunkWords(raw: RawWord[], chunkStart: number, chunkEnd: number) {
  const words: Array<{ text: string; start: number; end: number }> = [];
  let floor = chunkStart;
  for (const item of raw) {
    const text = String(item.text ?? '').trim();
    const start = Number(item.start); const end = Number(item.end);
    if (!text || !Number.isFinite(start)) continue;
    // A word placed past the chunk end still keeps 50 ms so it never collapses to zero length.
    const s = Math.min(chunkEnd - 0.05, Math.max(floor, chunkStart + start));
    const e = Math.min(chunkEnd, Math.max(s + 0.05, chunkStart + (Number.isFinite(end) ? end : start + 0.3)));
    words.push({ text, start: round(s), end: round(e) }); floor = s;
  }
  return words;
}
const round = (value: number) => Math.round(value * 1000) / 1000;

async function audioDuration(ffmpegBin: string, file: string) {
  const { stderr } = await run(ffmpegBin, ['-hide_banner', '-i', file, '-f', 'null', '-']).catch((error) => ({ stderr: String(error), stdout: Buffer.alloc(0) }));
  const match = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
  if (!match) throw new Error('Could not read the analysis audio duration');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function geminiChunk(apiKey: string, model: string, file: string) {
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: 'audio/mpeg', data: (await fs.readFile(file)).toString('base64') } }, { text: GEMINI_STT_PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Gemini transcription failed: ${response.status} ${(await response.text()).slice(0, 400)}`);
      const data: any = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '';
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed?.words)) throw new Error('Gemini returned no words array');
      return parsed as { language?: string; words: RawWord[] };
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function transcribeGemini(audioPath: string, config: SttConfig): Promise<Transcript> {
  if (!config.geminiApiKey) throw new Error('Gemini API key is not configured (Settings → Gemini API key)');
  const model = config.geminiModel || DEFAULT_GEMINI_STT_MODEL;
  const { stderr } = await run(config.ffmpegBin, ['-hide_banner', '-i', audioPath, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-']);
  const duration = await audioDuration(config.ffmpegBin, audioPath);
  const chunks = planChunks(parseSilences(stderr), duration);
  const dir = path.join(config.workDir, 'stt-chunks');
  await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
  const results: Array<{ language?: string; words: Array<{ text: string; start: number; end: number }> }> = new Array(chunks.length);
  let done = 0; config.onProgress?.(0, chunks.length);
  // Three chunks at a time: fast, and well inside API rate limits.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
    while (next < chunks.length) {
      const index = next++; const [start, end] = chunks[index];
      const file = path.join(dir, `chunk-${String(index).padStart(3, '0')}.mp3`);
      await run(config.ffmpegBin, ['-v', 'error', '-y', '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', audioPath, '-ac', '1', '-ar', '16000', '-b:a', '48k', file]);
      const raw = await geminiChunk(config.geminiApiKey!, model, file);
      results[index] = { language: raw.language, words: placeChunkWords(raw.words, start, end) };
      config.onProgress?.(++done, chunks.length);
    }
  }));
  await fs.rm(dir, { recursive: true, force: true });
  const words: Word[] = results.flatMap((chunk) => chunk.words).map((word, index) => ({ id: `w${String(index + 1).padStart(6, '0')}`, ...word }));
  if (!words.length) throw new Error('Gemini returned no words for this audio');
  return { text: words.map((word) => word.text).join(' '), words, language: results.find((chunk) => chunk.language)?.language, provider: 'gemini', model };
}

async function transcribeElevenLabs(audioPath: string, config: SttConfig): Promise<Transcript> {
  if (!config.elevenLabsApiKey) throw new Error('ElevenLabs API key is not configured');
  const form = new FormData();
  form.append('model_id', 'scribe_v2'); form.append('timestamps_granularity', 'word');
  form.append('file', new Blob([await fs.readFile(audioPath)]), path.basename(audioPath));
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': config.elevenLabsApiKey }, body: form });
  if (!response.ok) throw new Error(`ElevenLabs failed: ${response.status} ${await response.text()}`);
  const raw: any = await response.json();
  const words: Word[] = (raw.words ?? []).filter((word: any) => word.type === 'word' && Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word: any, index: number) => ({ id: `w${String(index + 1).padStart(6, '0')}`, text: word.text, start: word.start, end: word.end }));
  if (!words.length) throw new Error('No timestamped words returned by ElevenLabs');
  return { text: raw.text ?? words.map((word) => word.text).join(' '), words, language: raw.language_code, provider: 'elevenlabs', model: 'scribe_v2' };
}

export function transcribeAudio(audioPath: string, config: SttConfig) {
  return config.provider === 'gemini' ? transcribeGemini(audioPath, config) : transcribeElevenLabs(audioPath, config);
}
