import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, type Project, type Word } from './project-store.js';

export type StickScene = [number, string, string, number, string];
export type StickDraft = { scenes: StickScene[]; words: Word[]; music: number; sfx: number };
export type StickRender = { state: 'running' | 'ready' | 'failed'; progress: number; url?: string; error?: string };

export const stickFaces = ['neutral', 'happy', 'surprised', 'thinking', 'smirk'];
const root = path.resolve('remotion/stick-reel');
const assets = path.resolve('assets/stick-reel');
const draftPath = (project: Project) => path.join(project.workDir, 'stick-draft.json');

export function makeStickDraft(words: Word[]): StickDraft {
  const scenes: StickScene[] = [];
  let last = -4;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word.start - last < 3.6 || scenes.length >= 80) continue;
    const headline = words.slice(index, index + 4).map(item => item.text).join(' ').slice(0, 65);
    const note = words.slice(index, index + 9).map(item => item.text).join(' ').slice(0, 115);
    last = scenes.length ? word.start : 0;
    scenes.push([last, headline, note, 7, stickFaces[scenes.length % stickFaces.length]]);
  }
  return { scenes: scenes.length ? scenes : [[0, 'Your opening hook', 'Add your first visual beat', 7, 'neutral']], words, music: .27, sfx: .7 };
}

export function validateStickDraft(value: StickDraft, duration: number): StickDraft {
  if (!value || !Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 100 ||
    !Array.isArray(value.words) || value.words.length > 4000 ||
    ![value.music, value.sfx].every(gain => Number.isFinite(gain) && gain >= 0 && gain <= 1)) {
    throw new Error('Provide 1–100 scenes, up to 4,000 caption words, and mix levels between 0 and 1.');
  }
  const scenes = value.scenes.map((scene, i): StickScene => {
    if (!Array.isArray(scene) || scene.length !== 5) throw new Error(`Scene ${i + 1} must have five values.`);
    const [at, title, note, mode, face] = scene;
    if (!Number.isFinite(at) || at < 0 || at >= duration || (i === 0 ? at !== 0 : at <= value.scenes[i - 1][0]) ||
      typeof title !== 'string' || !title.trim() || title.length > 80 || typeof note !== 'string' || note.length > 140 ||
      !Number.isInteger(mode) || mode < 0 || mode > 7 || !stickFaces.includes(face)) {
      throw new Error(`Check the timing, headline, preset and expression on scene ${i + 1}.`);
    }
    return [at, title.trim(), note.trim(), mode, face];
  });
  const words = value.words.map((word, i) => {
    if (!word || typeof word.text !== 'string' || !word.text.trim() || word.text.length > 100 ||
      !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 ||
      word.start >= duration || word.end < word.start || (i && word.start < value.words[i - 1].start)) {
      throw new Error(`Check the caption word at position ${i + 1}.`);
    }
    return { id: typeof word.id === 'string' ? word.id.slice(0, 100) : String(i), text: word.text.trim(),
      start: word.start, end: Math.min(word.end, duration) };
  });
  return { scenes, words, music: value.music, sfx: value.sfx };
}

export async function loadStickDraft(project: Project) {
  const stored = await fs.readFile(draftPath(project), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  return stored ? validateStickDraft(JSON.parse(stored), project.media.duration) : makeStickDraft(project.transcript?.words ?? []);
}
export async function saveStickDraft(project: Project, input: StickDraft) {
  const draft = validateStickDraft(input, project.media.duration);
  await atomicWriteJson(draftPath(project), draft);
  return draft;
}

let bundled: Promise<string> | undefined;
async function stickBundle() {
  bundled ??= (async () => {
    await Promise.all(stickFaces.map(face => fs.access(path.join(root, 'local', 'stick-demo', `${face}.png`))))
      .catch(() => { throw new Error('Add the five expression PNGs to remotion/stick-reel/local/stick-demo.'); });
    const { bundle } = await import('@remotion/bundler');
    return bundle({ entryPoint: path.join(root, 'index.tsx'), publicDir: path.join(root, 'local') });
  })().catch(error => { bundled = undefined; throw error; });
  return bundled;
}

export const stickMusicPath = (project: Project) => path.join(project.workDir, 'stick-music.m4a');

export async function renderStickReel(options: {
  project: Project; draft: StickDraft; visual: string; output: string; chromeBin?: string | null;
  ffmpeg: (args: string[]) => Promise<unknown>; progress: (value: number) => void;
}) {
  const { project, draft, visual, output, progress, ffmpeg } = options;
  const { selectComposition, renderMedia } = await import('@remotion/renderer');
  const serveUrl = await stickBundle();
  const inputProps = { scenes: draft.scenes, words: draft.words, duration: project.media.duration };
  const browserExecutable = options.chromeBin || undefined;
  const composition = await selectComposition({ serveUrl, id: 'ReelStudio', inputProps, browserExecutable });
  await renderMedia({ serveUrl, composition, inputProps, browserExecutable, codec: 'h264',
    muted: true, outputLocation: visual, onProgress: ({ progress: fraction }) => progress(.05 + fraction * .85) });
  const duration = composition.durationInFrames / 30;
  const fade = Math.min(1.4, duration / 4);
  const track = await fs.access(stickMusicPath(project)).then(() => stickMusicPath(project), () => path.join(assets, 'tech-bed.mp3'));
  const inputs = ['-i', visual, '-i', project.sourcePath, '-stream_loop', '-1', '-i', track,
    ...['sweep', 'pop', 'chime'].flatMap(name => ['-i', path.join(assets, `${name}.mp3`)])];
  const filter = [
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${duration},asplit=2[voice][key]`,
    `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${draft.music},atrim=duration=${duration},afade=t=in:d=${fade / 3},afade=t=out:st=${duration - fade}:d=${fade}[bed]`,
    '[bed][key]sidechaincompress=threshold=.035:ratio=5:attack=22:release=320[music]',
  ];
  const cues = draft.scenes.flatMap(([start, , , mode], i) => {
    const end = draft.scenes[i + 1]?.[0] ?? duration;
    return [
      { start, effect: 0, gain: .085 },
      ...(end - start > 1.9 ? [{ start: start + 1.8, effect: 1, gain: .08 }] : []),
      ...(end - start > 2.6 && (mode === 2 || mode === 3) ? [{ start: start + 2.1, effect: mode === 3 ? 2 : 1, gain: .19 }] : []),
    ];
  });
  for (const [effect, length] of [.4, .2, .6].entries()) {
    const matches = cues.map((cue, i) => ({ ...cue, i })).filter(cue => cue.effect === effect);
    if (!matches.length) continue;
    const source = `[${effect + 3}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${length},afade=t=out:st=${length * .7}:d=${length * .3}`;
    filter.push(matches.length > 1 ? `${source},asplit=${matches.length}${matches.map(cue => `[s${cue.i}]`).join('')}` : `${source}[s${matches[0].i}]`);
    for (const cue of matches) filter.push(`[s${cue.i}]volume=${draft.sfx * cue.gain},adelay=${Math.round(cue.start * 1000)}:all=1[e${cue.i}]`);
  }
  filter.push(`[voice][music]${cues.map((_, i) => `[e${i}]`).join('')}amix=inputs=${2 + cues.length}:duration=first:normalize=0,alimiter=limit=.95:level=0:latency=1[a]`);
  await ffmpeg(['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filter.join(';'),
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', output]);
}
