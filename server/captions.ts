/**
 * Turn word timings on the edited timeline into short caption phrases for the Remotion caption templates.
 * Rules learned on the sample reel: short phrases (≤ 6 words / ~34 characters), break at pauses and sentence ends,
 * never let a phrase flash for less than 0.35 s, bridge small gaps so captions do not flicker, English words stay
 * in English letters with Title Case and are the highlighted ("key") words.
 */
export type CaptionWordIn = { text: string; start: number; end: number };
export type CaptionWord = { text: string; at: number; key: boolean };
export type CaptionPhrase = { start: number; end: number; words: CaptionWord[] };

const MALAYALAM = /[ഀ-ൿ]/;
// Any Indic script counts as "not English" for highlighting.
const INDIC = /[ऀ-෿]/;

export function isEnglishWord(text: string) {
  const root = text.split('-')[0];
  return !INDIC.test(root) && /[A-Za-z0-9]/.test(root);
}

export function displayWord(text: string) {
  const clean = text.replace(/[.,]+$/u, '');
  if (!isEnglishWord(clean)) return clean;
  return clean.replace(/^[a-z]/, (c) => c.toUpperCase());
}

export function buildCaptionPhrases(words: CaptionWordIn[], duration: number, options: { maxWords?: number; maxChars?: number; pause?: number } = {}): CaptionPhrase[] {
  const maxWords = options.maxWords ?? 6; const maxChars = options.maxChars ?? 34; const pause = options.pause ?? 0.35;
  const groups: CaptionWordIn[][] = [];
  let current: CaptionWordIn[] = [];
  words.forEach((word, i) => {
    current.push(word);
    const next = words[i + 1];
    const chars = current.map((w) => w.text).join(' ').length;
    if (!next || next.start - word.end > pause || /[.?!]$/.test(word.text) || current.length >= maxWords || chars >= maxChars) {
      groups.push(current); current = [];
    }
  });
  for (let i = 0; i < groups.length; i += 1) {
    if (groups.length > 1 && groups[i].at(-1)!.end - groups[i][0].start < 0.35) {
      if (i + 1 < groups.length) groups[i + 1] = [...groups[i], ...groups[i + 1]]; else groups[i - 1].push(...groups[i]);
      groups.splice(i, 1); i -= 1;
    }
  }
  return groups.map((group, i) => {
    const nextStart = groups[i + 1] ? groups[i + 1][0].start : duration;
    const lastEnd = group.at(-1)!.end;
    const end = nextStart - lastEnd < 0.8 ? nextStart : Math.min(nextStart, lastEnd + 0.6);
    return {
      start: Math.max(0, group[0].start - 0.05), end: Math.min(duration, end),
      words: group.map((w) => ({ text: displayWord(w.text), at: Math.max(0, w.start - 0.04), key: isEnglishWord(w.text) })),
    };
  }).filter((phrase) => phrase.end > phrase.start);
}

export { MALAYALAM };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/**
 * The Glass Card only changes while a card fades in/out (0.14 s / 0.1 s) or a word lights up (0.08 s); in between it
 * is still. Mirrors GlassCard.tsx: returns one time per distinct look (`times`) and, for every video frame in order,
 * runs of { state, frames } so each distinct image is drawn once and shown for as long as it holds.
 * State 0 is always "no card" (blank).
 */
export function captionStates(phrases: CaptionPhrase[], duration: number, fps = 30) {
  const total = Math.max(1, Math.round(duration * fps));
  const keys = new Map<string, number>([['blank', 0]]); const times: number[] = [-1];
  const runs: Array<{ state: number; frames: number }> = [];
  const r = (value: number) => Math.round(value * 1000) / 1000;
  let p = 0;
  for (let frame = 0; frame < total; frame += 1) {
    const time = frame / fps;
    while (p < phrases.length && phrases[p].end <= time) p += 1;
    const phrase = phrases[p] && time >= phrases[p].start && time < phrases[p].end ? phrases[p] : undefined;
    let key = 'blank';
    if (phrase) {
      const enter = clamp01((time - phrase.start) / 0.14); const exit = clamp01((phrase.end - time) / 0.1);
      key = `${p}|${r(enter)}|${r(exit)}|${phrase.words.map((word) => r(clamp01((time - word.at) / 0.08))).join(',')}`;
    }
    let state = keys.get(key);
    if (state === undefined) { state = times.length; keys.set(key, state); times.push(time); }
    const last = runs.at(-1);
    if (last && last.state === state) last.frames += 1; else runs.push({ state, frames: 1 });
  }
  return { times, runs, totalFrames: total };
}
