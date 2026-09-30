import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setStillEffect, type BrollPlan } from './broll.js';

test('still motion renders locally and can be switched back to AI video', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-cleaner-still-'));
  try {
    const width = 128; const height = 72;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      pixels[offset] = (x * 17 + y * 7) % 256;
      pixels[offset + 1] = (x * 3 + y * 29) % 256;
      pixels[offset + 2] = (x * 23 + y * 11) % 256;
    }
    const imageFile = path.join(workDir, 'still.ppm');
    await fs.writeFile(imageFile, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
    const scene = { id: 'scene-001', title: 'Test still', sourceStart: 0, sourceEnd: 0.8, imageFile, imageRevision: 1, imageStatus: 'ready' as const, videoAttempts: [] };
    const plan = { version: 2, orientation: 'landscape', settings: { aspectRatio: '16:9', displayTemplate: 'full-frame' }, scenes: [scene] } as unknown as BrollPlan;
    const rendered = await setStillEffect({ workDir, plan, sceneId: scene.id, effect: 'pan-left', ffmpegBin: 'ffmpeg' });
    assert.equal(rendered.videoTreatment, 'still');
    assert.equal(rendered.videoProvider, 'still-effect');
    assert.equal(rendered.videoStatus, 'ready');
    assert.ok((await fs.stat(rendered.videoFile!)).size > 50_000);
    const switched = await setStillEffect({ workDir, plan, sceneId: scene.id, effect: 'ai' });
    assert.equal(switched.videoTreatment, 'ai');
    assert.equal(switched.videoFile, undefined);
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});
