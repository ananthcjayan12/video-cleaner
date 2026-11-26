import type { Niche } from './ideas.js';

/**
 * A niche pack is everything that makes a reel look and sound right for one kind of practice:
 * caption and cover font and colours, the picture style for B-roll, and wording rules for the caption writer
 * and the claims check. One pack per field; an account picks its field and every reel uses that pack.
 */
export type NichePack = {
  id: Niche;
  label: string;
  /** Font family name as registered in the caption renderer (remotion/captions/src/fonts.ts). */
  font: string;
  /** The same font's web name, for the look preview in the phone app. */
  webFont: string;
  /** Brand colour (cover highlight block, app preview). */
  accent: string;
  /** Text colour on the accent block. */
  onAccent: string;
  /** Light tint of the accent that reads on the dark glass caption card and dark cover strip. */
  highlight: string;
  /** Cover label strip and badge rims, when different from highlight (dental keeps its lime cover). */
  coverHighlight?: string;
  /** Picture style added to every B-roll plan and image prompt. */
  artDirection: string;
  /** What the caption writer should know about this field's audience. */
  writer: string;
  /** Extra hashtags that usually fit (the AI picks from them, it does not paste them all). */
  hashtagHints: string[];
  /** Field-specific promises the claims check flags on the review screen. */
  risky?: RegExp;
};

export const NICHE_PACKS: Record<Niche, NichePack> = {
  dental: {
    id: 'dental', label: 'Dental', font: 'VC Jakarta', webFont: 'Plus Jakarta Sans', accent: '#D7F25B', onAccent: '#0B0D0C', highlight: '#7FE3D6', coverHighlight: '#D7F25B',
    artDirection: 'FIELD: dentistry. Prefer clean educational 3D of teeth, gums, roots and bone in cutaway, macro close-ups of brushing, flossing and dental tools, and calm modern Indian dental clinic moments. Palette: clinical whites, soft mint and teal, warm skin tones; bright, hygienic, reassuring. Teeth must look anatomically correct (right count, shape and roots). Never show blood, extraction gore, or before/after comparisons.',
    writer: 'The speaker is a dentist talking to patients and families in Kerala/India. Keep advice practical (brushing, gums, checkups, treatments explained simply). Calm and reassuring; never fear-mongering.',
    hashtagHints: ['#dentist', '#dentalcare', '#oralhealth', '#teeth', '#smile', '#dentaltips', '#kerala'],
    risky: /\b(painless|pain[- ]free|perfect smile|whiter in (one|1) (day|visit))\b/i,
  },
  physio: {
    id: 'physio', label: 'Physiotherapy', font: 'VC Montserrat', webFont: 'Montserrat', accent: '#3F5BD8', onAccent: '#FFFFFF', highlight: '#A9B8FF',
    artDirection: 'FIELD: physiotherapy. Prefer clear 3D of muscles, joints, spine and posture (anatomically correct, highlighted area glowing softly), real Indian people doing simple exercises, stretches and desk/phone posture at home or work, and a bright modern physio clinic. Palette: fresh whites, cool blue accents, natural daylight; energetic but calm. Show correct, safe exercise form only. No injuries, x-ray gore or extreme flexibility.',
    writer: 'The speaker is a physiotherapist talking to people with back, neck, knee or sports pain and desk workers in India. Give simple, safe movements and when to see a professional; never promise instant relief.',
    hashtagHints: ['#physiotherapy', '#physio', '#backpain', '#posture', '#neckpain', '#exercise', '#rehab'],
    risky: /\b(instant relief|fix(es|ed)? (it|your \w+) forever|never (hurt|have pain) again|no more pain|cure (back|neck|knee) pain)\b/i,
  },
  nutrition: {
    id: 'nutrition', label: 'Nutrition', font: 'VC Poppins', webFont: 'Poppins', accent: '#F4A93B', onAccent: '#1A1205', highlight: '#F4A93B',
    artDirection: 'FIELD: nutrition and diet. Prefer appetising, honest close-ups of everyday Indian/Kerala food (rice, dal, fish curry, idli, fruit, vegetables, nuts), plates showing balanced portions, simple 3D of digestion, blood sugar or nutrients when explaining a mechanism, and real people cooking or eating at home. Palette: warm saffron, fresh greens, natural daylight. No diet-pill or supplement packshots, no body-shaming, no before/after bodies, no measuring-tape-on-waist clichés.',
    writer: 'The speaker is a nutritionist/dietitian talking to Indian families about everyday meals, weight, diabetes and energy. Practical food swaps, portions and habits; respectful of local food. Never shame bodies.',
    hashtagHints: ['#nutrition', '#healthyeating', '#dietitian', '#indianfood', '#keralafood', '#diabetes', '#healthylifestyle'],
    risky: /\b(detox(es|ing)?|fat[- ]burn(ing|er)?|melts? (belly )?fat|lose \d+\s?(kg|kilos?) in|reverses? diabetes|cures? (diabetes|pcos|thyroid)|superfood cures?)\b/i,
  },
  optometry: {
    id: 'optometry', label: 'Optometry', font: 'VC Sora', webFont: 'Sora', accent: '#9A4FD0', onAccent: '#FFFFFF', highlight: '#D2A8F5',
    artDirection: 'FIELD: optometry and eye care. Prefer precise 3D cutaways of the eye (cornea, lens, retina, focus of light), macro shots of lenses, frames and eye-test equipment, real Indian people (children and adults) using screens, reading or outdoors in daylight, and a clean modern optometry practice. Palette: cool whites, soft violet accents, crisp light. Eyes must look natural and correct. No surgery close-ups, no red/injured eyes.',
    writer: 'The speaker is an optometrist talking to parents, students and screen workers in India about eye tests, screen time, glasses, contact lenses and children’s eyes. Practical habits and when to get checked.',
    hashtagHints: ['#optometrist', '#eyecare', '#eyetest', '#screentime', '#kidsvision', '#glasses', '#eyehealth'],
    risky: /\b(throw away (your )?glasses|never need glasses|cures? (myopia|short[- ]sight(edness)?)|reverses? (myopia|eyesight)|perfect (vision|eyesight))\b/i,
  },
};

export function nichePack(niche: Niche | undefined) { return NICHE_PACKS[niche ?? 'dental'] ?? NICHE_PACKS.dental; }

/** What the caption renderer and cover need (sent as Remotion input props). */
export function packLook(pack: NichePack) {
  return { font: pack.font, accent: pack.accent, onAccent: pack.onAccent, highlight: pack.highlight, coverHighlight: pack.coverHighlight ?? pack.highlight };
}
export type PackLook = ReturnType<typeof packLook>;

/** What the phone app shows as the account's reel look. */
export function packPreview(pack: NichePack) {
  return { label: pack.label, font: pack.webFont, accent: pack.accent, onAccent: pack.onAccent, highlight: pack.highlight, coverHighlight: pack.coverHighlight ?? pack.highlight };
}

/** Field notes for the reel caption writer. */
export function packWriterNotes(pack: NichePack) {
  return `FIELD: ${pack.label}. ${pack.writer} Hashtags that often fit (choose, don't paste all): ${pack.hashtagHints.join(' ')}.`;
}
