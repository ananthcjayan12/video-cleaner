import type { KeepRange, ReviewWord } from './api';

/** Per-word keep flags from the edit's keep ranges. */
export function keepFlags(words: ReviewWord[], ranges: KeepRange[]) {
  const index = new Map(words.map((w, i) => [w.id, i]));
  const flags = words.map(() => false);
  for (const range of ranges) {
    const a = index.get(range.startWordId); const b = index.get(range.endWordId);
    if (a === undefined || b === undefined) continue;
    for (let i = a; i <= b; i += 1) flags[i] = true;
  }
  return flags;
}

/** Keep flags back to the server's keep ranges (consecutive kept words become one range). */
export function flagsToRanges(words: ReviewWord[], flags: boolean[]): KeepRange[] {
  const ranges: KeepRange[] = [];
  let start = -1;
  flags.forEach((keep, i) => {
    if (keep && start < 0) start = i;
    if ((!keep || i === flags.length - 1) && start >= 0) { const end = keep ? i : i - 1; ranges.push({ startWordId: words[start].id, endWordId: words[end].id, reason: 'Reviewed by owner' }); start = -1; }
  });
  return ranges;
}

/** Sentences for the review screen: break at . ? ! , at pauses over 0.7 s, or after 28 words. */
export function sentences(words: ReviewWord[]) {
  const out: Array<{ from: number; to: number }> = [];
  let from = 0;
  words.forEach((word, i) => {
    const next = words[i + 1];
    if (!next || /[.?!]$/.test(word.text) || next.start - word.end > 0.7 || i - from >= 27) { out.push({ from, to: i }); from = i + 1; }
  });
  return out;
}

export function keptSeconds(words: ReviewWord[], flags: boolean[]) {
  let total = 0; let start = -1;
  flags.forEach((keep, i) => {
    if (keep && start < 0) start = i;
    if ((!keep || i === flags.length - 1) && start >= 0) { const end = keep ? i : i - 1; total += words[end].end - words[start].start; start = -1; }
  });
  return total;
}
