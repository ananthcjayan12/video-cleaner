/**
 * Motion graphics and sound plan for talking-head reels, drawn in the clinic's brand theme (brand-theme.ts,
 * remotion/captions/src/Graphics.tsx). One AI call reads the kept talk and places, on exact words:
 * - a hook headline for the first seconds,
 * - info graphics: myth vs fact, a counter, a checklist (content only from what the speaker says),
 * - punch boxes (1-4 words slammed in on the word) with a camera kick, and extra camera kicks on punchlines,
 * - a comment call-to-action when the speaker asks viewers to comment / follow / message,
 * - a transition for each B-roll picture (dissolve, slide, zoom, flash, or a split screen with a title),
 * - a sound for every moment from the local motion-sfx library (never the same sound twice in a row).
 * The clinic's avatar badge shows as a watermark whenever nothing else is at the top of the frame.
 *
 * The plan stores word ids; timeTheMotion() turns it into times on the edited reel once the cut is final.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { editedTime, type EditRange } from './auto-reel.js';
import { EMOTIONS, type EmotionId } from './emotion-sfx.js';
import { MOTION_SOUNDS } from './motion-sfx.js';
import { atomicWriteJson, type Word } from './project-store.js';
import type { ReelSoundCue } from './reel-sound.js';
import { generateStructuredText, type TextModelChoice, type TextModelConfig } from './text-models.js';

export type BrollTransition = 'dissolve' | 'slide' | 'zoom' | 'flash' | 'split';
export const BROLL_TRANSITIONS: BrollTransition[] = ['dissolve', 'slide', 'zoom', 'flash', 'split'];

type Sfx = { sfx: string };
export type PlannedGraphic =
  | ({ kind: 'mythfact'; wordId: string; factWordId: string; myth: string; fact: string } & Sfx)
  | ({ kind: 'counter'; wordId: string; value: number; from: number; prefix: string; suffix: string; label: string; sub: string } & Sfx)
  | ({ kind: 'checklist'; wordId: string; title: string; items: Array<{ text: string; wordId: string }> } & Sfx);
export type ReelMotionPlan = {
  version: 2;
  hook?: { tag: string; line: string; ribbon: string; emoji: string } & Sfx;
  graphics: PlannedGraphic[];
  punches: Array<{ wordId: string; text: string; emotion: EmotionId } & Sfx>;
  kicks: Array<{ wordId: string; emotion: EmotionId } & Sfx>;
  cta?: { wordId: string; keyword: string; line: string } & Sfx;
  transitions: Array<{ sceneId: string; kind: BrollTransition; title?: string }>;
  createdAt: string;
};

/** A timed graphic on the edited reel; mirrors ReelGraphic in Graphics.tsx (props are the template's props). */
export type ReelGraphic = { kind: 'headline' | 'mythfact' | 'counter' | 'checklist' | 'comment' | 'punch' | 'split' | 'watermark'; start: number; end: number; [prop: string]: unknown };
export type TimedMotion = { graphics: ReelGraphic[]; kicks: number[]; sounds: ReelSoundCue[]; transitions: Record<string, BrollTransition> };

