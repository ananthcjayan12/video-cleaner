import { promises as fs } from 'node:fs';
import path from 'node:path';
import { keptTimeline, keptWordIndexes, planningModelLabel, writePlanningFailureLog, type BrollKeepRange, type BrollPlan, type BrollWord } from './broll.js';
import { formatMetaFinding, metaTextGuidelinesPrompt, scanMetaText } from './meta-guidelines.js';
import { listMotionTemplates, motionTemplatePath } from './motion-templates.js';
import { renderMotionScene, validateMotionCode } from './motion-render.js';
import { generateStructuredText, type TextModelChoice, type TextModelConfig, type TextProvider } from './text-models.js';

export type MotionGraphicType = 'lower-third' | 'stat-callout' | 'kinetic-title' | 'animated-chart' | 'process-steps' | 'comparison' | 'checklist' | 'quote-card' | 'timeline' | 'icon-diagram';
export type MotionPlacement = 'top' | 'center' | 'bottom' | 'full';
export type MotionCountMode = 'auto' | 'exact' | 'per-minute';
export type MotionItem = { label: string; value: string };
export type MotionContent = { headline: string; subhead: string; items: MotionItem[] };
export type MotionSettings = {
  planningProvider: TextProvider; planningModel: string;
  codeProvider?: TextProvider; codeModel?: string;
  countMode: MotionCountMode; targetCount: number; perMinute: number;
  minDuration: number; maxDuration: number;
  accentColor: string; secondaryColor: string; styleNotes: string;
  /** Template used by every graphic that has no template of its own. */
  defaultTemplateId?: string;
};
export type MotionScene = {
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number; narration: string;
  graphicType: MotionGraphicType; placement: MotionPlacement; keyPoint: string; whyThisGraphicMatters: string; viewerTakeaway: string;
  content: MotionContent; designBrief: string; enabled: boolean; templateId?: string;
  code?: string; codeGeneratedAt?: string; codeModel?: string;
  videoFile?: string; renderedAt?: string; renderProgress?: number;
  status: 'none' | 'generating' | 'ready' | 'failed'; error?: string;
};
export type MotionPlan = { version: 1; orientation: 'portrait' | 'landscape'; settings: MotionSettings; scenes: MotionScene[]; notes: string[] };

export const MOTION_GRAPHIC_TYPES: Array<{ id: MotionGraphicType; label: string; description: string }> = [
  { id: 'lower-third', label: 'Lower third', description: 'Name/topic tag that slides in with an accent bar' },
  { id: 'stat-callout', label: 'Stat callout', description: 'One big number that counts up, with a short label' },
  { id: 'kinetic-title', label: 'Kinetic title', description: 'Bold key phrase animated word-by-word' },
  { id: 'animated-chart', label: 'Animated chart', description: 'Bars, rings or lines that draw in to show a comparison or trend' },
  { id: 'process-steps', label: 'Process steps', description: 'Numbered steps that connect and reveal in sequence' },
  { id: 'comparison', label: 'Comparison', description: 'Two-column contrast such as myth vs fact or option A vs option B (never patient results)' },
  { id: 'checklist', label: 'Checklist', description: 'Rows that tick off one by one' },
  { id: 'quote-card', label: 'Quote card', description: 'Highlighted statement or definition card' },
  { id: 'timeline', label: 'Timeline', description: 'Milestones along a line that draws in' },
  { id: 'icon-diagram', label: 'Icon diagram', description: 'Simple vector shapes/icons that assemble to explain a mechanism' },
];
const TYPE_IDS = MOTION_GRAPHIC_TYPES.map((type) => type.id);
const PLACEMENTS: MotionPlacement[] = ['top', 'center', 'bottom', 'full'];

/** Minimum talking-head-only gap between two motion graphics, and clearance from B-roll windows. */
export const MIN_MOTION_GAP_SECONDS = 2;
const MOTION_B_ROLL_CLEARANCE_SECONDS = 0.25;
const MAX_PLAN_ATTEMPTS = 4;
const MAX_CODE_ATTEMPTS = 3;

class MotionPlanValidationError extends Error {
  constructor(readonly issues: string[]) { super(issues.join('\n')); this.name = 'MotionPlanValidationError'; }
}

const hexColor = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value ?? '').trim()) ? String(value).trim() : fallback;

