import { colorVideoFilter, type ColorProfile } from './color.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type BrollWord = { id: string; text: string; start: number; end: number };
export type BrollKeepRange = { startWordId: string; endWordId: string };
export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';
export type VideoProvider = 'grok-cli' | 'google-flow' | 'magnific';
export type BrollWorkflowMode = 'cleaned-video' | 'raw-video' | 'assets-only';
export type BrollCountMode = 'auto' | 'exact' | 'per-minute' | 'interval';
export type BrollAssetAspectRatio = 'auto' | '9:16' | '16:9';
export type BrollBeatType = 'hook' | 'problem' | 'cause' | 'anatomy' | 'progression' | 'solution' | 'prevention' | 'cta' | 'supporting';
export type BrollVisualMode = 'hyperreal-clinical' | 'educational-3d' | 'anatomy-cutaway' | 'procedure-closeup' | 'symbolic-medical' | 'clinic-support';
export type BrollAnimationPlan = {
  motionType: string;
  cameraMove: string;
  subjectMotion: string;
  revealSequence: string[];
  highlightTargets: string[];
  avoidMotion: string[];
};
export type BrollDisplayTemplate = 'full-frame' | 'top-card' | 'split-top' | 'picture-in-picture' | 'top-card-presenter' | 'presenter-overlay' | 'stacked-cards-cutout' | 'stacked-talking-top' | 'stacked-broll-top';

export const BROLL_DISPLAY_TEMPLATES: Array<{ id: BrollDisplayTemplate; label: string; needsPresenterMatte: boolean }> = [
  { id: 'full-frame', label: 'Full-screen B-roll', needsPresenterMatte: false },
  { id: 'top-card', label: 'Top B-roll card', needsPresenterMatte: false },
  { id: 'split-top', label: 'Top split', needsPresenterMatte: false },
  { id: 'picture-in-picture', label: 'Picture in picture', needsPresenterMatte: false },
  { id: 'top-card-presenter', label: 'Top card + presenter cutout', needsPresenterMatte: true },
  { id: 'presenter-overlay', label: 'B-roll background + presenter cutout', needsPresenterMatte: true },
  { id: 'stacked-cards-cutout', label: 'Stacked reel cards + presenter cutout', needsPresenterMatte: true },
  { id: 'stacked-talking-top', label: 'Talking head top + B-roll bottom', needsPresenterMatte: false },
  { id: 'stacked-broll-top', label: 'B-roll top + talking head bottom', needsPresenterMatte: false },
];

export type BrollPlanSettings = {
  workflowMode: BrollWorkflowMode;
  provider: ImageProvider;
  videoProvider: VideoProvider;
  countMode: BrollCountMode;
  targetCount: number;
  imagesPerMinute: number;
  intervalSeconds: number;
  minSceneDuration: number;
  maxSceneDuration: number;
  aspectRatio: 'auto' | '9:16' | '16:9';
  displayTemplate: BrollDisplayTemplate;
  returnVideoWithAudio: boolean;
};

export type BrollVideoAttempt = {
  id: string;
  source: 'google-flow' | 'grok-cli' | 'magnific' | 'manual' | 'flow-catalog';
  status: 'submitted' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  model?: string;
  prompt?: string;
  localFile?: string;
  flowProjectId?: string;
  flowMediaId?: string;
  flowWorkflowId?: string;
  error?: string;
  errorLogFile?: string;
  sourceImageRevision?: number;
};

export type GoogleFlowProjectState = {
  projectId: string;
  title: string;
  profile: string;
  url: string;
  createdAt: string;
  lastSyncedAt?: string;
};

export type GoogleFlowCatalogVideo = {
  mediaId: string;
  projectId: string;
  prompt: string;
  aspect?: string;
  model?: string;
  duration?: number;
  createdAt?: string;
  localPath?: string;
};

export type BrollScene = {
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number;
  narration: string; visualIntent: string; shotType: string; imagePrompt: string; videoPrompt?: string; enabled: boolean;
  beatType?: BrollBeatType; keyPoint?: string; whyThisVisualMatters?: string; viewerTakeaway?: string; visualMode?: BrollVisualMode; animationPlan?: BrollAnimationPlan;
  imageFile?: string; generatedAt?: string; provider?: ImageProvider | 'manual'; model?: string; imageRevision?: number;
  videoFile?: string; videoGeneratedAt?: string; videoModel?: string; videoProvider?: VideoProvider;
  videoAttempts?: BrollVideoAttempt[]; activeVideoAttemptId?: string; videoSourceImageRevision?: number; videoStatus?: 'none' | 'stale' | 'generating' | 'ready';
  displayTemplate?: BrollDisplayTemplate;
  assetAspectRatio?: BrollAssetAspectRatio;
  generatedAspectRatio?: Exclude<BrollAssetAspectRatio, 'auto'>;
  orientationChanged?: boolean;
};

export type BrollPlan = { version: 2; orientation: 'portrait' | 'landscape'; stylePreset: string; settings: BrollPlanSettings; scenes: BrollScene[]; notes: string[]; googleFlow?: GoogleFlowProjectState };
export type ImageProviderConfig = { openAiApiKey?: string; openAiModel?: string; geminiApiKey?: string; geminiModel?: string; grokBin?: string; grokModel?: string; grokVideoModel?: string; gflowBin?: string; gflowProfile?: string; gflowVideoModel?: string; magnificApiKey?: string; magnificVideoModel?: string; magnificVideoEndpoint?: string; magnificFetch?: typeof fetch; magnificPollIntervalMs?: number; magnificTimeoutMs?: number; codexBin?: string; ffmpegBin?: string };
type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };

export const BROLL_STYLE_PRESET = [
  'Story-first B-roll: every visual must earn its place by clarifying, advancing or emotionally supporting the exact spoken idea. Never create filler just to satisfy a B-roll count.',
  'Use a deliberate mix of visual languages instead of forcing one look on every scene. Choose realistic live-action only when a real person, visible symptom, consultation, environment or tangible action carries the story; use educational 3D, anatomical cutaways, procedure closeups or symbolic medical visuals when explaining mechanisms, progression, treatment or prevention.',
  'For educational/scientific scenes, create polished clinically believable 3D visualization with readable anatomy, clear spatial relationships, clean depth layers and premium soft lighting. Make the concept understandable at a glance without labels.',
  'For hyper-real clinical scenes, use authentic premium documentary-style photography with believable people and environments, natural skin/teeth/hands, realistic materials and restrained cinematic lighting. Do not add people merely to make a scene look cinematic.',
  'Compose the image as the FIRST FRAME of a short image-to-video story: one dominant idea, visually separable foreground/midground/background elements, clean negative space, no baked-in motion blur, and obvious opportunities for reveal, progression, highlighting, object movement or camera movement.',
  'Keep the essential subject and action inside the social-video safe area. Prefer close, readable compositions over wide generic scenes.',
  'No text, captions, typography, labels, logos, watermarks, UI, borders, multi-panel layouts, collages, poster design or infographic cards.',
  'Do not introduce unrelated procedures, products, anatomy or claims. Adjacent B-roll scenes should feel like consecutive visual chapters rather than repeated variants of the same image.',
  'Avoid gore, horror aesthetics, impossible anatomy, malformed teeth/hands, duplicated tools, decorative sci-fi effects, plastic skin, stock-photo posing, excessive beauty retouching and obviously AI-generated details.',
].join(' ');

export const MIN_BROLL_GAP_SECONDS = 5;
const MAX_BROLL_PLAN_ATTEMPTS = 4;

class BrollPlanValidationError extends Error {
  constructor(readonly issues: string[]) { super(issues.join('\n')); this.name = 'BrollPlanValidationError'; }
}