const SOUND_IDS = new Set(MOTION_SOUNDS.map((sound) => sound.id));
const EMOTION = new Map(EMOTIONS.map((emotion) => [emotion.id, emotion]));
/** Sounds for each picture transition, and for coming back to the speaker. Used in turn, so neighbours differ. */
export const TRANSITION_SOUNDS: Record<BrollTransition | 'back', string[]> = {
  dissolve: ['whoosh-transitions-swish-2', 'whoosh-transitions-deep-whoosh-4', 'whoosh-transitions-simple-whoosh-2', 'whoosh-transitions-swish-3'],
  slide: ['whoosh-transitions-fast-whoosh', 'whoosh-transitions-swoosh-fast-1', 'whoosh-transitions-swoosh-quick-low', 'whoosh-transitions-swoosh'],
  zoom: ['whoosh-transitions-swoosh-sharp-hit', 'whoosh-transitions-swoosh-fast-with-thud', 'cinematic-cinematic-whoosh-reverse', 'whoosh-transitions-deep-whoosh-2'],
  flash: ['camera-fx-camera-6', 'camera-fx-vintage-flash', 'camera-fx-camera-3', 'camera-fx-analog-shutter'],
  split: ['whoosh-transitions-swoosh-quick-low', 'whoosh-transitions-fast-whoosh', 'whoosh-transitions-swoosh-fast-1'],
  back: ['whoosh-transitions-swish-1', 'whoosh-transitions-deep-whoosh-3', 'whoosh-transitions-swoosh-1', 'whoosh-transitions-simple-whoosh-1'],
};
const HOOK_SOUNDS = ['impacts-deep-hit-2', 'cinematic-inception-thump', 'impacts-impact-hit-3', 'buildups-dramatic-buildup-reveal'];
const CTA_SOUNDS = ['ui-notification-1', 'ui-success', 'ui-game-start', 'ui-chime'];
const GRAPHIC_SOUNDS = ['whoosh-transitions-swoosh-sharp-hit', 'ui-ui-sound-3', 'whoosh-transitions-whoosh-achievement', 'camera-fx-camera-6', 'ui-chime', 'impacts-impact-hit-3'];
const TICK_SOUNDS = ['ui-pop-sound', 'ui-ui-sound-4', 'ui-ui-sound-6'];
/** Sound level from the emotion's mix level (louder for shock/warning, softer for relief), like the editor's emotion cues. */
const gainFor = (emotion?: EmotionId) => Math.max(0.5, Math.min(1.3, 10 ** (((EMOTION.get(emotion!)?.mixDb ?? -26) + 26) / 20)));

const fileName = (workDir: string) => path.join(workDir, 'auto', 'motion-plan.json');
export const loadReelMotion = (workDir: string) => fs.readFile(fileName(workDir), 'utf8').then((text) => JSON.parse(text) as ReelMotionPlan, () => null).then((plan) => (plan?.version === 2 ? plan : null));
export const saveReelMotion = (workDir: string, plan: ReelMotionPlan) => atomicWriteJson(fileName(workDir), plan);

const S = { type: 'string' } as const; const N = { type: 'number' } as const;
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const SCHEMA = obj({
  hook: obj({ tag: S, line: S, ribbon: S, emoji: S, sfx: S }),
  graphics: { type: 'array', items: obj({ kind: { type: 'string', enum: ['mythfact', 'counter', 'checklist'] }, wordId: S, sfx: S,
    factWordId: S, myth: S, fact: S, value: N, from: N, prefix: S, suffix: S, label: S, sub: S, title: S,
    items: { type: 'array', items: obj({ text: S, wordId: S }) } }, ['kind', 'wordId', 'sfx']) },
  punches: { type: 'array', items: obj({ wordId: S, text: S, emotion: S, sfx: S }) },
  kicks: { type: 'array', items: obj({ wordId: S, emotion: S, sfx: S }) },
  cta: obj({ wordId: S, keyword: S, line: S, sfx: S }),
  transitions: { type: 'array', items: obj({ sceneId: S, kind: { type: 'string', enum: BROLL_TRANSITIONS }, title: S }, ['sceneId', 'kind']) },
});

