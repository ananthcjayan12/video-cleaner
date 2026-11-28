import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chatGptImagePrompt } from './chatgpt-images.js';
import { cleanCoverText, coverImagePrompt, coverRequest } from './reel-cover.js';

test('the AI cover headline is cleaned and needs at least two lines', () => {
  assert.deepEqual(cleanCoverText({ lines: ['  പല്ല്  Clean ചെയ്താൽ ', 'Enamel', 'പോകുമോ?', 'extra'], picture: ' a scaler. ' }), { lines: ['പല്ല് Clean ചെയ്താൽ', 'Enamel', 'പോകുമോ?'], picture: 'a scaler.' });
  assert.throws(() => cleanCoverText({ lines: ['one'] }), /empty/);
});

test('the cover prompt carries the exact headline lines, the logo rule and the 3:4 safe area', () => {
  const prompt = coverImagePrompt({ lines: ['ചെറിയ ശീലങ്ങൾ', 'ബാധിക്കുമോ?'], picture: 'a dental model.' }, { clinic: 'Smile Craft', hasStyle: true, hasLogo: true });
  assert.match(prompt, /Line 1 \(white box\): ചെറിയ ശീലങ്ങൾ/);
  assert.match(prompt, /Line 2 \(teal ribbon\): ബാധിക്കുമോ\?/);
  assert.match(prompt, /attached logo/);
  assert.match(prompt, /3:4/);
  assert.match(prompt, /a dental model\.\n/);
});

test('a clinic with references gets a designed ChatGPT request with them attached; one without gets none', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brands-'));
  process.env.VIDEO_CLEANER_BRANDS_DIR = dir;
  try {
    const work = path.join(dir, 'reel');
    assert.equal(await coverRequest({ workDir: work, workspaceId: 'clinic', text: { lines: ['a', 'b'], picture: 'p' } }), null);
    await fs.mkdir(path.join(dir, 'clinic', 'cover-refs'), { recursive: true });
    for (const name of ['logo.jpg', 'style.jpg', 'posts.jpg', 'notes.txt']) await fs.writeFile(path.join(dir, 'clinic', 'cover-refs', name), 'x');
    const request = (await coverRequest({ workDir: work, workspaceId: 'clinic', text: { lines: ['a', 'b'], picture: 'p' } }))!;
    assert.deepEqual(request.references!.map((file) => path.basename(file)), ['style.jpg', 'posts.jpg', 'logo.jpg']);
    assert.equal(request.outputPath, path.join(work, 'auto', 'cover.raw.png'));
    assert.ok(request.references!.every((file) => file.startsWith(path.join(work, 'auto', 'cover-refs')))); // copied into the reel folder
    const prompt = chatGptImagePrompt([request]);
    assert.match(prompt, /Attach these reference images to the same message: .*style\.jpg/);
    assert.match(prompt, /DESIGNED picture/);
    assert.match(prompt, /file-upload tool/);
  } finally { delete process.env.VIDEO_CLEANER_BRANDS_DIR; await fs.rm(dir, { recursive: true, force: true }); }
});