export function normalizeMotionSettings(raw: Partial<MotionSettings> | undefined): MotionSettings {
  const providers = ['codex-cli', 'claude-cli', 'agy-cli', 'gemini', 'openai'];
  const planningProvider = providers.includes(String(raw?.planningProvider)) ? raw!.planningProvider as TextProvider : 'claude-cli';
  const codeProvider = providers.includes(String(raw?.codeProvider)) ? raw!.codeProvider as TextProvider : undefined;
  const countMode: MotionCountMode = ['auto', 'exact', 'per-minute'].includes(String(raw?.countMode)) ? raw!.countMode as MotionCountMode : 'auto';
  const maxDuration = Math.max(2, Math.min(15, Number(raw?.maxDuration) || 5));
  return {
    planningProvider, planningModel: raw?.planningModel?.trim() || '', codeProvider, codeModel: raw?.codeModel?.trim() || '',
    countMode, targetCount: Math.max(1, Math.min(30, Math.round(Number(raw?.targetCount) || 4))), perMinute: Math.max(0.5, Math.min(10, Number(raw?.perMinute) || 2)),
    minDuration: Math.max(1.5, Math.min(maxDuration, Number(raw?.minDuration) || 2.5)), maxDuration,
    accentColor: hexColor(raw?.accentColor, '#22D3EE'), secondaryColor: hexColor(raw?.secondaryColor, '#0F172A'), styleNotes: String(raw?.styleNotes ?? '').trim().slice(0, 600),
    defaultTemplateId: /^[\w-]{1,40}$/.test(String(raw?.defaultTemplateId ?? '')) ? String(raw!.defaultTemplateId) : undefined,
  };
}

function typeOf(value: unknown): MotionGraphicType { return TYPE_IDS.includes(value as MotionGraphicType) ? value as MotionGraphicType : 'kinetic-title'; }
function placementOf(value: unknown): MotionPlacement { return PLACEMENTS.includes(value as MotionPlacement) ? value as MotionPlacement : 'center'; }
function cleanContent(raw: any): MotionContent {
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, 6).map((item: any) => ({ label: String(item?.label ?? '').trim().slice(0, 80), value: String(item?.value ?? '').trim().slice(0, 40) })).filter((item: MotionItem) => item.label || item.value);
  return { headline: String(raw?.headline ?? '').trim().slice(0, 90), subhead: String(raw?.subhead ?? '').trim().slice(0, 140), items };
}

function targetCount(duration: number, settings: MotionSettings) {
  if (settings.countMode === 'exact') return settings.targetCount;
  if (settings.countMode === 'per-minute' && duration) return Math.max(1, Math.min(30, Math.round(duration / 60 * settings.perMinute)));
  return 0;
}

