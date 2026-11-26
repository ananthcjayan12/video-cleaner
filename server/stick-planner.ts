import { MOTION_SOUNDS } from './motion-sfx.js';
import {
  STICK_THEMES,
  stickEnergies,
  stickEnters,
  stickFaces,
  stickPoses,
  stickSides,
  stickTemplates,
  validateStickDraft,
  type StickDraft,
  type StickSceneV2,
} from './stick-reel.js';
import type { Word } from './project-store.js';
import { generateStructuredText, type TextModelChoice, type TextModelConfig } from './text-models.js';

const CURATED_SFX_IDS = [
  'whoosh-transitions-simple-whoosh-1',
  'whoosh-transitions-fast-whoosh',
  'whoosh-transitions-swish-1',
  'whoosh-transitions-swoosh-fast-with-thud',
  'ui-pop-sound',
  'ui-chime',
  'ui-success',
  'ui-notification-1',
  'ui-button-pressed',
  'ui-swipe',
  'impacts-impact-hit-2',
  'impacts-impact-hit-3',
  'impacts-deep-hit-2',
  'camera-fx-camera-6',
  'buildups-dramatic-buildup-reveal',
  'risers-riser-1',
].filter(id => MOTION_SOUNDS.some(s => s.id === id));

/**
 * Codex (OpenAI strict structured output) demands that every object lists all of its properties in `required`.
 * Keep the readable schema above with optional fields, and derive the strict one: every key becomes required and
 * the formerly optional ones accept null. `dropNulls` turns those nulls back into missing fields.
 */
function strictSchema(node: any): any {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out: any = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, strictSchema(value)]));
  if (out.type === 'object' && out.properties) {
    const required = new Set<string>(Array.isArray(node.required) ? node.required : []);
    for (const [key, value] of Object.entries<any>(out.properties)) {
      if (required.has(key)) continue;
      const nullable: any = { ...value, type: [value.type, 'null'] };
      if (Array.isArray(value.enum)) nullable.enum = [...value.enum, null];
      out.properties[key] = nullable;
    }
    out.required = Object.keys(out.properties);
  }
  return out;
}
export function dropNulls(value: any): any {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => [key, dropNulls(item)]));
}

const LOOSE_PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['badge', 'marquee', 'themeId', 'scenes', 'notes', 'tracker', 'cast', 'setPrompt', 'photoPrompts'],
  properties: {
    tracker: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    cast: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' } } } },
    setPrompt: { type: 'string' },
    photoPrompts: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'string' } },
    badge: { type: 'string' },
    marquee: { type: 'string' },
    themeId: { type: 'string', enum: STICK_THEMES.map(t => t.id) },
    notes: { type: 'array', items: { type: 'string' } },
    scenes: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startWordId', 'headline', 'note', 'template', 'data', 'side', 'enter', 'pose', 'face', 'energy'],
        properties: {
          startWordId: { type: 'string' },
          headline: { type: 'string' },
          note: { type: 'string' },
          template: { type: 'string', enum: [...stickTemplates] },
          side: { type: 'string', enum: [...stickSides] },
          enter: { type: 'string', enum: [...stickEnters] },
          pose: { type: 'string', enum: [...stickPoses] },
          face: { type: 'string', enum: [...stickFaces] },
          energy: { type: 'string', enum: [...stickEnergies] },
          sfx: { type: 'string' },
          sfxQuery: { type: 'string' },
          chapter: { type: 'integer' },
          camera: { type: 'number' },
          photo: { type: 'integer' },
          punchText: { type: 'object', additionalProperties: false, required: ['text', 'wordId'], properties: { text: { type: 'string' }, wordId: { type: 'string' } } },
          myBubble: { type: 'object', additionalProperties: false, required: ['text', 'wordId'], properties: { text: { type: 'string' }, wordId: { type: 'string' } } },
          actors: {
            type: 'array', maxItems: 3,
            items: { type: 'object', additionalProperties: false, required: ['castId', 'pose'], properties: {
              castId: { type: 'string' }, pose: { type: 'string', enum: [...stickPoses] },
              bubble: { type: 'object', additionalProperties: false, required: ['text', 'wordId'], properties: { text: { type: 'string' }, wordId: { type: 'string' } } },
            } },
          },
          data: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              icon: { type: 'string' },
              badge: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              prompt: { type: 'string' },
              button: { type: 'string' },
              doneLabel: { type: 'string' },
              leftTitle: { type: 'string' },
              rightTitle: { type: 'string' },
              leftItems: { type: 'array', items: { type: 'string' } },
              rightItems: { type: 'array', items: { type: 'string' } },
              items: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } },
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['sender', 'text'],
                  properties: {
                    sender: { type: 'string', enum: ['them', 'me'] },
                    text: { type: 'string' },
                  },
                },
              },
            },
          },
          beats: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['wordId'],
              properties: {
                wordId: { type: 'string' },
                pose: { type: 'string', enum: [...stickPoses] },
                face: { type: 'string', enum: [...stickFaces] },
                sfx: { type: 'string' },
                sfxQuery: { type: 'string' },
                punch: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
};
export const PLANNER_SCHEMA = strictSchema(LOOSE_PLANNER_SCHEMA);

