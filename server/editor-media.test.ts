import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importEditorMedia, loadEditorMedia, resolveEditorMedia } from './editor-media.js';
import { buildEditorRender, type EditorTimeline } from './editor-render.js';
import type { Project } from './project-store.js';

const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(bin => spawnSync(bin, ['-version'], { encoding: 'utf8' }).status === 0);
function run(bin: string, args: string[]) {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function probe(file: string) {
  const raw = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const video = raw.streams.find((stream: any) => stream.codec_type === 'video');
  const audio = raw.streams.find((stream: any) => stream.codec_type === 'audio');
  return {
    duration: Number(raw.format?.duration || video?.duration || audio?.duration || 0),
    width: video?.width, height: video?.height,
    videoCodec: video?.codec_name, audioCodec: audio?.codec_name,
  };
}
const placement = (id: string, kind: 'video' | 'audio' | 'image', start: number, duration: number) => ({
  id: 'clip-' + id, trackId: 'track-' + id, type: kind, name: kind + ' import',
  role: 'imported', externalId: id, metadata: { editorMediaId: id },
  start, duration, sourceStart: 0, sourceDuration: kind === 'image' ? 5 : 1,
  x: 50, y: 50, scale: kind === 'image' ? 0.5 : 1,
  rotation: 0, opacity: 1, volume: kind === 'image' ? 0 : 1, speed: 1,
});

test('imported video, audio and picture survive reload and render into edited MP4', { skip: !hasFfmpeg }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cjcut-editor-media-'));
  try {
    const videoPath = path.join(dir, 'input.mp4');
    const audioPath = path.join(dir, 'input.mp3');
    const imagePath = path.join(dir, 'input.png');
    const output = path.join(dir, 'output.mp4');
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=96x160:rate=15', '-t', '1',
      '-c:v', 'mpeg4', '-q:v', '6', '-pix_fmt', 'yuv420p', videoPath]);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=523:sample_rate=48000', '-t', '1',
      '-c:a', 'libmp3lame', audioPath]);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=96x160', '-frames:v', '1', '-threads:v', '1', imagePath]);

    const video = await importEditorMedia({ workDir: dir, fileName: 'clip.mp4', kind: 'video',
      stream: createReadStream(videoPath), probe });
    const audio = await importEditorMedia({ workDir: dir, fileName: 'music.mp3', kind: 'audio',
      stream: createReadStream(audioPath), probe });
    const image = await importEditorMedia({ workDir: dir, fileName: 'picture.png', kind: 'image',
      stream: createReadStream(imagePath), probe });
    assert.equal((await loadEditorMedia(dir)).length, 3);
    assert.equal((await resolveEditorMedia(dir, video.id))?.entry.name, 'clip.mp4');
    assert.equal((await resolveEditorMedia(dir, audio.id))?.entry.name, 'music.mp3');
    assert.equal((await resolveEditorMedia(dir, image.id))?.entry.name, 'picture.png');

    const project = {
      id: 'test', name: 'Imported media', workDir: dir,
      media: { duration: 1, size: 1000, width: 96, height: 160, hdr: false },
      sourcePath: videoPath, sourceName: 'input.mp4',
      clips: [{ id: 'base', sourcePath: videoPath, sourceName: 'input.mp4',
        media: { duration: 1, size: 1000, width: 96, height: 160, hdr: false },
        timelineStart: 0, timelineEnd: 1 }],
    } as Project;
    const timeline: EditorTimeline = {
      name: 'Imported media timeline', width: 96, height: 160, fps: 15, duration: 1,
      tracks: [
        { id: 'picture', name: 'Picture', type: 'image', role: 'imported', visible: true, locked: false,
          clips: [placement(image.id, 'image', 0.2, 0.6)] },
        { id: 'video', name: 'Video', type: 'video', role: 'imported', visible: true, locked: false,
          clips: [placement(video.id, 'video', 0, 1)] },
        { id: 'audio', name: 'Audio', type: 'audio', role: 'imported', visible: true, locked: false,
          clips: [placement(audio.id, 'audio', 0, 1)] },
      ],
    };
    const render = await buildEditorRender({
      project, timeline, broll: null, ffmpegBin: 'ffmpeg',
      outputPath: output, workDir: path.join(dir, 'render'), mode: 'fast', probe,
    });
    assert.equal(render.visualClips, 2);
    assert.equal(render.audioClips, 1);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...render.args]);
    assert.ok((await fs.stat(output)).size > 1000);
    const result = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type', '-of', 'json', output]));
    assert.ok(Math.abs(Number(result.format.duration) - 1) < 0.2);
    assert.ok(result.streams.some((stream: { codec_type: string }) => stream.codec_type === 'video'));
    assert.ok(result.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('media uploads reject unsupported extensions and unregistered clip references', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cjcut-media-safe-'));
  try {
    await assert.rejects(
      importEditorMedia({ workDir: dir, fileName: '../bad.exe', kind: 'video',
        stream: createReadStream('/dev/null'), probe: async () => ({}) }),
      /Unsupported video format/,
    );
    assert.equal(await resolveEditorMedia(dir, 'not-registered'), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