function planSchema(exact = 0) {
  return {
    type: 'object', additionalProperties: false, required: ['scenes', 'notes'], properties: {
      scenes: {
        type: 'array', ...(exact ? { minItems: exact, maxItems: exact } : {}),
        items: {
          type: 'object', additionalProperties: false,
          required: ['title', 'startWordId', 'endWordId', 'graphicType', 'placement', 'keyPoint', 'whyThisGraphicMatters', 'viewerTakeaway', 'headline', 'subhead', 'items', 'designBrief'],
          properties: {
            title: { type: 'string' }, startWordId: { type: 'string' }, endWordId: { type: 'string' },
            graphicType: { type: 'string', enum: TYPE_IDS }, placement: { type: 'string', enum: PLACEMENTS },
            keyPoint: { type: 'string' }, whyThisGraphicMatters: { type: 'string' }, viewerTakeaway: { type: 'string' },
            headline: { type: 'string' }, subhead: { type: 'string' },
            items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string' } } } },
            designBrief: { type: 'string' },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
  };
}

/** On-screen text is ad-facing: the planner rejects warnings too (it can rephrase); manual edits reject hard blocks only. */
function contentPolicyIssue(content: MotionContent, strict: boolean) {
  const text = [content.headline, content.subhead, ...content.items.map((item) => `${item.label} ${item.value}`)].join(' ');
  const findings = scanMetaText(text).filter((finding) => strict || finding.severity === 'block');
  return findings.length ? findings.map((finding) => formatMetaFinding(finding)).join(' ') : '';
}

type Occupied = { start: number; end: number; label: string };

export function validatePlan(words: BrollWord[], keepRanges: BrollKeepRange[] | undefined, raw: any, settings: MotionSettings, occupied: Occupied[], expected: number) {
  const { index, kept } = keptWordIndexes(words, keepRanges);
  const scenes: MotionScene[] = []; const issues: string[] = [];
  if (!Array.isArray(raw?.scenes)) issues.push('The response does not contain a scenes array.');
  let previousStart = -1; let previousEnd = -Infinity; let previousLabel = '';
  for (const [position, candidate] of (Array.isArray(raw?.scenes) ? raw.scenes : []).entries()) {
    const label = String(candidate?.title || `graphic ${position + 1}`);
    const start = index.get(candidate?.startWordId); const end = index.get(candidate?.endWordId);
    if (start === undefined || end === undefined) { issues.push(`"${label}" uses a word ID that is not in the supplied narration.`); continue; }
    if (start > end) { issues.push(`"${label}" ends before it starts.`); continue; }
    if (start < previousStart) { issues.push(`"${label}" is out of chronological order.`); continue; }
    let removedInside = false; for (let i = start; i <= end; i += 1) if (!kept.has(i)) { removedInside = true; break; }
    if (removedInside) { issues.push(`"${label}" spans words removed from the final narration; keep it inside one continuous spoken passage.`); continue; }
    const sourceStart = words[start].start;
    const sourceEnd = Math.min(words[end].end, sourceStart + settings.maxDuration);
    if (sourceEnd - sourceStart < settings.minDuration - 0.001) { issues.push(`"${label}" lasts only ${(sourceEnd - sourceStart).toFixed(2)}s; choose a passage of at least ${settings.minDuration}s.`); continue; }
    const content = cleanContent(candidate);
    if (content.headline.length < 2) issues.push(`"${label}" has no headline text.`);
    const keyPoint = String(candidate?.keyPoint ?? '').trim(); const why = String(candidate?.whyThisGraphicMatters ?? '').trim(); const takeaway = String(candidate?.viewerTakeaway ?? '').trim(); const brief = String(candidate?.designBrief ?? '').trim();
    if (keyPoint.length < 8) issues.push(`"${label}" is missing a useful keyPoint.`);
    if (why.length < 12) issues.push(`"${label}" does not explain why this graphic earns its place.`);
    if (brief.length < 40) issues.push(`"${label}" needs a fuller designBrief (layout, motion sequence, emphasis).`);
    const policy = contentPolicyIssue(content, true);
    if (policy) issues.push(`"${label}" on-screen text violates Meta ad policy: ${policy}`);
    const number = scenes.length + 1;
    scenes.push({
      id: `motion-${String(number).padStart(3, '0')}`, title: label.slice(0, 100), startWordId: words[start].id, endWordId: words[end].id, sourceStart, sourceEnd,
      narration: words.slice(start, end + 1).map((word) => word.text).join(' '), graphicType: typeOf(candidate?.graphicType), placement: placementOf(candidate?.placement),
      keyPoint, whyThisGraphicMatters: why, viewerTakeaway: takeaway, content, designBrief: brief, enabled: true, status: 'none',
    });
    previousStart = start; previousEnd = sourceEnd; previousLabel = label;
  }
  if (!scenes.length) issues.push('The response contains no valid motion-graphic beats.');
  else if (expected && scenes.length !== expected) issues.push(`The response contains ${scenes.length} valid graphics, but exactly ${expected} are required.`);
  if (issues.length) throw new MotionPlanValidationError(issues);
  return { scenes, notes: Array.isArray(raw?.notes) ? raw.notes.map((note: unknown) => String(note)) : [] };
}

// Several graphics render in parallel and each saves the shared plan; queue the writes and swap files atomically.
const saveQueues = new Map<string, Promise<unknown>>();
export function saveMotionPlan(workDir: string, plan: MotionPlan) {
  const write = async () => {
    await fs.mkdir(path.join(workDir, 'motion'), { recursive: true });
    const target = path.join(workDir, 'motion-plan.json'); const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(plan, null, 2)); await fs.rename(temporary, target);
  };
  const next = (saveQueues.get(workDir) ?? Promise.resolve()).catch(() => undefined).then(write);
  saveQueues.set(workDir, next); return next;
}
export async function loadMotionPlan(workDir: string): Promise<MotionPlan | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(workDir, 'motion-plan.json'), 'utf8')) as MotionPlan;
    if (raw.version !== 1) return null;
    raw.settings = normalizeMotionSettings(raw.settings);
    for (const scene of raw.scenes ?? []) {
      // A crash mid-render must not leave a scene stuck in "generating" forever.
      if (scene.status === 'generating') scene.status = scene.videoFile ? 'ready' : 'none';
      scene.content = cleanContent(scene.content);
      scene.graphicType = typeOf(scene.graphicType); scene.placement = placementOf(scene.placement);
      if (scene.videoFile && !await fs.stat(scene.videoFile).then((stat) => stat.isFile()).catch(() => false)) { scene.videoFile = undefined; scene.renderedAt = undefined; if (scene.status === 'ready') scene.status = 'none'; }
    }
    return raw;
  } catch { return null; }
}

