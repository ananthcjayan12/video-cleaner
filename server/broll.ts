import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type BrollWord = { id: string; text: string; start: number; end: number };
export type BrollKeepRange = { startWordId: string; endWordId: string };
export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';
export type BrollWorkflowMode = 'cleaned-video' | 'raw-video' | 'assets-only';
export type BrollCountMode = 'auto' | 'exact' | 'per-minute';

export type BrollPlanSettings = {
  workflowMode: BrollWorkflowMode;
  provider: ImageProvider;
  countMode: BrollCountMode;
  targetCount: number;
  imagesPerMinute: number;
  minSceneDuration: number;
  maxSceneDuration: number;
  aspectRatio: 'auto' | '9:16' | '16:9';
};

export type BrollScene = {
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number;
  narration: string; visualIntent: string; shotType: string; imagePrompt: string; videoPrompt?: string; enabled: boolean;
  imageFile?: string; generatedAt?: string; provider?: ImageProvider | 'manual'; model?: string;
  videoFile?: string; videoGeneratedAt?: string; videoModel?: string;
};

export type BrollPlan = { version: 2; orientation: 'portrait' | 'landscape'; stylePreset: string; settings: BrollPlanSettings; scenes: BrollScene[]; notes: string[] };
export type ImageProviderConfig = { openAiApiKey?: string; openAiModel?: string; geminiApiKey?: string; geminiModel?: string; grokBin?: string; grokModel?: string; grokVideoModel?: string; codexBin?: string; ffmpegBin?: string };
type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };

