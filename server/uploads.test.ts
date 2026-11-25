import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { appendChunk, completedUploadPath, createUpload, readUpload, safeFileName, uploadKindFor } from './uploads.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'vc-uploads-'));
const bytes = (n: number, fill: number) => Buffer.alloc(n, fill);

test('names are sanitised and kinds come from the extension', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('My Clip (1).MOV'), 'My-Clip-1-.MOV');
  assert.equal(safeFileName('ക്ലിനിക് video.mp4'), 'ക്ലിനിക്-video.mp4');
  assert.equal(uploadKindFor('IMG_0001.MOV'), 'video');
  assert.equal(uploadKindFor('ref.HEIC'), 'image');
  assert.equal(uploadKindFor('notes.txt'), null);
});

test('slices append in order, resume after a cut-off, and complete', async () => {
  const dir = await tmp();
  try {
    const meta = await createUpload(dir, { name: 'clip.mov', size: 10 });
    await appendChunk(dir, meta.id, 0, Readable.from([bytes(4, 1)]));
    await assert.rejects(appendChunk(dir, meta.id, 8, Readable.from([bytes(2, 9)])), (error: any) => error.status === 409 && error.expected === 4);
    await assert.rejects(completedUploadPath(dir, meta.id), /not fully uploaded yet \(40%\)/);
    const done = await appendChunk(dir, meta.id, 4, Readable.from([bytes(6, 2)]));
    assert.equal(done.complete, true);
    const file = await completedUploadPath(dir, meta.id, 'video');
    assert.deepEqual([...await fs.readFile(file)], [1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    await assert.rejects(completedUploadPath(dir, meta.id, 'image'), /not a image file/);
    assert.equal((await readUpload(dir, meta.id)).received, 10);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a slice cannot write past the declared size', async () => {
  const dir = await tmp();
  try {
    const meta = await createUpload(dir, { name: 'clip.mp4', size: 4 });
    await assert.rejects(appendChunk(dir, meta.id, 0, Readable.from([bytes(6, 1)])), (error: any) => error.status === 413);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('bad uploads are refused up front', async () => {
  const dir = await tmp();
  try {
    await assert.rejects(createUpload(dir, { name: 'run.sh', size: 10 }), /Upload a video/);
    await assert.rejects(createUpload(dir, { name: 'a.mp4', size: 0 }), /size/);
    await assert.rejects(readUpload(dir, '../../etc'), /Unknown upload/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
