import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateStructuredText, type TextModelChoice, type TextModelConfig } from './text-models.js';
import { recordUsage } from './usage.js';

/**
 * "Write it for me" stick-figure reels: concept -> AI script (approved by the owner) -> AI narration (Gemini TTS)
 * -> the normal stick pipeline (transcribe, plan, render) runs on the narration as if it were an uploaded voiceover.
 */

/** Gemini's male prebuilt voices with Google's one-word character for each. */
export const MALE_VOICES: Array<{ id: string; label: string }> = [
  { id: 'Sadaltager', label: 'Sadaltager · knowledgeable (default)' },
  { id: 'Charon', label: 'Charon · informative' },
  { id: 'Iapetus', label: 'Iapetus · clear' },
  { id: 'Orus', label: 'Orus · firm' },
  { id: 'Achird', label: 'Achird · friendly' },
  { id: 'Algieba', label: 'Algieba · smooth' },
  { id: 'Umbriel', label: 'Umbriel · easy-going' },
  { id: 'Alnilam', label: 'Alnilam · firm' },
  { id: 'Rasalgethi', label: 'Rasalgethi · informative' },
  { id: 'Schedar', label: 'Schedar · even' },
  { id: 'Puck', label: 'Puck · upbeat' },
  { id: 'Fenrir', label: 'Fenrir · excitable' },
  { id: 'Algenib', label: 'Algenib · gravelly' },
  { id: 'Enceladus', label: 'Enceladus · breathy' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi · casual' },
  { id: 'Sadachbia', label: 'Sadachbia · lively' },
];

/** Script writer engine default: Claude CLI, Sonnet 5.5, high effort (owner's choice, 2026-11-26). */
export const DEFAULT_SCRIPT_ENGINE = { provider: 'claude-cli' as const, model: 'claude-sonnet-5-5', effort: 'high' };

export const DEFAULT_MALE_STYLE =
  'A Malayali man in his early thirties from Kerala, a friendly young doctor talking to people on Instagram. ' +
  'Native Malayalam speaker with a natural Kerala accent and intonation, warm, confident and clear. ' +
  'The English words in the text are said the way an educated Malayali says them in everyday Manglish, ' +
  'not with an American or British accent. Conversational and lively, like explaining to a friend, ' +
  'not a news reader, not dramatic. Steady, slightly brisk pace.';

export type StickStudioSettings = {
  voice: string;
  voiceStyle: string;
  ttsModel: string;
  /** 0.8-1.25: tempo applied after the voice is made (1 = as spoken). */
  speed: number;
  /** Silence between script lines, in milliseconds. */
  lineGapMs: number;
  scriptSeconds: number;
  scriptLanguage: 'malayalam' | 'english';
  /** Extra standing instructions for every script (audience, tone, words to avoid...). */
  scriptNotes: string;
  /** Closing call to action the script should end on (empty: the writer picks). */
  cta: string;
  /** Defaults applied to every new stick reel. */
  themeId: string;
  faces: string;
  badge: string;
  music: number;
  sfx: number;
  useOpenverse: boolean;
  /** 'cinematic' = photo set, moving camera, cast, punch boxes; 'classic' = the card layout. */
  look: 'cinematic' | 'classic';
  /** Who makes the set + photo sheet: ChatGPT in Chrome (falls back to Codex), Codex image generation, Gemini API, or none. */
  picturesEngine: 'chatgpt' | 'codex' | 'gemini' | 'none';
};

export const DEFAULT_STUDIO_SETTINGS: StickStudioSettings = {
  voice: 'Sadaltager',
  voiceStyle: DEFAULT_MALE_STYLE,
  ttsModel: process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
  speed: 1,
  lineGapMs: 220,
  scriptSeconds: 45,
  scriptLanguage: 'malayalam',
  scriptNotes: '',
  cta: '',
  themeId: 'dental',
  faces: 'stick-demo',
  badge: '',
  music: 0.12,
  sfx: 0.55,
  useOpenverse: false,
  look: 'cinematic',
  picturesEngine: 'chatgpt',
};

const settingsFile = () => process.env.VIDEO_CLEANER_STICK_SETTINGS || path.join(os.homedir(), '.video-cleaner', 'stick-studio.json');
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value: unknown, max: number, fallback: string) => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);