export const BROLL_STYLE_PRESET = [
  'Hyper-realistic premium commercial photography that looks like a genuine frame from a high-end live-action video, never like illustration or CGI.',
  'When people are relevant, prefer authentic South-Asian / Indian adults and believable contemporary Indian environments unless the narration clearly requires another context.',
  'Natural skin texture with pores and fine hair, realistic teeth, hands, eyes, fabrics, food and medical/dental instruments; anatomically and procedurally plausible.',
  'Soft natural daylight or clean diffused practical lighting, restrained cinematic contrast, neutral accurate skin tones, realistic material response, subtle depth and highlight rolloff.',
  'Use a modern full-frame camera look with an appropriate 35mm, 50mm or 85mm prime-lens perspective, shallow but believable depth of field and smooth optical bokeh.',
  'Composition should feel candid and editorial rather than posed stock photography. Keep the main subject and important action inside the central safe area for a social-video crop.',
  'Premium clean clinic, home or lifestyle production design when appropriate, with convincing small environmental details and no distracting clutter.',
  'No text, captions, typography, logos, watermarks, brand marks, UI, borders or poster design.',
  'Avoid plastic skin, excessive beauty retouching, oversharpening, surreal lighting, orange/teal grading, impossible reflections, malformed teeth, extra fingers, duplicated tools, uncanny faces or obviously AI-generated details.',
].join(' ');

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
function targetSceneCount(words: BrollWord[], ranges: BrollKeepRange[] | undefined, settings: BrollPlanSettings) {
  if (settings.countMode === 'exact') return Math.max(1, Math.min(40, Math.round(settings.targetCount || 1))); if (settings.countMode !== 'per-minute') return 0;
  const { kept } = keptWordIndexes(words, ranges); const keptWords = words.filter((_word, index) => kept.has(index)); if (!keptWords.length) return 0; const duration = Math.max(1, keptWords.at(-1)!.end - keptWords[0].start); return Math.max(1, Math.min(40, Math.round(duration / 60 * Math.max(0.5, settings.imagesPerMinute || 4))));
}
function planSchema(exactCount = 0) { return { type: 'object', additionalProperties: false, required: ['scenes', 'notes'], properties: { scenes: { type: 'array', ...(exactCount ? { minItems: exactCount, maxItems: exactCount } : {}), items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'startWordId', 'endWordId', 'narration', 'visualIntent', 'shotType', 'imagePrompt'], properties: { id: { type: 'string' }, title: { type: 'string' }, startWordId: { type: 'string' }, endWordId: { type: 'string' }, narration: { type: 'string' }, visualIntent: { type: 'string' }, shotType: { type: 'string' }, imagePrompt: { type: 'string' } } } }, notes: { type: 'array', items: { type: 'string' } } } }; }
function normalizeSettings(raw: Partial<BrollPlanSettings> | undefined): BrollPlanSettings {
  const workflowMode: BrollWorkflowMode = ['cleaned-video', 'raw-video', 'assets-only'].includes(String(raw?.workflowMode)) ? raw!.workflowMode as BrollWorkflowMode : 'cleaned-video';
  const provider: ImageProvider = ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(raw?.provider)) ? raw!.provider as ImageProvider : 'gemini';
  const countMode: BrollCountMode = ['auto', 'exact', 'per-minute'].includes(String(raw?.countMode)) ? raw!.countMode as BrollCountMode : 'auto';
  const aspectRatio = ['auto', '9:16', '16:9'].includes(String(raw?.aspectRatio)) ? raw!.aspectRatio as BrollPlanSettings['aspectRatio'] : 'auto';
  return { workflowMode, provider, countMode, targetCount: Math.max(1, Math.min(40, Number(raw?.targetCount) || 6)), imagesPerMinute: Math.max(0.5, Math.min(20, Number(raw?.imagesPerMinute) || 5)), minSceneDuration: Math.max(1, Math.min(20, Number(raw?.minSceneDuration) || 3)), maxSceneDuration: Math.max(2, Math.min(30, Number(raw?.maxSceneDuration) || 8)), aspectRatio };
}
function validatePlan(words: BrollWord[], keepRanges: BrollKeepRange[] | undefined, raw: any, orientation: 'portrait' | 'landscape', settings: BrollPlanSettings): BrollPlan {
  const { index, kept } = keptWordIndexes(words, keepRanges); const scenes: BrollScene[] = []; let previousStart = -1;
  for (const candidate of raw.scenes ?? []) {
    const start = index.get(candidate.startWordId); const end = index.get(candidate.endWordId); if (start === undefined || end === undefined || start > end || !kept.has(start) || !kept.has(end) || start < previousStart) continue;
    const narrationWords: string[] = []; for (let position = start; position <= end; position += 1) if (kept.has(position)) narrationWords.push(words[position].text); const imagePrompt = String(candidate.imagePrompt ?? '').trim(); if (!narrationWords.length || imagePrompt.length < 40) continue;
    const sceneNumber = scenes.length + 1; scenes.push({ id: `scene-${String(sceneNumber).padStart(3, '0')}`, title: String(candidate.title ?? `Scene ${sceneNumber}`).trim().slice(0, 100) || `Scene ${sceneNumber}`, startWordId: words[start].id, endWordId: words[end].id, sourceStart: words[start].start, sourceEnd: words[end].end, narration: narrationWords.join(' '), visualIntent: String(candidate.visualIntent ?? '').trim(), shotType: String(candidate.shotType ?? '').trim(), imagePrompt, enabled: true }); previousStart = start;
  }
  if (!scenes.length) throw new Error('The planning agent did not return any valid B-roll scenes'); const expected = targetSceneCount(words, keepRanges, settings); if (expected && scenes.length !== expected) throw new Error(`The planning agent returned ${scenes.length} scenes; ${expected} were requested. Retry planning.`); return { version: 2, orientation, stylePreset: BROLL_STYLE_PRESET, settings, scenes, notes: Array.isArray(raw.notes) ? raw.notes.map((note: unknown) => String(note)) : [] };
}

