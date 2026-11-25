import type { KeepRange, Word } from './project-store.js';
import { metaTextGuidelinesPrompt } from './meta-guidelines.js';

export type CleanIntensity = 'light' | 'balanced' | 'aggressive';
export const CLEAN_INTENSITIES: CleanIntensity[] = ['light', 'balanced', 'aggressive'];

export function cleanIntensityValue(value: unknown): CleanIntensity {
  return CLEAN_INTENSITIES.includes(value as CleanIntensity) ? value as CleanIntensity : 'aggressive';
}
/** Optional final-length budget in seconds; anything outside 10–600 s means "no target". */
export function targetDurationValue(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 10 && seconds <= 600 ? Math.round(seconds) : undefined;
}

/** Spoken length of a keep list: each range runs from its first word's start to its last word's end. */
export function keptDuration(words: Word[], ranges: KeepRange[]) {
  const index = new Map(words.map((word, i) => [word.id, i]));
  return ranges.reduce((sum, range) => {
    const a = index.get(range.startWordId); const b = index.get(range.endWordId);
    return a === undefined || b === undefined ? sum : sum + Math.max(0, words[b].end - words[a].start);
  }, 0);
}

const INTENSITY_RULES: Record<CleanIntensity, string> = {
  light: 'LIGHT: remove only obvious mistakes, retakes, duplicate takes, fillers and long silence; keep relaxed pacing and all context.',
  balanced: 'BALANCED: remove all clear repetition and non-essential wording, tighten ordinary pauses, and keep only useful context.',
  // The approach the owner approved on the sample clip (100 s -> 50 s): every idea said once, short-form story order kept.
  aggressive: [
    'AGGRESSIVE (short-form reel edit). Work in two steps.',
    'Step 1 - list the distinct ideas the speaker makes (who this is for, what it is, the problem, the reason, the promise, the call to action, any key fact).',
    'Step 2 - keep each idea exactly ONCE, in its clearest and most complete statement (usually the first full one), and delete every other time it is said:',
    '- restating who the video is for, re-explaining what was just said, "in other words" passages, summaries of earlier points;',
    '- a sentence that a later kept sentence already covers;',
    '- retakes: a sentence the speaker abandons, corrects or restarts (for example with "no", "അല്ല", "sorry"), keeping only the final attempt;',
    '- doubled words and self-corrections ("clients, potential clients" keeps only "potential clients" when that reads naturally);',
    '- fillers and lead-ins: hello at the very start, "so", "okay", "അതായത്", "അപ്പൊ", "പിന്നെ" when they carry no meaning;',
    '- anything after the final call to action (outtakes, "okay, no problem", chatter).',
    'Keep the short-form arc: hook (who/what in the first seconds) -> what it is -> problem -> why/solution -> promise -> call to action.',
    'The result must read as natural, grammatical speech. Prefer cutting at sentence or clause boundaries. Avoid keep ranges shorter than about 1 second unless the range drops a single filler; word timings can be a few tenths of a second off, so very short ranges risk clipped words.',
  ].join('\n'),
};

/** Owner's review notes, plus the edit they reviewed, so the AI changes only what was asked. */
export type CleanNotes = { notes: string; previous?: KeepRange[] };

export function buildCleanPrompt(words: Word[], intensity: CleanIntensity, targetSeconds?: number, feedback?: string, owner?: CleanNotes) {
  const source = words.map((word) => `[${word.id} ${word.start.toFixed(3)}-${word.end.toFixed(3)}] ${word.text}`).join('\n');
  const total = words.length ? words.at(-1)!.end - words[0].start : 0;
  return [
    'You are a decisive professional short-form video editor cleaning a talking-head recording. Produce a concise, natural final narration containing only material that earns its place.',
    '',
    'This is DELETE-ONLY editing. Never invent, paraphrase, replace, reorder or combine spoken words. Keep source chronology. Return only ranges of ORIGINAL words to keep, and never cut inside a word.',
    '',
    'Always remove: silence and dead air (infer it from timestamp gaps; split keep ranges around removable gaps), duplicate takes, false starts, abandoned phrases, stumbles, production chatter and off-topic tangents.',
    'Always preserve: the complete intended meaning, important facts, necessary context and the speaker\'s natural voice.',
    '',
    `Cleanup intensity - ${INTENSITY_RULES[intensity]}`,
    '',
    targetSeconds
      ? `TARGET LENGTH: about ${targetSeconds} seconds (stay within ±10%). The recording is ${total.toFixed(1)} s. Length = sum over keep ranges of (end of last word - start of first word). To hit the budget, drop secondary examples, side explanations and repeated points before touching the hook, the core message or the call to action.`
      : 'No fixed length: make it as tight as the intensity allows.',
    feedback ? `\nYOUR PREVIOUS ATTEMPT: ${feedback}` : '',
    owner?.notes.trim() ? [
      '',
      'THE OWNER REVIEWED THE EDIT AND GAVE THESE INSTRUCTIONS. Follow them exactly; they override the rules above (still delete-only, still never cut inside a word):',
      owner.notes.trim(),
      owner.previous?.length ? `The edit they reviewed kept these ranges (start-end word ids): ${owner.previous.map((r) => `${r.startWordId}-${r.endWordId}`).join(', ')}. Start from it and change only what the instructions ask for.` : '',
    ].join('\n') : '',
    '',
    'For every keep range give a short reason saying which idea it carries. In notes, list what you removed (repeats, retakes, fillers, outtakes) in a few short lines.',
    '',
    metaTextGuidelinesPrompt(),
    'Because editing is delete-only, you may REMOVE a sentence that clearly breaks these policies (e.g. a guaranteed-cure claim or a superiority claim) when the remaining narration still makes sense, and you must say so in notes prefixed "Meta policy:". Never rewrite or add words.',
    '',
    'SOURCE WORDS:',
    source,
  ].join('\n');
}

/** Returns feedback for a retry when the edit misses the target by more than 12 %, otherwise undefined. */
export function targetFeedback(seconds: number, target: number | undefined) {
  if (!target) return undefined;
  if (seconds > target * 1.12) return `kept ${seconds.toFixed(1)} s, which is over the ${target} s target. Cut more: remove secondary points and any remaining repeats, keeping the hook, core message and call to action.`;
  if (seconds < target * 0.75) return `kept only ${seconds.toFixed(1)} s, well under the ${target} s target. Put back the most useful context you removed.`;
  return undefined;
}
