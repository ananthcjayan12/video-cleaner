#!/usr/bin/env node
// Measures every file in assets/motion-sfx/manifest.json with FFmpeg and writes the results back into the manifest:
//   peakTime    seconds into the file where the loudest 50 ms lands (where the sound "hits")
//   peakDb      sample peak in dBFS
//   loudnessDb  average level of the audible part in dB RMS
//   brightnessHz energy-weighted spectral centroid of the audible part
// The emotion planner uses peakTime to land each sound's hit on the spoken word and loudnessDb to level sounds against each other.
// Usage: node scripts/analyze-motion-sfx.mjs [--print]   (FFMPEG_BIN overrides the ffmpeg binary)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/motion-sfx');
const manifestPath = path.join(directory, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const WINDOW = 1102; // 50 ms at 22.05 kHz

function analyze(file) {
  const filters = `aresample=22050,asetnsamples=n=${WINDOW}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level,aspectralstats=win_size=512:measure=centroid,ametadata=mode=print:file=-`;
  const run = spawnSync(ffmpeg, ['-v', 'error', '-i', path.join(directory, file), '-af', filters, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${run.stderr}`);
  const frames = []; let frame = null;
  for (const line of run.stdout.split('\n')) {
    const header = /pts_time:([\d.]+)/.exec(line);
    if (header) { frame = { time: Number(header[1]), rms: -Infinity, peak: -Infinity, centroid: 0 }; frames.push(frame); continue; }
    if (!frame) continue;
    const [key, raw] = line.split('=');
    const value = Number(raw);
    if (key === 'lavfi.astats.Overall.RMS_level') frame.rms = value;
    else if (key === 'lavfi.astats.Overall.Peak_level') frame.peak = value;
    else if (key === 'lavfi.aspectralstats.1.centroid') frame.centroid = value;
  }
  const loud = frames.filter((item) => Number.isFinite(item.rms));
  if (!loud.length) throw new Error(`no audio measured in ${file}`);
  const top = loud.reduce((best, item) => item.rms > best.rms ? item : best);
  const audible = loud.filter((item) => item.rms > top.rms - 30);
  const power = audible.reduce((sum, item) => sum + 10 ** (item.rms / 10), 0) / audible.length;
  const weight = audible.reduce((sum, item) => sum + 10 ** (item.rms / 10), 0);
  const third = Math.max(1, Math.floor(audible.length / 3));
  const centroidOf = (items) => items.reduce((sum, item) => sum + item.centroid * 10 ** (item.rms / 10), 0) / (items.reduce((sum, item) => sum + 10 ** (item.rms / 10), 0) || 1);
  return {
    peakTime: Math.round((top.time + 0.025) * 100) / 100,
    peakDb: Math.round(Math.max(...loud.map((item) => item.peak)) * 10) / 10,
    loudnessDb: Math.round(10 * Math.log10(power) * 10) / 10,
    brightnessHz: Math.round(centroidOf(audible)),
    // Not stored: printed so sounds can be curated by whether their pitch rises or falls.
    trendHz: Math.round(centroidOf(audible.slice(-third)) - centroidOf(audible.slice(0, third))),
    weight,
  };
}

const print = process.argv.includes('--print');
for (const sound of manifest) {
  const { trendHz, weight, ...measured } = analyze(sound.file);
  Object.assign(sound, measured);
  if (print) console.log([sound.id.padEnd(58), `dur ${sound.duration.toFixed(2).padStart(5)}`, `peak@${String(measured.peakTime).padStart(5)}`, `peak ${String(measured.peakDb).padStart(6)}dB`, `loud ${String(measured.loudnessDb).padStart(6)}dB`, `bright ${String(measured.brightnessHz).padStart(5)}Hz`, `trend ${String(trendHz).padStart(6)}Hz`].join(' | '));
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Analysed ${manifest.length} sounds → ${path.relative(process.cwd(), manifestPath)}`);