export function buildMotionPrompt(options: { words: Array<{ id: string; text: string; at: number }>; broll: Array<{ id: string; start: number; end: number; title?: string }>; duration: number; field?: string; clinic?: string }) {
  // One line per sentence (or 12 words), starting with the reel time of its first word.
  const lines: string[] = []; let line: string[] = []; let lineAt = 0;
  options.words.forEach((word, i) => {
    if (!line.length) lineAt = word.at;
    line.push(`${word.id}:${word.text}`);
    if (line.length >= 12 || /[.?!]$/.test(word.text) || i === options.words.length - 1) { lines.push(`@${lineAt.toFixed(1)}s  ${line.join(' ')}`); line = []; }
  });
  return [
    'You are the motion designer and sound designer for a vertical (9:16) talking-head Instagram reel by a healthcare practitioner, edited like a top creator reel (MrBeast / Malayalam finance-creator style): something new on screen every few seconds, bold graphics that explain, never clutter.',
    `The reel is ${options.duration.toFixed(1)} s long.${options.field ? ` Field: ${options.field}.` : ''}${options.clinic ? ` Clinic: ${options.clinic}.` : ''} The talk mixes Malayalam with English words.`,
    'All graphics sit at the top of the frame, above the speaker\'s head, in the clinic\'s brand colours. Write on-screen text the way the clinic writes its Instagram posts: Malayalam with English words in English letters (e.g. "പല്ല് Clean ചെയ്താൽ"), short and punchy. Only say what the speaker says; never add a medical claim, promise or number she did not say.',
    '',
    'Plan, on exact wordIds of the talk below:',
    '- hook: the opening headline for the first ~3 s. tag: a short English label in capitals (e.g. "DENTAL TIPS", "MYTH BUSTER"). line: the main question, max 22 characters. ribbon: a second line, max 18 characters. emoji: one fitting emoji or "". sfx: a hit or reveal.',
    '- graphics: 2-4 info graphics where they explain best, at least 6 s apart:',
    '  - mythfact: when she busts a belief. wordId where the myth is raised, factWordId where she gives the truth. myth and fact: max 34 characters each.',
    '  - counter: when she says a number (months, years, times a day, percent, rupees). value: the number to count up to, from: 0 or a smaller start, prefix/suffix (e.g. "₹", "%", "x"), label: a unit in English capitals (e.g. "MONTHS"), sub: max 28 characters.',
    '  - checklist: when she lists 2-4 things (steps, tips, signs). title max 20 characters; items: each max 24 characters with the wordId where she says it.',
    '- punches: 2-5 punch boxes, each 1-4 words or a number (English in capitals, or short Malayalam) slammed in on the wordId where that idea is said, at least 4 s apart and not near a graphic.',
    '- kicks: 4-8 quick camera punch-ins on punchline words that have no graphic or punch box, at least 2 s apart. sfx may be "" for a silent kick.',
    '- cta: when she asks viewers to comment a word, follow, save, share or message: wordId where she asks, keyword (the word to comment, e.g. "CLEAN", or "FOLLOW"), line: what they get, max 26 characters. If she does not ask, wordId "".',
    `- transitions: one per B-roll picture, from ${BROLL_TRANSITIONS.join(', ')}. split = picture on top with a title (max 22 characters) and the speaker below, for a picture that explains a process; use it for at most 2 pictures. Mix the rest; never the same kind three times in a row.`,
    '',
    'Nothing (graphic, punch, kick) inside the B-roll windows below: the picture covers the speaker there.',
    'SOUND: every graphic, punch and kick has an sfx id. Punches and kicks name an emotion and pick from that emotion\'s list; vary them, never the same sfx twice in a row.',
    ...EMOTIONS.map((emotion) => `- ${emotion.id}: ${emotion.cue} sounds: ${emotion.sounds.join(', ')}`),
    `- hook sfx from: ${HOOK_SOUNDS.join(', ')}. graphics sfx from: ${GRAPHIC_SOUNDS.join(', ')}. cta sfx from: ${CTA_SOUNDS.join(', ')}.`,
    '',
    'B-ROLL WINDOWS:',
    ...(options.broll.length ? options.broll.map((scene) => `- ${scene.id}: ${scene.start.toFixed(1)}-${scene.end.toFixed(1)} s${scene.title ? ` (${scene.title})` : ''}`) : ['- none']),
    '',
    'TALK (wordId:word, with the reel time of each line). Every wordId you return must be copied exactly from here:',
    ...lines,
  ].join('\n');
}

const pickSound = (wanted: unknown, allowed: string[], previous?: string) => {
  const options = allowed.filter((id) => SOUND_IDS.has(id));
  const choice = typeof wanted === 'string' && SOUND_IDS.has(wanted) && wanted !== previous ? wanted : options.find((id) => id !== previous) ?? options[0];
  return choice ?? '';
};
const emotionOf = (value: unknown): EmotionId => (EMOTION.has(value as EmotionId) ? value as EmotionId : 'emphasis');
const cleanText = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : fallback);

