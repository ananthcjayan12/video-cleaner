import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ImageProvider, ImageProviderConfig } from './broll.js';

export type ThumbnailReference = { id: string; name: string; file: string; bytes: number };
export type ThumbnailState = {
  version: 1;
  hook?: string;
  references: ThumbnailReference[];
  referencesUpdatedAt?: string;
  imageFile?: string;
  generatedAt?: string;
  provider?: Extract<ImageProvider, 'gemini' | 'codex-cli'>;
  model?: string;
  prompt?: string;
};
export type ThumbnailStateView = Omit<ThumbnailState, 'references' | 'imageFile'> & {
  references: Array<Pick<ThumbnailReference, 'id' | 'name' | 'bytes'>>;
  hasImage: boolean;
};

type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };

async function run(command: string, args: string[], stdin?: string, timeoutMs = 0, options?: RunOptions) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, cwd: options?.cwd, env: options?.env });
    let stdout = ''; let stderr = ''; let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`)); });
    child.stdin.end(stdin ?? '');
  });
}

function statePath(workDir: string) { return path.join(workDir, 'thumbnail', 'state.json'); }
function thumbnailDir(workDir: string) { return path.join(workDir, 'thumbnail'); }
function thumbnailImagePath(workDir: string) { return path.join(thumbnailDir(workDir), 'thumbnail.png'); }

export async function loadThumbnailState(workDir: string): Promise<ThumbnailState> {
  try {
    const state = JSON.parse(await fs.readFile(statePath(workDir), 'utf8')) as ThumbnailState;
    if (state.version !== 1) throw new Error('Unsupported thumbnail state');
    state.references = Array.isArray(state.references) ? state.references : [];
    return state;
  } catch {
    return { version: 1, references: [] };
  }
}

async function saveThumbnailState(workDir: string, state: ThumbnailState) {
  await fs.mkdir(thumbnailDir(workDir), { recursive: true });
  await fs.writeFile(statePath(workDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function thumbnailStateView(state: ThumbnailState): ThumbnailStateView {
  return {
    version: 1,
    hook: state.hook,
    references: state.references.map(({ id, name, bytes }) => ({ id, name, bytes })),
    referencesUpdatedAt: state.referencesUpdatedAt,
    generatedAt: state.generatedAt,
    provider: state.provider,
    model: state.model,
    prompt: state.prompt,
    hasImage: Boolean(state.imageFile),
  };
}

async function ensureGitRepo(workDir: string) {
  const gitDir = path.join(workDir, '.git');
  const stat = await fs.stat(gitDir).catch(() => null);
  if (stat?.isDirectory()) return;
  await run('git', ['init', '-q'], undefined, 10000, { cwd: workDir });
}

async function compressReference(sourcePath: string, outputPath: string, ffmpegBin: string) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await run(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
    '-vf', 'scale=900:-2:force_original_aspect_ratio=decrease',
    '-frames:v', '1', '-q:v', '5', outputPath,
  ], undefined, 120000);
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 1_000) throw new Error(`Could not prepare thumbnail reference ${path.basename(sourcePath)}`);
  return stat.size;
}

export async function replaceThumbnailReferences(options: { workDir: string; sourcePaths: string[]; ffmpegBin?: string }) {
  if (!options.ffmpegBin) throw new Error('FFmpeg is required to compress thumbnail reference images.');
  const selected = options.sourcePaths.filter(Boolean).slice(0, 6);
  if (!selected.length) throw new Error('Choose at least one thumbnail reference image.');
  const dir = path.join(thumbnailDir(options.workDir), 'references');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const references: ThumbnailReference[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const sourcePath = selected[index];
    const id = `ref-${String(index + 1).padStart(2, '0')}`;
    const file = path.join(dir, `${id}.jpg`);
    const bytes = await compressReference(sourcePath, file, options.ffmpegBin);
    references.push({ id, name: path.basename(sourcePath), file, bytes });
  }
  const state = await loadThumbnailState(options.workDir);
  if (state.imageFile) await fs.rm(state.imageFile, { force: true }).catch(() => undefined);
  state.references = references;
  state.referencesUpdatedAt = new Date().toISOString();
  state.imageFile = undefined;
  state.generatedAt = undefined;
  state.provider = undefined;
  state.model = undefined;
  state.prompt = undefined;
  await saveThumbnailState(options.workDir, state);
  return state;
}

function findBase64Image(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'object') {
    if (typeof value.data === 'string' && (value.type === 'image' || value.mime_type?.startsWith?.('image/'))) return value.data;
    if (typeof value.b64_json === 'string') return value.b64_json;
    if (value.output_image) { const nested = findBase64Image(value.output_image); if (nested) return nested; }
    for (const child of Object.values(value)) { const nested = findBase64Image(child); if (nested) return nested; }
  }
  if (Array.isArray(value)) for (const child of value) { const nested = findBase64Image(child); if (nested) return nested; }
  return undefined;
}

function thumbnailPrompt(options: { projectName: string; transcript: string; hook?: string; referenceNames: string[] }) {
  const transcript = options.transcript.trim().slice(0, 5000);
  const hook = options.hook?.trim();
  return `Create ONE premium vertical 9:16 social-media thumbnail for a dental education reel.

