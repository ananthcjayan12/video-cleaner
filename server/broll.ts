import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type BrollWord = { id: string; text: string; start: number; end: number };
export type BrollKeepRange = { startWordId: string; endWordId: string };

export type BrollScene = {
  id: string;
  title: string;
  startWordId: string;
  endWordId: string;
  sourceStart: number;
  sourceEnd: number;
  narration: string;
  visualIntent: string;
  shotType: string;
  imagePrompt: string;
  imageFile?: string;
  generatedAt?: string;
};

export type BrollPlan = {
  version: 1;
  orientation: 'portrait' | 'landscape';
  stylePreset: string;
  scenes: BrollScene[];
  notes: string[];
};

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

const BROLL_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes', 'notes'],
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'startWordId', 'endWordId', 'narration', 'visualIntent', 'shotType', 'imagePrompt'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          startWordId: { type: 'string' },
          endWordId: { type: 'string' },
          narration: { type: 'string' },
          visualIntent: { type: 'string' },
          shotType: { type: 'string' },
          imagePrompt: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

async function run(command: string, args: string[], stdin?: string, timeoutMs = 0) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${command} timed out`));
      }, timeoutMs);
    }
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`));
    });
    child.stdin.end(stdin ?? '');
  });
}

function keptWordIndexes(words: BrollWord[], ranges: BrollKeepRange[]) {
  const index = new Map(words.map((word, position) => [word.id, position]));
  const kept = new Set<number>();
  for (const range of ranges) {
    const start = index.get(range.startWordId);
    const end = index.get(range.endWordId);
    if (start === undefined || end === undefined || start > end) continue;
    for (let position = start; position <= end; position += 1) kept.add(position);
  }
  return { index, kept };
}

function validatePlan(words: BrollWord[], keepRanges: BrollKeepRange[], raw: any, orientation: 'portrait' | 'landscape'): BrollPlan {
  const { index, kept } = keptWordIndexes(words, keepRanges);
  const scenes: BrollScene[] = [];
  let previousStart = -1;

  for (const candidate of raw.scenes ?? []) {
    const start = index.get(candidate.startWordId);
    const end = index.get(candidate.endWordId);
    if (start === undefined || end === undefined || start > end) continue;
    if (!kept.has(start) || !kept.has(end)) continue;
    if (start < previousStart) continue;

    const narrationWords: string[] = [];
    for (let position = start; position <= end; position += 1) {
      if (kept.has(position)) narrationWords.push(words[position].text);
    }
    if (!narrationWords.length) continue;

    const imagePrompt = String(candidate.imagePrompt ?? '').trim();
    if (imagePrompt.length < 40) continue;

    const sceneNumber = scenes.length + 1;
    scenes.push({
      id: `scene-${String(sceneNumber).padStart(3, '0')}`,
      title: String(candidate.title ?? `Scene ${sceneNumber}`).trim().slice(0, 100) || `Scene ${sceneNumber}`,
      startWordId: words[start].id,
      endWordId: words[end].id,
      sourceStart: words[start].start,
      sourceEnd: words[end].end,
      narration: narrationWords.join(' '),
      visualIntent: String(candidate.visualIntent ?? '').trim(),
      shotType: String(candidate.shotType ?? '').trim(),
      imagePrompt,
    });
    previousStart = start;
  }

  if (!scenes.length) throw new Error('Codex did not return any valid B-roll scenes');
  return {
    version: 1,
    orientation,
    stylePreset: BROLL_STYLE_PRESET,
    scenes,
    notes: Array.isArray(raw.notes) ? raw.notes.map((note: unknown) => String(note)) : [],
  };
}