async function run(command: string, args: string[], stdin?: string, timeoutMs = 0, options?: RunOptions) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, cwd: options?.cwd, env: options?.env }); let stdout = ''; let stderr = ''; let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString())); child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`)); });
    child.stdin.end(stdin ?? '');
  });
}

function allWordsRange(words: BrollWord[]): BrollKeepRange[] { return words.length ? [{ startWordId: words[0].id, endWordId: words.at(-1)!.id }] : []; }
function keptWordIndexes(words: BrollWord[], ranges?: BrollKeepRange[]) {
  const activeRanges = ranges?.length ? ranges : allWordsRange(words); const index = new Map(words.map((word, position) => [word.id, position])); const kept = new Set<number>();
  for (const range of activeRanges) { const start = index.get(range.startWordId); const end = index.get(range.endWordId); if (start === undefined || end === undefined || start > end) continue; for (let position = start; position <= end; position += 1) kept.add(position); }
  return { index, kept, activeRanges };
}
function keptTimeline(words: BrollWord[], ranges?: BrollKeepRange[]) {
  const { index, activeRanges } = keptWordIndexes(words, ranges);
  const times = new Map<number, { start: number; end: number }>();
  let cursor = 0;
  for (const range of activeRanges) {
    const start = index.get(range.startWordId); const end = index.get(range.endWordId);
    if (start === undefined || end === undefined || start > end) continue;
    const rangeSourceStart = words[start].start;
    for (let position = start; position <= end; position += 1) times.set(position, { start: cursor + words[position].start - rangeSourceStart, end: cursor + words[position].end - rangeSourceStart });
    cursor += Math.max(0, words[end].end - rangeSourceStart);
  }
  return { times, duration: cursor };
}
function targetSceneCount(words: BrollWord[], ranges: BrollKeepRange[] | undefined, settings: BrollPlanSettings) {
  if (settings.countMode === 'exact') return Math.max(1, Math.min(40, Math.round(settings.targetCount || 1)));
  if (settings.countMode !== 'per-minute' && settings.countMode !== 'interval') return 0;
  const { duration } = keptTimeline(words, ranges);
  if (!duration) return 0;
  if (settings.countMode === 'interval') return Math.max(1, Math.ceil(duration / settings.intervalSeconds));
  return Math.max(1, Math.min(40, Math.round(duration / 60 * Math.max(0.5, settings.imagesPerMinute || 4))));
}
const BROLL_BEAT_TYPES: BrollBeatType[] = ['hook', 'problem', 'cause', 'anatomy', 'progression', 'solution', 'prevention', 'cta', 'supporting'];
const BROLL_VISUAL_MODES: BrollVisualMode[] = ['hyperreal-clinical', 'educational-3d', 'anatomy-cutaway', 'procedure-closeup', 'symbolic-medical', 'clinic-support'];

type PlannedStoryBeat = {
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number; narration: string;
  beatType: BrollBeatType; keyPoint: string; whyThisVisualMatters: string; viewerTakeaway: string; visualMode: BrollVisualMode; visualIntent: string; shotType: string;
};

function storyPlanSchema(exactCount = 0) {
  return {
    type: 'object', additionalProperties: false, required: ['scenes', 'notes'], properties: {
      scenes: {
        type: 'array', ...(exactCount ? { minItems: exactCount, maxItems: exactCount } : {}),
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'title', 'startWordId', 'endWordId', 'beatType', 'keyPoint', 'whyThisVisualMatters', 'viewerTakeaway', 'visualMode', 'visualIntent', 'shotType'],
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, startWordId: { type: 'string' }, endWordId: { type: 'string' },
            beatType: { type: 'string', enum: BROLL_BEAT_TYPES }, keyPoint: { type: 'string' }, whyThisVisualMatters: { type: 'string' }, viewerTakeaway: { type: 'string' },
            visualMode: { type: 'string', enum: BROLL_VISUAL_MODES }, visualIntent: { type: 'string' }, shotType: { type: 'string' },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
  };
}
function visualPlanSchema(exactCount: number) {
  return {
    type: 'object', additionalProperties: false, required: ['scenes'], properties: {
      scenes: {
        type: 'array', minItems: exactCount, maxItems: exactCount,
        items: { type: 'object', additionalProperties: false, required: ['id', 'imagePrompt'], properties: { id: { type: 'string' }, imagePrompt: { type: 'string' } } },
      },
    },
  };
}
function normalizeBeatType(value: unknown): BrollBeatType { const candidate = String(value || 'supporting') as BrollBeatType; return BROLL_BEAT_TYPES.includes(candidate) ? candidate : 'supporting'; }
function normalizeVisualMode(value: unknown): BrollVisualMode { const candidate = String(value || 'educational-3d') as BrollVisualMode; return BROLL_VISUAL_MODES.includes(candidate) ? candidate : 'educational-3d'; }
function normalizeDisplayTemplate(value: unknown): BrollDisplayTemplate {
  const candidate = String(value || 'full-frame') as BrollDisplayTemplate;
  return BROLL_DISPLAY_TEMPLATES.some((template) => template.id === candidate) ? candidate : 'full-frame';
}
function normalizeSettings(raw: Partial<BrollPlanSettings> | undefined): BrollPlanSettings {
  const workflowMode: BrollWorkflowMode = ['cleaned-video', 'raw-video', 'assets-only'].includes(String(raw?.workflowMode)) ? raw!.workflowMode as BrollWorkflowMode : 'cleaned-video';
  const provider: ImageProvider = ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(raw?.provider)) ? raw!.provider as ImageProvider : 'gemini';
  const videoProvider: VideoProvider = ['grok-cli', 'google-flow', 'magnific'].includes(String(raw?.videoProvider)) ? raw!.videoProvider as VideoProvider : 'grok-cli';
  const countMode: BrollCountMode = ['auto', 'exact', 'per-minute', 'interval'].includes(String(raw?.countMode)) ? raw!.countMode as BrollCountMode : 'auto';
  const aspectRatio = ['auto', '9:16', '16:9'].includes(String(raw?.aspectRatio)) ? raw!.aspectRatio as BrollPlanSettings['aspectRatio'] : 'auto';
  return { workflowMode, provider, videoProvider, countMode, targetCount: Math.max(1, Math.min(40, Number(raw?.targetCount) || 6)), imagesPerMinute: Math.max(0.5, Math.min(20, Number(raw?.imagesPerMinute) || 5)), intervalSeconds: Math.max(10, Math.min(300, Number(raw?.intervalSeconds) || 20)), minSceneDuration: Math.max(1, Math.min(20, Number(raw?.minSceneDuration) || 3)), maxSceneDuration: Math.max(2, Math.min(30, Number(raw?.maxSceneDuration) || 8)), aspectRatio, displayTemplate: normalizeDisplayTemplate(raw?.displayTemplate), returnVideoWithAudio: raw?.returnVideoWithAudio === true };
}
function validateStoryPlan(words: BrollWord[], keepRanges: BrollKeepRange[] | undefined, raw: any, settings: BrollPlanSettings) {
  const { index, kept } = keptWordIndexes(words, keepRanges); const { times } = keptTimeline(words, keepRanges);
  const beats: PlannedStoryBeat[] = []; const issues: string[] = []; let previousStart = -1; let previousTimelineEnd = -1; let previousLabel = '';
  if (!Array.isArray(raw?.scenes)) issues.push('The response does not contain a scenes array.');
  for (const [candidateIndex, candidate] of (Array.isArray(raw?.scenes) ? raw.scenes : []).entries()) {
    const label = String(candidate?.id || `scene at array position ${candidateIndex + 1}`); const start = index.get(candidate?.startWordId); const end = index.get(candidate?.endWordId);
    if (start === undefined || end === undefined) { issues.push(`${label} uses a word ID that is not in the supplied narration.`); continue; }
    if (start > end) { issues.push(`${label} ends before it starts.`); continue; }
    if (!kept.has(start) || !kept.has(end)) { issues.push(`${label} uses words removed from the final narration.`); continue; }
    if (start < previousStart) { issues.push(`${label} is out of chronological order.`); continue; }
    const narrationWords: string[] = []; for (let position = start; position <= end; position += 1) if (kept.has(position)) narrationWords.push(words[position].text);
    const timelineStart = times.get(start)?.start; const timelineEnd = times.get(end)?.end;
    if (!narrationWords.length) { issues.push(`${label} has no kept narration words.`); continue; }
    if (timelineStart === undefined || timelineEnd === undefined) { issues.push(`${label} cannot be mapped to the final narration timeline.`); continue; }
    if (beats.length) {
      const gap = timelineStart - previousTimelineEnd;
      if (gap < MIN_BROLL_GAP_SECONDS) issues.push(`${label} starts only ${gap.toFixed(2)} seconds after ${previousLabel} ends on the final narration timeline; at least ${MIN_BROLL_GAP_SECONDS.toFixed(2)} seconds is required.`);
    }
    const keyPoint = String(candidate?.keyPoint ?? '').trim(); const whyThisVisualMatters = String(candidate?.whyThisVisualMatters ?? '').trim(); const viewerTakeaway = String(candidate?.viewerTakeaway ?? '').trim();
    if (keyPoint.length < 8) issues.push(`${label} is missing a useful keyPoint.`);
    if (whyThisVisualMatters.length < 12) issues.push(`${label} does not explain why the visual earns its place.`);
    if (viewerTakeaway.length < 8) issues.push(`${label} is missing a viewer takeaway.`);
    const sceneNumber = beats.length + 1;
    beats.push({
      id: `scene-${String(sceneNumber).padStart(3, '0')}`, title: String(candidate?.title ?? `Scene ${sceneNumber}`).trim().slice(0, 100) || `Scene ${sceneNumber}`,
      startWordId: words[start].id, endWordId: words[end].id, sourceStart: words[start].start, sourceEnd: words[end].end, narration: narrationWords.join(' '),
      beatType: normalizeBeatType(candidate?.beatType), keyPoint, whyThisVisualMatters, viewerTakeaway, visualMode: normalizeVisualMode(candidate?.visualMode),
      visualIntent: String(candidate?.visualIntent ?? '').trim(), shotType: String(candidate?.shotType ?? '').trim(),
    });
    previousStart = start; previousTimelineEnd = timelineEnd; previousLabel = label;
  }
  const expected = targetSceneCount(words, keepRanges, settings);
  if (!beats.length) issues.push('The response contains no valid B-roll story beats.');
  else if (expected && beats.length !== expected) issues.push(`The response contains ${beats.length} valid beats, but exactly ${expected} are required.`);
  if (issues.length) throw new BrollPlanValidationError(issues);
  return { beats, notes: Array.isArray(raw?.notes) ? raw.notes.map((note: unknown) => String(note)) : [] };
}
async function createVisualPlan(options: { codexBin: string; workDir: string; beats: PlannedStoryBeat[]; targetAspect: string }) {
  const schemaPath = path.join(options.workDir, 'broll-visual-plan.schema.json'); const outputPath = path.join(options.workDir, 'codex-broll-visual-plan.json');
  await fs.writeFile(schemaPath, JSON.stringify(visualPlanSchema(options.beats.length), null, 2));
  const beatPayload = options.beats.map((beat) => ({
    id: beat.id, narration: beat.narration, beatType: beat.beatType, keyPoint: beat.keyPoint, whyThisVisualMatters: beat.whyThisVisualMatters,
    viewerTakeaway: beat.viewerTakeaway, visualMode: beat.visualMode, visualIntent: beat.visualIntent, shotType: beat.shotType,
  }));
  const basePrompt = `You are the visual-development director for a premium talking-head story. The story editor has already selected the B-roll beats. Your job is to write the strongest possible STARTING-FRAME image prompt for each beat.\n\nDo not add, remove, merge or reorder beats. Return exactly one prompt for every supplied id.\n\nTARGET FRAME: ${options.targetAspect}.\n\nGLOBAL STORYTELLING BAR:\n${BROLL_STYLE_PRESET}\n\nVISUAL MODE RULES:\n- hyperreal-clinical: premium documentary/live-action realism only when a real person, visible symptom, consultation, environment or tangible action is essential to the spoken idea. Natural people; never generic stock posing.\n- educational-3d: polished cinematic 3D/scientific visualization for mechanisms, concepts, progression, prevention or treatment logic.\n- anatomy-cutaway: anatomically plausible sectional/cutaway view that clearly exposes the internal relationship being explained.\n- procedure-closeup: precise close or macro view of a treatment/action/tool interacting with the relevant structure; clinically plausible, clean and non-gory.\n- symbolic-medical: simple premium object-based metaphor for an abstract point such as timing, prevention, protection, risk or recurrence; still grounded in the narration.\n- clinic-support: realistic environment/detail shot only when the clinic, appointment, equipment or consultation itself is part of the story; never use this as filler.\n\nEvery imagePrompt must describe ONE coherent frame, not a collage or infographic. It must be animation-ready: clear depth layers, separated movable elements, readable subject, clean background, no baked-in motion blur. Do not include text, labels, arrows with words, logos, watermarks or poster layouts. The prompt must directly express the key point and viewer takeaway; do not introduce unrelated topics.\n\nSTORY BEATS:\n${JSON.stringify(beatPayload, null, 2)}`;
  let attemptPrompt = basePrompt; let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await run(options.codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], attemptPrompt);
    let raw: any;
    try { raw = JSON.parse(await fs.readFile(outputPath, 'utf8')); } catch (error) { raw = null; lastIssues = [`Visual plan was not valid JSON: ${error instanceof Error ? error.message : String(error)}`]; }
    if (raw?.scenes && Array.isArray(raw.scenes)) {
      const byId = new Map<string, string>(); const issues: string[] = [];
      for (const scene of raw.scenes) {
        const id = String(scene?.id ?? ''); const imagePrompt = String(scene?.imagePrompt ?? '').trim();
        if (!options.beats.some((beat) => beat.id === id)) { issues.push(`Unknown visual-plan id ${id || '(blank)'}.`); continue; }
        if (byId.has(id)) { issues.push(`Duplicate visual-plan id ${id}.`); continue; }
        if (imagePrompt.length < 80) { issues.push(`${id} has an incomplete image prompt (${imagePrompt.length} characters).`); continue; }
        byId.set(id, imagePrompt);
      }
      for (const beat of options.beats) if (!byId.has(beat.id)) issues.push(`Missing image prompt for ${beat.id}.`);
      if (!issues.length) return options.beats.map((beat): BrollScene => ({ ...beat, imagePrompt: byId.get(beat.id)!, enabled: true }));
      lastIssues = issues;
    }
    if (attempt < 3) attemptPrompt = `${basePrompt}\n\nREPAIR THE VISUAL PLAN. Return a complete replacement for all beats. Fix every issue:\n${lastIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\\n')}`;
  }
  throw new Error(`Codex could not produce a complete visual plan. Remaining issues:\n${lastIssues.map((issue) => `- ${issue}`).join('\\n')}`);
}

