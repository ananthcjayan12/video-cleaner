import { randomBytes } from 'node:crypto';
import { keptTimeline, keptWordIndexes, planningModelLabel, writePlanningFailureLog, type BrollKeepRange, type BrollWord } from './broll.js';
import { MOTION_SOUNDS, motionSound } from './motion-sfx.js';
import { generateStructuredText, type TextModelChoice, type TextModelConfig } from './text-models.js';

export type EmotionId = 'shock' | 'suspense' | 'sadness' | 'joy' | 'insight' | 'warning' | 'emphasis' | 'transition' | 'humor' | 'relief';
export type SoundIntensity = 'soft' | 'medium' | 'strong';
export type EmotionDensity = 'subtle' | 'balanced' | 'expressive';
/** How one cue sits on the timeline: the clip is trimmed so the sound's loudest moment lands on the anchor word. */
export type EmotionClip = { lead: number; sourceOffset: number; duration: number; volume: number; fadeIn: number; fadeOut: number; soundDuration: number; label: string };
export type EmotionCue = {
  id: string; emotion: EmotionId; soundId: string; intensity: SoundIntensity;
  /** Source-video seconds where the sound's hit lands (the start of the anchor word). */
  sourceTime: number; wordId?: string; narration: string; reason: string; enabled: boolean; clip: EmotionClip;
};