export async function createMotionPlan(options: {
  textConfig: TextModelConfig; workDir: string; words: BrollWord[]; keepRanges?: BrollKeepRange[];
  orientation: 'portrait' | 'landscape'; broll: BrollPlan | null; settings?: Partial<MotionSettings>;
}) {
  const settings = normalizeMotionSettings(options.settings); const { workDir, words, keepRanges } = options;
  const choice: TextModelChoice = { provider: settings.planningProvider, model: settings.planningModel };
  const { kept } = keptWordIndexes(words, keepRanges); const { times, duration } = keptTimeline(words, keepRanges);
  const transcript = words.map((word, index) => ({ word, index })).filter(({ index }) => kept.has(index)).map(({ word, index }) => {
    const t = times.get(index)!; return `[${word.id} source:${word.start.toFixed(3)}-${word.end.toFixed(3)} final:${t.start.toFixed(3)}-${t.end.toFixed(3)}] ${word.text}`;
  }).join('\n');
  const occupied: Occupied[] = (options.broll?.scenes ?? []).filter((scene) => scene.enabled).map((scene) => ({ start: scene.sourceStart, end: scene.sourceEnd, label: `B-roll "${scene.title}"` }));
  const brollLines = occupied.length ? occupied.map((slot) => `- ${slot.label}: source ${slot.start.toFixed(2)}s–${slot.end.toFixed(2)}s`).join('\n') : '(no B-roll planned)';
  const expected = targetCount(duration, settings);
  const frame = options.orientation === 'portrait' ? 'vertical 9:16 (1080×1920)' : 'landscape 16:9 (1920×1080)';
  const countInstruction = expected ? `Create exactly ${expected} motion graphics.` : 'Choose only the moments where an animated graphic genuinely helps. Fewer, sharper graphics beat filler.';
  const typeGuide = MOTION_GRAPHIC_TYPES.map((type) => `- ${type.id}: ${type.description}`).join('\n');
  const prompt = `You are the motion-design director for a premium talking-head video (${frame}). Decide WHERE professional animated motion graphics make the spoken idea clearer, more memorable or easier to follow — the way top explainer channels use them. The presenter stays visible; graphics are overlays on transparent background.\n\n${countInstruction}\n\nWHAT MAKES A GOOD MOTION-GRAPHIC BEAT\n- A concrete fact, number, list, sequence, comparison, definition or key phrase the viewer should retain. Skip vague or purely emotional sentences.\n- The graphic must add clarity, not repeat the whole sentence. On-screen text is SHORT: headline ≤ 6 words, subhead ≤ 12 words, at most 5 items, each label ≤ 4 words.\n- Only use facts stated in the narration. Never invent statistics, percentages, prices or guarantees.\n- Vary graphicType across the video; do not use the same type back to back.\n- Choose placement so the graphic never covers the presenter's face: 'bottom' or 'top' for compact graphics, 'center' only for brief full-attention moments, 'full' for a large visual that may dominate the frame.\n\nGRAPHIC TYPES\n${typeGuide}\n\nHARD RULES\n- Each graphic covers ONE continuous spoken passage (startWordId..endWordId) of ${settings.minDuration}–${settings.maxDuration} seconds. Use only supplied word IDs, chronological order, no removed words inside.\n- Base placement purely on the narration. Ignore any B-roll; overlaps are fixed later in the timeline.\n- designBrief: 2–4 sentences describing layout, the motion sequence (what enters first, how it emphasises the key number/word, how it exits) and the visual mood. Colour palette: accent ${settings.accentColor}, base ${settings.secondaryColor}.${settings.styleNotes ? `\n- House style: ${settings.styleNotes}` : ''}\n\n${metaTextGuidelinesPrompt()}\nOn-screen text must obey these rules too (no before/after claims, guarantees, or exaggerated medical claims).\n\nNARRATION WORDS:\n${transcript}`;
  let attemptPrompt = prompt; let lastIssues: string[] = []; let planned: ReturnType<typeof validatePlan> | null = null;
  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
    let raw: any;
    try { raw = await generateStructuredText({ config: options.textConfig, choice, workDir, prompt: attemptPrompt, schema: planSchema(expected), outputName: 'motion-plan' }); }
    catch (error) { raw = null; lastIssues = [`The motion plan failed: ${error instanceof Error ? error.message : String(error)}`]; }
    if (raw) {
      try { planned = validatePlan(words, keepRanges, raw, settings, occupied, expected); break; }
      catch (error) { if (!(error instanceof MotionPlanValidationError)) throw error; lastIssues = error.issues; }
    }
    if (attempt < MAX_PLAN_ATTEMPTS) attemptPrompt = `${prompt}\n\nREPAIR PASS ${attempt} OF ${MAX_PLAN_ATTEMPTS - 1}\nThe previous plan failed validation. Return a complete replacement plan and fix every issue:\n${lastIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\nPREVIOUS PLAN:\n${raw ? JSON.stringify(raw, null, 2) : '(unparseable response)'}`;
  }
  if (!planned) {
    const logPath = await writePlanningFailureLog(workDir, 'motion-plan', choice, MAX_PLAN_ATTEMPTS, lastIssues);
    throw new Error(`${planningModelLabel(choice)} could not produce a valid motion-graphics plan after ${MAX_PLAN_ATTEMPTS} attempts.${logPath ? ` Diagnostic log: ${logPath}` : ''}\nRemaining issues:\n${lastIssues.map((issue) => `- ${issue}`).join('\n')}`);
  }
  const narration = words.filter((_, index) => kept.has(index)).map((word) => word.text).join(' ');
  const complianceNotes = scanMetaText(narration).map((finding) => formatMetaFinding(finding, 'the narration'));
  const plan: MotionPlan = { version: 1, orientation: options.orientation, settings, scenes: planned.scenes, notes: [...planned.notes, ...complianceNotes] };
  // Ids restart at motion-001, so clips rendered for the previous plan must not be mistaken for the new ones.
  await fs.rm(path.join(workDir, 'motion'), { recursive: true, force: true });
  await saveMotionPlan(workDir, plan); return plan;
}

