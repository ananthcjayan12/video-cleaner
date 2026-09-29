/**
 * Meta (Facebook/Instagram) advertising guidelines applied to every piece of content this app analyses or generates.
 *
 * Single source of truth: edit RULES below when Meta changes its policy and bump META_GUIDELINES_REVIEWED.
 * Used by: dialogue cleaning (transcript review), B-roll story/visual planning, image and video prompts, thumbnails.
 *
 * Sources (review periodically, policy changes often):
 *  - https://transparency.meta.com/policies/ad-standards/
 *  - Meta Advertising Standards: Personal Attributes, Misleading/False Claims, Before-and-After, Sensational Content,
 *    Adult Content, Health & Wellness, "AI info" labelling.
 * Summarised 2026-09-29 from Meta's ad-standards index and 2026 policy round-ups; this is guidance, not legal advice.
 */

export const META_GUIDELINES_REVIEWED = '2026-09-29';

export type MetaSeverity = 'block' | 'warn';
export type MetaRule = {
  id: string;
  title: string;
  severity: MetaSeverity;
  /** Plain-language rule handed to the language models. */
  guideline: string;
  /** Applies to spoken/claim text (transcript, narration, hooks). */
  text?: RegExp[];
  /** Applies to image/video prompts (visual content). */
  visual?: RegExp[];
  /** Safer alternative suggested to editors. */
  fix: string;
};