export async function createBrollPlan(options: { codexBin: string; workDir: string; words: BrollWord[]; keepRanges?: BrollKeepRange[]; orientation: 'portrait' | 'landscape'; settings?: Partial<BrollPlanSettings> }) {
  const settings = normalizeSettings(options.settings); const { codexBin, workDir, words, keepRanges, orientation } = options; const { kept } = keptWordIndexes(words, keepRanges);
  const transcript = words.map((word, index) => ({ word, index })).filter(({ index }) => kept.has(index)).map(({ word }) => `[${word.id} ${word.start.toFixed(3)}-${word.end.toFixed(3)}] ${word.text}`).join('\n');
  const requestedCount = targetSceneCount(words, keepRanges, settings); const schemaPath = path.join(workDir, 'broll-plan.schema.json'); const outputPath = path.join(workDir, 'codex-broll-plan.json'); await fs.writeFile(schemaPath, JSON.stringify(planSchema(requestedCount), null, 2));
  const targetAspect = settings.aspectRatio === 'auto' ? (orientation === 'portrait' ? 'vertical 9:16' : 'landscape 16:9') : settings.aspectRatio; const countInstruction = requestedCount ? `Create exactly ${requestedCount} B-roll scenes.` : `Choose the number of scenes automatically. Prefer one strong image per major idea, usually ${settings.minSceneDuration}-${settings.maxSceneDuration} seconds apart.`;
  const prompt = `You are the B-roll director and image-prompt writer for a polished talking-head video.\n\n${countInstruction}\n\nAnalyze ONLY the supplied narration words. Group narration into distinct visual ideas and do not invent unsupported claims. Every scene must use supplied word IDs and stay chronological.\n\nTARGET FRAME: ${targetAspect}.\nTARGET SCENE DURATION: normally ${settings.minSceneDuration}-${settings.maxSceneDuration} seconds.\n\nREFERENCE VISUAL LANGUAGE:\n${BROLL_STYLE_PRESET}\n\nWrite complete standalone image prompts with exact subject/action/environment/camera/lens/light/composition/realism. Healthcare/dental scenes must be clinically believable. Prefer authentic Indian context when natural. Require natural skin, hands, teeth/anatomy, real-camera photography, and no text/logos/watermarks/CGI. Vary adjacent compositions.\n\nNARRATION WORDS:\n${transcript}`;
  await run(codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt); const plan = validatePlan(words, keepRanges, JSON.parse(await fs.readFile(outputPath, 'utf8')), orientation, settings); await saveBrollPlan(workDir, plan); return plan;
}

export async function saveBrollPlan(workDir: string, plan: BrollPlan) { await fs.mkdir(path.join(workDir, 'broll'), { recursive: true }); await fs.writeFile(path.join(workDir, 'broll-plan.json'), JSON.stringify(plan, null, 2)); }
export async function loadBrollPlan(workDir: string): Promise<BrollPlan | null> { try { const raw = JSON.parse(await fs.readFile(path.join(workDir, 'broll-plan.json'), 'utf8')) as BrollPlan; return raw.version === 2 ? raw : null; } catch { return null; } }
export async function updateBrollScene(workDir: string, plan: BrollPlan, sceneId: string, patch: { imagePrompt?: string; videoPrompt?: string; title?: string; sourceStart?: number; sourceEnd?: number; enabled?: boolean }) {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found');
  if (typeof patch.title === 'string' && patch.title.trim()) scene.title = patch.title.trim().slice(0, 100); if (typeof patch.imagePrompt === 'string' && patch.imagePrompt.trim()) scene.imagePrompt = patch.imagePrompt.trim(); if (typeof patch.videoPrompt === 'string') scene.videoPrompt = patch.videoPrompt.trim() || undefined; if (typeof patch.enabled === 'boolean') scene.enabled = patch.enabled;
  const nextStart = Number.isFinite(patch.sourceStart) ? Math.max(0, Number(patch.sourceStart)) : scene.sourceStart; const nextEnd = Number.isFinite(patch.sourceEnd) ? Math.max(0, Number(patch.sourceEnd)) : scene.sourceEnd; if (nextEnd <= nextStart) throw new Error('B-roll end time must be after start time'); scene.sourceStart = nextStart; scene.sourceEnd = nextEnd; await saveBrollPlan(workDir, plan); return scene;
}
export async function deleteBrollScene(workDir: string, plan: BrollPlan, sceneId: string) { const index = plan.scenes.findIndex((scene) => scene.id === sceneId); if (index < 0) throw new Error('B-roll scene not found'); const [scene] = plan.scenes.splice(index, 1); await Promise.all([scene.imageFile ? fs.rm(scene.imageFile, { force: true }) : Promise.resolve(), scene.videoFile ? fs.rm(scene.videoFile, { force: true }) : Promise.resolve()]); await saveBrollPlan(workDir, plan); return plan; }

function targetAspect(plan: BrollPlan) { if (plan.settings.aspectRatio !== 'auto') return plan.settings.aspectRatio; return plan.orientation === 'portrait' ? '9:16' : '16:9'; }
function generatedImagePrompt(scene: BrollScene, plan: BrollPlan) { return `${scene.imagePrompt}\n\nFINAL QUALITY BAR: ${BROLL_STYLE_PRESET}\n\nDeliver exactly one hyper-realistic photographic still composed for a ${targetAspect(plan)} B-roll frame. It must look captured on a real premium camera. Keep the essential subject/action safely centered. Absolutely no text, captions, logos, watermark or graphic-design elements.`; }
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