/** `mixDb` is the average level (dB RMS of the audible part) each emotion's sounds are mixed at, before the intensity trim. */
export const EMOTIONS: Array<{ id: EmotionId; label: string; color: string; cue: string; mixDb: number; sounds: string[] }> = [
  { id: 'shock', label: 'Shock', color: '#f97316', mixDb: -22, cue: 'A jaw-drop fact, sudden twist, myth-buster or "you will not believe this" reveal. One sharp hit on the word that lands the surprise.',
    sounds: ['impacts-impact-hit-2', 'impacts-impact-hit-4', 'impacts-impact-hit', 'impacts-impact-hit-launch', 'impacts-deep-hit-3', 'cinematic-cinematic-glass-hit', 'cinematic-cinematic-boom', 'cinematic-cinematic-heavy-hit', 'risers-cinematic-riser-fast-tremolo-big-hit', 'whoosh-transitions-swoosh-crash'] },
  { id: 'suspense', label: 'Suspense', color: '#8b5cf6', mixDb: -27, cue: 'Tension while the speaker sets up a reveal: "but here is the catch", "and then it happened", a question left hanging. The build arrives at the word that pays it off.',
    sounds: ['buildups-dramatic-buildup-1', 'buildups-dramatic-buildup-2', 'buildups-dramatic-buildup-3', 'buildups-dramatic-buildup-4', 'buildups-dramatic-buildup-sliced', 'buildups-dramatic-buildup-whip-1', 'buildups-dramatic-buildup-whip-2', 'buildups-dramatic-buildup-whip-3', 'risers-riser-2', 'risers-riser-1', 'cinematic-cinematic-riser-wildfire', 'reverse-fx-cinematic-reverse-4', 'reverse-fx-cinematic-reverse-5', 'reverse-fx-cinematic-reverse-6'] },
  { id: 'sadness', label: 'Sadness', color: '#3b82f6', mixDb: -29, cue: 'Pain, loss, regret, disappointment or a problem that hurts: a low, falling, deflating sound under the word that carries the sorrow.',
    sounds: ['ui-ui-sound-8', 'ui-ui-sound-7', 'ui-ui-sound-off', 'ui-ui-sound', 'impacts-deep-hit', 'impacts-deep-hit-2', 'whoosh-transitions-deep-whoosh-1', 'whoosh-transitions-deep-whoosh-2', 'reverse-fx-cinematic-reverse-11', 'reverse-fx-cinematic-reverse-1', 'cinematic-cinematic-whoosh-reverse'] },
  { id: 'joy', label: 'Joy', color: '#facc15', mixDb: -28, cue: 'Celebration, good news, a win, a transformation or a happy outcome: bright, rising, rewarding sounds.',
    sounds: ['ui-success', 'ui-apple-pay-success', 'ui-chime', 'ui-game-start', 'whoosh-transitions-whoosh-achievement', 'ui-notification-1', 'ui-ui-sound-3'] },
  { id: 'insight', label: 'Insight', color: '#22d3ee', mixDb: -29, cue: 'The "aha": the key idea, the secret, the answer or a clever tip lands. A light ping or camera-flash on the word that reveals it.',
    sounds: ['ui-chime', 'ui-notification-1', 'ui-ui-sound-3', 'ui-ui-sound-4', 'camera-fx-camera-6', 'camera-fx-camera-3', 'camera-fx-vintage-flash', 'buildups-dramatic-buildup-reveal'] },
  { id: 'warning', label: 'Warning', color: '#ef4444', mixDb: -23, cue: 'Danger, urgency, a costly mistake or "do not ignore this": a heavy, ominous low hit.',
    sounds: ['cinematic-inception-thump', 'cinematic-cinematic-heavy-hit', 'cinematic-cinematic-boom', 'impacts-impact-hit-1', 'impacts-dramatic-impact', 'impacts-deep-hit-3', 'whoosh-transitions-whoosh-coarse-harsh'] },
  { id: 'emphasis', label: 'Emphasis', color: '#94a3b8', mixDb: -26, cue: 'A punchline, a number or a key phrase that deserves a firm underline without any strong emotion.',
    sounds: ['impacts-impact-hit-3', 'whoosh-transitions-swoosh-fast-with-thud', 'whoosh-transitions-swoosh-sharp-hit', 'whoosh-transitions-swoosh-sharp-hit-mp3', 'ui-pop-sound', 'ui-ui-sound-6', 'ui-button-pressed', 'camera-fx-camera-6'] },
  { id: 'transition', label: 'Transition', color: '#64748b', mixDb: -27, cue: 'A change of topic or step ("now", "next", "step two", "let us talk about"): a whoosh that carries the viewer across.',
    sounds: ['whoosh-transitions-simple-whoosh-1', 'whoosh-transitions-simple-whoosh-2', 'whoosh-transitions-fast-whoosh', 'whoosh-transitions-swish-2', 'whoosh-transitions-swish-3', 'whoosh-transitions-swish-1', 'whoosh-transitions-swoosh-quick-low', 'whoosh-transitions-swoosh-fast-1', 'whoosh-transitions-swoosh', 'whoosh-transitions-swoosh-5', 'whoosh-transitions-deep-whoosh-3', 'whoosh-transitions-deep-whoosh-4', 'ui-swipe'] },
  { id: 'humor', label: 'Humor', color: '#f472b6', mixDb: -27, cue: 'A playful, ironic or awkward beat, a small joke or a "whoops": short pops and boops that wink at the viewer.',
    sounds: ['ui-pop-sound', 'ui-ui-back-sound', 'ui-ui-sound-4', 'ui-ui-sound-6', 'ui-button-pressed', 'ui-ui-sound-7'] },
  { id: 'relief', label: 'Relief', color: '#34d399', mixDb: -31, cue: 'Reassurance and resolution ("the good news is", "it is treatable", "you are not alone"): soft, warm, settling sounds.',
    sounds: ['ui-ui-sound', 'ui-ui-sound-3', 'ui-success', 'ui-apple-pay-success', 'ui-notification-1', 'whoosh-transitions-deep-whoosh-4', 'whoosh-transitions-swish-1'] },
];
const EMOTION_IDS = EMOTIONS.map((emotion) => emotion.id);
export const SOUND_INTENSITIES: SoundIntensity[] = ['soft', 'medium', 'strong'];
const INTENSITY_TRIM_DB: Record<SoundIntensity, number> = { soft: -5, medium: 0, strong: 4 };
export const EMOTION_DENSITIES: Record<EmotionDensity, { label: string; perMinute: number }> = {
  subtle: { label: 'Subtle', perMinute: 2.5 }, balanced: { label: 'Balanced', perMinute: 5 }, expressive: { label: 'Expressive', perMinute: 9 },
};

/** Minimum seconds (on the final, cleaned timeline) between two sound beats. */
export const MIN_BEAT_GAP_SECONDS = 2;
/** A sound whose loudest moment is later than this builds up to the word instead of starting on it. */
const LEAD_IN_SECONDS = 0.8;
const MAX_LEAD_SECONDS = 2.5;
const MAX_TAIL_SECONDS = 3;
const MAX_CUES = 60;
const MAX_PLAN_ATTEMPTS = 3;

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const emotionOf = (id: unknown) => EMOTIONS.find((emotion) => emotion.id === id);
export const isLeadIn = (soundId: string) => (motionSound(soundId).peakTime ?? 0) >= LEAD_IN_SECONDS;
const intensityOf = (value: unknown): SoundIntensity => SOUND_INTENSITIES.includes(value as SoundIntensity) ? value as SoundIntensity : 'medium';