function formatTranscript(words: Word[]) {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  let lastEnd = -1;
  let lastText = '';
  const flush = () => {
    if (line.length) lines.push(`[${lineStart.toFixed(1)}s] ${line.join(' ')}`);
    line = [];
  };
  for (const word of words) {
    const gap = lastEnd < 0 ? 0 : word.start - lastEnd;
    if (line.length && (gap >= 0.45 || /[.!?…।]$/.test(lastText) || line.length >= 14)) flush();
    if (!line.length) lineStart = word.start;
    line.push(`${word.id}:${word.text}`);
    lastEnd = word.end;
    lastText = word.text;
  }
  flush();
  return lines.join('\n');
}

function buildDirectorPrompt(words: Word[], duration: number, brief?: string, themeId?: string) {
  const targetScenes = Math.max(5, Math.min(28, Math.round(duration / 3.2)));
  return [
    'You are the creative director & motion choreographer for a punchy vertical (9:16) stick-figure explainer reel.',
    'The speaker is represented by an expressive cutout head on a dynamic 2D stick-figure body, acting the story out with other plain stick characters.',
    'Read the timestamped narration (which may be English, Malayalam, or Manglish) and design a dynamic, visually varied storyboard.',
    '',
    `TARGET PACING: Plan roughly ${targetScenes} scenes across ${duration.toFixed(1)} seconds (every 2.5–4.5 seconds, cutting on natural narrative beats — never mid-phrase).`,
    brief ? `CREATIVE BRIEF / NOTES: ${brief}` : '',
    themeId ? `PREFERRED THEME: ${themeId}` : `THEMES: ${STICK_THEMES.map(t => `${t.id} (${t.label})`).join(', ')}. Pick the best fit.`,
    '',
    'STAGE TEMPLATES (vary them — never use the same template 3 times in a row):',
    '- key_idea: { icon, title, subtitle } — bold punchy takeaway with animated progress underline.',
    '- hero_icon: { icon, title, subtitle, badge } — big centered symbol/emoji hero card.',
    '- metric: { title, badge, from, to, rows: [[label, value], ...] } — animated before→after stat or counter with 2–3 rows.',
    '- checklist: { title, items: ["...", ...] } — 3–4 items ticking off sequentially.',
    '- compare: { leftTitle, rightTitle, leftItems: [...], rightItems: [...] } — Before vs After / Myth vs Reality split.',
    '- flow: { title, items: ["Step A", "Step B", "Step C"] } — 2–4 connected pipeline boxes with animated arrows.',
    '- prompt_box: { title, prompt, badge } — typewriter terminal / AI prompt card.',
    '- chat_bubble: { title, messages: [{ sender: "them"|"me", text }] } — 2–3 quick back-and-forth messages.',
    '- steps: { title, items: ["...", ...] } — numbered 1-2-3 guide.',
    '- cta_click: { title, subtitle, button, doneLabel } — interactive cursor click CTA (use for final call-to-action).',
    '',
    'CINEMATIC LOOK (this reel is a short film, not slides):',
    '- The figures stand inside ONE photo-real set that the camera glides across. Write setPrompt: a photorealistic, empty location that fits the topic (for dental: e.g. a modern dental clinic reception or treatment room), described as a real photograph: natural light, real materials, slightly dark and cinematic, wide shot at eye level, lots of empty floor in the lower half, no people, no text, no logos.',
    '- camera: 0 = left part of the set, 1 = right part. Move it every scene (big moves between chapters, small moves within one).',
    '- tracker: exactly 3 short UPPERCASE chapter labels for the story arc in English (e.g. "MYTH", "WHY", "FIX"); give every scene its chapter 0, 1 or 2 in order.',
    '- cast: 0-3 plain stick characters the story needs (id like "patient", label in English UPPERCASE like "PATIENT", "RECEPTIONIST", "KID"). Put them in scenes via actors (0-2 per scene, most scenes should have at least one) with a pose and, when they speak in the story, a short bubble (<= 7 words, same language as the narration) anchored to the wordId where it should pop.',
    '- myBubble: an occasional short line the main figure says out loud (<= 7 words), anchored to a wordId.',
    '- punchText: in about half the scenes, a 1-4 word punch box (UPPERCASE English or a number like "6 MONTHS", "NOT NORMAL", "60% → 90%") slammed in exactly on the wordId where it is said. Never a full sentence.',
    '- photoPrompts: exactly 6 real-photo ideas that illustrate key moments (e.g. close-up of bleeding gums on a toothbrush, a dentist checking a patient). Each is described as a natural real photograph (real people or objects, real light, phone or DSLR look), never illustration, 3D or cartoon, no text. Use photo (0-5) on the scenes where a real picture explains best (about a third of the scenes); other scenes use a stage template, which builds up on screen step by step.',
    '- Every 1-2 seconds something new should happen: a bubble, a punch box, a beat, a list item. Keep the scene headline short (it shows as a yellow tag).',
    '',
    'STICK-FIGURE CHOREOGRAPHY:',
    `- poses: ${stickPoses.join(', ')} (use celebrate or wave for opener/closer, think_chin for questions, shrug for problems, point_stage/present_both for reveals).`,
    `- faces: ${stickFaces.join(', ')}.`,
    `- side: left, right, or center (vary naturally, don't robotically flip every single cut).`,
    `- enter: slide, pop, or peek.`,
    `- energy: calm, normal, or hype.`,
    '- beats: attach 0–2 mid-scene beats to exact punchline wordIds to switch pose/face, trigger a micro camera punch (punch: true), and fire a sound effect right on the word.',
    '',
    'SOUND DESIGN:',
    `- For standard UI/transitions/impacts, set sfx to one of: ${CURATED_SFX_IDS.join(', ')}.`,
    '- When a scene calls for a specific real-world foley sound not in that list (e.g. "cash register bell", "mechanical keyboard typing", "camera shutter"), set sfxQuery to a 2–4 word English search phrase for Openverse Freesound AND still set sfx as a safe local fallback.',
    '- Keep headlines crisp (<= 55 chars, in the same language/script as the narration or clean English) and card items concise so nothing wraps awkwardly.',
    '- HEALTH RULES for every headline, note and card item: no outcome guarantees and never the words painless, pain-free, best, guaranteed, 100%, permanent or cure; say "may", "can", "often" instead. No patient names or identifiable details.',
    '- Scene 1 MUST start on the first wordId. Every startWordId and beat.wordId MUST come verbatim from the transcript below.',
    '',
    'TRANSCRIPT (wordId:text):',
    formatTranscript(words),
  ].filter(Boolean).join('\n');
}