/** Basic sanity check shared by manual edits. Overlaps with B-roll or other graphics are allowed; the timeline handles those. */
function assertMotionTiming(plan: MotionPlan, scene: MotionScene, start: number, end: number, broll: BrollPlan | null) {
  if (end <= start) throw new Error('Motion graphic end time must be after its start time');
  if (end - start > 15) throw new Error('Motion graphics can be at most 15 seconds long');
}

export type MotionScenePatch = {
  title?: string; enabled?: boolean; sourceStart?: number; sourceEnd?: number; graphicType?: string; placement?: string; templateId?: string | null;
  headline?: string; subhead?: string; items?: MotionItem[]; designBrief?: string;
};
export async function updateMotionScene(workDir: string, plan: MotionPlan, sceneId: string, patch: MotionScenePatch, broll: BrollPlan | null) {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('Motion graphic not found');
  const start = Number.isFinite(patch.sourceStart) ? Math.max(0, Number(patch.sourceStart)) : scene.sourceStart;
  const end = Number.isFinite(patch.sourceEnd) ? Math.max(0, Number(patch.sourceEnd)) : scene.sourceEnd;
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : scene.enabled;
  const timingChanged = Math.abs(start - scene.sourceStart) > 0.0005 || Math.abs(end - scene.sourceEnd) > 0.0005;
  if (enabled && (timingChanged || (patch.enabled === true && !scene.enabled))) assertMotionTiming(plan, scene, start, end, broll);
  else if (end <= start) throw new Error('Motion graphic end time must be after its start time');
  let renderAffected = timingChanged;
  if (typeof patch.title === 'string' && patch.title.trim()) scene.title = patch.title.trim().slice(0, 100);
  if (typeof patch.enabled === 'boolean') scene.enabled = patch.enabled;
  if (patch.graphicType && typeOf(patch.graphicType) !== scene.graphicType) { scene.graphicType = typeOf(patch.graphicType); scene.code = undefined; scene.codeGeneratedAt = undefined; renderAffected = true; }
  if (patch.placement && placementOf(patch.placement) !== scene.placement) { scene.placement = placementOf(patch.placement); scene.code = undefined; scene.codeGeneratedAt = undefined; renderAffected = true; }
  if (typeof patch.designBrief === 'string' && patch.designBrief.trim() && patch.designBrief.trim() !== scene.designBrief) { scene.designBrief = patch.designBrief.trim(); scene.code = undefined; scene.codeGeneratedAt = undefined; renderAffected = true; }
  if (patch.templateId !== undefined) {
    const next = patch.templateId && /^[\w-]{1,40}$/.test(patch.templateId) ? patch.templateId : undefined;
    if (next !== scene.templateId) { scene.templateId = next; scene.code = undefined; scene.codeGeneratedAt = undefined; renderAffected = true; }
  }
  const nextContent = cleanContent({ headline: patch.headline ?? scene.content.headline, subhead: patch.subhead ?? scene.content.subhead, items: patch.items ?? scene.content.items });
  if (JSON.stringify(nextContent) !== JSON.stringify(scene.content)) {
    const policy = contentPolicyIssue(nextContent, false);
    if (policy) throw new Error(`On-screen text violates Meta ad policy: ${policy}`);
    scene.content = nextContent; renderAffected = true;
  }
  scene.sourceStart = start; scene.sourceEnd = end;
  if (renderAffected && scene.videoFile && scene.status === 'ready') scene.status = 'none';
  await saveMotionPlan(workDir, plan); return scene;
}
export async function updateMotionSettings(workDir: string, plan: MotionPlan, patch: Partial<MotionSettings>) {
  const previousDefault = plan.settings.defaultTemplateId || '';
  plan.settings = normalizeMotionSettings({ ...plan.settings, ...patch });
  // Scenes without their own template inherit the default, so their stored code no longer matches the reference: redesign on next render.
  if ((plan.settings.defaultTemplateId || '') !== previousDefault) for (const scene of plan.scenes) if (!scene.templateId && scene.status !== 'generating') { scene.code = undefined; scene.codeGeneratedAt = undefined; }
  await saveMotionPlan(workDir, plan); return plan;
}
export async function deleteMotionScene(workDir: string, plan: MotionPlan, sceneId: string) {
  const index = plan.scenes.findIndex((scene) => scene.id === sceneId); if (index < 0) throw new Error('Motion graphic not found');
  const [scene] = plan.scenes.splice(index, 1);
  if (scene.videoFile) await fs.rm(scene.videoFile, { force: true });
  await fs.rm(path.join(workDir, 'motion', scene.id), { recursive: true, force: true });
  await saveMotionPlan(workDir, plan); return plan;
}