/**
 * Trim a sound around its loudest moment, level it against the other sounds, and return the clip that puts that moment on the word.
 * Sounds differ by 35 dB in loudness, so a fixed gain would make some deafening and others inaudible.
 */
export function emotionCueClip(emotion: EmotionId, soundId: string, intensity: SoundIntensity): EmotionClip {
  const sound = motionSound(soundId); const definition = emotionOf(emotion)!;
  const peak = Math.min(Math.max(sound.peakTime ?? 0, 0), sound.duration);
  const lead = Math.min(peak, MAX_LEAD_SECONDS); const tail = Math.min(sound.duration - peak, MAX_TAIL_SECONDS);
  const target = definition.mixDb + INTENSITY_TRIM_DB[intensity];
  const volume = Math.min(1, 10 ** ((target - (sound.loudnessDb ?? -20)) / 20), 10 ** ((-3 - (sound.peakDb ?? 0)) / 20));
  return {
    lead: round(lead), sourceOffset: round(peak - lead), duration: round(lead + tail), volume: round(volume),
    fadeIn: peak - lead > 0.01 ? 0.2 : 0, fadeOut: sound.duration - peak > MAX_TAIL_SECONDS + 0.01 ? 0.6 : 0.05,
    soundDuration: sound.duration, label: `${definition.label} · ${sound.label}`,
  };
}

function nearestWord(words: BrollWord[], time: number) {
  let best = -1; let distance = Infinity;
  words.forEach((word, position) => { const gap = Math.abs(word.start - time); if (gap < distance) { distance = gap; best = position; } });
  return best;
}
export function narrationAround(words: BrollWord[], position: number) {
  return words.slice(Math.max(0, position - 2), position + 8).map((word) => word.text).join(' ').trim().slice(0, 140);
}

export function buildEmotionCue(input: { id: string; emotion: EmotionId; soundId: string; intensity?: SoundIntensity; sourceTime: number; wordId?: string; narration?: string; reason?: string; enabled?: boolean }): EmotionCue {
  const intensity = intensityOf(input.intensity);
  return {
    id: input.id, emotion: input.emotion, soundId: input.soundId, intensity, sourceTime: round(Math.max(0, input.sourceTime)), wordId: input.wordId,
    narration: input.narration ?? '', reason: String(input.reason ?? '').trim().slice(0, 200), enabled: input.enabled !== false, clip: emotionCueClip(input.emotion, input.soundId, intensity),
  };
}

/** Cues come back from disk and from the editor: keep only well-formed ones and recompute their clip so the plan can never drift from the library. */
export function normalizeEmotionCues(raw: unknown): EmotionCue[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_CUES).flatMap((cue: any) => {
    const id = String(cue?.id ?? '');
    if (!/^emo-[\w-]{1,20}$/.test(id) || seen.has(id) || !emotionOf(cue?.emotion) || !MOTION_SOUNDS.some((sound) => sound.id === cue?.soundId) || !Number.isFinite(cue?.sourceTime)) return [];
    seen.add(id);
    return [buildEmotionCue({ ...cue, id, narration: String(cue.narration ?? '').slice(0, 140) })];
  }).sort((a, b) => a.sourceTime - b.sourceTime);
}

export type EmotionEdit = { emotion?: string; soundId?: string; intensity?: string; sourceTime?: number; enabled?: boolean; reason?: string };
/** Apply a user edit. Moving a cue re-anchors it to the nearest spoken word so the narration snippet stays truthful. */
export function editEmotionCue(cue: EmotionCue, patch: EmotionEdit, words: BrollWord[]): EmotionCue {
  const emotion = emotionOf(patch.emotion)?.id ?? cue.emotion;
  const soundId = patch.soundId !== undefined ? motionSound(patch.soundId).id : cue.soundId;
  let { sourceTime, wordId, narration } = cue;
  if (Number.isFinite(patch.sourceTime) && Math.abs(Number(patch.sourceTime) - cue.sourceTime) > 0.0005) {
    sourceTime = Math.max(0, Number(patch.sourceTime)); const at = words.length ? nearestWord(words, sourceTime) : -1;
    if (at >= 0) { wordId = words[at].id; narration = narrationAround(words, at); }
  }
  return buildEmotionCue({ ...cue, emotion, soundId, intensity: patch.intensity !== undefined ? intensityOf(patch.intensity) : cue.intensity, sourceTime, wordId, narration, reason: typeof patch.reason === 'string' ? patch.reason : cue.reason, enabled: typeof patch.enabled === 'boolean' ? patch.enabled : cue.enabled });
}
/**
 * Ids are random, not sequential: the editor remembers the tracks a user deleted by id, so a re-plan that reused `emo-002` for a
 * different sound would stay hidden on the timeline.
 */