export async function createBrollPlan(options: { codexBin: string; workDir: string; words: BrollWord[]; keepRanges?: BrollKeepRange[]; orientation: 'portrait' | 'landscape'; settings?: Partial<BrollPlanSettings> }) {
  const settings = normalizeSettings(options.settings); const { codexBin, workDir, words, keepRanges, orientation } = options; const { kept } = keptWordIndexes(words, keepRanges);
  const { times } = keptTimeline(words, keepRanges);
  const transcript = words.map((word, index) => ({ word, index })).filter(({ index }) => kept.has(index)).map(({ word, index }) => { const timeline = times.get(index)!; return `[${word.id} source:${word.start.toFixed(3)}-${word.end.toFixed(3)} final:${timeline.start.toFixed(3)}-${timeline.end.toFixed(3)}] ${word.text}`; }).join('\\n');
  const requestedCount = targetSceneCount(words, keepRanges, settings); const schemaPath = path.join(workDir, 'broll-story-plan.schema.json'); const outputPath = path.join(workDir, 'codex-broll-story-plan.json');
  await fs.writeFile(schemaPath, JSON.stringify(storyPlanSchema(requestedCount), null, 2));
  const targetAspect = settings.aspectRatio === 'auto' ? (orientation === 'portrait' ? 'vertical 9:16' : 'landscape 16:9') : settings.aspectRatio;
  const intervalDurationLimit = settings.countMode === 'interval' ? settings.intervalSeconds - MIN_BROLL_GAP_SECONDS : settings.maxSceneDuration;
  const plannedMaxDuration = Math.min(settings.maxSceneDuration, intervalDurationLimit); const plannedMinDuration = Math.min(settings.minSceneDuration, plannedMaxDuration);
  const countInstruction = requestedCount ? `Create exactly ${requestedCount} B-roll story beats.` : `Choose only the strongest story beats automatically. Fewer meaningful visuals are better than filler.`;
  const cadenceInstruction = settings.countMode === 'interval'
    ? `Aim for approximately one beat in every ${settings.intervalSeconds}-second section, but choose the most meaningful spoken idea in that section rather than generic filler.`
    : 'Distribute beats across the narration according to narrative value. Do not bunch them together and do not illustrate every sentence.';
  const prompt = `You are the story editor for a polished talking-head video. Decide WHERE B-roll genuinely improves understanding or storytelling before anyone writes image prompts.\n\n${countInstruction}\n${cadenceInstruction}\n\nHARD SCHEDULING RULE: after one B-roll ends, leave at least ${MIN_BROLL_GAP_SECONDS} full seconds of uninterrupted talking-head footage before the next B-roll starts. This is an end-to-next-start gap, not a start-to-start gap. Never overlap or place B-roll scenes back-to-back. Measure gaps using the final timestamps supplied for each word.\n\nAnalyze ONLY the supplied narration. Identify the key story progression: hook, problem, cause, anatomy/mechanism, progression/consequence, solution, prevention, CTA or a genuinely useful supporting beat. Each chosen beat must add new information or emotional clarity. Reject decorative scenes that merely show a generic clinic, smiling person, doctor, tool or object without helping the viewer understand the current sentence.\n\nFor every beat explain:\n- keyPoint: the single spoken idea this visual must communicate.\n- whyThisVisualMatters: why cutting away from the talking head is worth it here.\n- viewerTakeaway: what the viewer should understand after seeing it.\n- visualMode: select the best storytelling language. Use hyperreal-clinical only when real-world human/environment realism carries the idea. Prefer educational-3d/anatomy-cutaway/procedure-closeup for internal mechanisms and treatment logic; symbolic-medical for abstract ideas; clinic-support only when the clinic itself matters.\n\nTARGET FRAME: ${targetAspect}.\nTARGET B-ROLL DURATION: normally ${plannedMinDuration}-${plannedMaxDuration} seconds.\n\nDo NOT write image prompts yet. This pass is only story structure and visual strategy. Every scene must use supplied word IDs and stay chronological.\n\nNARRATION WORDS:\n${transcript}`;
  let attemptPrompt = prompt; let lastIssues: string[] = []; let story: { beats: PlannedStoryBeat[]; notes: string[] } | null = null;
  for (let attempt = 1; attempt <= MAX_BROLL_PLAN_ATTEMPTS; attempt += 1) {
    await run(codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], attemptPrompt);
    let raw: any;
    try { raw = JSON.parse(await fs.readFile(outputPath, 'utf8')); } catch (error) { raw = null; lastIssues = [`The story plan was not valid JSON: ${error instanceof Error ? error.message : String(error)}`]; }
    if (raw) {
      try { story = validateStoryPlan(words, keepRanges, raw, settings); break; }
      catch (error) { if (!(error instanceof BrollPlanValidationError)) throw error; lastIssues = error.issues; }
    }
    if (attempt < MAX_BROLL_PLAN_ATTEMPTS) {
      const previousPlan = raw ? JSON.stringify(raw, null, 2) : '(unparseable response)';
      attemptPrompt = `${prompt}\n\nREPAIR PASS ${attempt} OF ${MAX_BROLL_PLAN_ATTEMPTS - 1}\nThe previous story plan failed validation. Return a complete replacement plan. Correct every issue while keeping only strong storytelling beats.\n\nALL VALIDATION ISSUES:\n${lastIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\\n')}\n\nPREVIOUS STORY PLAN:\n${previousPlan}`;
    }
  }
  if (!story) throw new Error(`Codex could not produce a valid B-roll story plan after ${MAX_BROLL_PLAN_ATTEMPTS} attempts. Remaining issues:\n${lastIssues.map((issue) => `- ${issue}`).join('\\n')}`);
  const scenes = await createVisualPlan({ codexBin, workDir, beats: story.beats, targetAspect });
  const plan: BrollPlan = { version: 2, orientation, stylePreset: BROLL_STYLE_PRESET, settings, scenes, notes: story.notes };
  await saveBrollPlan(workDir, plan); return plan;
}