/** Keep only what the reel can use: known word ids, known sounds, short texts, known transitions. */
export function validateMotionPlan(raw: any, wordIds: Set<string>, sceneIds: string[]): ReelMotionPlan {
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const graphics: PlannedGraphic[] = list(raw?.graphics).filter((g: any) => wordIds.has(g?.wordId)).slice(0, 6).flatMap((g: any): PlannedGraphic[] => {
    const sfx = pickSound(g.sfx, GRAPHIC_SOUNDS);
    if (g.kind === 'mythfact' && cleanText(g.myth, 40) && cleanText(g.fact, 40)) return [{ kind: 'mythfact', wordId: g.wordId, factWordId: wordIds.has(g.factWordId) ? g.factWordId : '', myth: cleanText(g.myth, 40), fact: cleanText(g.fact, 40), sfx }];
    if (g.kind === 'counter' && num(g.value) > 0 && num(g.value) < 1e6) return [{ kind: 'counter', wordId: g.wordId, value: num(g.value), from: Math.min(num(g.from), num(g.value)), prefix: cleanText(g.prefix, 3), suffix: cleanText(g.suffix, 3), label: cleanText(g.label, 12), sub: cleanText(g.sub, 34), sfx }];
    const items = list(g.items).map((item: any) => ({ text: cleanText(item?.text, 28), wordId: wordIds.has(item?.wordId) ? item.wordId : '' })).filter((item) => item.text).slice(0, 4);
    if (g.kind === 'checklist' && items.length >= 2) return [{ kind: 'checklist', wordId: g.wordId, title: cleanText(g.title, 24), items, sfx }];
    return [];
  });
  const punches = list(raw?.punches).filter((p: any) => wordIds.has(p?.wordId) && cleanText(p?.text, 24)).slice(0, 8)
    .map((p: any) => { const emotion = emotionOf(p.emotion); return { wordId: p.wordId, text: cleanText(p.text, 24), emotion, sfx: pickSound(p.sfx, [p.sfx, ...EMOTION.get(emotion)!.sounds]) }; });
  const kicks = list(raw?.kicks).filter((k: any) => wordIds.has(k?.wordId)).slice(0, 12)
    .map((k: any) => { const emotion = emotionOf(k.emotion); return { wordId: k.wordId, emotion, sfx: k.sfx === '' ? '' : pickSound(k.sfx, [k.sfx, ...EMOTION.get(emotion)!.sounds]) }; });
  const given = new Map(list(raw?.transitions).map((t: any) => [t?.sceneId, t]));
  let splits = 0;
  const transitions = sceneIds.map((sceneId, i) => {
    const t: any = given.get(sceneId);
    let kind = (BROLL_TRANSITIONS.includes(t?.kind) ? t.kind : BROLL_TRANSITIONS[i % 4]) as BrollTransition;
    const title = cleanText(t?.title, 26);
    if (kind === 'split' && (splits >= 2 || !title)) kind = 'slide'; else if (kind === 'split') splits += 1;
    return kind === 'split' ? { sceneId, kind, title } : { sceneId, kind };
  });
  const hookLine = cleanText(raw?.hook?.line, 30);
  const keyword = cleanText(raw?.cta?.keyword, 16);
  return {
    version: 2,
    hook: hookLine ? { tag: cleanText(raw.hook.tag, 16).toUpperCase(), line: hookLine, ribbon: cleanText(raw.hook.ribbon, 24), emoji: cleanText(raw.hook.emoji, 4), sfx: pickSound(raw.hook.sfx, HOOK_SOUNDS) } : undefined,
    graphics, punches, kicks,
    cta: keyword && wordIds.has(raw?.cta?.wordId) ? { wordId: raw.cta.wordId, keyword, line: cleanText(raw.cta.line, 30), sfx: pickSound(raw.cta.sfx, CTA_SOUNDS) } : undefined,
    transitions, createdAt: new Date().toISOString(),
  };
}