export const newEmotionCueId = () => `emo-${randomBytes(4).toString('hex')}`;
export function newEmotionCue(input: { emotion?: string; soundId?: string; intensity?: string; sourceTime: number }, words: BrollWord[]): EmotionCue {
  const emotion = emotionOf(input.emotion) ?? EMOTIONS[0]; const soundId = input.soundId ? motionSound(input.soundId).id : emotion.sounds[0];
  if (!Number.isFinite(input.sourceTime) || input.sourceTime < 0) throw new Error('Choose a time inside the video for the sound');
  const at = words.length ? nearestWord(words, input.sourceTime) : -1;
  return buildEmotionCue({ id: newEmotionCueId(), emotion: emotion.id, soundId, intensity: intensityOf(input.intensity), sourceTime: input.sourceTime, wordId: at >= 0 ? words[at].id : undefined, narration: at >= 0 ? narrationAround(words, at) : '', reason: 'Added by hand' });
}

export type Occupied = { start: number; end: number; label: string };
const INTENSITY_RANK: Record<SoundIntensity, number> = { soft: 0, medium: 1, strong: 2 };

/**
 * Turn the model's picks into a safe plan. Individual cues that break a rule are dropped with a note rather than failing the
 * whole plan; only when nothing usable is left does the caller repair. The rules: one spoken anchor per cue, sounds from the
 * emotion's own palette, clear of graphics that already carry sound, breathing room between beats, no sound twice in a row,
 * and at most `maxBeats` beats (the strongest survive).
 */
export function validateEmotionCues(words: BrollWord[], keepRanges: BrollKeepRange[] | undefined, raw: any, options: { maxBeats: number; graphics: Occupied[] }) {
  const { index, kept } = keptWordIndexes(words, keepRanges); const { times } = keptTimeline(words, keepRanges);
  const notes: string[] = []; const candidates: Array<EmotionCue & { final: number }> = [];
  const picks = Array.isArray(raw?.cues) ? raw.cues : [];
  picks.forEach((pick: any, position: number) => {
    const name = `Sound cue ${position + 1}`; const emotion = emotionOf(pick?.emotion);
    const at = index.get(String(pick?.wordId));
    if (!emotion) return void notes.push(`${name} dropped: “${pick?.emotion}” is not an emotion in the list.`);
    if (at === undefined || !kept.has(at)) return void notes.push(`${name} (${emotion.id}) dropped: ${pick?.wordId} is not a word of the final narration.`);
    if (!emotion.sounds.includes(pick?.soundId)) return void notes.push(`${name} (${emotion.id}) dropped: ${pick?.soundId} is not in the ${emotion.id} palette.`);
    const graphic = options.graphics.find((item) => words[at].start >= item.start - 0.15 && words[at].start <= item.end);
    if (graphic) return void notes.push(`${name} (${emotion.id}) dropped: it lands inside ${graphic.label}, which has its own sound design.`);
    candidates.push({ ...buildEmotionCue({ id: 'emo-0', emotion: emotion.id, soundId: pick.soundId, intensity: pick.intensity, sourceTime: words[at].start, wordId: words[at].id, narration: narrationAround(words, at), reason: String(pick?.reason ?? '') }), final: times.get(at)!.start });
  });
  candidates.sort((a, b) => a.final - b.final || Number(isLeadIn(b.soundId)) - Number(isLeadIn(a.soundId)));

  // A lead-in and a hit on the same word form one "stinger" beat; every other neighbour needs breathing room.
  const groups: Array<Array<EmotionCue & { final: number }>> = [];
  for (const cue of candidates) {
    const group = groups.at(-1); const head = group?.[0];
    if (group && head && cue.wordId === head.wordId && group.length === 1 && isLeadIn(head.soundId) && !isLeadIn(cue.soundId)) { group.push(cue); continue; }
    if (head && cue.final - head.final < MIN_BEAT_GAP_SECONDS) { notes.push(`Dropped ${cue.emotion} at ${cue.final.toFixed(1)}s: it is within ${MIN_BEAT_GAP_SECONDS}s of another sound beat.`); continue; }
    groups.push([cue]);
  }
  if (groups.length > options.maxBeats) {
    const keep = new Set([...groups].sort((a, b) => Math.max(...b.map((cue) => INTENSITY_RANK[cue.intensity])) - Math.max(...a.map((cue) => INTENSITY_RANK[cue.intensity])) || a[0].final - b[0].final).slice(0, options.maxBeats));
    notes.push(`Kept the ${options.maxBeats} strongest of ${groups.length} sound beats to respect the density setting.`);
    groups.splice(0, groups.length, ...groups.filter((group) => keep.has(group)));
  }

  // Never the same sound on consecutive beats: swap in an unused sound from the same palette.
  const used = new Map<string, number>(); let previous = '';
  const cues = groups.flat().map((cue) => {
    let soundId = cue.soundId;
    if (soundId === previous) {
      const palette = emotionOf(cue.emotion)!.sounds.filter((id) => id !== previous && isLeadIn(id) === isLeadIn(soundId));
      soundId = [...palette].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0] ?? soundId;
    }
    used.set(soundId, (used.get(soundId) ?? 0) + 1); previous = soundId;
    return buildEmotionCue({ ...cue, soundId, id: newEmotionCueId() });
  });
  return { cues, notes, returned: picks.length };
}