export async function saveBrollPlan(workDir: string, plan: BrollPlan) { await fs.mkdir(path.join(workDir, 'broll'), { recursive: true }); await fs.writeFile(path.join(workDir, 'broll-plan.json'), JSON.stringify(plan, null, 2)); }
export async function loadBrollPlan(workDir: string): Promise<BrollPlan | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(workDir, 'broll-plan.json'), 'utf8')) as BrollPlan;
    if (raw.version !== 2) return null;
    raw.settings = normalizeSettings(raw.settings);
    if (raw.googleFlow?.projectId) raw.googleFlow.url = flowProjectUrl(raw.googleFlow.projectId);
    for (const scene of raw.scenes ?? []) {
      if (scene.beatType) scene.beatType = normalizeBeatType(scene.beatType);
      if (scene.visualMode) scene.visualMode = normalizeVisualMode(scene.visualMode);
      if (scene.displayTemplate && !BROLL_DISPLAY_TEMPLATES.some((template) => template.id === scene.displayTemplate)) delete scene.displayTemplate;
      if (scene.assetAspectRatio && !['auto', '9:16', '16:9'].includes(scene.assetAspectRatio)) delete scene.assetAspectRatio;
      if (scene.generatedAspectRatio && !['9:16', '16:9'].includes(scene.generatedAspectRatio)) delete scene.generatedAspectRatio;
      if (scene.imageFile && !scene.generatedAspectRatio) scene.generatedAspectRatio = resolveSceneAssetAspect(raw, scene);
      scene.orientationChanged = Boolean(scene.imageFile && scene.generatedAspectRatio !== resolveSceneAssetAspect(raw, scene));
      scene.imageRevision = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
      scene.videoAttempts = Array.isArray(scene.videoAttempts) ? scene.videoAttempts : [];
      if (scene.videoFile && scene.videoSourceImageRevision === undefined) scene.videoSourceImageRevision = scene.imageRevision;
      if (scene.videoFile && !scene.videoStatus) scene.videoStatus = 'ready';
      if (!scene.videoFile && !scene.videoStatus) scene.videoStatus = scene.imageFile ? 'none' : 'none';
      if (scene.videoFile && !scene.videoAttempts.length) {
        const id = `legacy-${scene.id}`;
        scene.videoAttempts.push({ id, source: scene.videoProvider === 'google-flow' ? 'google-flow' : 'grok-cli', status: 'completed', startedAt: scene.videoGeneratedAt ?? new Date(0).toISOString(), completedAt: scene.videoGeneratedAt, model: scene.videoModel, localFile: scene.videoFile, sourceImageRevision: scene.videoSourceImageRevision ?? scene.imageRevision });
        scene.activeVideoAttemptId = id;
      }
      for (const attempt of scene.videoAttempts) {
        if (attempt.source !== 'google-flow' || attempt.status !== 'failed' || !attempt.errorLogFile) continue;
        const detail = await fs.readFile(attempt.errorLogFile, 'utf8').catch(() => ''); if (!detail) continue; captureFlowAttemptIds(attempt, detail); attempt.error = conciseAttemptError(detail);
      }
    }
    return raw;
  } catch { return null; }
}
export async function updateBrollScene(workDir: string, plan: BrollPlan, sceneId: string, patch: { imagePrompt?: string; videoPrompt?: string; title?: string; sourceStart?: number; sourceEnd?: number; enabled?: boolean; displayTemplate?: BrollDisplayTemplate | 'default'; assetAspectRatio?: BrollAssetAspectRatio }) {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found');
  const previousAspect = resolveSceneAssetAspect(plan, scene);
  const nextStart = Number.isFinite(patch.sourceStart) ? Math.max(0, Number(patch.sourceStart)) : scene.sourceStart;
  const nextEnd = Number.isFinite(patch.sourceEnd) ? Math.max(0, Number(patch.sourceEnd)) : scene.sourceEnd;
  const nextEnabled = typeof patch.enabled === 'boolean' ? patch.enabled : scene.enabled;
  const timingChanged = Math.abs(nextStart - scene.sourceStart) > 0.0005 || Math.abs(nextEnd - scene.sourceEnd) > 0.0005;
  const newlyEnabled = patch.enabled === true && !scene.enabled;
  if (nextEnd <= nextStart) throw new Error('B-roll end time must be after start time');
  if (nextEnabled && (timingChanged || newlyEnabled)) {
    for (const other of plan.scenes) {
      if (other.id === scene.id || !other.enabled) continue;
      const gap = nextStart >= other.sourceEnd ? nextStart - other.sourceEnd : other.sourceStart >= nextEnd ? other.sourceStart - nextEnd : -1;
      if (gap < MIN_BROLL_GAP_SECONDS) throw new Error(`Keep at least ${MIN_BROLL_GAP_SECONDS} seconds of talking-head footage between B-roll scenes. This timing is too close to ${other.title || other.id}.`);
    }
  }
  if (typeof patch.title === 'string' && patch.title.trim()) scene.title = patch.title.trim().slice(0, 100); if (typeof patch.imagePrompt === 'string' && patch.imagePrompt.trim()) scene.imagePrompt = patch.imagePrompt.trim(); if (typeof patch.videoPrompt === 'string') scene.videoPrompt = patch.videoPrompt.trim() || undefined; if (typeof patch.enabled === 'boolean') scene.enabled = patch.enabled;
  if (patch.displayTemplate === 'default') delete scene.displayTemplate; else if (patch.displayTemplate) scene.displayTemplate = normalizeDisplayTemplate(patch.displayTemplate);
  if (patch.assetAspectRatio && ['auto', '9:16', '16:9'].includes(patch.assetAspectRatio)) scene.assetAspectRatio = patch.assetAspectRatio;
  if (scene.imageFile) { scene.generatedAspectRatio ??= previousAspect; scene.orientationChanged = scene.generatedAspectRatio !== resolveSceneAssetAspect(plan, scene); } else scene.orientationChanged = false;
  scene.sourceStart = nextStart; scene.sourceEnd = nextEnd; await saveBrollPlan(workDir, plan); return scene;
}
export async function updateBrollSettings(workDir: string, plan: BrollPlan, patch: Partial<Pick<BrollPlanSettings, 'videoProvider' | 'returnVideoWithAudio'>>) { plan.settings = normalizeSettings({ ...plan.settings, ...patch }); await saveBrollPlan(workDir, plan); return plan; }
export async function deleteBrollScene(workDir: string, plan: BrollPlan, sceneId: string) { const index = plan.scenes.findIndex((scene) => scene.id === sceneId); if (index < 0) throw new Error('B-roll scene not found'); const [scene] = plan.scenes.splice(index, 1); const files = new Set([scene.imageFile, scene.videoFile, ...(scene.videoAttempts ?? []).map((attempt) => attempt.localFile), ...(scene.videoAttempts ?? []).map((attempt) => attempt.errorLogFile)].filter((value): value is string => Boolean(value))); await Promise.all([...files].map((file) => fs.rm(file, { force: true }))); await saveBrollPlan(workDir, plan); return plan; }

export function resolveSceneDisplayTemplate(plan: BrollPlan, scene: BrollScene) { return scene.displayTemplate || plan.settings.displayTemplate || 'full-frame'; }
export function displayTemplateNeedsPresenterMatte(template: BrollDisplayTemplate) { return template === 'top-card-presenter' || template === 'presenter-overlay' || template === 'stacked-cards-cutout'; }
export function planNeedsPresenterMatte(plan: BrollPlan) { return plan.scenes.some((scene) => scene.enabled && displayTemplateNeedsPresenterMatte(resolveSceneDisplayTemplate(plan, scene))); }
export function displayTemplateUsesHorizontalBroll(template: BrollDisplayTemplate) { return template !== 'full-frame' && template !== 'presenter-overlay'; }

export function resolveSceneAssetAspect(plan: BrollPlan, scene: BrollScene) { if (scene.assetAspectRatio && scene.assetAspectRatio !== 'auto') return scene.assetAspectRatio; if (displayTemplateUsesHorizontalBroll(resolveSceneDisplayTemplate(plan, scene))) return '16:9'; if (plan.settings.aspectRatio !== 'auto') return plan.settings.aspectRatio; return plan.orientation === 'portrait' ? '9:16' : '16:9'; }
function visualModeDirective(mode: BrollVisualMode | undefined) {
  if (mode === 'hyperreal-clinical') return 'Render as premium documentary-style live-action clinical photography. Use people only when the story beat genuinely needs them; keep expressions/actions natural and non-stock-like.';
  if (mode === 'anatomy-cutaway') return 'Render as a polished, anatomically plausible 3D sectional/cutaway medical visualization with clear internal layers and spatial relationships.';
  if (mode === 'procedure-closeup') return 'Render as a clinically plausible close or macro treatment view with the relevant tool/material/action clearly readable, clean and non-gory.';
  if (mode === 'symbolic-medical') return 'Render as a simple premium medical/scientific visual metaphor using a few tangible objects or structures; keep it literal enough that the narration makes the meaning obvious.';
  if (mode === 'clinic-support') return 'Render as a premium realistic clinic/environment/detail shot because the setting or appointment itself is part of this story beat; avoid generic stock-photo staging.';
  return 'Render as premium educational 3D/scientific visualization with a clear central concept, readable depth and animation-friendly separated elements.';
}
function generatedImagePrompt(scene: BrollScene, plan: BrollPlan, regenerationComment?: string) {
  const requestedChange = regenerationComment?.trim() ? `\n\nUSER REQUEST FOR THIS REGENERATION:\n${regenerationComment.trim()}` : '';
  return `${scene.imagePrompt}${requestedChange}

STORY BEAT: ${scene.beatType || 'supporting'}
KEY POINT: ${scene.keyPoint || scene.visualIntent}
VIEWER TAKEAWAY: ${scene.viewerTakeaway || scene.visualIntent}
VISUAL MODE: ${scene.visualMode || 'educational-3d'}
MODE DIRECTION: ${visualModeDirective(scene.visualMode)}

FINAL QUALITY BAR: ${BROLL_STYLE_PRESET}

Deliver exactly ONE ${resolveSceneAssetAspect(plan, scene)} starting frame for a short image-to-video B-roll clip. This is not a finished poster: keep one dominant idea, clean depth layers and visually separable elements that can later move, reveal, highlight or be explored by the camera. Keep the essential subject safely centered. Absolutely no text, captions, labels, logos, watermarks, UI, collage or graphic-design elements.`;
}
function findBase64Image(value: any): string | undefined { if (!value) return undefined; if (typeof value === 'object') { if (typeof value.data === 'string' && (value.type === 'image' || value.mime_type?.startsWith?.('image/'))) return value.data; if (typeof value.b64_json === 'string') return value.b64_json; if (value.output_image) { const nested = findBase64Image(value.output_image); if (nested) return nested; } for (const child of Object.values(value)) { const nested = findBase64Image(child); if (nested) return nested; } } if (Array.isArray(value)) for (const child of value) { const nested = findBase64Image(child); if (nested) return nested; } return undefined; }
async function generateOpenAi(prompt: string, aspect: '9:16' | '16:9', config: ImageProviderConfig, outputPath: string) { if (!config.openAiApiKey) throw new Error('OPENAI_API_KEY is not configured'); const model = config.openAiModel || 'gpt-image-2'; const size = aspect === '9:16' ? '1024x1536' : '1536x1024'; const response = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${config.openAiApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, size, quality: 'high' }) }); if (!response.ok) throw new Error(`OpenAI image generation failed: ${response.status} ${await response.text()}`); const encoded = (await response.json() as any).data?.[0]?.b64_json; if (!encoded) throw new Error('OpenAI image generation returned no image data'); await fs.writeFile(outputPath, Buffer.from(encoded, 'base64')); return model; }
async function generateGemini(prompt: string, aspect: '9:16' | '16:9', config: ImageProviderConfig, outputPath: string) { if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured'); const model = config.geminiModel || 'gemini-3.1-flash-image'; const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'x-goog-api-key': config.geminiApiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: prompt, response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: aspect, image_size: '2K' } }) }); if (!response.ok) throw new Error(`Gemini image generation failed: ${response.status} ${await response.text()}`); const encoded = findBase64Image(await response.json()); if (!encoded) throw new Error('Gemini image generation returned no image data'); await fs.writeFile(outputPath, Buffer.from(encoded, 'base64')); return model; }
function codexImageQuality() { return String(process.env.CODEX_IMAGE_QUALITY || 'high').toLowerCase() === 'medium' ? 'medium' : 'high'; }
async function ensureGitRepo(workDir: string) {
  const gitDir = path.join(workDir, '.git'); const stat = await fs.stat(gitDir).catch(() => null); if (stat?.isDirectory()) return;
  try { await run('git', ['init', '-q'], undefined, 10000, { cwd: workDir }); }
  catch (error) { throw new Error(`Codex $imagegen needs a git-backed working folder and git init failed: ${error instanceof Error ? error.message : String(error)}`); }
}
async function generateWithAgentCli(provider: 'grok-cli' | 'codex-cli', prompt: string, config: ImageProviderConfig, workDir: string, outputPath: string) {
  await fs.rm(outputPath, { force: true });
  if (provider === 'grok-cli') {
    if (!config.grokBin) throw new Error('Grok CLI was not found.');
    const agentPrompt = `Create exactly one image using any image-generation capability available to your Grok Build environment. Save the actual final image file to this exact path: ${outputPath}\nThe task is complete only when the image file exists.\n\n${prompt}`;
    const args = ['--no-auto-update', '--always-approve', '--cwd', workDir, '-p', agentPrompt, '--output-format', 'plain']; if (config.grokModel) args.splice(4, 0, '-m', config.grokModel); await run(config.grokBin, args, undefined, 300000);
  } else {
    if (!config.codexBin) throw new Error('Codex CLI was not found.');
    const sceneKey = path.basename(outputPath).replace(/\.raw\.png$/i, '').replace(/[^a-z0-9_-]/gi, '-');
    const codexWorkDir = path.join(workDir, 'broll', 'codex-work', sceneKey); await fs.mkdir(codexWorkDir, { recursive: true }); await ensureGitRepo(codexWorkDir);
    const outputName = path.basename(outputPath); const codexOutputPath = path.join(codexWorkDir, outputName); await fs.rm(codexOutputPath, { force: true });
    const quality = codexImageQuality();
    const agentPrompt = `$imagegen\n\n${prompt}\n\nGenerate ONE image using ${quality.toUpperCase()} image quality.\n\nSave the finished generated image into the current working directory as:\n\n${outputName}\n\nUse Codex built-in image generation.\nDo NOT call the OpenAI API manually.\nDo NOT create a Python image generation script.\nDo NOT use an API key.\nActually generate the image.`;
    const codexEnv: NodeJS.ProcessEnv = { ...process.env }; delete codexEnv.OPENAI_API_KEY; delete codexEnv.CODEX_API_KEY;
    await run(config.codexBin, ['exec', '--ephemeral', '--sandbox', 'workspace-write', agentPrompt], undefined, 900000, { cwd: codexWorkDir, env: codexEnv });
    const generated = await fs.stat(codexOutputPath).catch(() => null); if (!generated?.isFile() || generated.size < 10_000) throw new Error(`Codex $imagegen completed without creating ${outputName}. Check Codex login and built-in image generation availability.`);
    await fs.copyFile(codexOutputPath, outputPath);
    return `Codex $imagegen (${quality})`;
  }
  const stat = await fs.stat(outputPath).catch(() => null); if (!stat?.isFile() || stat.size < 10_000) throw new Error('Grok CLI completed without creating a usable image.'); return config.grokModel || 'grok-cli';
}

function currentImageRevision(scene: BrollScene) { return Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0)); }
export function hasCurrentBrollVideo(scene: BrollScene) {
  if (!scene.videoFile || scene.videoStatus === 'stale') return false;
  const imageRevision = currentImageRevision(scene);
  const videoRevision = scene.videoSourceImageRevision;
  return videoRevision === undefined || videoRevision === imageRevision;
}
function invalidateSceneVideoForImageChange(scene: BrollScene) {
  scene.imageRevision = currentImageRevision(scene) + 1;
  scene.videoFile = undefined;
  scene.activeVideoAttemptId = undefined;
  scene.videoGeneratedAt = undefined;
  scene.videoModel = undefined;
  scene.videoProvider = undefined;
  scene.videoPrompt = undefined;
  scene.animationPlan = undefined;
  scene.videoSourceImageRevision = undefined;
  scene.videoStatus = 'stale';
}