export async function planStickReelWithAi(options: {
  textConfig: TextModelConfig;
  choice: TextModelChoice;
  workDir: string;
  words: Word[];
  duration: number;
  existing: StickDraft;
  brief?: string;
  themeId?: string;
  signal?: AbortSignal;
}): Promise<StickDraft> {
  const { words, duration, existing } = options;
  if (!words.length) throw new Error('Transcribe the recording first so the AI Director has word timestamps.');

  const wordById = new Map(words.map(word => [word.id, word]));
  const prompt = buildDirectorPrompt(words, duration, options.brief, options.themeId);

  let raw: any = null;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptPrompt = attempt === 1
      ? prompt
      : `${prompt}\n\nPREVIOUS ATTEMPT FAILED (${lastError}). Fix the JSON and ensure every startWordId exists in the transcript and scenes are in strictly increasing chronological order.`;
    try {
      raw = await generateStructuredText({
        config: options.textConfig,
        choice: options.choice,
        workDir: options.workDir,
        prompt: attemptPrompt,
        schema: PLANNER_SCHEMA,
        outputName: 'stick-reel-plan',
        signal: options.signal,
      });
      raw = dropNulls(raw);
    } catch (error) {
      if (options.signal?.aborted) throw new Error('Stopped.');
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }

    const rawScenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
    const mapped: StickSceneV2[] = [];
    for (let i = 0; i < rawScenes.length; i++) {
      const item = rawScenes[i];
      const anchor = wordById.get(String(item?.startWordId ?? ''));
      const at = i === 0 ? 0 : (anchor ? anchor.start : -1);
      if (at < 0 || at >= duration) continue;
      if (mapped.length && at <= mapped.at(-1)!.at + 0.4) continue;

      const timed = (value: any, sceneAt: number) => {
        if (!value || typeof value.text !== 'string' || !value.text.trim()) return undefined;
        const word = wordById.get(String(value.wordId ?? ''));
        return { text: value.text.trim(), at: word && word.start >= sceneAt ? word.start : sceneAt + 0.6, wordId: word?.id };
      };
      const beats = Array.isArray(item?.beats)
        ? item.beats
          .map((beat: any) => {
            const bw = wordById.get(String(beat?.wordId ?? ''));
            if (!bw || bw.start <= at || bw.start >= duration) return null;
            return {
              at: bw.start,
              wordId: bw.id,
              pose: beat.pose,
              face: beat.face,
              sfx: beat.sfx,
              sfxQuery: beat.sfxQuery,
              punch: Boolean(beat.punch),
            };
          })
          .filter(Boolean)
        : undefined;

      mapped.push({
        id: `sc-${mapped.length + 1}`,
        at,
        startWordId: anchor?.id ?? words[0].id,
        headline: String(item.headline || '').trim().slice(0, 80) || 'Key point',
        note: String(item.note || '').trim().slice(0, 140),
        template: item.template,
        data: item.data ?? {},
        side: item.side,
        enter: item.enter,
        pose: item.pose,
        face: item.face,
        energy: item.energy,
        sfx: item.sfx,
        sfxQuery: item.sfxQuery,
        beats,
        chapter: Number.isInteger(item.chapter) ? item.chapter : undefined,
        camera: typeof item.camera === 'number' ? item.camera : undefined,
        photo: Number.isInteger(item.photo) ? item.photo : undefined,
        punchText: timed(item.punchText, at),
        myBubble: timed(item.myBubble, at),
        actors: Array.isArray(item.actors) ? item.actors.map((a: any) => ({ castId: String(a?.castId ?? ''), pose: a?.pose, bubble: timed(a?.bubble, at) })) : undefined,
      });
    }

    if (mapped.length) {
      return validateStickDraft({
        ...existing,
        version: 2,
        badge: raw.badge || existing.badge,
        marquee: raw.marquee || existing.marquee,
        themeId: options.themeId || raw.themeId || existing.themeId,
        scenes: mapped,
        words,
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        style: existing.style ?? 'cinematic',
        tracker: Array.isArray(raw.tracker) ? raw.tracker : existing.tracker,
        cast: Array.isArray(raw.cast) ? raw.cast : existing.cast,
        setPrompt: typeof raw.setPrompt === 'string' ? raw.setPrompt : existing.setPrompt,
        photoPrompts: Array.isArray(raw.photoPrompts) ? raw.photoPrompts : existing.photoPrompts,
      }, duration);
    }
    lastError = 'No scenes matched valid wordIds in the transcript.';
  }

  throw new Error(`AI Director could not build a valid stick-figure plan: ${lastError}`);
}