const CODE_SCHEMA = { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string' } } };

function sceneDimensions(plan: MotionPlan) { return plan.orientation === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }; }
function sceneDuration(scene: MotionScene) { return Math.round((scene.sourceEnd - scene.sourceStart) * 100) / 100; }
function sceneProps(plan: MotionPlan, scene: MotionScene) {
  return { headline: scene.content.headline, subhead: scene.content.subhead, items: scene.content.items, accentColor: plan.settings.accentColor, baseColor: plan.settings.secondaryColor, placement: scene.placement };
}

function templateSection(template: { name: string; notes: string } | null, graphicType: string) {
  if (!template) return '';
  return `\nREFERENCE TEMPLATE — "${template.name}"${template.notes ? ` (${template.notes})` : ''}\nThe attached image is the client's brand template. Recreate its look as closely as you can in code: layout structure, card shapes and corner radii, colour palette (sample the actual colours from the image; they take precedence over accentColor/baseColor), typography weight and hierarchy, icon style, decoration (leaf/blur accents, gradients, badges, dividers) and spacing. If the image is a contact sheet of several numbered layouts, use the panel whose purpose best matches the graphic type "${graphicType}" and ignore the rest. Rules for using it:\n- Rebuild everything with vector shapes/CSS/SVG. Do NOT embed photos, people, screenshots or the logo image; leave photo areas out or use a clean gradient shape instead. Keep the background transparent apart from the template's own cards.\n- Take all text from the props, never from the picture (the picture's sample copy is only an example). Malayalam or other Indic text may appear in props: keep it readable with fontFamily including 'Noto Sans Malayalam', 'Malayalam Sangam MN'.\n- Keep the professional motion rules below; the template defines the look, not the animation, so still animate it with springs and staggers.\n`;
}