async function normalizeImage(rawPath: string, outputPath: string, aspect: '9:16' | '16:9', ffmpegBin?: string, removeSource = true) {
  if (!ffmpegBin) { await fs.copyFile(rawPath, outputPath); if (removeSource && rawPath !== outputPath) await fs.rm(rawPath, { force: true }); return; }
  const filter = aspect === '9:16' ? 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920' : 'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080';
  await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath, '-vf', filter, '-frames:v', '1', outputPath], undefined, 120000); if (removeSource && rawPath !== outputPath) await fs.rm(rawPath, { force: true });
}
export async function importBrollImage(options: { workDir: string; plan: BrollPlan; sceneId: string; sourcePath: string; ffmpegBin?: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); const brollDir = path.join(options.workDir, 'broll'); await fs.mkdir(brollDir, { recursive: true }); const outputPath = path.join(brollDir, `${scene.id}.png`);
  await normalizeImage(options.sourcePath, outputPath, targetAspect(options.plan), options.ffmpegBin, false); scene.imageFile = outputPath; scene.generatedAt = new Date().toISOString(); scene.provider = 'manual'; scene.model = 'manual-import'; if (scene.videoFile) { await fs.rm(scene.videoFile, { force: true }); scene.videoFile = undefined; scene.videoGeneratedAt = undefined; scene.videoModel = undefined; } await saveBrollPlan(options.workDir, options.plan); return scene;
}
export async function generateBrollImage(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; sceneId: string }) {
  const { config, workDir, plan, sceneId } = options; const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found'); const provider = plan.settings.provider; const aspect = targetAspect(plan); const prompt = generatedImagePrompt(scene, plan); const brollDir = path.join(workDir, 'broll'); await fs.mkdir(brollDir, { recursive: true }); const rawPath = path.join(brollDir, `${scene.id}.raw.png`); const outputPath = path.join(brollDir, `${scene.id}.png`); let model: string;
  if (provider === 'openai') model = await generateOpenAi(prompt, aspect, config, rawPath); else if (provider === 'gemini') model = await generateGemini(prompt, aspect, config, rawPath); else model = await generateWithAgentCli(provider, prompt, config, workDir, rawPath); await normalizeImage(rawPath, outputPath, aspect, config.ffmpegBin, true); scene.imageFile = outputPath; scene.generatedAt = new Date().toISOString(); scene.provider = provider; scene.model = model; if (scene.videoFile) { await fs.rm(scene.videoFile, { force: true }); scene.videoFile = undefined; scene.videoGeneratedAt = undefined; scene.videoModel = undefined; } await saveBrollPlan(workDir, plan); return scene;
}

