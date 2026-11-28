/**
 * Music and sound effects for talking-head reels, the same way stick reels do them: the music bed ducks under the
 * voice (sidechain), and short effects from the local motion-sfx library mark what happens on screen.
 *
 * - a low hit when the talk starts,
 * - a whoosh into each B-roll picture and a soft swish back to the face,
 * - a light pop on some highlighted caption words (at most one every few seconds).
 *
 * Built from the mastered voice (auto/speech-master.wav), so it can be run again on a finished reel: only the sound
 * track is rebuilt and the picture is copied, never re-encoded.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { CaptionPhrase } from './captions.js';
import { resolveSingleSfx, type ResolvedSfxCue } from './stick-reel.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REEL_MUSIC = path.join(repoRoot, 'assets', 'stick-reel', 'tech-bed.mp3');
const exec = promisify(execFile);

export type ReelSoundCue = { at: number; sfx: string; gainScale: number };
const WHOOSHES = ['whoosh-transitions-swoosh-quick-low', 'whoosh-transitions-simple-whoosh-1', 'whoosh-transitions-swoosh-fast-1'];

/** Where the effects go, on the edited timeline. Same restraint as stick reels: at least 0.45 s apart, at most 48. */
export function reelSoundCues(broll: Array<{ start: number; end: number }>, phrases: CaptionPhrase[], duration: number): ReelSoundCue[] {
  const cues: ReelSoundCue[] = [];
  if (phrases[0]) cues.push({ at: Math.max(0, phrases[0].start), sfx: 'impacts-deep-hit-2', gainScale: 0.9 });
  broll.forEach((scene, i) => {
    cues.push({ at: scene.start, sfx: WHOOSHES[i % WHOOSHES.length], gainScale: 1 });
    if (scene.end < duration - 0.5) cues.push({ at: scene.end, sfx: 'whoosh-transitions-swish-1', gainScale: 0.55 });
  });
  let lastPop = -Infinity;
  for (const phrase of phrases) {
    const word = phrase.words.find((item) => item.key);
    if (!word || word.at - lastPop < 4.5 || word.at > duration - 0.3) continue;
    if (cues.some((cue) => Math.abs(cue.at - word.at) < 1.5)) continue;
    cues.push({ at: word.at, sfx: 'ui-pop-sound', gainScale: 0.6 }); lastPop = word.at;
  }
  cues.sort((a, b) => a.at - b.at);
  const spaced: ReelSoundCue[] = [];
  for (const cue of cues) {
    if (spaced.length >= 48) break;
    const prev = spaced.at(-1);
    if (prev && cue.at - prev.at < 0.45) continue;
    spaced.push(cue);
  }
  return spaced;
}

/** Voice + ducked music + effects, loudness-matched, written as an AAC file. */
export async function mixReelSound(options: { ffmpegBin: string; speech: string; cues: ReelSoundCue[]; duration: number; output: string; music?: string; musicGain?: number; sfxGain?: number }) {
  const { ffmpegBin, speech, duration } = options;
  const musicGain = options.musicGain ?? 0.25; const sfxGain = options.sfxGain ?? 0.75;
  const track = options.music ?? REEL_MUSIC;
  const hasMusic = musicGain > 0 && await fs.access(track).then(() => true, () => false);
  const resolved: ResolvedSfxCue[] = [];
  const runFfmpeg = (args: string[]) => exec(ffmpegBin, args, { maxBuffer: 16 * 1024 * 1024 });
  for (const cue of options.cues) {
    const sound = await resolveSingleSfx(cue, { useOpenverse: false, runFfmpeg });
    if (sound) resolved.push(sound);
  }
  const files = [...new Set(resolved.map((cue) => cue.filePath))];
  const inputs = ['-i', speech, ...(hasMusic ? ['-stream_loop', '-1', '-i', track] : []), ...files.flatMap((file) => ['-i', file])];
  const sfxBase = hasMusic ? 2 : 1;
  const d = duration.toFixed(3); const fade = Math.min(1.4, duration / 4);
  const filter = [`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${d}${hasMusic ? ',asplit=2[voice][key]' : '[voice]'}`];
  if (hasMusic) filter.push(
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${musicGain},atrim=duration=${d},afade=t=in:d=${(fade / 3).toFixed(3)},afade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade.toFixed(3)}[bed]`,
    '[bed][key]sidechaincompress=threshold=.035:ratio=5:attack=22:release=320[music]',
  );
  files.forEach((file, f) => {
    const uses = resolved.map((cue, i) => ({ cue, i })).filter(({ cue }) => cue.filePath === file);
    filter.push(`[${sfxBase + f}:a]aformat=sample_rates=48000:channel_layouts=stereo${uses.length > 1 ? `,asplit=${uses.length}` : ''}${uses.map(({ i }) => `[s${i}]`).join('')}`);
    for (const { cue, i } of uses) {
      const gain = Math.max(0.01, Math.min(1, cue.gain * sfxGain));
      filter.push(`[s${i}]atrim=start=${cue.sourceOffset.toFixed(3)}:end=${(cue.sourceOffset + cue.clipDuration).toFixed(3)},asetpts=PTS-STARTPTS,`
        + `afade=t=out:st=${(cue.clipDuration * 0.75).toFixed(3)}:d=${Math.max(0.02, cue.clipDuration * 0.25).toFixed(3)},volume=${gain.toFixed(4)},`
        + `adelay=${Math.max(0, Math.round((cue.at - cue.lead) * 1000))}:all=1[e${i}]`);
    }
  });
  const mix = ['[voice]', ...(hasMusic ? ['[music]'] : []), ...resolved.map((_, i) => `[e${i}]`)];
  filter.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=.95:level=0:latency=1,atrim=duration=${d}[a]`);
  await exec(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter.join(';'), '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', options.output], { maxBuffer: 16 * 1024 * 1024 });
  return { effects: resolved.length, music: hasMusic };
}

/** Swap a video's sound for `audio`, copying the picture. Written next to it, then renamed over it. */
export async function replaceSound(ffmpegBin: string, video: string, audio: string) {
  const temporary = video.replace(/\.mp4$/, '.sound.part.mp4');
  await exec(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', temporary], { maxBuffer: 16 * 1024 * 1024 });
  await fs.rename(temporary, video);
}

/** Music and effects for a reel made by the auto pipeline (its auto/ folder), on the final reel and its phone preview. */
export async function addReelSound(options: { ffmpegBin: string; autoDir: string; phrases: CaptionPhrase[]; duration: number; videos: string[]; cues?: ReelSoundCue[] }) {
  const placed = JSON.parse(await fs.readFile(path.join(options.autoDir, 'broll-placed.json'), 'utf8').catch(() => '{"scenes":[]}')) as { scenes: Array<{ start: number; end: number }> };
  // Planned sounds (reel-motion.ts) when there is a motion plan; otherwise the simple fixed set below.
  const cues = options.cues ?? reelSoundCues(placed.scenes ?? [], options.phrases, options.duration);
  const audio = path.join(options.autoDir, 'sound-mix.m4a');
  const result = await mixReelSound({ ffmpegBin: options.ffmpegBin, speech: path.join(options.autoDir, 'speech-master.wav'), cues, duration: options.duration, output: audio });
  for (const video of options.videos) if (await fs.access(video).then(() => true, () => false)) await replaceSound(options.ffmpegBin, video, audio);
  return result;
}