STYLE / BRAND REFERENCES:
The supplied reference images are examples of the desired thumbnail language and brand identity. Study them closely for the teal + white clinic palette, logo treatment, bold mobile-readable hierarchy, rounded title panels, premium dental-clinic atmosphere, high contrast, depth, and the balance between a main subject and a supporting dental visual. Use them as STYLE AND BRAND references, not as frames to copy literally.
Reference files: ${options.referenceNames.join(', ')}.

BRAND CONSISTENCY:
- Preserve the same teal / deep teal / white visual identity shown in the references.
- If the clinic logo or recognizable logo treatment appears in a reference, keep its colors, proportions and visual identity consistent. Do not invent a different logo.
- Keep the result visually part of the same Smile Craft / dental-tips thumbnail family.
- Use a clean premium modern clinic look, not a generic stock poster.

CONTENT:
Project: ${options.projectName}
Narration/topic: ${transcript || options.projectName}
${hook ? `Required thumbnail hook: "${hook}". Use this wording prominently and keep spelling exactly as provided.` : 'Derive one short, curiosity-driven hook from the narration. Keep it concise enough to read instantly on a phone.'}

COMPOSITION:
- Vertical 9:16, optimized for Instagram Reels / YouTube Shorts.
- One dominant focal subject relevant to the exact topic. A realistic person is allowed when it helps the hook; otherwise use a compelling dental/medical subject.
- Add ONE supporting dental inset / anatomical visual / treatment object only when it helps explain the topic.
- Strong foreground/background separation, premium clinic lighting, polished depth and realistic materials.
- Bold large headline with excellent mobile readability. Malayalam + English mixing is allowed when it naturally matches the hook/reference style.
- Keep the logo/brand area clean and visible.
- Avoid clutter, tiny text, long paragraphs, extra unrelated procedures, fake UI, watermarks, or random branding.
- Do not reproduce the reference person's identity unless that exact person is intentionally part of the selected reference and the prompt explicitly requires them.

The final result should feel like a professionally art-directed thumbnail in the same visual family as the supplied references, while being specific to this video's actual topic.`;
}

async function generateWithGemini(prompt: string, references: ThumbnailReference[], config: ImageProviderConfig, outputPath: string) {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  const model = config.geminiModel || 'gemini-3.1-flash-image';
  const images = await Promise.all(references.map(async (reference) => ({
    type: 'image',
    mime_type: 'image/jpeg',
    data: (await fs.readFile(reference.file)).toString('base64'),
  })));
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': config.geminiApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ type: 'text', text: prompt }, ...images],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '9:16', image_size: '2K' },
    }),
  });
  if (!response.ok) throw new Error(`Gemini thumbnail generation failed: ${response.status} ${await response.text()}`);
  const encoded = findBase64Image(await response.json());
  if (!encoded) throw new Error('Gemini thumbnail generation returned no image data');
  await fs.writeFile(outputPath, Buffer.from(encoded, 'base64'));
  return model;
}