async function normalizeImage(rawPath: string, outputPath: string, aspect: '9:16' | '16:9', ffmpegBin?: string, removeSource = true) {
  if (!ffmpegBin) { await fs.copyFile(rawPath, outputPath); if (removeSource && rawPath !== outputPath) await fs.rm(rawPath, { force: true }); return; }
  const filter = aspect === '9:16' ? 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920' : 'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080';
  await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath, '-vf', filter, '-frames:v', '1', outputPath], undefined, 120000); if (removeSource && rawPath !== outputPath) await fs.rm(rawPath, { force: true });
}
export async function importBrollImage(options: { workDir: string; plan: BrollPlan; sceneId: string; sourcePath: string; ffmpegBin?: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); const brollDir = path.join(options.workDir, 'broll'); await fs.mkdir(brollDir, { recursive: true }); const outputPath = path.join(brollDir, `${scene.id}.png`);
  const aspect = resolveSceneAssetAspect(options.plan, scene); await normalizeImage(options.sourcePath, outputPath, aspect, options.ffmpegBin, false); invalidateSceneVideoForImageChange(scene); scene.imageFile = outputPath; scene.generatedAt = new Date().toISOString(); scene.generatedAspectRatio = aspect; scene.orientationChanged = false; scene.provider = 'manual'; scene.model = 'manual-import'; await saveBrollPlan(options.workDir, options.plan); return scene;
}
export async function generateBrollImage(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; sceneId: string; regenerationComment?: string }) {
  const { config, workDir, plan, sceneId } = options; const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found'); const provider = plan.settings.provider; const aspect = resolveSceneAssetAspect(plan, scene); const prompt = generatedImagePrompt(scene, plan, options.regenerationComment); const brollDir = path.join(workDir, 'broll'); await fs.mkdir(brollDir, { recursive: true }); const rawPath = path.join(brollDir, `${scene.id}.raw.png`); const outputPath = path.join(brollDir, `${scene.id}.png`); let model: string;
  if (provider === 'openai') model = await generateOpenAi(prompt, aspect, config, rawPath); else if (provider === 'gemini') model = await generateGemini(prompt, aspect, config, rawPath); else model = await generateWithAgentCli(provider, prompt, config, workDir, rawPath); await normalizeImage(rawPath, outputPath, aspect, config.ffmpegBin, true); invalidateSceneVideoForImageChange(scene); scene.imageFile = outputPath; scene.generatedAt = new Date().toISOString(); scene.generatedAspectRatio = aspect; scene.orientationChanged = false; scene.provider = provider; scene.model = model; await saveBrollPlan(workDir, plan); return scene;
}

export async function createVideoPrompt(options: { codexBin: string; workDir: string; plan: BrollPlan; sceneId: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.imageFile) throw new Error('Add or generate a B-roll image before creating video');
  const schemaPath = path.join(options.workDir, `${scene.id}-video-prompt.schema.json`); const outputPath = path.join(options.workDir, `${scene.id}-video-prompt.json`);
  const schema = {
    type: 'object', additionalProperties: false, required: ['animationPlan', 'videoPrompt'], properties: {
      animationPlan: {
        type: 'object', additionalProperties: false, required: ['motionType', 'cameraMove', 'subjectMotion', 'revealSequence', 'highlightTargets', 'avoidMotion'], properties: {
          motionType: { type: 'string' }, cameraMove: { type: 'string' }, subjectMotion: { type: 'string' },
          revealSequence: { type: 'array', items: { type: 'string' } }, highlightTargets: { type: 'array', items: { type: 'string' } }, avoidMotion: { type: 'array', items: { type: 'string' } },
        },
      },
      videoPrompt: { type: 'string' },
    },
  };
  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2)); const duration = Math.max(2, Math.min(12, scene.sourceEnd - scene.sourceStart));
  const prompt = `You are the animation director for one B-roll story beat. The still image is the FIRST FRAME, not the finished idea. Design a short visual micro-story whose motion helps the viewer understand the spoken point.

Narration: ${scene.narration}
Beat type: ${scene.beatType || 'supporting'}
Key point: ${scene.keyPoint || scene.visualIntent}
Why this visual matters: ${scene.whyThisVisualMatters || scene.visualIntent}
Viewer takeaway: ${scene.viewerTakeaway || scene.visualIntent}
Visual mode: ${scene.visualMode || 'educational-3d'}
Visual intent: ${scene.visualIntent}
Shot type: ${scene.shotType}
Still-image prompt: ${scene.imagePrompt}
Target frame: ${resolveSceneAssetAspect(options.plan, scene)}.
Target duration: about ${duration.toFixed(1)} seconds.

First create a structured animationPlan:
- motionType: the storytelling mechanism (reveal, progression, transformation, comparison, demonstration, natural live-action motion, etc.).
- cameraMove: one restrained camera move that improves comprehension.
- subjectMotion: exactly what should move or change in the subject.
- revealSequence: ordered visual beats across the clip; use an empty array if no reveal is needed.
- highlightTargets: structures/objects/regions that should receive attention through focus, light, color, movement or framing; no text labels.
- avoidMotion: important things that must remain stable to prevent AI warping or factual confusion.

Then write ONE production-ready videoPrompt based on that plan. Motion must advance the idea, not merely add ambience. Educational/3D/cutaway scenes may reveal layers, show progression, move tools/materials, highlight structures or demonstrate cause-and-effect when supported by the narration. Hyperreal scenes should favor believable human/environment motion and restrained camera movement. Preserve identity, anatomy, composition and clinically important details from the starting image. Do not invent unsupported people, objects, tools, procedures, text or logos. No random morphing, dramatic cuts, lip-sync unless explicitly needed, or decorative motion unrelated to the key point.`;
  await run(options.codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt);
  const raw = JSON.parse(await fs.readFile(outputPath, 'utf8')); const videoPrompt = String(raw.videoPrompt ?? '').trim(); const animation = raw.animationPlan ?? {};
  if (videoPrompt.length < 50) throw new Error('Codex returned an unusable video prompt');
  const animationPlan: BrollAnimationPlan = {
    motionType: String(animation.motionType ?? '').trim(), cameraMove: String(animation.cameraMove ?? '').trim(), subjectMotion: String(animation.subjectMotion ?? '').trim(),
    revealSequence: Array.isArray(animation.revealSequence) ? animation.revealSequence.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
    highlightTargets: Array.isArray(animation.highlightTargets) ? animation.highlightTargets.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
    avoidMotion: Array.isArray(animation.avoidMotion) ? animation.avoidMotion.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
  };
  if (!animationPlan.motionType || !animationPlan.cameraMove || !animationPlan.subjectMotion) throw new Error('Codex returned an incomplete animation plan');
  scene.animationPlan = animationPlan; scene.videoPrompt = videoPrompt; await saveBrollPlan(options.workDir, options.plan); return scene;
}
export async function generateBrollVideoWithGrokCli(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; sceneId: string; regenerationComment?: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.imageFile) throw new Error('Add or generate a B-roll image first'); if (!scene.videoPrompt) throw new Error('Create a Codex video prompt first'); if (!options.config.grokBin) throw new Error('Grok CLI was not found. Configure GROK_BIN or install Grok Build.'); const duration = Math.max(2, Math.min(12, scene.sourceEnd - scene.sourceStart)); const videoModel = options.config.grokVideoModel || 'grok-imagine-video-1.5';
  const requestedChange = options.regenerationComment?.trim() ? `\n\nUSER REQUEST FOR THIS REGENERATION:\n${options.regenerationComment.trim()}` : '';
  const prompt = `${scene.videoPrompt}${requestedChange}`.trim(); const attempt = newVideoAttempt(scene, 'grok-cli', videoModel, prompt); const outputPath = await videoAttemptPath(options.workDir, scene.id, attempt.id); attempt.localFile = outputPath; await saveBrollPlan(options.workDir, options.plan);
  const agentPrompt = `Turn the local still image at ${scene.imageFile} into an image-to-video clip and save the final playable MP4 to this exact path: ${outputPath}\n\nUse the xAI/Grok Imagine image-to-video capability available in this Grok Build environment. Prefer model ${videoModel}. Target frame: ${resolveSceneAssetAspect(options.plan, scene)}. Preserve the source image's exact orientation and aspect ratio in the output video. Target duration: ${duration.toFixed(1)} seconds. Use the source still as the starting image.\n\nMOTION PROMPT:\n${scene.videoPrompt}${requestedChange}\n\nYou may use shell/code/tools available to Grok Build. Do not stop after instructions/code. The task is complete only after the MP4 exists. Do not modify the source still.`;
  try {
    const args = ['--no-auto-update', '--always-approve', '--cwd', options.workDir, '-p', agentPrompt, '--output-format', 'plain']; if (options.config.grokModel) args.splice(4, 0, '-m', options.config.grokModel); await run(options.config.grokBin, args, undefined, 900000); await validateVideo(outputPath, options.config.ffmpegBin, 'Grok CLI completed without creating a usable MP4. The Grok CLI environment must have image-to-video capability/authentication.'); if (!options.plan.settings.returnVideoWithAudio) await stripVideoAudio(outputPath, options.config.ffmpegBin); completeVideoAttempt(scene, attempt, outputPath, videoModel, 'grok-cli'); await saveBrollPlan(options.workDir, options.plan); return scene;
  } catch (error) { await failVideoAttempt(options.workDir, options.plan, attempt, error); throw error; }
}