/** Ask the planning engine for the motion plan. Times in the prompt are on the edited reel. */
export async function planReelMotion(options: {
  textConfig: TextModelConfig; choice: TextModelChoice; workDir: string; words: Word[]; ranges: EditRange[];
  broll: Array<{ id: string; start: number; end: number; title?: string }>; duration: number; field?: string; clinic?: string;
}) {
  const kept = options.words.map((word, i) => ({ id: word.id, text: word.text, at: editedTime(options.words, options.ranges, i) }))
    .filter((word): word is { id: string; text: string; at: number } => word.at !== undefined);
  const prompt = buildMotionPrompt({ words: kept, broll: options.broll, duration: options.duration, field: options.field, clinic: options.clinic });
  const raw = await generateStructuredText({ choice: options.choice, config: options.textConfig, workDir: options.workDir, prompt, schema: SCHEMA as unknown as Record<string, unknown>, outputName: 'reel-motion-plan' });
  const plan = validateMotionPlan(raw, new Set(kept.map((word) => word.id)), options.broll.map((scene) => scene.id));
  await saveReelMotion(options.workDir, plan);
  return plan;
}

/** How long each graphic animates before it holds still (the motion layer draws held frames once). */
export function animatedFor(graphic: ReelGraphic) {
  switch (graphic.kind) {
    case 'watermark': return 0.35;
    case 'punch': return 0.6;
    case 'headline': return 0.9;
    case 'split': return 0.9;
    case 'counter': return 1.3;
    case 'mythfact': return Number(graphic.factAt ?? 1.2) + 0.6;
    case 'checklist': return Math.max(...((graphic.itemAt as number[] | undefined) ?? [1.5])) + 0.5;
    case 'comment': return Math.max(2.3, 0.35 + 0.08 * String(graphic.keyword ?? '').length + 1);
  }
}

const PUNCH_HOLD = 1.6;
/**
 * The plan on the edited reel: graphics, camera kicks, sounds and B-roll transitions. Anything that would land under
 * a B-roll picture, crowd another graphic at the top of the frame or run off the end is dropped here, so a sloppy
 * plan stays tidy. `broll` is the placed B-roll (edited times).
 */