export async function createBrollPlan(options: {
  codexBin: string;
  workDir: string;
  words: BrollWord[];
  keepRanges: BrollKeepRange[];
  orientation: 'portrait' | 'landscape';
}) {
  const { codexBin, workDir, words, keepRanges, orientation } = options;
  const { kept } = keptWordIndexes(words, keepRanges);
  const cleanedTranscript = words
    .map((word, index) => ({ word, index }))
    .filter(({ index }) => kept.has(index))
    .map(({ word }) => `[${word.id} ${word.start.toFixed(3)}-${word.end.toFixed(3)}] ${word.text}`)
    .join('\n');

  const schemaPath = path.join(workDir, 'broll-plan.schema.json');
  const outputPath = path.join(workDir, 'codex-broll-plan.json');
  await fs.writeFile(schemaPath, JSON.stringify(BROLL_PLAN_SCHEMA, null, 2));

  const aspect = orientation === 'portrait' ? 'vertical 9:16 social-video frame' : 'landscape 16:9 video frame';
  const prompt = `You are the B-roll director and image-prompt writer for a polished talking-head video.\n\nAnalyze ONLY the cleaned spoken words below. Group the narration into distinct visual ideas and create one useful B-roll still for each major semantic scene. A scene is usually about 4-8 seconds of speech. Do not create a new scene for every sentence when consecutive lines describe the same idea. Do not invent claims that are not supported by the narration.\n\nEvery scene must use startWordId and endWordId from the supplied CLEANED WORDS. Keep scene order chronological. Prefer concrete visuals over abstract symbolism. The B-roll should enhance the narration rather than literally show a person speaking to camera.\n\nTARGET FRAME: ${aspect}.\n\nREFERENCE VISUAL LANGUAGE:\n${BROLL_STYLE_PRESET}\n\nPROMPT-WRITING RULES:\n- imagePrompt must be a complete standalone production prompt, not shorthand.\n- Describe the exact subject, action, environment, wardrobe/props, camera distance, lens perspective, lighting, depth of field, composition and realism details.\n- For healthcare or dental scenes, be clinically believable: correct PPE, tools and patient positioning; no gore.\n- When a South-Asian/Indian context is natural, explicitly say so. Avoid generic Western-looking stock imagery unless the narration requires it.\n- Keep important faces/actions inside the central safe area because the generated image may be cropped to ${aspect}.\n- Explicitly request natural skin texture, realistic hands/teeth/anatomy and a real-camera photographic look.\n- Explicitly forbid text, logos, watermarks and artificial/CGI appearance.\n- Avoid repeating the same composition across adjacent scenes; vary close-up, medium, environmental and detail shots when appropriate.\n\nCLEANED WORDS:\n${cleanedTranscript}`;

  await run(codexBin, ['exec', '--ephemeral', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], prompt);
  const raw = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  const plan = validatePlan(words, keepRanges, raw, orientation);
  await saveBrollPlan(workDir, plan);
  return plan;
}

export async function saveBrollPlan(workDir: string, plan: BrollPlan) {
  await fs.mkdir(path.join(workDir, 'broll'), { recursive: true });
  await fs.writeFile(path.join(workDir, 'broll-plan.json'), JSON.stringify(plan, null, 2));
}

export async function loadBrollPlan(workDir: string): Promise<BrollPlan | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(workDir, 'broll-plan.json'), 'utf8')) as BrollPlan;
  } catch {
    return null;
  }
}

export async function updateBrollScene(workDir: string, plan: BrollPlan, sceneId: string, patch: { imagePrompt?: string; title?: string }) {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error('B-roll scene not found');
  if (typeof patch.title === 'string' && patch.title.trim()) scene.title = patch.title.trim().slice(0, 100);
  if (typeof patch.imagePrompt === 'string' && patch.imagePrompt.trim()) scene.imagePrompt = patch.imagePrompt.trim();
  await saveBrollPlan(workDir, plan);
  return scene;
}

function generatedImagePrompt(scene: BrollScene, orientation: 'portrait' | 'landscape') {
  const aspect = orientation === 'portrait' ? 'vertical 9:16' : 'landscape 16:9';
  return `${scene.imagePrompt}\n\nFINAL QUALITY BAR: ${BROLL_STYLE_PRESET}\n\nDeliver one hyper-realistic photographic still composed for a ${aspect} B-roll frame. The result must look like a frame captured on a real premium camera in a real location. Keep the essential subject and action safely centered for the final crop. Absolutely no text, captions, logos, watermark or graphic-design elements.`;
}

export async function generateBrollImage(options: {
  openAiApiKey: string;
  imageModel: string;
  ffmpegBin: string;
  workDir: string;
  plan: BrollPlan;
  sceneId: string;
}) {
  const { openAiApiKey, imageModel, ffmpegBin, workDir, plan, sceneId } = options;
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error('B-roll scene not found');

  const portrait = plan.orientation === 'portrait';
  const size = portrait ? '1024x1536' : '1536x1024';
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: imageModel,
      prompt: generatedImagePrompt(scene, plan.orientation),
      size,
      quality: 'high',
    }),
  });

  if (!response.ok) throw new Error(`OpenAI image generation failed: ${response.status} ${await response.text()}`);
  const payload: any = await response.json();
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new Error('OpenAI image generation returned no image data');

  const brollDir = path.join(workDir, 'broll');
  await fs.mkdir(brollDir, { recursive: true });
  const rawPath = path.join(brollDir, `${scene.id}.raw.png`);
  const outputPath = path.join(brollDir, `${scene.id}.png`);
  await fs.writeFile(rawPath, Buffer.from(encoded, 'base64'));

  if (ffmpegBin) {
    const filter = portrait
      ? 'crop=864:1536:(iw-864)/2:0,scale=1080:1920:flags=lanczos'
      : 'crop=1536:864:0:(ih-864)/2,scale=1920:1080:flags=lanczos';
    await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath, '-vf', filter, '-frames:v', '1', outputPath], undefined, 120000);
    await fs.rm(rawPath, { force: true });
  } else {
    await fs.rename(rawPath, outputPath);
  }

  scene.imageFile = outputPath;
  scene.generatedAt = new Date().toISOString();
  await saveBrollPlan(workDir, plan);
  return scene;
}
