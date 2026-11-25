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
