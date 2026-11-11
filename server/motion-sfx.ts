import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type MotionSoundCue = { soundId: string; time: number; gainDb: number };
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/motion-sfx');
/** peakTime, peakDb, loudnessDb and brightnessHz come from scripts/analyze-motion-sfx.mjs. */
export type MotionSoundEntry = {
  id: string; label: string; file: string; category: string; usage: string; duration: number; sampleRate: number;
  sha256: string; peakTime?: number; peakDb?: number; loudnessDb?: number; brightnessHz?: number;
};
export const MOTION_SOUNDS = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as MotionSoundEntry[];
export function motionSound(id: string) {
  const sound = MOTION_SOUNDS.find(item => item.id === id);
  if (!sound) throw new Error(`Unknown motion sound: ${id}`);
  return sound;
}
export function motionSoundPath(id: string) { return path.join(directory, motionSound(id).file); }
export function normalizeMotionSounds(raw: unknown, duration: number): MotionSoundCue[] {
  if (!Array.isArray(raw) || !Number.isFinite(duration) || duration <= 0) return [];
  return raw.slice(0, 3).flatMap(cue => {
    if (!cue || !MOTION_SOUNDS.some(sound => sound.id === cue.soundId) || !Number.isFinite(cue.time) || cue.time < 0 || cue.time >= duration) return [];
    return [{ soundId: cue.soundId, time: Math.round(cue.time * 30) / 30, gainDb: Number.isFinite(cue.gainDb) ? Math.max(-30, Math.min(-6, cue.gainDb)) : -16 }];
  }).filter(cue => cue.time < duration).sort((a, b) => a.time - b.time).filter((cue, i, cues) => !i || cue.time - cues[i - 1].time >= 0.12);
}
export const motionSoundSchema = {
  type: 'array', minItems: 1, maxItems: 3,
  items: { type: 'object', additionalProperties: false, required: ['soundId', 'time', 'gainDb'], properties: {
    soundId: { type: 'string', enum: MOTION_SOUNDS.map(sound => sound.id) },
    time: { type: 'number', minimum: 0 }, gainDb: { type: 'number', minimum: -30, maximum: -6 },
  } },
};
export const motionSoundPrompt = `SOUND DESIGN: Select 1–3 cues from the supplied VideoEditingSFX Free Pack for every graphic. Match the cut: use UI for text/card reveals, Whoosh & Transitions for movements, Impacts for major emphasis, Camera FX for photo/camera moments, Risers/Buildups before a reveal, Reverse FX for rewind/reverse motion, and Cinematic only for deliberately dramatic beats. Prefer punchy short effects over long ones unless the graphic has room for the full cue. Keep narration intelligible (usually -16 dB; never louder than -6 dB). time is seconds from this graphic's start, within its duration, snapped to 30fps. Describe the matching visual event in designBrief. No music, external audio or invented sound IDs. Return soundEffects: [{soundId,time,gainDb}]. Library:\n${MOTION_SOUNDS.map(s => `${s.id}: ${s.label} — ${s.category}, ${s.duration.toFixed(2)}s`).join('\n')}`;

/** Audio is encoded into the alpha WebM, so preview, trims, speed and export share one clock. */
export function motionSoundEncoding(cues: MotionSoundCue[], duration: number) {
  const valid = normalizeMotionSounds(cues, duration);
  if (!valid.length) return { inputs: [] as string[], output: [] as string[] };
  const filters = valid.map((cue, i) => {
    const length = Math.min(MOTION_SOUNDS.find(s => s.id === cue.soundId)!.duration, duration - cue.time);
    return `[${i + 1}:a]aresample=48000,atrim=duration=${length},asetpts=PTS-STARTPTS,volume=${cue.gainDb}dB,afade=t=out:st=${Math.max(0, length - 0.01)}:d=0.01,adelay=${Math.round(cue.time * 1000)}:all=1[sfx${i}]`;
  });
  filters.push(valid.map((_, i) => `[sfx${i}]`).join('') + `amix=inputs=${valid.length}:normalize=0,apad,atrim=duration=${duration}[sfx]`);
  return { inputs: valid.flatMap(cue => ['-i', motionSoundPath(cue.soundId)]), output: ['-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[sfx]', '-c:a', 'libopus', '-b:a', '128k'] };
}