export function normalizeStudioSettings(input: Partial<StickStudioSettings> | null | undefined): StickStudioSettings {
  const d = DEFAULT_STUDIO_SETTINGS;
  const raw = input ?? {};
  return {
    voice: typeof raw.voice === 'string' && /^[A-Za-z]{2,30}$/.test(raw.voice) ? raw.voice : d.voice,
    voiceStyle: text(raw.voiceStyle, 1200, d.voiceStyle) || d.voiceStyle,
    ttsModel: typeof raw.ttsModel === 'string' && /^[a-z0-9.-]{3,60}$/.test(raw.ttsModel) ? raw.ttsModel : d.ttsModel,
    speed: clamp(raw.speed, 0.8, 1.25, d.speed),
    lineGapMs: Math.round(clamp(raw.lineGapMs, 0, 1200, d.lineGapMs)),
    scriptSeconds: Math.round(clamp(raw.scriptSeconds, 15, 120, d.scriptSeconds)),
    scriptLanguage: raw.scriptLanguage === 'english' ? 'english' : 'malayalam',
    scriptNotes: text(raw.scriptNotes, 1500, d.scriptNotes),
    cta: text(raw.cta, 200, d.cta),
    themeId: typeof raw.themeId === 'string' && /^[a-z0-9_-]{1,40}$/.test(raw.themeId) ? raw.themeId : d.themeId,
    faces: typeof raw.faces === 'string' && /^[a-z0-9_-]{1,40}$/i.test(raw.faces) ? raw.faces : d.faces,
    badge: text(raw.badge, 32, d.badge),
    music: clamp(raw.music, 0, 1, d.music),
    sfx: clamp(raw.sfx, 0, 1, d.sfx),
    useOpenverse: typeof raw.useOpenverse === 'boolean' ? raw.useOpenverse : d.useOpenverse,
    look: raw.look === 'classic' ? 'classic' : 'cinematic',
    picturesEngine: (['chatgpt', 'codex', 'gemini', 'none'] as const).find((e) => e === raw.picturesEngine) ?? d.picturesEngine,
  };
}

export async function loadStudioSettings(): Promise<StickStudioSettings> {
  const raw = await fs.readFile(settingsFile(), 'utf8').then(JSON.parse).catch(() => null);
  return normalizeStudioSettings(raw);
}

export async function saveStudioSettings(input: Partial<StickStudioSettings>): Promise<StickStudioSettings> {
  const next = normalizeStudioSettings({ ...await loadStudioSettings(), ...input });
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  const tmp = `${settingsFile()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.rename(tmp, settingsFile());
  return next;
}

// ---------------------------------------------------------------- script

export type StickScript = { title: string; lines: string[] };

const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'lines'],
  properties: {
    title: { type: 'string' },
    lines: { type: 'array', minItems: 3, maxItems: 30, items: { type: 'string' } },
  },
};

/** Measured with Gemini TTS (2026-11-26): Malayalam about 2.4 words a second, minus line gaps; English about 2.6. */
export const wordsPerSecond = (language: StickStudioSettings['scriptLanguage']) => (language === 'english' ? 2.5 : 2.2);

export function buildScriptPrompt(input: { concept: string; settings: StickStudioSettings; seconds?: number; feedback?: string; previous?: StickScript; sourceText?: string }) {
  const { settings } = input;
  const seconds = Math.round(clamp(input.seconds, 15, 120, settings.scriptSeconds));
  const words = Math.round(seconds * wordsPerSecond(settings.scriptLanguage));
  const language = settings.scriptLanguage === 'english'
    ? 'Write in simple, spoken Indian English.'
    : [
      'Write in everyday spoken Kerala Malayalam (Malayalam script), the way a young doctor talks to friends, not bookish or formal Malayalam.',
      'English words that Malayalis normally say in English (doctor, clinic, reel, appointment, follow, cavity, X-ray, brushing...) stay in English letters inside the Malayalam sentence, with the Malayalam suffix joined by a hyphen: "Doctors-നും", "reel-ൽ", "clinic-ലേക്ക്".',
      'Numbers as digits.',
    ].join(' ');
  return [
    'You write the voiceover for a short vertical reel (Instagram Reels / YouTube Shorts). A stick-figure version of the creator acts it out with on-screen cards, so the words must carry the whole story.',
    input.concept.trim() ? `CONCEPT FROM THE CREATOR:\n${input.concept.trim()}` : 'CONCEPT FROM THE CREATOR: make our own version of the reference reel below.',
    input.sourceText ?? '',
    `LENGTH: about ${seconds} seconds spoken, roughly ${words} words in total.`,
    language,
    'SHAPE: one continuous story, not a list of facts. Line 1 is the hook: a surprising fact, a question or a relatable moment that stops the scroll in under 3 seconds. Then the problem or common belief, the twist or the real reason (why), what to do instead, and a short payoff. End with one clear call to action.',
    settings.cta ? `CALL TO ACTION to end on (adapt the wording naturally): ${settings.cta}` : 'End with a natural call to action (follow, save, comment a word, or book).',
    'LINES: each line is one spoken sentence or short phrase, 4-14 words, said in one breath. No stage directions, no speaker names, no emojis, no hashtags, no brackets, no markdown.',
    'HEALTH RULES: no outcome guarantees, never "painless", "best", "guaranteed", "100%" or similar promises; no patient names or identifiable details; general information only, not a diagnosis.',
    settings.scriptNotes ? `CREATOR'S STANDING NOTES:\n${settings.scriptNotes}` : '',
    input.previous ? `PREVIOUS DRAFT:\nTitle: ${input.previous.title}\n${input.previous.lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}` : '',
    input.feedback ? `CHANGES THE CREATOR ASKED FOR (apply them, keep what they did not mention):\n${input.feedback.trim()}` : '',
    'Before answering, check: does line 1 hook? Is it one story with a twist and a payoff? Is the length right? Are English words in English letters? Then return JSON: title (short English working title, max 8 words) and lines.',
  ].filter(Boolean).join('\n\n');
}