export const META_RULES: MetaRule[] = [
  {
    id: 'personal-attributes', title: 'Personal attributes', severity: 'warn',
    guideline: 'Never assert or imply that the viewer has a health condition, dental problem, or other personal attribute (e.g. "Do you have bad breath?", "Your gums are bleeding"). Speak about the topic in general terms or in the third person.',
    text: [/\b(do|are|have|did) you (have|suffer|struggle|feel|got)\b[^.?!]{0,60}\b(pain|decay|cavit|bleed|gum|breath|infection|disease|problem|teeth|tooth|stain|yellow)/i, /\byour (teeth|gums|breath|smile|tooth)\b[^.?!]{0,40}\b(are|is|look|bleed|smell|hurt|rotten|yellow|ugly|bad)/i, /\byou (are|may be|might be|probably|definitely) (suffering|having|have)\b/i],
    fix: 'Rephrase to a general statement ("Many people notice gum bleeding…", "Gum disease can start quietly…") instead of addressing the viewer\'s condition.',
  },
  {
    id: 'guaranteed-results', title: 'Guaranteed, miraculous or unrealistic outcomes', severity: 'warn',
    guideline: 'Do not promise or imply guaranteed, instant, permanent, painless, risk-free or miraculous results, or results that are unlikely for a typical patient. Use hedged, factual language ("can help", "many patients", "results vary").',
    text: [/\b(100\s?%|guarantee[ds]?|guaranteed|permanent(ly)? (cure|fix|solution|white)|miracle|instant(ly)? (cure|result|white|relief)|overnight|cure[sd]? (all|forever|completely)|no (risk|side effects?|pain at all)|completely painless|never (come|comes|coming) back|forever)\b/i, /\b(cure|cured|cures)\b/i],
    visual: [/\b(miracle|guaranteed|instant transformation|perfect (smile|result)s?)\b/i],
    fix: 'Replace absolute claims with hedged wording and avoid outcome promises; do not show idealised or unlikely results.',
  },
  {
    id: 'before-after', title: 'Before-and-after imagery', severity: 'block',
    guideline: 'Do not create before-and-after, side-by-side transformation, split-screen "problem vs perfect result" or progress-comparison imagery of teeth, gums, faces or bodies. Meta treats idealised or unexpected/unlikely results as prohibited, and pairing them with outcome claims is high risk.',
    visual: [/\bbefore\s*(and|&|\/|-|vs\.?|versus|→|->)\s*after\b/i, /\bbefore[- ]after\b/i, /\bside[- ]by[- ]side (comparison|transformation)\b/i, /\btransformation (shot|reveal|comparison)\b/i, /\bsplit[- ]screen\b/i, /\bcomparison (of|between) (teeth|smile|gum)/i],
    text: [/\bbefore and after\b/i],
    fix: 'Show one state at a time as an educational visual (mechanism, anatomy, general prevention) rather than a transformation comparison.',
  },
  {
    id: 'negative-self-perception', title: 'Shaming or negative self-perception', severity: 'warn',
    guideline: 'Do not shame, mock or provoke insecurity about teeth, smile, breath, weight, age or appearance to sell a service. No "ugly", "disgusting", "embarrassing" framing aimed at the viewer.',
    text: [/\b(ugly|disgusting|embarrass(ing|ed)|shame(ful)?|gross|rotten|hideous|stinky|nobody will (love|like|date))\b/i],
    visual: [/\b(ugly|disgusting|embarrass(ing|ed)|shame(ful)?|humiliat\w+|mocked?|rotten (teeth|smile))\b/i],
    fix: 'Keep the tone respectful and informative; frame the topic around health and prevention, not appearance flaws.',
  },
  {
    id: 'fear-and-scare', title: 'Fear-mongering and sensational content', severity: 'warn',
    guideline: 'Avoid shocking, sensational or fear-based claims (e.g. "this will kill you", "doctors are hiding this"). Do not exaggerate risk or use scare tactics; stay factual and calm.',
    text: [/\b(deadly|kills?|killer|shocking|you won'?t believe|doctors? (don'?t want|are hiding)|secret (they|that)|banned|exposed|danger(ous)? truth)\b/i],
    visual: [/\b(shocking|horror|terrifying|nightmare)\b/i],
    fix: 'State the medical fact plainly and proportionately, and encourage a professional consultation.',
  },
  {
    id: 'graphic-content', title: 'Graphic, gory or disturbing imagery', severity: 'block',
    guideline: 'No gore, blood, exposed raw tissue, open wounds, surgical bleeding, visible infection/pus, extraction gore, needles piercing skin/gums in close-up, or other graphic medical imagery. Keep procedure visuals clean, clinical and non-gory.',
    visual: [/\b(gore|gory|blood(y|ied)?|bleeding|pus|abscess (drain|burst)|open wound|raw (flesh|tissue)|mutilat\w*|graphic|rotting|decayed? flesh|exposed nerve|needle (piercing|entering|into))\b/i],
    fix: 'Use clean anatomical illustration, cutaway or tool-only close-ups without blood or exposed tissue.',
  },
  {
    id: 'adult-nudity', title: 'Nudity, sexual or suggestive content', severity: 'block',
    guideline: 'No nudity, sexualised or suggestive imagery, lingering close-ups of lips/mouth framed suggestively, or intimate poses.',
    visual: [/\b(nude|naked|sexy|sensual|seductive|erotic|lingerie|topless|kiss(ing)?|suggestive|provocative)\b/i],
    text: [/\b(sexy|seductive|erotic)\b/i],
    fix: 'Keep people fully clothed, neutral and professional.',
  },
  {
    id: 'minors', title: 'Children and minors in medical context', severity: 'warn',
    guideline: 'Avoid identifiable children in clinical or sensitive scenes; do not show minors undergoing procedures. Prefer adult subjects or non-human anatomy.',
    visual: [/\b(child|children|kid|kids|toddler|baby|infant|boy|girl|minor|schoolchild(ren)?)\b/i],
    fix: 'Use an adult subject or an anatomical/3D visual.',
  },
  {
    id: 'real-people-endorsement', title: 'Real people, celebrities and testimonials', severity: 'block',
    guideline: 'Do not depict celebrities, public figures or identifiable real individuals, and never fabricate patient testimonials, reviews, "real patient" claims or endorsements. AI-generated people must not be presented as real patients.',
    visual: [/\b(celebrity|famous (actor|actress|person|doctor)|politician|cricketer|movie star|real patient (photo|story)|patient testimonial|review screenshot)\b/i],
    text: [/\b(celebrity|famous (actor|actress)|real patient results?)\b/i],
    fix: 'Use generic, clearly illustrative visuals; never imply a specific real person or real patient outcome.',
  },
  {
    id: 'on-image-text', title: 'Text, logos, brands and third-party IP in visuals', severity: 'block',
    guideline: 'No text, captions, price tags, phone numbers, arrows with words, watermarks, third-party logos, competitor brands, trademarked products or copyrighted characters inside generated visuals. Use only the clinic\'s own supplied branding when a thumbnail requires it.',
    visual: [/\b(logo|brand name|trademark|watermark|price tag|discount (banner|tag)|phone number|qr code|hashtag|colgate|oral-?b|sensodyne|crest|listerine|pepsodent|invisalign|disney|marvel)\b/i],
    fix: 'Remove text and third-party marks; add wording later in the editor using compliant copy.',
  },
  {
    id: 'medical-claims', title: 'Unsubstantiated medical, treatment or product claims', severity: 'warn',
    guideline: 'Health claims must be accurate and substantiated. Do not claim to diagnose, treat or cure a disease, do not disparage other treatments or professionals, do not promote prescription drugs/medicines, unapproved products, or make superiority claims ("best dentist", "number 1", "only clinic").',
    text: [/\b(best|no\.?\s?1|number one|top[- ]rated|only) (dentist|clinic|doctor|hospital|treatment|in (kerala|india|the world))\b/i, /\b(diagnos(e|es|ed)|prescri(be|ption)|antibiotic|painkiller)\b/i, /\b(replaces?|better than) (dentist|doctor|treatment|surgery)\b/i, /\b(no need (to see|for) (a )?(dentist|doctor))\b/i],
    fix: 'Keep claims educational and general, avoid superiority language, and recommend consulting a qualified dentist for diagnosis.',
  },
  {
    id: 'deceptive-practices', title: 'Deceptive practices, urgency and clickbait', severity: 'warn',
    guideline: 'No misleading, fake-urgency, fake-scarcity or "free money/offer" tactics, no fake UI elements (play buttons, notifications, close buttons, system alerts) and no engagement bait.',
    text: [/\b(only \d+ (slots?|seats?|spots?) left|hurry|act now|limited time only|last chance|click (here|below) now|free (treatment|whitening|gift))\b/i],
    visual: [/\b(fake (ui|notification|play button)|play button|notification badge|system alert|close button|swipe up|click here)\b/i],
    fix: 'Use honest, specific calls to action (e.g. "book a consultation") without pressure tactics.',
  },
  {
    id: 'discrimination', title: 'Discrimination and stereotypes', severity: 'warn',
    guideline: 'Do not target, stereotype or demean people by race, religion, caste, gender, age, disability, or health status. Keep casting natural and respectful.',
    text: [/\b(lower caste|dirty people|those people|people like them)\b/i],
    fix: 'Use inclusive, neutral language and natural, respectful casting.',
  },
  {
    id: 'ai-disclosure', title: 'AI-generated imagery disclosure', severity: 'warn',
    guideline: 'Photorealistic AI-generated or substantially AI-altered imagery/video must be disclosed: set the "AI info"/AI-generated label when publishing or boosting, and never present synthetic people, patients or clinical outcomes as real footage.',
    fix: 'Enable the AI label in Meta Business Suite / Ads Manager for any post containing generated B-roll, and prefer illustrative 3D/anatomy visuals over photoreal patients.',
  },
];