function designSystemPrompt(plan: MotionPlan, scene: MotionScene, template: { name: string; notes: string } | null = null) {
  const { width, height } = sceneDimensions(plan); const fps = 30; const seconds = sceneDuration(scene); const frames = Math.round(seconds * fps);
  const portrait = height > width;
  const safe = portrait
    ? `VERTICAL 9:16 safe area: keep all essential content between x=${Math.round(width * 0.07)}..${Math.round(width * 0.93)} and y=${Math.round(height * 0.1)}..${Math.round(height * 0.78)}. The bottom ~22% is reserved for platform UI and burned-in captions. The presenter's face is usually in the upper-middle third.`
    : `LANDSCAPE 16:9 safe area: keep essential content inside a ${Math.round(width * 0.06)}px margin on all sides; lower-third graphics sit in y=${Math.round(height * 0.62)}..${Math.round(height * 0.9)}.`;
  const placementRule = { top: 'Anchor the composition to the TOP third.', center: 'Centre the composition in the frame.', bottom: 'Anchor the composition to the lower part of the safe area (above the caption zone).', full: 'Use the whole safe area with a large, confident composition.' }[scene.placement];
  return `You are a senior motion designer writing ONE Remotion (React) component that renders a broadcast-quality animated overlay. It is composited over a live presenter, so the background must stay TRANSPARENT.\n\nCANVAS: ${width}×${height}px, ${fps} fps, ${frames} frames (${seconds}s). ${safe} ${placementRule}\n\nFILE CONTRACT (strict)\n- A single TSX file. \`export default function Scene(props)\` — a React function component. Props (already provided, never hard-code the text): ${JSON.stringify(sceneProps(plan, scene))}\n  - headline: string, subhead: string, items: {label:string; value:string}[], accentColor: hex, baseColor: hex, placement: string.\n  - Render whatever fields are non-empty; tolerate empty subhead/items. Do NOT hard-code copy so text edits re-render without regenerating.\n- Allowed imports ONLY: react, remotion, @remotion/shapes, @remotion/paths, @remotion/noise. Nothing else. No images, no network, no fonts to download, no CSS @import, no external URLs.\n- Use remotion APIs: useCurrentFrame, useVideoConfig, interpolate, spring, Easing, AbsoluteFill, Sequence. Derive ALL motion from the frame number (deterministic). Never use Math.random, Date, setTimeout, CSS transitions or CSS keyframe animations. For randomness use \`random(seed)\` from remotion.\n- Root element: <AbsoluteFill> with NO background colour (transparent). Draw only the graphic itself.\n- Fonts: system stack only — fontFamily: "Poppins, Montserrat, Inter, 'SF Pro Display', -apple-system, 'Noto Sans Malayalam', 'Malayalam Sangam MN', 'Helvetica Neue', Arial, sans-serif". Use font weights 600–900 for headlines, tabular-nums for counters.\n\nPROFESSIONAL DESIGN BAR\n- Timeline: entrance 0–0.7s, hold, exit in the final 0.5s so the last frame is fully transparent. Everything that enters must also leave.\n- Motion: springs with damping ≈ 12–20 for entrances, Easing.bezier(0.16,1,0.3,1) or Easing.out(Easing.cubic) for wipes; stagger related elements 3–6 frames apart; animate opacity, translate, scale and clip/mask reveals together. Numbers count up with an ease-out. Lines and rings draw with stroke-dashoffset. Never let elements pop in without easing.\n- Hierarchy: one dominant element (large, high contrast), one supporting line, everything else subordinate. Headline size ≈ ${portrait ? '84–120px' : '72–104px'}, subhead ≈ ${portrait ? '40–52px' : '34–44px'}. Minimum text size ${portrait ? 40 : 32}px so it is legible on a phone.\n- Look: modern, premium, restrained. Solid or softly gradient cards (baseColor with 88–95% opacity), generous padding, 24–36px radius, subtle 1px inner highlight, layered soft shadows (0 20px 60px rgba(0,0,0,.35)), accentColor used sparingly for emphasis bars, underlines, numbers and icons. Ensure text contrast ≥ 4.5:1 on its own card. No neon clutter, no clip-art, no emoji, no drop-shadow text glow.\n- Build icons/illustrations from simple SVG shapes (paths, circles, rounded rects). Keep them geometric and clean.\n- Layout must never overflow the safe area; measure long text conservatively (wrap with maxWidth, clamp line count), and scale down gracefully if items are many.\n- Performance: no heavy filters (avoid blur > 20px, avoid huge box-shadows on many elements), keep DOM small.\n\n${templateSection(template, scene.graphicType)}\nGRAPHIC TYPE: ${scene.graphicType}\nDESIGN BRIEF: ${scene.designBrief}\nNARRATION IT ACCOMPANIES: "${scene.narration}"\n${plan.settings.styleNotes ? `HOUSE STYLE: ${plan.settings.styleNotes}\n` : ''}\nReturn ONLY JSON {"code": "<the full TSX source>"}.`;
}