export async function createVideoPrompt(options: { codexBin: string; workDir: string; plan: BrollPlan; sceneId: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.imageFile) throw new Error('Add or generate a B-roll image before creating video'); const schemaPath = path.join(options.workDir, `${scene.id}-video-prompt.schema.json`); const outputPath = path.join(options.workDir, `${scene.id}-video-prompt.json`); const schema = { type: 'object', additionalProperties: false, required: ['videoPrompt'], properties: { videoPrompt: { type: 'string' } } }; await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2)); const duration = Math.max(2, Math.min(12, scene.sourceEnd - scene.sourceStart));
  const prompt = `You are a cinematic image-to-video motion director. Write ONE production-ready motion prompt that animates the existing still image.\n\nNarration: ${scene.narration}\nVisual intent: ${scene.visualIntent}\nShot type: ${scene.shotType}\nStill-image prompt: ${scene.imagePrompt}\nTarget duration: about ${duration.toFixed(1)} seconds.\n\nPreserve exact people, identity, clothing, anatomy, environment, lighting, composition and clinical details. Add subtle believable breathing/blinking/hand/body/environment motion and restrained camera movement. Do not introduce people/objects/tools/text/logos; do not morph faces, hands, teeth or instruments; do not change ethnicity/age/wardrobe/room. Avoid dramatic camera moves, cuts, lip-sync unless required, and AI warping. Make it feel like real premium live action. Return only videoPrompt in the JSON schema.`;
  await run(options.codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt); const raw = JSON.parse(await fs.readFile(outputPath, 'utf8')); const videoPrompt = String(raw.videoPrompt ?? '').trim(); if (videoPrompt.length < 30) throw new Error('Codex returned an unusable video prompt'); scene.videoPrompt = videoPrompt; await saveBrollPlan(options.workDir, options.plan); return scene;
}
export async function generateBrollVideoWithGrokCli(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; sceneId: string }) {
  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.imageFile) throw new Error('Add or generate a B-roll image first'); if (!scene.videoPrompt) throw new Error('Create a Codex video prompt first'); if (!options.config.grokBin) throw new Error('Grok CLI was not found. Configure GROK_BIN or install Grok Build.'); const brollDir = path.join(options.workDir, 'broll'); const outputPath = path.join(brollDir, `${scene.id}.mp4`); await fs.rm(outputPath, { force: true }); const duration = Math.max(2, Math.min(12, scene.sourceEnd - scene.sourceStart)); const videoModel = options.config.grokVideoModel || 'grok-imagine-video-1.5';
  const agentPrompt = `Turn the local still image at ${scene.imageFile} into an image-to-video clip and save the final playable MP4 to this exact path: ${outputPath}\n\nUse the xAI/Grok Imagine image-to-video capability available in this Grok Build environment. Prefer model ${videoModel}. Target duration: ${duration.toFixed(1)} seconds. Use the source still as the starting image.\n\nMOTION PROMPT:\n${scene.videoPrompt}\n\nYou may use shell/code/tools available to Grok Build. Do not stop after instructions/code. The task is complete only after the MP4 exists. Do not modify the source still.`;
  const args = ['--no-auto-update', '--always-approve', '--cwd', options.workDir, '-p', agentPrompt, '--output-format', 'plain']; if (options.config.grokModel) args.splice(4, 0, '-m', options.config.grokModel); await run(options.config.grokBin, args, undefined, 900000); const stat = await fs.stat(outputPath).catch(() => null); if (!stat?.isFile() || stat.size < 50_000) throw new Error('Grok CLI completed without creating a usable MP4. The Grok CLI environment must have image-to-video capability/authentication.'); if (options.config.ffmpegBin) await run(options.config.ffmpegBin, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], undefined, 120000); scene.videoFile = outputPath; scene.videoGeneratedAt = new Date().toISOString(); scene.videoModel = videoModel; await saveBrollPlan(options.workDir, options.plan); return scene;
}

export function buildBrollOverlayFilter(options: { plan: BrollPlan; width: number; height: number; fps: number; cleanedSegments?: Array<{ start: number; end: number }> }) {
  const active = options.plan.scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile)); if (!active.length) throw new Error('Add at least one enabled B-roll image or video before exporting'); const parts: string[] = ['[0:v]setpts=PTS-STARTPTS[base0]']; let previous = 'base0';
  active.forEach((scene, index) => { const input = index + 1; const mediaLabel = `broll${index}`; const output = `base${index + 1}`; const duration = Math.max(0.1, scene.sourceEnd - scene.sourceStart); parts.push(`[${input}:v]scale=${options.width}:${options.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${options.width}:${options.height},setsar=1,trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS+${scene.sourceStart.toFixed(6)}/TB[${mediaLabel}]`); parts.push(`[${previous}][${mediaLabel}]overlay=0:0:eof_action=pass:enable='between(t,${scene.sourceStart.toFixed(6)},${scene.sourceEnd.toFixed(6)})'[${output}]`); previous = output; });
  if (options.cleanedSegments?.length) { const expression = options.cleanedSegments.map((segment) => `between(t\\,${segment.start.toFixed(6)}\\,${segment.end.toFixed(6)})`).join('+'); parts.push(`[${previous}]select='${expression}',setpts=N/${options.fps.toFixed(6)}/TB[vout]`); parts.push(`[0:a]aselect='${expression}',asetpts=N/SR/TB[aout]`); } else { parts.push(`[${previous}]setpts=PTS-STARTPTS[vout]`); parts.push('[0:a]asetpts=PTS-STARTPTS[aout]'); }
  return { filter: parts.join(';'), activeScenes: active };
}