const cueSchema = {
  type: 'object', additionalProperties: false, required: ['cues', 'notes'], properties: {
    cues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['emotion', 'wordId', 'soundId', 'intensity', 'reason'], properties: {
      emotion: { type: 'string', enum: EMOTION_IDS }, wordId: { type: 'string' }, soundId: { type: 'string', enum: MOTION_SOUNDS.map((sound) => sound.id) },
      intensity: { type: 'string', enum: SOUND_INTENSITIES }, reason: { type: 'string' },
    } } },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

function paletteLine(soundId: string) {
  const sound = motionSound(soundId); const lead = Math.min(sound.peakTime ?? 0, MAX_LEAD_SECONDS);
  return `    ${sound.id} (${sound.label}, ${sound.duration.toFixed(1)}s${isLeadIn(soundId) ? `, ↗ builds for ${lead.toFixed(1)}s and hits on the word` : ''})`;
}

/** Readable narration for the model: one line per phrase, each word tagged with its ID, pauses called out (reveals land right after a breath). */
function narrationForPrompt(words: BrollWord[], keepRanges: BrollKeepRange[] | undefined) {
  const { kept } = keptWordIndexes(words, keepRanges); const { times } = keptTimeline(words, keepRanges);
  const lines: string[] = []; let line: string[] = []; let lineStart = 0; let linePause = 0; let pending = 0; let lastEnd = -1; let lastText = '';
  const flush = () => { if (line.length) lines.push(`[${lineStart.toFixed(1)}s]${linePause >= 0.5 ? ` ⏸ ${linePause.toFixed(1)}s pause` : ''} ${line.join(' ')}`); line = []; };
  words.forEach((word, position) => {
    if (!kept.has(position)) return;
    const time = times.get(position)!; const gap = lastEnd < 0 ? 0 : time.start - lastEnd;
    if (line.length && (gap >= 0.5 || /[.!?…।]$/.test(lastText))) { flush(); pending = gap; }
    if (!line.length) { lineStart = time.start; linePause = pending; pending = 0; }
    line.push(`${word.id}:${word.text}`); lastEnd = time.end; lastText = word.text;
  });
  flush();
  return lines.join('\n');
}