export async function writeStickScript(options: {
  concept: string; seconds?: number; feedback?: string; previous?: StickScript; sourceText?: string;
  settings: StickStudioSettings; textConfig: TextModelConfig; choice: TextModelChoice; workDir: string; signal?: AbortSignal;
}): Promise<StickScript> {
  if (!options.concept.trim() && !options.sourceText) throw new Error('Tell me what the reel is about first.');
  await fs.mkdir(options.workDir, { recursive: true });
  const raw = await generateStructuredText({
    config: options.textConfig,
    choice: options.choice,
    workDir: options.workDir,
    prompt: buildScriptPrompt(options),
    schema: SCRIPT_SCHEMA,
    outputName: 'stick-script',
    signal: options.signal,
  }) as { title?: unknown; lines?: unknown };
  return cleanScript(raw);
}

export function cleanScript(raw: { title?: unknown; lines?: unknown }): StickScript {
  const lines = (Array.isArray(raw?.lines) ? raw.lines : [])
    .map(line => String(line ?? '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30)
    .map(line => line.slice(0, 300));
  if (lines.length < 2) throw new Error('The script came back empty. Try again or reword the concept.');
  return { title: String(raw?.title ?? '').trim().slice(0, 80) || 'Stick reel', lines };
}

// ---------------------------------------------------------------- narration (Gemini TTS)

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
type Pcm = { samples: Int16Array; rate: number };

async function ttsLine(line: string, settings: StickStudioSettings, apiKey: string, signal?: AbortSignal): Promise<Pcm> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: line, speech_metadata: { style: settings.voiceStyle } }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: settings.voice } } },
  };
  let lastError = ''; let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, lastStatus === 429 ? 8000 * attempt : 2000 * attempt));
    if (signal?.aborted) throw new Error('Stopped.');
    const response = await fetch(`${GEMINI_BASE}${settings.ttsModel}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal,
    }).catch(error => { lastError = error instanceof Error ? error.message : String(error); return null; });
    if (!response) continue;
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      lastError = `Gemini voice ${response.status}: ${detail}`; lastStatus = response.status;
      if (response.status === 429 && /PerDay/i.test(detail)) throw new Error('Gemini daily voice quota is used up. Try again tomorrow.');
      if (response.status === 429 || response.status >= 500) continue;
      throw new Error(lastError);
    }
    const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string } }> } }> };
    const part = json.candidates?.flatMap(c => c.content?.parts ?? []).find(p => p.inlineData)?.inlineData;
    if (!part) { lastError = 'Gemini returned no audio for a line.'; continue; }
    const bytes = Buffer.from(part.data, 'base64');
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF') return readWav(bytes);
    const rate = Number(/rate=(\d+)/i.exec(part.mimeType ?? '')?.[1] ?? 24000);
    return { samples: new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 2))), rate };
  }
  throw new Error(lastError || 'Gemini voice failed.');
}

function readWav(bytes: Buffer): Pcm {
  let offset = 12; let rate = 24000;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4); const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') rate = bytes.readUInt32LE(offset + 12);
    if (id === 'data') {
      const data = bytes.subarray(offset + 8, offset + 8 + size);
      return { samples: new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength - (data.byteLength % 2))), rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Gemini sent an unreadable WAV.');
}

/** Cut leading/trailing near-silence, keeping a short natural tail. */
export function trimSilence(samples: Int16Array, rate: number, threshold = 500, padMs = 60): Int16Array {
  const window = Math.max(1, Math.round(rate * 0.01));
  const loud = (i: number) => { let peak = 0; for (let j = i; j < Math.min(samples.length, i + window); j++) peak = Math.max(peak, Math.abs(samples[j])); return peak > threshold; };
  let start = 0; while (start < samples.length && !loud(start)) start += window;
  let end = samples.length; while (end > start && !loud(Math.max(start, end - window))) end -= window;
  const pad = Math.round((rate * padMs) / 1000);
  return samples.subarray(Math.max(0, start - pad), Math.min(samples.length, end + pad * 2));
}

export function wavBytes(samples: Int16Array, rate: number): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8, 'latin1');
  head.write('fmt ', 12, 'latin1'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** How the pause setting is said to the voice model (one request reads the whole script, so pauses are asked for). */
export function pauseInstruction(lineGapMs: number) {
  if (lineGapMs < 150) return 'Run the lines together with barely any pause at line breaks.';
  if (lineGapMs > 450) return 'Leave a clear, unhurried pause at each line break.';
  return 'Leave a short natural pause at each line break.';
}

/** Group lines into requests of at most ~1800 characters (about 2 minutes of speech), keeping whole lines. */
export function narrationChunks(lines: string[], maxChars = 1800): string[] {
  const chunks: string[] = []; let current: string[] = [];
  for (const line of lines) {
    if (current.length && [...current, line].join('\n').length > maxChars) { chunks.push(current.join('\n')); current = []; }
    current.push(line);
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

/**
 * Read the whole script in ONE Gemini request (one continuous take, natural pacing, and far fewer requests than a
 * call per line, which ran into the per-minute limit). Scripts over ~2 minutes go in a few sequential requests.
 */
export async function narrateScript(options: {
  lines: string[]; settings: StickStudioSettings; apiKey: string; outWav: string;
  progress?: (done: number, total: number) => void; signal?: AbortSignal;
}): Promise<{ seconds: number }> {
  const { lines, settings } = options;
  if (!options.apiKey) throw new Error('Add a Gemini API key in Settings to make the AI voice.');
  if (!lines.length) throw new Error('The script has no lines.');
  const chunks = narrationChunks(lines);
  const voice = { ...settings, voiceStyle: `${settings.voiceStyle} ${pauseInstruction(settings.lineGapMs)}` };
  const clips: Pcm[] = [];
  for (const [index, chunk] of chunks.entries()) {
    options.progress?.(index, chunks.length);
    const pcm = await ttsLine(chunk, voice, options.apiKey, options.signal);
    clips.push({ samples: trimSilence(pcm.samples, pcm.rate), rate: pcm.rate });
  }
  options.progress?.(chunks.length, chunks.length);
  const rate = clips[0].rate;
  const gap = new Int16Array(Math.round(rate * 0.35));
  const parts = [new Int16Array(Math.round(rate * 0.15)), ...clips.flatMap((clip, i) => (i < clips.length - 1 ? [clip.samples, gap] : [clip.samples])), new Int16Array(Math.round(rate * 0.4))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Int16Array(total); let at = 0;
  for (const part of parts) { joined.set(part, at); at += part.length; }
  await fs.mkdir(path.dirname(options.outWav), { recursive: true });
  await fs.writeFile(options.outWav, wavBytes(joined, rate));
  const seconds = total / rate;
  await recordUsage({ kind: 'tts', provider: 'gemini', model: settings.ttsModel, audioSeconds: seconds, task: 'stick narration' });
  return { seconds };
}

/** One spoken sample line for the voice picker. */
export async function previewVoice(options: { settings: StickStudioSettings; apiKey: string; line?: string; outWav: string }) {
  const line = options.line?.trim() || (options.settings.scriptLanguage === 'english'
    ? 'Most people brush twice a day. But here is the one mistake almost everyone makes.'
    : 'ദിവസവും രണ്ടു നേരം brush ചെയ്തിട്ടും cavity വരുന്നുണ്ടോ? അതിന്റെ കാരണം ഇതാണ്.');
  if (!options.apiKey) throw new Error('Add a Gemini API key in Settings to hear the voice.');
  const pcm = await ttsLine(line.slice(0, 300), options.settings, options.apiKey);
  await fs.mkdir(path.dirname(options.outWav), { recursive: true });
  await fs.writeFile(options.outWav, wavBytes(trimSilence(pcm.samples, pcm.rate), pcm.rate));
  await recordUsage({ kind: 'tts', provider: 'gemini', model: options.settings.ttsModel, audioSeconds: pcm.samples.length / pcm.rate, task: 'voice preview' });
}

// ---------------------------------------------------------------- narration jobs

export type NarrationJob = {
  id: string; state: 'running' | 'ready' | 'failed'; progress: number; stage: string;
  uploadId?: string; seconds?: number; error?: string; startedAt: number; abort?: AbortController;
};
export const narrationJobs = new Map<string, NarrationJob>();
export const newNarrationJob = (): NarrationJob => {
  for (const [id, job] of narrationJobs) if (Date.now() - job.startedAt > 6 * 3600_000) narrationJobs.delete(id);
  const job: NarrationJob = { id: randomUUID(), state: 'running', progress: 0, stage: 'Starting the voice…', startedAt: Date.now(), abort: new AbortController() };
  narrationJobs.set(job.id, job);
  return job;
};
