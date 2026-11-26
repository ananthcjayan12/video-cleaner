import { META_RULES } from './meta-guidelines.js';

/**
 * Health-claim check for the review screen. The words are what the practitioner actually said, so a fix is to
 * cut the sentence (or keep it on purpose), never to rewrite it: the audio cannot be changed.
 */
export type ClaimFlag = { from: number; to: number; match: string; title: string; fix: string };
type Word = { text: string; start: number; end: number };

/** Plain absolute words that health-advertising rules (Meta, ASCI, GDC/Ahpra/DHA/Dental Council) treat as promises. */
const ABSOLUTE_WORDS = {
  title: 'Promises a result',
  pattern: /\b(painless|pain[- ]free|guarantee[ds]?|guaranteed|permanent(ly)?|100\s?%|best (dentist|doctor|clinic|treatment|physio|dietitian|optometrist)|cures?d?|cure it|miracle|risk[- ]free|no side[- ]effects?)\b/i,
  fix: 'Health ad rules do not allow promises. Remove this sentence, or keep it only if you are sure it is allowed.',
};

/** Sentences as the review screen shows them: break at . ? ! , at pauses over 0.7 s, or after 28 words. */
export function reviewSentences(words: Word[]) {
  const out: Array<{ from: number; to: number }> = [];
  let from = 0;
  words.forEach((word, i) => {
    const next = words[i + 1];
    if (!next || /[.?!]$/.test(word.text) || next.start - word.end > 0.7 || i - from >= 27) { out.push({ from, to: i }); from = i + 1; }
  });
  return out;
}

/** extra: the field's own risky promises (from its niche pack), checked after the general list. */
export function findClaims(words: Word[], extra?: RegExp): ClaimFlag[] {
  const flags: ClaimFlag[] = [];
  for (const { from, to } of reviewSentences(words)) {
    const text = words.slice(from, to + 1).map((word) => word.text).join(' ');
    const absolute = text.match(ABSOLUTE_WORDS.pattern);
    if (absolute) { flags.push({ from, to, match: absolute[0], title: ABSOLUTE_WORDS.title, fix: ABSOLUTE_WORDS.fix }); continue; }
    const field = extra && text.match(extra);
    if (field) { flags.push({ from, to, match: field[0], title: ABSOLUTE_WORDS.title, fix: ABSOLUTE_WORDS.fix }); continue; }
    for (const rule of META_RULES) {
      const hit = rule.text?.map((pattern) => text.match(pattern)).find(Boolean);
      if (hit) { flags.push({ from, to, match: hit[0], title: rule.title, fix: rule.fix }); break; }
    }
  }
  return flags;
}