export async function generateBrollVideoWithMagnific(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; sceneId: string; regenerationComment?: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId);
  if (!scene) throw new Error('B-roll scene not found');
  if (!scene.imageFile) throw new Error('Add or generate a B-roll image first');
  if (!scene.videoPrompt) throw new Error('Create a Codex video prompt first');
  if (!options.config.magnificApiKey) throw new Error('Magnific API key is missing. Add MAGNIFIC_API_KEY in Settings or .env.local.');

  const { model, endpoint } = resolveMagnificVideoConfig(options.config.magnificVideoModel, options.config.magnificVideoEndpoint);
  const fetchMagnific = options.config.magnificFetch ?? fetch;
  const requestedChange = options.regenerationComment?.trim() ? `\n\nUSER REQUEST FOR THIS REGENERATION:\n${options.regenerationComment.trim()}` : '';
  const prompt = `${scene.videoPrompt}${requestedChange}`.trim();
  const displayModel = `Magnific · MiniMax · ${model}`;
  const attempt = newVideoAttempt(scene, 'magnific', displayModel, prompt);
  const outputPath = await videoAttemptPath(options.workDir, scene.id, attempt.id);
  attempt.localFile = outputPath;
  await saveBrollPlan(options.workDir, options.plan);

  try {
    const image = (await fs.readFile(scene.imageFile)).toString('base64');
    const createResponse = await fetchMagnific(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-magnific-api-key': options.config.magnificApiKey },
      body: JSON.stringify({
        prompt,
        first_frame_image: image,
        prompt_optimizer: true,
        duration: 6,
      }),
    });
    const createBody: any = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok) throw new Error(`Magnific video submission failed (${createResponse.status}): ${createBody?.message || createBody?.error || JSON.stringify(createBody)}`);
    const taskId = String(createBody?.data?.task_id || createBody?.task_id || '');
    if (!taskId) throw new Error(`Magnific video submission returned no task_id: ${JSON.stringify(createBody)}`);

    const deadline = Date.now() + (options.config.magnificTimeoutMs ?? 15 * 60_000);
    let generatedUrl = '';
    let lastStatus = 'CREATED';
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, options.config.magnificPollIntervalMs ?? 3000));
      const statusResponse = await fetchMagnific(`${endpoint}/${encodeURIComponent(taskId)}`, { headers: { 'x-magnific-api-key': options.config.magnificApiKey } });
      const statusBody: any = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(`Magnific task polling failed (${statusResponse.status}): ${statusBody?.message || statusBody?.error || JSON.stringify(statusBody)}`);
      const data = statusBody?.data ?? statusBody;
      lastStatus = String(data?.status || '').toUpperCase() || lastStatus;
      const generated = Array.isArray(data?.generated) ? data.generated[0] : data?.generated;
      generatedUrl = String(typeof generated === 'object' ? generated?.url || generated?.video_url || '' : generated || data?.url || data?.video_url || '');
      if (lastStatus === 'COMPLETED' && generatedUrl) break;
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(lastStatus)) throw new Error(`Magnific MiniMax generation failed with status ${lastStatus}: ${JSON.stringify(data)}`);
    }
    if (!generatedUrl) throw new Error(`Magnific MiniMax generation timed out or returned no video URL (last status: ${lastStatus}).`);

    const videoResponse = await fetchMagnific(generatedUrl);
    if (!videoResponse.ok) throw new Error(`Magnific generated video download failed (${videoResponse.status}).`);
    await fs.writeFile(outputPath, Buffer.from(await videoResponse.arrayBuffer()));
    await validateVideo(outputPath, options.config.ffmpegBin, 'Magnific completed without returning a usable MP4.');
    if (!options.plan.settings.returnVideoWithAudio) await stripVideoAudio(outputPath, options.config.ffmpegBin);
    completeVideoAttempt(scene, attempt, outputPath, displayModel, 'magnific');
    await saveBrollPlan(options.workDir, options.plan);
    return scene;
  } catch (error) {
    await failVideoAttempt(options.workDir, options.plan, attempt, error);
    throw error;
  }
}

export const DEFAULT_MAGNIFIC_VIDEO_MODEL = 'minimax-hailuo-2-3-768p-fast';

export function resolveMagnificVideoConfig(configuredModel?: string, configuredEndpoint?: string) {
  const legacyModel = configuredModel?.trim() === 'minimax-h3-max-turbo';
  const model = legacyModel || !configuredModel?.trim() ? DEFAULT_MAGNIFIC_VIDEO_MODEL : configuredModel.trim();
  const override = configuredEndpoint?.trim().replace(/\/$/, '');
  if (override) {
    try {
      const parsed = new URL(override);
      if (parsed.hostname === 'api.freepik.com' && parsed.pathname.startsWith('/v1/ai/image-to-video/')) {
        return { model, endpoint: `https://api.magnific.com/v1/ai/image-to-video/${model}`, migratedLegacyEndpoint: true };
      }
    } catch { /* Preserve custom non-URL overrides so the request reports the useful transport error. */ }
    return { model, endpoint: override, migratedLegacyEndpoint: legacyModel };
  }
  return { model, endpoint: `https://api.magnific.com/v1/ai/image-to-video/${model}`, migratedLegacyEndpoint: legacyModel };
}