export async function generateMotionCode(options: { textConfig: TextModelConfig; workDir: string; plan: MotionPlan; scene: MotionScene; previousCode?: string; feedback?: string; comment?: string; signal?: AbortSignal }) {
  const { plan, scene } = options;
  const choice: TextModelChoice = plan.settings.codeProvider ? { provider: plan.settings.codeProvider, model: plan.settings.codeModel || '' } : { provider: plan.settings.planningProvider, model: plan.settings.planningModel };
  // Copy the reference into the project so tool-restricted CLIs (which only see workDir) can open it.
  const templateId = scene.templateId || plan.settings.defaultTemplateId;
  const found = templateId ? await motionTemplatePath(templateId) : null;
  let reference: string | undefined;
  if (found) { const dir = path.join(options.workDir, 'motion', 'reference'); await fs.mkdir(dir, { recursive: true }); reference = path.join(dir, found.entry.file); await fs.copyFile(found.file, reference); }
  let prompt = designSystemPrompt(plan, scene, found ? found.entry : null);
  if (options.comment?.trim()) prompt += `\n\nUSER REQUEST FOR THIS REVISION:\n${options.comment.trim()}`;
  if (options.feedback) prompt += `\n\nYOUR PREVIOUS ATTEMPT FAILED. Fix these problems and return the complete corrected file:\n${options.feedback}${options.previousCode ? `\n\nPREVIOUS CODE:\n${options.previousCode}` : ''}`;
  else if (options.previousCode && options.comment?.trim()) prompt += `\n\nCURRENT CODE TO REVISE:\n${options.previousCode}`;
  const raw = await generateStructuredText({ config: options.textConfig, choice, workDir: options.workDir, prompt, schema: CODE_SCHEMA, outputName: `motion-code-${scene.id}`, images: reference ? [reference] : undefined, signal: options.signal }) as { code?: unknown };
  const code = String(raw?.code ?? '').replace(/^```(?:tsx|typescript|jsx|ts)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  return { code, choice };
}

/**
 * Generate (if needed) and render one motion graphic. Reuses stored code when only text or timing changed;
 * asks the model for new code when there is none, when asked to revise, or when a render fails (up to 3 attempts).
 */
export async function generateMotionScene(options: {
  textConfig: TextModelConfig; workDir: string; plan: MotionPlan; sceneId: string; chromeBin?: string; ffmpegBin: string;
  regenerateCode?: boolean; comment?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal;
}) {
  const { plan, workDir } = options; const scene = plan.scenes.find((candidate) => candidate.id === options.sceneId);
  if (!scene) throw new Error('Motion graphic not found');
  const previousStatus = scene.status; scene.status = 'generating'; scene.error = undefined; scene.renderProgress = 0; await saveMotionPlan(workDir, plan);
  const { width, height } = sceneDimensions(plan); const outputPath = path.join(workDir, 'motion', `${scene.id}.webm`);
  const revising = Boolean(options.regenerateCode || options.comment?.trim());
  let feedback: string | undefined; let lastError = ''; let candidate = scene.code; let mustGenerate = revising || !scene.code;
  try {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
      if (options.signal?.aborted) throw new Error('Render stopped');
      if (mustGenerate) {
        const generated = await generateMotionCode({ textConfig: options.textConfig, workDir, plan, scene, previousCode: candidate, feedback, comment: attempt === 1 ? options.comment : undefined, signal: options.signal });
        candidate = generated.code || candidate;
        const problems = validateMotionCode(generated.code);
        if (problems.length) { feedback = problems.map((problem, i) => `${i + 1}. ${problem}`).join('\n'); lastError = feedback; continue; }
        scene.code = generated.code; scene.codeGeneratedAt = new Date().toISOString(); scene.codeModel = planningModelLabel(generated.choice);
        feedback = undefined;
      }
      try {
        await renderMotionScene({
          sceneDir: path.join(workDir, 'motion', scene.id), code: scene.code!, props: sceneProps(plan, scene), width, height, fps: 30,
          durationSeconds: sceneDuration(scene), outputPath, chromeBin: options.chromeBin, ffmpegBin: options.ffmpegBin, signal: options.signal,
          onProgress: (fraction) => { scene.renderProgress = fraction; options.onProgress?.(fraction); },
        });
        scene.videoFile = outputPath; scene.renderedAt = new Date().toISOString();
        scene.status = 'ready'; scene.error = undefined; scene.renderProgress = 1; await saveMotionPlan(workDir, plan);
        return scene;
      } catch (error) {
        if (options.signal?.aborted) throw new Error('Render stopped');
        lastError = error instanceof Error ? error.message : String(error);
        feedback = `The component failed to bundle or render with Remotion:\n${lastError.slice(-2500)}`; candidate = scene.code; mustGenerate = true;
      }
    }
    throw new Error(`Could not produce a working motion graphic after ${MAX_CODE_ATTEMPTS} attempts.\n${lastError.slice(-1500)}`);
  } catch (error) {
    if (options.signal?.aborted) { scene.status = scene.videoFile && previousStatus === 'ready' ? 'ready' : 'none'; scene.error = undefined; scene.renderProgress = undefined; await saveMotionPlan(workDir, plan).catch(() => undefined); throw new Error('Render stopped'); }
    scene.status = scene.videoFile ? (previousStatus === 'ready' ? 'ready' : 'none') : 'failed'; scene.error = error instanceof Error ? error.message : String(error);
    await saveMotionPlan(workDir, plan).catch(() => undefined);
    throw error;
  }
}
