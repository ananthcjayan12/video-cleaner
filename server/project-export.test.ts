import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BrollPlan } from './broll.js';
import { buildProjectExportDirectory } from './project-export.js';
import type { Project } from './project-store.js';

test('buildProjectExportDirectory creates an editor-friendly package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-cleaner-export-test-'));
  try {
    const sourcePath = path.join(root, 'source.mov');
    const imagePath = path.join(root, 'scene.png');
    const videoPath = path.join(root, 'scene.mp4');
    const workDir = path.join(root, 'work');
    const destination = path.join(root, 'bundle');
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(sourcePath, 'source-video');
    await fs.writeFile(imagePath, 'image');
    await fs.writeFile(videoPath, 'video');

    const project: Project = {
      id: 'project-12345678',
      name: 'Demo Project',
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
      sourcePath,
      sourceName: 'source.mov',
      workDir,
      media: { duration: 2, size: 12, width: 1080, height: 1920, frameRate: 30, videoCodec: 'h264', audioCodec: 'aac', hdr: false },
      clips: [{
        id: 'clip-001',
        sourcePath,
        sourceName: 'source.mov',
        media: { duration: 2, size: 12, width: 1080, height: 1920, frameRate: 30, videoCodec: 'h264', audioCodec: 'aac', hdr: false },
        timelineStart: 0,
        timelineEnd: 2,
      }],
      transcript: {
        text: 'Hello world.',
        words: [
          { id: 'w000001', text: 'Hello', start: 0.1, end: 0.5 },
          { id: 'w000002', text: 'world.', start: 0.55, end: 1.1 },
        ],
      },
      edl: { keepRanges: [{ startWordId: 'w000001', endWordId: 'w000002', reason: 'Keep intro' }], notes: ['test'] },
    };

    const plan: BrollPlan = {
      version: 2,
      orientation: 'portrait',
      stylePreset: 'clean',
      settings: {
        workflowMode: 'raw-video',
        provider: 'gemini',
        videoProvider: 'magnific',
        countMode: 'exact',
        targetCount: 1,
        imagesPerMinute: 1,
        intervalSeconds: 20,
        minSceneDuration: 2,
        maxSceneDuration: 5,
        aspectRatio: '9:16',
        displayTemplate: 'full-frame',
        returnVideoWithAudio: false,
      },
      scenes: [{
        id: 'scene-001',
        title: 'Example scene',
        startWordId: 'w000001',
        endWordId: 'w000002',
        sourceStart: 0.1,
        sourceEnd: 1.1,
        narration: 'Hello world.',
        visualIntent: 'Show an example',
        shotType: 'macro',
        imagePrompt: 'Example image',
        videoPrompt: 'Example motion',
        enabled: true,
        imageFile: imagePath,
        videoFile: videoPath,
        videoProvider: 'magnific',
      }],
      notes: [],
    };

    const result = await buildProjectExportDirectory({ project, plan, directory: destination });
    assert.equal(result.clips, 1);
    assert.equal(result.words, 2);
    assert.equal(result.brollImages, 1);
    assert.equal(result.brollVideos, 1);

    for (const relative of [
      'talking-head/001-source.mov',
      'broll/images/scene-001.png',
      'broll/videos/scene-001.mp4',
      'captions/transcript.txt',
      'captions/captions.srt',
      'captions/captions.vtt',
      'captions/word-level-timestamps.json',
      'captions/word-level-timestamps.csv',
      'timeline/edl.json',
      'timeline/cleaned-timeline.json',
      'timeline/broll-timing.json',
      'project-manifest.json',
      'README.txt',
    ]) {
      const stat = await fs.stat(path.join(destination, relative));
      assert.equal(stat.isFile(), true, relative);
    }

    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'project-manifest.json'), 'utf8'));
    assert.equal(manifest.clips[0].timelineStart, 0);
    assert.equal(manifest.timeline.brollTiming, 'timeline/broll-timing.json');
    assert.equal(manifest.counts.brollVideos, 1);

    const srt = await fs.readFile(path.join(destination, 'captions/captions.srt'), 'utf8');
    assert.match(srt, /00:00:00,100 --> 00:00:01,100/);
    assert.match(srt, /Hello world\./);

    const timing = JSON.parse(await fs.readFile(path.join(destination, 'timeline/broll-timing.json'), 'utf8'));
    assert.equal(timing.scenes[0].videoFile, 'broll/videos/scene-001.mp4');
    assert.equal(timing.scenes[0].videoProvider, 'magnific');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