const BLOCK_PROMPT_HEADER = `META ADS COMPLIANCE (reviewed ${META_GUIDELINES_REVIEWED}). This content will be posted and boosted on Facebook/Instagram, so it must never risk an ad rejection or account restriction.`;

function bulletList(rules: MetaRule[]) {
  return rules.map((rule) => `- ${rule.title}: ${rule.guideline}`).join('\n');
}

/** Rules for models that analyse/edit the spoken content (cleaning, story planning). */
export function metaTextGuidelinesPrompt() {
  const rules = META_RULES.filter((rule) => rule.text?.length || rule.id === 'ai-disclosure');
  return `${BLOCK_PROMPT_HEADER}\nWhile analysing the narration, treat these as policy constraints:\n${bulletList(rules)}`;
}

/** Rules for models that write image/video prompts and for image generators. */
export function metaVisualGuidelinesPrompt() {
  const rules = META_RULES.filter((rule) => rule.visual?.length || rule.id === 'ai-disclosure');
  return `${BLOCK_PROMPT_HEADER}\nEvery visual you describe must satisfy these policy constraints, even if the narration or a user request seems to ask otherwise (choose a compliant alternative that still explains the key point):\n${bulletList(rules)}`;
}

export type MetaFinding = { ruleId: string; title: string; severity: MetaSeverity; match: string; fix: string };

// A mention is negated when a negator opens the same clause, e.g. "no text, logos or watermark" or "without blood".
function isNegated(text: string, index: number) {
  const clause = text.slice(Math.max(0, index - 80), index).split(/[.;:!?\n]/).pop() ?? '';
  return /\b(no|non|not|never|without|avoid|avoiding|free of|zero)\b[-\s]/i.test(clause) || /\b(no|non|not|never|without|avoid|avoiding|zero)[-\s]*$/i.test(clause);
}

function scan(text: string, kind: 'text' | 'visual'): MetaFinding[] {
  const findings: MetaFinding[] = [];
  for (const rule of META_RULES) {
    for (const pattern of rule[kind] ?? []) {
      const match = pattern.exec(text);
      // Ignore negated mentions such as "no blood", "non-gory" or "without text".
      if (match && !(kind === 'visual' && isNegated(text, match.index))) { findings.push({ ruleId: rule.id, title: rule.title, severity: rule.severity, match: match[0].trim().slice(0, 80), fix: rule.fix }); break; }
    }
  }
  return findings;
}

/** Scan spoken/claim text (transcript, narration, hooks). */
export function scanMetaText(text: string): MetaFinding[] { return scan(text, 'text'); }
/** Scan an image/video prompt. */
export function scanMetaVisual(text: string): MetaFinding[] { return scan(text, 'visual'); }

export function formatMetaFinding(finding: MetaFinding, context?: string) {
  return `Meta policy (${finding.severity === 'block' ? 'blocked' : 'review'}) — ${finding.title}: found "${finding.match}"${context ? ` in ${context}` : ''}. ${finding.fix}`;
}

export class MetaPolicyError extends Error {
  findings: MetaFinding[];
  constructor(context: string, findings: MetaFinding[]) {
    super(`This ${context} conflicts with Meta ad policy and was not sent to the generator:\n${findings.map((finding) => `- ${formatMetaFinding(finding)}`).join('\n')}\nEdit the prompt to remove it and try again.`);
    this.name = 'MetaPolicyError';
    this.findings = findings;
  }
}

/** Throws when a visual prompt contains a hard-block pattern. */
export function assertMetaVisualCompliant(context: string, prompt: string) {
  const blocking = scanMetaVisual(prompt).filter((finding) => finding.severity === 'block');
  if (blocking.length) throw new MetaPolicyError(context, blocking);
}