function newVideoAttempt(scene: BrollScene, source: BrollVideoAttempt['source'], model: string, prompt: string) {
  const attempt: BrollVideoAttempt = { id: randomUUID(), source, status: 'submitted', startedAt: new Date().toISOString(), model, prompt, sourceImageRevision: currentImageRevision(scene) };
  scene.videoAttempts ??= []; scene.videoAttempts.push(attempt); scene.videoStatus = 'generating'; return attempt;
}
async function videoAttemptPath(workDir: string, sceneId: string, attemptId: string, extension = '.mp4') { const dir = path.join(workDir, 'broll', 'video-attempts'); await fs.mkdir(dir, { recursive: true }); return path.join(dir, `${sceneId}-${attemptId}${extension}`); }
async function validateVideo(file: string, ffmpegBin: string | undefined, missingMessage: string) { const stat = await fs.stat(file).catch(() => null); if (!stat?.isFile() || stat.size < 50_000) throw new Error(missingMessage); if (ffmpegBin) await run(ffmpegBin, ['-v', 'error', '-i', file, '-f', 'null', '-'], undefined, 120000); }
async function stripVideoAudio(file: string, ffmpegBin?: string) { if (!ffmpegBin) throw new Error('FFmpeg is required when “Return video with audio” is disabled.'); const extension = path.extname(file) || '.mp4'; const silentPath = `${file}.silent${extension}`; try { await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', silentPath], undefined, 120000); await fs.rename(silentPath, file); } finally { await fs.rm(silentPath, { force: true }); } }
function completeVideoAttempt(scene: BrollScene, attempt: BrollVideoAttempt, outputPath: string, model: string, provider: VideoProvider) { const completedAt = new Date().toISOString(); attempt.status = 'completed'; attempt.completedAt = completedAt; attempt.localFile = outputPath; attempt.sourceImageRevision ??= currentImageRevision(scene); scene.activeVideoAttemptId = attempt.id; scene.videoFile = outputPath; scene.videoGeneratedAt = completedAt; scene.videoModel = model; scene.videoProvider = provider; scene.videoSourceImageRevision = attempt.sourceImageRevision; scene.videoStatus = 'ready'; }
function conciseAttemptError(detail: string) { if (/"event": "migrated\.status"[^\n]*"status": 4|"status": 4[^\n]*"event": "migrated\.status"/.test(detail)) return 'Google Flow accepted the submission but the Veo generation failed (Flow status 4). Open the saved Flow project to inspect or create the scene manually.'; const nonLog = detail.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('{')); return (nonLog.at(-1) || detail.split(/\r?\n/).filter(Boolean).at(-1) || 'Video generation failed').slice(0, 1000); }
async function failVideoAttempt(workDir: string, plan: BrollPlan, attempt: BrollVideoAttempt, error: unknown) { const detail = error instanceof Error ? error.message : String(error); attempt.status = 'failed'; attempt.completedAt = new Date().toISOString(); attempt.error = conciseAttemptError(detail); const scene = plan.scenes.find((candidate) => candidate.videoAttempts?.some((candidateAttempt) => candidateAttempt.id === attempt.id)); if (scene && !hasCurrentBrollVideo(scene)) scene.videoStatus = scene.imageFile ? 'stale' : 'none'; const logDir = path.join(workDir, 'broll', 'generation-logs'); await fs.mkdir(logDir, { recursive: true }); attempt.errorLogFile = path.join(logDir, `${attempt.id}.log`); await fs.writeFile(attempt.errorLogFile, detail); await saveBrollPlan(workDir, plan); }
function parseJsonObject(text: string) { const trimmed = text.trim(); if (!trimmed) return null; try { return JSON.parse(trimmed); } catch { const start = trimmed.indexOf('{'); const end = trimmed.lastIndexOf('}'); if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; } } return null; } }
function flowProjectUrl(projectId: string) { return `https://flow.google.com/project/${projectId}`; }
function captureFlowAttemptIds(attempt: BrollVideoAttempt, detail: string) { for (const line of detail.split(/\r?\n/)) { const start = line.indexOf('{'); if (start < 0) continue; try { const event = JSON.parse(line.slice(start)); if (event.event === 'migrated.submit_observed') { if (event.media_id) attempt.flowMediaId = String(event.media_id); if (event.workflow_id) attempt.flowWorkflowId = String(event.workflow_id); } } catch { /* Keep parsing later structured log lines. */ } } }
async function ensureGoogleFlowProject(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; projectName: string }) {
  const profile = options.config.gflowProfile?.trim() || 'default';
  if (options.plan.googleFlow?.projectId && options.plan.googleFlow.profile === profile) return options.plan.googleFlow;
  if (!options.config.gflowBin) throw new Error('Google Flow CLI was not found.');
  const localId = path.basename(options.workDir).slice(0, 8); const title = `Video Cleaner · ${options.projectName.slice(0, 60)} · ${localId}`;
  const args = ['project', 'create', '--name', title, '--json']; if (profile !== 'default') args.push('--profile', profile);
  const { stdout } = await run(options.config.gflowBin, args, undefined, 180000, { cwd: options.workDir }); const result = parseJsonObject(stdout); const projectId = String(result?.project_id ?? ''); if (!projectId) throw new Error(`Google Flow project creation returned no project id.\n${stdout}`);
  options.plan.googleFlow = { projectId, title: String(result?.title || title), profile, url: flowProjectUrl(projectId), createdAt: new Date().toISOString() }; await saveBrollPlan(options.workDir, options.plan); return options.plan.googleFlow;
}
function openFlowProject(url: string) { if (process.platform !== 'darwin') return; const child = spawn('open', [url], { detached: true, stdio: 'ignore' }); child.unref(); }

export async function generateBrollVideoWithGoogleFlow(options: { config: ImageProviderConfig; workDir: string; projectName: string; plan: BrollPlan; sceneId: string; regenerationComment?: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.imageFile) throw new Error('Add or generate a B-roll image first'); if (!scene.videoPrompt) throw new Error('Create a Codex video prompt first'); if (!options.config.gflowBin) throw new Error('Google Flow CLI was not found. Install gflow-cli and configure GFLOW_BIN if it is not on PATH.');
  const flowProject = await ensureGoogleFlowProject(options); const videoModel = options.config.gflowVideoModel || 'veo-fast';
  const silentInstruction = options.plan.settings.returnVideoWithAudio || /completely silent|no (?:dialogue|speech|audio)/i.test(scene.videoPrompt) ? '' : 'Create a completely silent video with no dialogue, speech, music, sound effects, ambient sound, or generated audio. ';
  const requestedChange = options.regenerationComment?.trim() ? `\n\nUSER REQUEST FOR THIS REGENERATION:\n${options.regenerationComment.trim()}` : ''; const motionPrompt = `${silentInstruction}${scene.videoPrompt}${requestedChange}`.trim();
  const attempt = newVideoAttempt(scene, 'google-flow', `Google Flow · ${videoModel}`, motionPrompt); attempt.flowProjectId = flowProject.projectId; const trackingMarker = `VC_${scene.id.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_${attempt.id.slice(0, 8).toUpperCase()}`; const trackedPrompt = `Production tracking marker (metadata only; never render this as text): ${trackingMarker}. ${motionPrompt}`; attempt.prompt = trackedPrompt; const outputPath = await videoAttemptPath(options.workDir, scene.id, attempt.id); attempt.localFile = outputPath; await saveBrollPlan(options.workDir, options.plan);
  const args = ['video', 'i2v', '--initial-frame', scene.imageFile, trackedPrompt, '--model', videoModel, '--count', '1', '--aspect', resolveSceneAssetAspect(options.plan, scene), '--project', flowProject.projectId, '--output', outputPath, '--json'];
  if (options.config.gflowProfile?.trim()) args.push('--profile', options.config.gflowProfile.trim());
  try {
    const { stdout } = await run(options.config.gflowBin, args, undefined, 1_200_000, { cwd: options.workDir }); const result = parseJsonObject(stdout); if (result?.media_id) attempt.flowMediaId = String(result.media_id); if (result?.status === 'fail') throw new Error(String(result?.error_message || result?.failure_reasons?.join?.(', ') || 'Google Flow generation failed'));
    await validateVideo(outputPath, options.config.ffmpegBin, 'Google Flow finished without creating a usable MP4. Check the saved Flow project and account credits.'); if (!options.plan.settings.returnVideoWithAudio) await stripVideoAudio(outputPath, options.config.ffmpegBin); completeVideoAttempt(scene, attempt, outputPath, `Google Flow · ${videoModel}`, 'google-flow'); await saveBrollPlan(options.workDir, options.plan); return scene;
  } catch (error) { captureFlowAttemptIds(attempt, error instanceof Error ? error.message : String(error)); await failVideoAttempt(options.workDir, options.plan, attempt, error); openFlowProject(flowProject.url); throw new Error(`${attempt.error}\nFlow media: ${attempt.flowMediaId || 'not reported'}\nFlow project left open for inspection: ${flowProject.url}\nFull log: ${attempt.errorLogFile}`); }
}

export async function importBrollVideo(options: { workDir: string; plan: BrollPlan; sceneId: string; sourcePath: string; ffmpegBin?: string; source?: 'manual' | 'flow-catalog'; flowMediaId?: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); const extension = path.extname(options.sourcePath).toLowerCase() || '.mp4'; const attempt = newVideoAttempt(scene, options.source ?? 'manual', options.source === 'flow-catalog' ? 'Google Flow · manual/catalog import' : 'Manual video import', scene.videoPrompt ?? 'Manual video import'); const outputPath = await videoAttemptPath(options.workDir, scene.id, attempt.id, extension); await fs.copyFile(options.sourcePath, outputPath); if (!options.plan.settings.returnVideoWithAudio) await stripVideoAudio(outputPath, options.ffmpegBin); await validateVideo(outputPath, options.ffmpegBin, 'The selected file is not a usable video.'); attempt.flowProjectId = options.plan.googleFlow?.projectId; attempt.flowMediaId = options.flowMediaId; completeVideoAttempt(scene, attempt, outputPath, attempt.model!, options.source === 'flow-catalog' ? 'google-flow' : (scene.videoProvider ?? 'google-flow')); if (options.source === 'manual') scene.videoProvider = undefined; await saveBrollPlan(options.workDir, options.plan); return scene;
}

export async function listGoogleFlowProjectVideos(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan }) {
  if (!options.plan.googleFlow?.projectId) return [] as GoogleFlowCatalogVideo[]; if (!options.config.gflowBin) throw new Error('Google Flow CLI was not found.'); const profile = options.plan.googleFlow.profile; const args = ['data', 'list', 'videos', '--limit', '1000', '--json']; if (profile !== 'default') args.push('--profile', profile); const { stdout } = await run(options.config.gflowBin, args, undefined, 120000, { cwd: options.workDir });
  const rows = stdout.split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean); const videos = rows.filter((row: any) => String(row.project_id) === options.plan.googleFlow!.projectId).map((row: any): GoogleFlowCatalogVideo => ({ mediaId: String(row.media_id), projectId: String(row.project_id), prompt: String(row.prompt ?? ''), aspect: row.aspect ? String(row.aspect) : undefined, model: row.model ? String(row.model) : undefined, duration: Number.isFinite(Number(row.duration)) ? Number(row.duration) : undefined, createdAt: row.created_at ? String(row.created_at) : undefined, localPath: row.local_path ? String(row.local_path) : undefined }));
  const known = new Set(options.plan.scenes.flatMap((candidate) => candidate.videoAttempts ?? []).map((candidate) => candidate.flowMediaId).filter(Boolean)); options.plan.googleFlow.lastSyncedAt = new Date().toISOString(); await saveBrollPlan(options.workDir, options.plan); return videos.filter((video) => !known.has(video.mediaId));
}

