import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildEditorRender, type EditorTimeline } from './editor-render.js';
import type { Project } from './project-store.js';
import type { BrollPlan } from './broll.js';

const available = (binary: string) => spawnSync(binary, ['-version'], { encoding: 'utf8' }).status === 0;
const hasFfmpeg = available('ffmpeg') && available('ffprobe');

function exec(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

const baseClip = (start: number, duration: number, sourceStart: number, id: string) => ({
  id, trackId: 'base', type: 'video' as const, name: id, role: 'base',
  metadata: { sourceClipId: 'clip-1' }, start, duration, sourceStart, sourceDuration: 2,
  x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1,
});

test('CJCut timeline produces a playable layered MP4 with talking-head audio', { skip: !hasFfmpeg }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cjcut-render-test-'));
  try {
    const source = path.join(dir, 'source.mp4');
    const image = path.join(dir, 'broll.png');
    const output = path.join(dir, 'final.mp4');
    exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=96x160:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '2', '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=96x160', '-frames:v', '1', '-threads:v', '1', image]);

    const media = { duration: 2, size: 50000, width: 96, height: 160, frameRate: 15, audioCodec: 'aac', hdr: false };
    const project = {
      id: 'test', name: 'CJCut test', workDir: dir, sourcePath: source, sourceName: 'source.mp4',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), media,
      clips: [{ id: 'clip-1', sourcePath: source, sourceName: 'source.mp4', media, timelineStart: 0, timelineEnd: 2 }],
    } as Project;
    const broll = { scenes: [{
      id: 'scene-01', title: 'Illustration', enabled: true,
      imageFile: image, imageStatus: 'ready', videoStatus: 'none',
    }] } as unknown as BrollPlan;
    const imageClip = {
      id: 'broll-01', trackId: 'broll', type: 'image' as const, name: 'Illustration',
      role: 'broll', externalId: 'scene-01', metadata: { sceneId: 'scene-01' },
      start: 0.4, duration: 0.8, sourceStart: 0, sourceDuration: 0.8,
      x: 50, y: 50, scale: 0.5, rotation: 0, opacity: 1, volume: 0, speed: 1,
    };
    const timeline: EditorTimeline = {
      name: 'Test', width: 96, height: 160, fps: 15, duration: 2,
      tracks: [
        { id: 'hidden', name: 'Hidden B-roll', visible: false, locked: false, type: 'image', role: 'broll', clips: [{ ...imageClip, id: 'hidden', externalId: 'missing-scene', metadata: { sceneId: 'missing-scene' } }] },
        { id: 'broll', name: 'B-roll', visible: true, locked: false, type: 'image', role: 'broll', clips: [imageClip] },
        { id: 'base', name: 'Talking head', visible: true, locked: false, type: 'video', role: 'base', clips: [
          baseClip(0, 0.9, 0, 'base-1'), baseClip(0.9, 1.1, 0.9, 'base-2'),
        ] },
      ],
    };
    const render = await buildEditorRender({
      project, timeline, broll, ffmpegBin: 'ffmpeg', outputPath: output, workDir: path.join(dir, 'render'), mode: 'fast',
      probe: async () => ({ duration: 2, audioCodec: 'aac' }),
    });
    assert.equal(render.visualClips, 3);
    assert.equal(render.audioClips, 2);
    exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...render.args]);
    const stat = await fs.stat(output);
    assert.ok(stat.size > 1000);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.ok(Math.abs(Number(result.format.duration) - 2) < 0.2);
    assert.ok(result.streams.some((stream: { codec_type: string }) => stream.codec_type === 'video'));
    assert.ok(result.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('hidden clips cannot inject missing files; stale active B-roll is rejected', async () => {
  const timeline = {
    name: 'Test', width: 96, height: 160, fps: 15, duration: 1,
    tracks: [{ id: 'broll', name: 'B-roll', role: 'broll', type: 'video', visible: true, locked: false, clips: [{
      id: 'stale', trackId: 'broll', type: 'video', name: 'Stale', role: 'broll',
      externalId: 'scene-01', metadata: { sceneId: 'scene-01' },
      start: 0, duration: 1, sourceStart: 0, sourceDuration: 1,
      x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 0, speed: 1,
    }] }],
  } as EditorTimeline;
  const project = { workDir: os.tmpdir(), media: { duration: 1, width: 96, height: 160, hdr: false }, clips: [] } as unknown as Project;
  const broll = { scenes: [{ id: 'scene-01', title: 'Stale', enabled: true, imageStatus: 'ready', imageRevision: 2,
    videoFile: '/missing/stale.mp4', videoSourceImageRevision: 1, videoStatus: 'stale' }] } as unknown as BrollPlan;
  await assert.rejects(
    buildEditorRender({ project, timeline, broll, ffmpegBin: 'ffmpeg', outputPath: '/tmp/no.mp4',
      workDir: path.join(os.tmpdir(), 'cjcut-stale-test'), mode: 'fast', probe: async () => ({}) }),
    /stale or missing/i,
  );
});
