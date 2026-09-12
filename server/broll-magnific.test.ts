import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateBrollVideoWithMagnific, resolveMagnificVideoConfig, type BrollPlan } from './broll.js';

test('migrates the unsupported Freepik endpoint and model', () => {
  assert.deepEqual(
    resolveMagnificVideoConfig('minimax-h3-max-turbo', 'https://api.freepik.com/v1/ai/image-to-video/minimax-h3-max-turbo'),
    {
      model: 'minimax-hailuo-2-3-768p-fast',
      endpoint: 'https://api.magnific.com/v1/ai/image-to-video/minimax-hailuo-2-3-768p-fast',
      migratedLegacyEndpoint: true,
    },
  );
});

test('preserves a deliberate custom endpoint override', () => {
  assert.deepEqual(resolveMagnificVideoConfig('custom-model', 'https://video.example.test/tasks/'), {
    model: 'custom-model', endpoint: 'https://video.example.test/tasks', migratedLegacyEndpoint: false,
  });
});

test('submits, polls, downloads and completes a Magnific generation', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-cleaner-magnific-'));
  try {
    const imageFile = path.join(workDir, 'still.png');
    await fs.writeFile(imageFile, Buffer.alloc(128, 1));
    const plan = {
      version: 2, orientation: 'portrait', stylePreset: '', notes: [],
      settings: { workflowMode: 'assets-only', provider: 'gemini', videoProvider: 'magnific', countMode: 'auto', targetCount: 1, imagesPerMinute: 1, intervalSeconds: 30, minSceneDuration: 2, maxSceneDuration: 12, aspectRatio: '9:16', displayTemplate: 'full-frame', returnVideoWithAudio: true },
      scenes: [{ id: 'scene-1', title: 'Scene', startWordId: 'w1', endWordId: 'w2', sourceStart: 0, sourceEnd: 6, narration: 'Narration', visualIntent: 'Intent', shotType: 'close-up', imagePrompt: 'Still', videoPrompt: 'Subtle motion', enabled: true, imageFile }],
    } satisfies BrollPlan;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input); requests.push({ url, init });
      if (requests.length === 1) return Response.json({ data: { task_id: 'task/123' } }, { status: 202 });
      if (requests.length === 2) return Response.json({ data: { status: 'PROCESSING' } });
      if (requests.length === 3) return Response.json({ data: { status: 'COMPLETED', generated: [{ url: 'https://cdn.example.test/video.mp4' }] } });
      return new Response(Buffer.alloc(60_000, 7), { status: 200, headers: { 'content-type': 'video/mp4' } });
    };
    const scene = await generateBrollVideoWithMagnific({ workDir, plan, sceneId: 'scene-1', config: { magnificApiKey: 'secret', magnificFetch: fakeFetch, magnificPollIntervalMs: 0 } });
    const endpoint = 'https://api.magnific.com/v1/ai/image-to-video/minimax-hailuo-2-3-768p-fast';
    assert.deepEqual(requests.map(({ url }) => url), [endpoint, `${endpoint}/task%2F123`, `${endpoint}/task%2F123`, 'https://cdn.example.test/video.mp4']);
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal((requests[0].init?.headers as Record<string, string>)['x-magnific-api-key'], 'secret');
    const body = JSON.parse(String(requests[0].init?.body));
    assert.equal(body.prompt, 'Subtle motion');
    assert.equal(body.first_frame_image, Buffer.alloc(128, 1).toString('base64'));
    assert.equal(scene.videoAttempts?.[0].status, 'completed');
    assert.equal(scene.videoProvider, 'magnific');
    assert.equal((await fs.stat(scene.videoFile!)).size, 60_000);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});