function even(value: number) { const rounded = Math.max(2, Math.round(value)); return rounded % 2 === 0 ? rounded : rounded - 1; }
function roundedAlpha(radius: number, maxAlpha = 255) {
  return `if(lte(hypot(max(${radius}-X,0)+max(X-(W-${radius}),0),max(${radius}-Y,0)+max(Y-(H-${radius}),0)),${radius}),${maxAlpha},0)`;
}
function roundedRgba(radius: number, hdr = false) { return `format=${hdr ? 'gbrap10le' : 'rgba'},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(radius, hdr ? 1023 : 255)}'`; }
function layoutRect(template: BrollDisplayTemplate, width: number, height: number) {
  if (template === 'top-card' || template === 'top-card-presenter') return { width: even(width * 0.92), height: even(height * 0.42), x: even(width * 0.04), y: even(height * 0.035) };
  if (template === 'split-top') return { width: even(width), height: even(height * 0.47), x: 0, y: 0 };
  if (template === 'picture-in-picture') {
    if (height >= width) return { width: even(width * 0.86), height: even(height * 0.33), x: even(width * 0.07), y: even(height * 0.53) };
    return { width: even(width * 0.42), height: even(height * 0.56), x: even(width * 0.54), y: even(height * 0.08) };
  }
  return { width: even(width), height: even(height), x: 0, y: 0 };
}

export function buildBrollOverlayFilter(options: { plan: BrollPlan; width: number; height: number; fps: number; cleanedSegments?: Array<{ start: number; end: number }>; presenterInputIndex?: number; includeAudio?: boolean; baseVideoFilter?: string; outputHdr?: boolean; assetColors?: Record<string, ColorProfile> }) {
  const active = options.plan.scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile));
  if (!active.length) throw new Error('Add at least one enabled B-roll image or video before exporting');
  const presenterScenes = active.filter((scene) => displayTemplateNeedsPresenterMatte(resolveSceneDisplayTemplate(options.plan, scene)));
  const stackedScenes = active.filter((scene) => ['stacked-cards-cutout', 'stacked-talking-top', 'stacked-broll-top'].includes(resolveSceneDisplayTemplate(options.plan, scene)));
  if (presenterScenes.length && options.presenterInputIndex === undefined) throw new Error('A presenter-cutout template is selected but the presenter matte input is missing');

  const parts: string[] = [];
  const basePrefix = options.baseVideoFilter?.trim() ? `${options.baseVideoFilter.trim()},` : '';
  const overlayFormat = options.outputHdr ? ':format=yuv420p10' : '';
  const outputFormat = options.outputHdr ? 'format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc,' : '';
  let presenterLabels: string[] = [];
  const sourceLabels = ['base0', ...(presenterScenes.length ? ['presenterSource'] : []), ...stackedScenes.map((_scene, index) => `stackedSource${index}`)];
  if (sourceLabels.length > 1) {
    parts.push(`[0:v]${basePrefix}setpts=PTS-STARTPTS,split=${sourceLabels.length}${sourceLabels.map((label) => `[${label}]`).join('')}`);
  } else {
    parts.push(`[0:v]${basePrefix}setpts=PTS-STARTPTS[base0]`);
  }
  if (presenterScenes.length) {
    parts.push(`[${options.presenterInputIndex}:v]fps=${options.fps.toFixed(6)},scale=${options.width}:${options.height}:flags=bilinear,gblur=sigma=0.45:steps=1,format=${options.outputHdr ? 'gray10le' : 'gray'},setpts=PTS-STARTPTS[presenterMask]`);
    parts.push(`[presenterSource]format=${options.outputHdr ? 'gbrp10le' : 'rgba'}[presenterRgb]`);
    parts.push('[presenterRgb][presenterMask]alphamerge[presenterAlpha]');
    if (presenterScenes.length === 1) presenterLabels = ['presenterAlpha'];
    else {
      presenterLabels = presenterScenes.map((_scene, index) => `presenter${index}`);
      parts.push(`[presenterAlpha]split=${presenterLabels.length}${presenterLabels.map((label) => `[${label}]`).join('')}`);
    }
  }

  let previous = 'base0'; let presenterCursor = 0; let stackedCursor = 0;
  active.forEach((scene, index) => {
    const mediaFilter = colorVideoFilter(options.assetColors?.[scene.id] ?? { pixelFormat: scene.videoFile ? "yuv420p" : "rgb24" }, options.outputHdr);
    const input = index + 1; const mediaLabel = `broll${index}`; const mediaOutput = `mediaBase${index}`; const output = `base${index + 1}`;
    const duration = Math.max(0.1, scene.sourceEnd - scene.sourceStart); const template = resolveSceneDisplayTemplate(options.plan, scene); const rect = layoutRect(template, options.width, options.height);
    const between = `between(t,${scene.sourceStart.toFixed(6)},${scene.sourceEnd.toFixed(6)})`;
    if (template === 'stacked-talking-top' || template === 'stacked-broll-top') {
      const margin = even(options.width * 0.035); const topY = even(options.height * 0.025); const cardWidth = even(options.width - margin * 2); const cardHeight = even(options.height * 0.455); const lowerY = even(options.height * 0.52); const radius = even(Math.min(cardWidth, cardHeight) * 0.055); const stackedSource = `stackedSource${stackedCursor++}`;
      parts.push(`[${input}:v]scale=${cardWidth}:${cardHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cardWidth}:${cardHeight},setsar=1,${mediaFilter},${roundedRgba(radius, options.outputHdr)},trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS+${scene.sourceStart.toFixed(6)}/TB[${mediaLabel}]`);
      parts.push(`[${stackedSource}]scale=${cardWidth}:${cardHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cardWidth}:${cardHeight},setsar=1,${roundedRgba(radius, options.outputHdr)}[talkingCard${index}]`);
      parts.push(`[${previous}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='${between}'[stackedBg${index}]`);
      const topLabel = template === 'stacked-broll-top' ? mediaLabel : `talkingCard${index}`; const bottomLabel = template === 'stacked-broll-top' ? `talkingCard${index}` : mediaLabel;
      parts.push(`[stackedBg${index}][${topLabel}]overlay=${margin}:${topY}:eof_action=pass:enable='${between}'${overlayFormat}[stackedTop${index}]`);
      parts.push(`[stackedTop${index}][${bottomLabel}]overlay=${margin}:${lowerY}:eof_action=pass:enable='${between}'${overlayFormat}[${output}]`);
      previous = output;
      return;
    }
    if (template === 'stacked-cards-cutout') {
      const margin = even(options.width * 0.035); const topY = even(options.height * 0.025); const cardWidth = even(options.width - margin * 2); const topHeight = even(options.height * 0.43); const lowerY = even(options.height * 0.50); const lowerHeight = even(options.height * 0.475); const radius = even(Math.min(cardWidth, topHeight) * 0.065);
      const presenterWidth = even(cardWidth * 0.94); const presenterX = margin + even((cardWidth - presenterWidth) / 2); const presenterY = even(options.height * (options.height >= options.width ? 0.16 : 0.30)); const shadowY = presenterY + even(options.height * 0.008); const stackedSource = `stackedSource${stackedCursor++}`; const presenterLabel = presenterLabels[presenterCursor++];
      parts.push(`[${input}:v]scale=${cardWidth}:${topHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cardWidth}:${topHeight},setsar=1,${mediaFilter},${roundedRgba(radius, options.outputHdr)},trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS+${scene.sourceStart.toFixed(6)}/TB[${mediaLabel}]`);
      parts.push(`[${stackedSource}]scale=${cardWidth}:${lowerHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cardWidth}:${lowerHeight},setsar=1,boxblur=luma_radius=12:luma_power=1:chroma_radius=6:chroma_power=1,${roundedRgba(radius, options.outputHdr)}[stackedRoom${index}]`);
      parts.push(`[${presenterLabel}]scale=${presenterWidth}:-2:flags=lanczos,format=${options.outputHdr ? 'gbrap10le' : 'rgba'},split=2[stackedPresenter${index}][stackedShadowSeed${index}]`);
      parts.push(`[stackedShadowSeed${index}]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.20,gblur=sigma=8:steps=2[stackedShadow${index}]`);
      parts.push(`[${previous}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='${between}'[stackedBg${index}]`);
      parts.push(`[stackedBg${index}][${mediaLabel}]overlay=${margin}:${topY}:eof_action=pass:enable='${between}'${overlayFormat}[stackedTop${index}]`);
      parts.push(`[stackedTop${index}][stackedRoom${index}]overlay=${margin}:${lowerY}:eof_action=pass:enable='${between}'${overlayFormat}[stackedLower${index}]`);
      parts.push(`[stackedLower${index}][stackedShadow${index}]overlay=${presenterX}:${shadowY}:eof_action=pass:enable='${between}'${overlayFormat}[stackedShadowed${index}]`);
      parts.push(`[stackedShadowed${index}][stackedPresenter${index}]overlay=${presenterX}:${presenterY}:eof_action=pass:enable='${between}'${overlayFormat}[${output}]`);
      previous = output;
      return;
    }
    parts.push(`[${input}:v]scale=${rect.width}:${rect.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${rect.width}:${rect.height},setsar=1,${mediaFilter},trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS+${scene.sourceStart.toFixed(6)}/TB[${mediaLabel}]`);
    parts.push(`[${previous}][${mediaLabel}]overlay=${rect.x}:${rect.y}:eof_action=pass:enable='${between}'${overlayFormat}[${mediaOutput}]`);
    if (displayTemplateNeedsPresenterMatte(template)) {
      const presenterLabel = presenterLabels[presenterCursor++];
      parts.push(`[${mediaOutput}][${presenterLabel}]overlay=0:0:eof_action=pass:enable='between(t,${scene.sourceStart.toFixed(6)},${scene.sourceEnd.toFixed(6)})'${overlayFormat}[${output}]`);
    } else {
      parts.push(`[${mediaOutput}]null[${output}]`);
    }
    previous = output;
  });

  if (options.cleanedSegments?.length) {
    const expression = options.cleanedSegments.map((segment) => `between(t\\,${segment.start.toFixed(6)}\\,${segment.end.toFixed(6)})`).join('+');
    parts.push(`[${previous}]${outputFormat}select='${expression}',setpts=N/${options.fps.toFixed(6)}/TB[vout]`);
    if (options.includeAudio !== false) parts.push(`[0:a]aselect='${expression}',asetpts=N/SR/TB[aout]`);
  } else {
    parts.push(`[${previous}]${outputFormat}setpts=PTS-STARTPTS[vout]`); if (options.includeAudio !== false) parts.push('[0:a]asetpts=PTS-STARTPTS[aout]');
  }
  return { filter: parts.join(';'), activeScenes: active, needsPresenterMatte: presenterScenes.length > 0 };
}