export async function createEmotionCues(options: {
  textConfig: TextModelConfig; workDir: string; choice: TextModelChoice; words: BrollWord[]; keepRanges?: BrollKeepRange[];
  orientation: 'portrait' | 'landscape'; density: EmotionDensity; graphics: Occupied[];
}) {
  const { words, keepRanges, choice, workDir } = options;
  const { duration } = keptTimeline(words, keepRanges);
  const maxBeats = Math.max(1, Math.round(duration / 60 * EMOTION_DENSITIES[options.density].perMinute));
  const palettes = EMOTIONS.map((emotion) => `${emotion.id} — ${emotion.label}: ${emotion.cue}\n  Sounds:\n${emotion.sounds.map(paletteLine).join('\n')}`).join('\n\n');
  const graphics = options.graphics.length ? options.graphics.map((item) => `- ${item.label}: source ${item.start.toFixed(2)}s–${item.end.toFixed(2)}s`).join('\n') : '(none)';
  const frame = options.orientation === 'portrait' ? 'vertical short-form video' : 'landscape video';
  const prompt = `You are the sound designer for a premium talking-head ${frame}. Read the narration the way a film editor does and place sound effects on its EMOTIONAL beats — the moments a viewer should feel something: shock, suspense, sadness, joy, an idea clicking, a warning, relief. Well-placed sound makes the edit feel professional; sound on every sentence makes it feel cheap.\n\nEMOTIONS AND THEIR SOUND PALETTES (each cue must use a sound from its own emotion's palette)\n${palettes}\n\nCRAFT RULES\n- Restraint. At most ${maxBeats} beats for this ${Math.round(duration)}s video — fewer is better than filler. Only mark a moment when the words genuinely carry the emotion. Leave at least ${MIN_BEAT_GAP_SECONDS}s between beats; let silence work.\n- Judge emotion from meaning, in whatever language the narration uses (it may be Malayalam, English or mixed).\n- Anchor each cue on ONE wordId: the sound's hit lands as that word begins. Pick the word that carries the feeling — the number, the reversal, the painful noun — not the first word of the sentence out of habit. A pause marker means the speaker took a breath: reveals land right after one.\n- Sounds marked ↗ build up TO the anchor word, so they need that much room before it. Use them for suspense and for reveals, never over the middle of a phrase.\n- Stinger: for the single biggest twist you may pair ONE ↗ suspense build with ONE hit (shock or warning) on the SAME wordId. That counts as one beat. Use it at most once.\n- Vary the sounds; never repeat a soundId back to back, and prefer not to reuse one at all.\n- intensity: soft for gentle beats, medium for most, strong for the one biggest moment only.\n- reason: one short sentence — what the viewer should feel and why this word.\n- These passages already have animated graphics with their own sound design; do NOT place cues inside them:\n${graphics}\n- Use only the wordIds below. If the narration has no strong emotional beats, return an empty cues array and say why in notes.\n\nNARRATION (final edit; times are seconds on the finished timeline; each word is id:text):\n${narrationForPrompt(words, keepRanges)}`;

  let attemptPrompt = prompt; let lastIssues: string[] = []; let result: ReturnType<typeof validateEmotionCues> | null = null; let modelNotes: string[] = [];
  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS && !result; attempt += 1) {
    let raw: any = null;
    try { raw = await generateStructuredText({ config: options.textConfig, choice, workDir, prompt: attemptPrompt, schema: cueSchema, outputName: 'emotion-sound-plan' }); }
    catch (error) { lastIssues = [`The sound plan failed: ${error instanceof Error ? error.message : String(error)}`]; }
    if (raw) {
      const checked = validateEmotionCues(words, keepRanges, raw, { maxBeats, graphics: options.graphics });
      if (checked.cues.length || !checked.returned) { result = checked; modelNotes = Array.isArray(raw.notes) ? raw.notes.map((note: unknown) => String(note)) : []; }
      else lastIssues = checked.notes;
    }
    if (!result && attempt < MAX_PLAN_ATTEMPTS) attemptPrompt = `${prompt}\n\nREPAIR PASS ${attempt} OF ${MAX_PLAN_ATTEMPTS - 1}\nNone of the previous cues could be used. Return a complete replacement and fix every issue:\n${lastIssues.map((issue, position) => `${position + 1}. ${issue}`).join('\n')}\n\nPREVIOUS RESPONSE:\n${raw ? JSON.stringify(raw, null, 2) : '(unparseable response)'}`;
  }
  if (!result) {
    const logPath = await writePlanningFailureLog(workDir, 'emotion-sound-plan', choice, MAX_PLAN_ATTEMPTS, lastIssues);
    throw new Error(`${planningModelLabel(choice)} could not produce a usable sound plan after ${MAX_PLAN_ATTEMPTS} attempts.${logPath ? ` Diagnostic log: ${logPath}` : ''}\nRemaining issues:\n${lastIssues.map((issue) => `- ${issue}`).join('\n')}`);
  }
  const notes = [...modelNotes, ...result.notes];
  if (!result.cues.length) notes.unshift('No strong emotional beats were found, so no emotion sounds were added.');
  return { cues: result.cues, notes };
}