async function generateWithCodex(prompt: string, references: ThumbnailReference[], config: ImageProviderConfig, workDir: string, outputPath: string) {
  if (!config.codexBin) throw new Error('Codex CLI was not found.');
  const dir = thumbnailDir(workDir);
  await fs.mkdir(dir, { recursive: true });
  await ensureGitRepo(dir);
  const outputName = path.basename(outputPath);
  await fs.rm(outputPath, { force: true });
  const referenceList = references.map((reference) => path.relative(dir, reference.file)).join(', ');
  const agentPrompt = `$imagegen

Study these local reference images before generating: ${referenceList}
Use them as visual/brand references for palette, logo treatment, typography hierarchy and overall art direction.

${prompt}

Generate ONE finished vertical 9:16 thumbnail using HIGH image quality.
Save the finished image in the current working directory as:
${outputName}

Use Codex built-in image generation. Do NOT call the OpenAI API manually. Do NOT create a Python image generation script. Actually inspect the references and generate the image.`;
  const env: NodeJS.ProcessEnv = { ...process.env }; delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
  await run(config.codexBin, ['exec', '--ephemeral', '--sandbox', 'workspace-write', agentPrompt], undefined, 900000, { cwd: dir, env });
  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10_000) throw new Error('Codex completed without creating a usable thumbnail image.');
  return 'Codex $imagegen (high)';
}

async function normalizeThumbnail(rawPath: string, outputPath: string, ffmpegBin?: string) {
  if (!ffmpegBin) { await fs.copyFile(rawPath, outputPath); return; }
  await run(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920',
    '-frames:v', '1', outputPath,
  ], undefined, 120000);
}

export async function generateProjectThumbnail(options: {
  workDir: string;
  projectName: string;
  transcript: string;
  hook?: string;
  provider: ImageProvider;
  config: ImageProviderConfig;
}) {
  if (options.provider !== 'gemini' && options.provider !== 'codex-cli') {
    throw new Error('Reference-driven thumbnail generation currently supports Gemini API or Codex CLI. Select Gemini or Codex as the image provider.');
  }
  const state = await loadThumbnailState(options.workDir);
  if (!state.references.length) throw new Error('Add one or more thumbnail reference images first so the generator can follow the clinic brand and style.');
  const prompt = thumbnailPrompt({ projectName: options.projectName, transcript: options.transcript, hook: options.hook, referenceNames: state.references.map((reference) => reference.name) });
  const dir = thumbnailDir(options.workDir);
  await fs.mkdir(dir, { recursive: true });
  const rawPath = path.join(dir, 'thumbnail.raw.png');
  const outputPath = thumbnailImagePath(options.workDir);
  await fs.rm(rawPath, { force: true });
  let model: string;
  if (options.provider === 'gemini') model = await generateWithGemini(prompt, state.references, options.config, rawPath);
  else model = await generateWithCodex(prompt, state.references, options.config, options.workDir, rawPath);
  await normalizeThumbnail(rawPath, outputPath, options.config.ffmpegBin);
  if (rawPath !== outputPath) await fs.rm(rawPath, { force: true }).catch(() => undefined);
  state.hook = options.hook?.trim() || undefined;
  state.imageFile = outputPath;
  state.generatedAt = new Date().toISOString();
  state.provider = options.provider;
  state.model = model;
  state.prompt = prompt;
  await saveThumbnailState(options.workDir, state);
  return state;
}

export async function thumbnailImageFile(workDir: string) {
  const state = await loadThumbnailState(workDir);
  if (!state.imageFile) return undefined;
  const stat = await fs.stat(state.imageFile).catch(() => null);
  return stat?.isFile() ? state.imageFile : undefined;
}

export async function thumbnailReferenceFile(workDir: string, referenceId: string) {
  const state = await loadThumbnailState(workDir);
  const reference = state.references.find((candidate) => candidate.id === referenceId);
  if (!reference) return undefined;
  const stat = await fs.stat(reference.file).catch(() => null);
  return stat?.isFile() ? reference.file : undefined;
}
