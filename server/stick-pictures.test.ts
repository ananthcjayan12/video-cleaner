import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cutSheet, sheetPicturePrompt } from './stick-pictures.js';

const has = (bin: string) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

test('a 2×3 contact sheet is cut along its white gutters into 6 photos', { skip: !has('ffmpeg') }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
  const sheet = path.join(dir, 'sheet.png');
  // 1024×1536 white canvas, 6 coloured cells (gutter 60 px).
  const boxes = [0, 1, 2].flatMap((r) => [0, 1].map((c) => `drawbox=x=${60 + c * 482}:y=${60 + r * 472}:w=422:h=412:color=0x${['c0392b', '2980b9', '27ae60', '8e44ad', 'd35400', '16a085'][r * 2 + c]}:t=fill`)).join(',');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=white:s=1024x1536', '-frames:v', '1', '-vf', boxes, sheet]);
  const files = await cutSheet({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', sheet, outDir: dir, prefix: 'p' });
  assert.equal(files.length, 6);
  const w = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', path.join(dir, files[0])]).toString());
  assert.ok(w >= 800 && w <= 850, `cell width ${w} (422 minus edge shave, doubled)`);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith('p-')).length, 6);
});

test('the sheet prompt asks for a strict 2×3 grid of real photos with white gutters', () => {
  const prompt = sheetPicturePrompt(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.match(prompt, /2 columns × 3 rows/); assert.match(prompt, /pure white/); assert.match(prompt, /Not an illustration/); assert.match(prompt, /6\. f/);
});