export function timeTheMotion(plan: ReelMotionPlan, words: Word[], ranges: EditRange[], broll: Array<{ id: string; start: number; end: number; image?: string }>, duration: number, options: { watermark?: boolean } = {}): TimedMotion {
  const index = new Map(words.map((word, i) => [word.id, i]));
  const at = (wordId: string) => { const i = index.get(wordId); return i === undefined ? undefined : editedTime(words, ranges, i); };
  const transitions: Record<string, BrollTransition> = {};
  for (const scene of broll) transitions[scene.id] = plan.transitions.find((t) => t.sceneId === scene.id)?.kind ?? 'dissolve';
  const covered = (start: number, end: number) => broll.some((scene) => start < scene.end + 0.15 && end > scene.start - 0.15);
  const nextPicture = (t: number) => broll.map((scene) => scene.start).filter((start) => start > t).sort((a, b) => a - b)[0] ?? Infinity;
  const graphics: ReelGraphic[] = []; const kicks: number[] = []; const sounds: ReelSoundCue[] = [];
  const sound = (time: number, sfx: string | undefined, gainScale: number) => { if (sfx && SOUND_IDS.has(sfx)) sounds.push({ at: Math.max(0, time), sfx, gainScale }); };
  const top: Array<[number, number]> = []; // time spans with something at the top of the frame
  const free = (start: number, end: number) => !covered(start, end) && top.every(([a, b]) => end + 0.3 <= a || start >= b + 0.3);
  const place = (graphic: ReelGraphic) => { graphics.push(graphic); top.push([graphic.start, graphic.end]); };

  // Split screens replace their B-roll cutaway: picture on top with a title, the speaker below.
  for (const scene of broll) {
    const planned = plan.transitions.find((t) => t.sceneId === scene.id);
    if (planned?.kind === 'split' && scene.image) graphics.push({ kind: 'split', start: scene.start, end: scene.end, title: planned.title ?? '', pictureFile: scene.image });
  }
  if (plan.hook) {
    const end = Math.min(3.0, nextPicture(0) - 0.1, duration - 1);
    if (end >= 1.4) { place({ kind: 'headline', start: 0.1, end, tag: plan.hook.tag, lines: [plan.hook.line], ribbon: plan.hook.ribbon, emoji: plan.hook.emoji }); sound(0.1, plan.hook.sfx, 1); }
  }
  if (plan.cta) {
    const said = at(plan.cta.wordId);
    if (said !== undefined && said > duration * 0.4) {
      // Comment stickers need ~2.5 s to read: start earlier when she asks at the very end, and after any picture.
      let start = Math.min(said, duration - 2.5);
      for (const scene of broll) if (start < scene.end + 0.1 && start + 2.5 > scene.start) start = scene.end + 0.1;
      if (duration - start >= 2 && free(start, duration)) { place({ kind: 'comment', start, end: duration, keyword: plan.cta.keyword, line: plan.cta.line }); sound(start, plan.cta.sfx, 0.9); }
    }
  }
  for (const g of [...plan.graphics].sort((a, b) => (at(a.wordId) ?? 0) - (at(b.wordId) ?? 0))) {
    const start = at(g.wordId); if (start === undefined) continue;
    // Graphics end before the next picture (same margin as covered()), so a picture never cuts one off.
    const room = Math.min(nextPicture(start) - 0.2, duration - 0.2) - start;
    let graphic: ReelGraphic | undefined;
    if (g.kind === 'mythfact') {
      // The fact card lands when she gives the fact, or earlier when a picture would come first (it must be readable).
      const factSaid = g.factWordId ? at(g.factWordId) : undefined;
      const factAt = Math.max(1.2, Math.min(4, factSaid !== undefined ? factSaid - start : 1.6, room - 1.6));
      graphic = { kind: 'mythfact', start, end: start + factAt + 2.4, myth: g.myth, fact: g.fact, factAt: Math.round(factAt * 100) / 100 };
    } else if (g.kind === 'counter') {
      graphic = { kind: 'counter', start, end: start + 3.2, value: g.value, from: g.from, prefix: g.prefix, suffix: g.suffix, label: g.label, sub: g.sub };
    } else {
      let last = 0.35;
      const itemAt = g.items.map((item, i) => { const said = item.wordId ? at(item.wordId) : undefined; last = Math.min(6, Math.max(last + (i ? 0.4 : 0), said !== undefined ? said - start : 0.35 + i * 0.45)); return Math.round(last * 100) / 100; });
      graphic = { kind: 'checklist', start, end: start + Math.max(3.5, itemAt.at(-1)! + 1.8), title: g.title, items: g.items.map((item) => item.text), itemAt };
      itemAt.forEach((offset, i) => sound(start + offset + 0.15, TICK_SOUNDS[i % TICK_SOUNDS.length], 0.6));
    }
    graphic.end = Math.round((start + Math.min(graphic.end - start, room)) * 1000) / 1000;
    if (graphic.end - start < (g.kind === 'counter' ? 1.6 : 2.6) || !free(start, graphic.end)) continue;
    place(graphic); sound(start, g.sfx, 1);
    if (g.kind === 'mythfact') sound(start + Number(graphic.factAt), 'ui-success', 0.8);
    if (g.kind === 'counter') sound(start + 1.1, 'ui-chime', 0.7);
  }
  let lastPunch = -Infinity;
  for (const punch of [...plan.punches].sort((a, b) => (at(a.wordId) ?? 0) - (at(b.wordId) ?? 0))) {
    const start = at(punch.wordId);
    if (start === undefined || start - lastPunch < 3.5 || start > duration - 1.2) continue;
    const end = Math.min(start + PUNCH_HOLD, nextPicture(start) - 0.2, duration - 0.2);
    if (end - start < 0.9 || !free(start, end)) continue;
    place({ kind: 'punch', start, end, text: punch.text });
    kicks.push(start); sound(start, punch.sfx, gainFor(punch.emotion)); lastPunch = start;
  }
  for (const kick of plan.kicks) {
    const time = at(kick.wordId);
    if (time === undefined || time < 0.5 || time > duration - 0.4 || covered(time, time + 0.5)) continue;
    if (kicks.some((other) => Math.abs(other - time) < 1.8)) continue;
    kicks.push(time); sound(time, kick.sfx, gainFor(kick.emotion) * 0.85);
  }
  kicks.sort((a, b) => a - b);

  // B-roll: the planned transition, with its own sound going in and a soft one coming back; each list used in turn.
  const turn: Record<string, number> = {};
  const next = (list: BrollTransition | 'back') => { const options = TRANSITION_SOUNDS[list]; const i = turn[list] ?? 0; turn[list] = i + 1; return options[i % options.length]; };
  for (const scene of broll) {
    sound(scene.start, next(transitions[scene.id]), 1);
    if (scene.end < duration - 0.5) sound(scene.end, next('back'), 0.55);
  }

  // Watermark: the clinic's badge, whenever the top of the frame is free (not during split screens).
  if (options.watermark) {
    const busy = [...top, ...graphics.filter((g) => g.kind === 'split').map((g) => [g.start, g.end] as [number, number])].sort((a, b) => a[0] - b[0]);
    let from = 0.3;
    for (const [a, b] of [...busy, [duration + 1, duration + 1] as [number, number]]) {
      const until = Math.min(a - 0.15, duration);
      if (until - from >= 1.2) graphics.push({ kind: 'watermark', start: from, end: until });
      from = Math.max(from, b + 0.15);
    }
  }

  // Restraint, as in stick reels: at least 0.45 s apart, at most 48, and never the same sound twice in a row.
  sounds.sort((a, b) => a.at - b.at);
  const spaced: ReelSoundCue[] = [];
  for (const cue of sounds) {
    const prev = spaced.at(-1);
    if (spaced.length >= 48 || (prev && cue.at - prev.at < 0.45)) continue;
    if (prev && prev.sfx === cue.sfx) {
      const family = EMOTIONS.find((emotion) => emotion.sounds.includes(cue.sfx))?.sounds ?? Object.values(TRANSITION_SOUNDS).find((list) => list.includes(cue.sfx)) ?? TICK_SOUNDS;
      const other = family.find((id) => id !== cue.sfx && SOUND_IDS.has(id));
      if (!other) continue;
      cue.sfx = other;
    }
    spaced.push(cue);
  }
  for (const g of graphics) { g.start = Math.round(g.start * 1000) / 1000; g.end = Math.round(g.end * 1000) / 1000; }
  return { graphics: graphics.sort((a, b) => a.start - b.start), kicks, sounds: spaced, transitions };
}

/** Distinct looks of the motion layer (mirrors ReelGraphics in Graphics.tsx), like captionStates(). */
export const GRAPHIC_OUT = 0.2;
export function motionStates(graphics: ReelGraphic[], duration: number, fps = 30) {
  const total = Math.max(1, Math.round(duration * fps));
  const keys = new Map<string, number>([['blank', 0]]); const times: number[] = [-1];
  const runs: Array<{ state: number; frames: number }> = [];
  const moving = graphics.map(animatedFor);
  for (let frame = 0; frame < total; frame += 1) {
    const time = frame / fps;
    const parts = graphics.map((graphic, i) => {
      if (time < graphic.start || time >= graphic.end) return '';
      return time - graphic.start < moving[i] || graphic.end - time < GRAPHIC_OUT ? `${i}@${frame}` : `${i}`;
    }).filter(Boolean);
    const key = parts.length ? parts.join('|') : 'blank';
    let state = keys.get(key);
    if (state === undefined) { state = times.length; keys.set(key, state); times.push(time); }
    const last = runs.at(-1);
    if (last && last.state === state) last.frames += 1; else runs.push({ state, frames: 1 });
  }
  return { times, runs, totalFrames: total };
}
