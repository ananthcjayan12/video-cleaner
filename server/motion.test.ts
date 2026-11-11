import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BrollWord } from './broll.js';
import { buildEditorRender, type EditorTimeline } from './editor-render.js';
import { defaultMotionSounds, normalizeMotionSettings, updateMotionScene, validatePlan, type MotionPlan, type MotionScene } from './motion.js';
import { validateMotionCode } from './motion-render.js';
import type { Project } from './project-store.js';

const GOOD_CODE = `import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
export default function Scene({ headline, accentColor }: { headline: string; accentColor: string }) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const exit = interpolate(frame, [60, 80], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill><div style={{ opacity: enter * exit, color: accentColor }}>{headline}</div></AbsoluteFill>;
}`;

test('motion code validation accepts Remotion components and rejects unsafe or non-deterministic code', () => {
  assert.deepEqual(validateMotionCode(GOOD_CODE), []);
  const problems = (source: string) => validateMotionCode(GOOD_CODE + '\n' + source).join(' ');
  assert.match(problems("import fs from 'fs';"), /Import "fs" is not allowed/);
  assert.match(problems("import x from 'left-pad';"), /not allowed/);
  assert.match(problems("fetch('https://example.com');"), /fetch/);
  assert.match(problems('const r = Math.random();'), /Math\.random/);
  assert.match(problems('const t = Date.now();'), /Date/);
  assert.match(problems("eval('1');"), /eval/);
  assert.match(problems("const style = { background: 'url(https://x.test/a.png)' };"), /remote url/);
  assert.match(validateMotionCode('export default () => null').join(' '), /useCurrentFrame|too short/);
  assert.match(validateMotionCode(GOOD_CODE.replace('export default function', 'function')).join(' '), /export default/);
});

test('motion settings are clamped and defaulted', () => {
  const settings = normalizeMotionSettings({ maxDuration: 99, minDuration: 0.1, accentColor: 'red', targetCount: 999, countMode: 'nope' as never });
  assert.equal(settings.maxDuration, 15);
  assert.equal(settings.minDuration, 1.5);
  assert.equal(settings.accentColor, '#22D3EE');
  assert.equal(settings.targetCount, 30);
  assert.equal(settings.countMode, 'auto');
  assert.equal(settings.planningProvider, 'claude-cli');
});

const words: BrollWord[] = Array.from({ length: 60 }, (_, index) => ({ id: `w${index}`, text: `word${index}`, start: index * 0.5, end: index * 0.5 + 0.45 }));
const candidate = (start: number, end: number, extra: Record<string, unknown> = {}) => ({
  title: `Graphic ${start}`, startWordId: `w${start}`, endWordId: `w${end}`, graphicType: 'stat-callout', placement: 'bottom',
  keyPoint: 'A concrete number to remember', whyThisGraphicMatters: 'The figure is easier to retain on screen.', viewerTakeaway: 'Remember the number',
  headline: '90% of teeth saved', subhead: 'with timely care', items: [], designBrief: 'Big count-up number on a rounded card sliding up from the bottom, accent underline sweep, exits by fading down.', ...extra,
});
const settings = normalizeMotionSettings({ minDuration: 2, maxDuration: 4 });

test('motion plan validation ignores B-roll and spacing but enforces removed words and text policy', () => {
  const occupied = [{ start: 10, end: 14, label: 'B-roll "Anatomy"' }];
  const ok = validatePlan(words, undefined, { scenes: [candidate(0, 6), candidate(30, 36)], notes: [] }, settings, occupied, 0);
  assert.equal(ok.scenes.length, 2);
  assert.equal(ok.scenes[0].id, 'motion-001');
  assert.equal(ok.scenes[0].sourceStart, 0);
  assert.ok(ok.scenes[1].sourceEnd - ok.scenes[1].sourceStart <= settings.maxDuration);

  const issues = (raw: unknown, keep?: Array<{ startWordId: string; endWordId: string }>, expected = 0) => {
    try { validatePlan(words, keep, raw, settings, occupied, expected); return ''; } catch (error) { return (error as Error).message; }
  };
  assert.equal(issues({ scenes: [candidate(19, 26)] }), '', 'B-roll overlap is allowed');
  assert.equal(issues({ scenes: [candidate(0, 6), candidate(7, 13)] }), '', 'back-to-back graphics are allowed');
  assert.match(issues({ scenes: [candidate(30, 32)] }), /lasts only/);
  assert.match(issues({ scenes: [candidate(30, 36, { headline: 'Guaranteed cure in one visit' })] }), /Meta ad policy/);
  assert.match(issues({ scenes: [candidate(30, 36)] }, [{ startWordId: 'w0', endWordId: 'w32' }, { startWordId: 'w34', endWordId: 'w59' }]), /removed from the final narration/);
  assert.match(issues({ scenes: [candidate(0, 6)] }, undefined, 2), /exactly 2/);
  assert.match(issues({ scenes: [candidate(0, 6, { startWordId: 'nope' })] }), /not in the supplied narration/);
});

const scene = (over: Partial<MotionScene>): MotionScene => ({
  id: 'motion-001', title: 'Stat', startWordId: 'w0', endWordId: 'w6', sourceStart: 20, sourceEnd: 24, narration: 'x', graphicType: 'stat-callout', placement: 'bottom',
  keyPoint: 'k', whyThisGraphicMatters: 'w', viewerTakeaway: 't', content: { headline: 'Old', subhead: '', items: [] }, designBrief: 'brief '.repeat(10), enabled: true, status: 'ready', videoFile: '/tmp/x.webm', code: GOOD_CODE, ...over,
});

test('editing a motion graphic invalidates only what changed and guards timing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-edit-'));
  try {
    const plan: MotionPlan = { version: 1, orientation: 'portrait', settings, notes: [], scenes: [scene({}), scene({ id: 'motion-002', sourceStart: 40, sourceEnd: 44 })] };
    const broll = { scenes: [{ id: 'scene-001', title: 'Anatomy', enabled: true, sourceStart: 30, sourceEnd: 34 }] } as never;
    const edited = await updateMotionScene(dir, plan, 'motion-001', { headline: 'New headline' }, broll);
    assert.equal(edited.status, 'none'); assert.equal(edited.code, GOOD_CODE, 'text edits must keep the generated code');
    const restyled = await updateMotionScene(dir, plan, 'motion-001', { placement: 'top' }, broll);
    assert.equal(restyled.code, undefined, 'layout changes must trigger a redesign');
    await updateMotionScene(dir, plan, 'motion-001', { sourceStart: 29, sourceEnd: 33 }, broll);
    await updateMotionScene(dir, plan, 'motion-001', { sourceStart: 38, sourceEnd: 41 }, broll);
    await assert.rejects(updateMotionScene(dir, plan, 'motion-001', { headline: 'Before and after' }, broll), /Meta ad policy/);
    const moved = await updateMotionScene(dir, plan, 'motion-001', { sourceStart: 20.5, sourceEnd: 24.5 }, broll);
    assert.equal(moved.sourceStart, 20.5);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

const available = (binary: string) => spawnSync(binary, ['-version'], { encoding: 'utf8' }).status === 0;
const hasVp9 = available('ffmpeg') && spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout.includes('libvpx-vp9');
const exec = (args: string[]) => { const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout: 120_000 }); assert.equal(result.status, 0, result.stderr); };
function pixel(file: string, at: number, x: number, y: number) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 60_000 });
  assert.equal(result.status, 0); return [...result.stdout.subarray(0, 3)];
}

test('rendered motion overlay composites over the talking head with its transparency intact', { skip: !hasVp9 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-composite-'));
  try {
    const source = path.join(dir, 'source.mp4'); const overlay = path.join(dir, 'motion-001.webm'); const output = path.join(dir, 'final.mp4');
    exec(['-f', 'lavfi', '-i', 'color=c=0x2255cc:s=96x160:r=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    // Red frame whose alpha plane is opaque only in a band across the lower part (drawbox would not write alpha).
    exec(['-f', 'lavfi', '-i', "color=c=red:s=96x160:r=15:d=1,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(between(Y,100,139),255,0)'", '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', overlay]);
    const media = { duration: 2, size: 50000, width: 96, height: 160, frameRate: 15, audioCodec: 'aac', hdr: false };
    const project = { id: 't', name: 't', workDir: dir, sourcePath: source, sourceName: 'source.mp4', createdAt: '', updatedAt: '', media, clips: [{ id: 'clip-1', sourcePath: source, sourceName: 'source.mp4', media, timelineStart: 0, timelineEnd: 2 }] } as Project;
    const graphic = scene({ videoFile: overlay, status: 'ready' });
    const motion: MotionPlan = { version: 1, orientation: 'portrait', settings, notes: [], scenes: [graphic] };
    const clip = { id: 'c-motion', trackId: 'm', type: 'video' as const, name: 'Stat', role: 'overlay', externalId: 'motion-001', metadata: { motionId: 'motion-001' }, start: 0.5, duration: 1, sourceStart: 0, sourceDuration: 1, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 0, speed: 1 };
    const timeline: EditorTimeline = { name: 't', width: 96, height: 160, fps: 15, duration: 2, tracks: [
      { id: 'm', name: 'Motion', visible: true, locked: false, type: 'video', role: 'overlay', clips: [clip] },
      { id: 'b', name: 'Base', visible: true, locked: false, type: 'video', role: 'base', clips: [{ id: 'base', trackId: 'b', type: 'video', name: 'base', role: 'base', metadata: { sourceClipId: 'clip-1' }, start: 0, duration: 2, sourceStart: 0, sourceDuration: 2, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1 }] },
    ] };
    const render = await buildEditorRender({ project, timeline, broll: null, motion, ffmpegBin: 'ffmpeg', outputPath: output, workDir: path.join(dir, 'render'), mode: 'fast', inputVideoArgs: ['-hwaccel', 'videotoolbox'], probe: async () => ({ duration: 2, audioCodec: 'aac' }) });
    const motionInput = render.args.indexOf(overlay);
    assert.equal(render.args[motionInput - 3], '-c:v'); assert.equal(render.args[motionInput - 2], 'libvpx-vp9', 'alpha WebM must use the libvpx decoder, never hardware decode');
    exec(render.args);
    const [r, g, b] = pixel(output, 1, 48, 120);
    assert.ok(r > 180 && g < 90 && b < 90, `band should be red, got ${r},${g},${b}`);
    const [tr, tg, tb] = pixel(output, 1, 48, 20);
    assert.ok(tb > 150 && tr < 90, `transparent area must show the blue talking head, got ${tr},${tg},${tb}`);
    const [br, , bb] = pixel(output, 0.2, 48, 120);
    assert.ok(bb > 150 && br < 90, 'graphic must not appear before its start time');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a moved, scaled motion graphic lands where the editor put it in the final MP4', { skip: !hasVp9 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-transform-'));
  try {
    const source = path.join(dir, 'source.mp4'); const overlay = path.join(dir, 'motion-001.webm'); const output = path.join(dir, 'final.mp4');
    exec(['-f', 'lavfi', '-i', 'color=c=0x2255cc:s=96x160:r=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    exec(['-f', 'lavfi', '-i', "color=c=red:s=96x160:r=15:d=1,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(between(Y,60,99),255,0)'", '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', overlay]);
    const media = { duration: 2, size: 50000, width: 96, height: 160, frameRate: 15, audioCodec: 'aac', hdr: false };
    const project = { id: 't', name: 't', workDir: dir, sourcePath: source, sourceName: 'source.mp4', createdAt: '', updatedAt: '', media, clips: [{ id: 'clip-1', sourcePath: source, sourceName: 'source.mp4', media, timelineStart: 0, timelineEnd: 2 }] } as Project;
    const motion: MotionPlan = { version: 1, orientation: 'portrait', settings, notes: [], scenes: [scene({ videoFile: overlay, status: 'ready' })] };
    // Half size, moved to the right-hand quarter: the 96x160 frame becomes 48x80 centred at (72, 80) => x 48..96, y 40..120.
    const clip = { id: 'c', trackId: 'm', type: 'video' as const, name: 'Stat', role: 'overlay', externalId: 'motion-001', metadata: { motionId: 'motion-001' }, start: 0, duration: 1.5, sourceStart: 0, sourceDuration: 1, x: 75, y: 50, scale: 0.5, rotation: 0, opacity: 1, volume: 0, speed: 1 };
    const timeline: EditorTimeline = { name: 't', width: 96, height: 160, fps: 15, duration: 2, tracks: [
      { id: 'm', name: 'Motion', visible: true, locked: false, type: 'video', role: 'overlay', clips: [clip] },
      { id: 'b', name: 'Base', visible: true, locked: false, type: 'video', role: 'base', clips: [{ id: 'base', trackId: 'b', type: 'video', name: 'base', role: 'base', metadata: { sourceClipId: 'clip-1' }, start: 0, duration: 2, sourceStart: 0, sourceDuration: 2, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1 }] },
    ] };
    const render = await buildEditorRender({ project, timeline, broll: null, motion, ffmpegBin: 'ffmpeg', outputPath: output, workDir: path.join(dir, 'render'), mode: 'fast', probe: async () => ({ duration: 2, audioCodec: 'aac' }) });
    exec(render.args);
    // The overlay's opaque band (source rows 60-99) becomes output rows 40+30..40+49 = 70..89, columns 48..95.
    const inside = pixel(output, 0.5, 72, 80);
    assert.ok(inside[0] > 180 && inside[1] < 90 && inside[2] < 90, `moved+scaled band should be red at (72,80), got ${inside}`);
    const wherePlacedByDefault = pixel(output, 0.5, 20, 80);
    assert.ok(wherePlacedByDefault[2] > 150 && wherePlacedByDefault[0] < 90, 'the graphic must have left its original position');
    const above = pixel(output, 0.5, 72, 50);
    assert.ok(above[2] > 150 && above[0] < 90, 'transparent part of the scaled graphic shows the talking head');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('an unrendered or disabled motion graphic cannot be exported silently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-missing-'));
  try {
    const source = path.join(dir, 'source.mp4'); await fs.writeFile(source, 'x');
    const media = { duration: 2, size: 1, width: 96, height: 160, frameRate: 15, audioCodec: 'aac', hdr: false };
    const project = { id: 't', name: 't', workDir: dir, sourcePath: source, sourceName: 's', createdAt: '', updatedAt: '', media, clips: [{ id: 'clip-1', sourcePath: source, sourceName: 's', media, timelineStart: 0, timelineEnd: 2 }] } as Project;
    const clip = { id: 'c', trackId: 'm', type: 'video' as const, name: 'Stat', role: 'overlay', externalId: 'motion-001', metadata: { motionId: 'motion-001' }, start: 0, duration: 1, sourceStart: 0, sourceDuration: 1, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 0, speed: 1 };
    const timeline: EditorTimeline = { name: 't', width: 96, height: 160, fps: 15, duration: 2, tracks: [{ id: 'm', name: 'M', visible: true, locked: false, type: 'video', clips: [clip] }] };
    const make = (status: MotionScene['status']) => buildEditorRender({ project, timeline, broll: null, motion: { version: 1, orientation: 'portrait', settings, notes: [], scenes: [scene({ status, videoFile: path.join(dir, 'x.webm') })] }, ffmpegBin: 'ffmpeg', outputPath: path.join(dir, 'o.mp4'), workDir: dir, mode: 'fast', probe: async () => ({ duration: 2 }) });
    await assert.rejects(make('none'), /has not been rendered/);
    await assert.rejects(make('ready'), /Missing media file/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('motion template library stores, lists, updates and deletes reference images', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-templates-'));
  const previous = process.env.MOTION_TEMPLATES_DIR; process.env.MOTION_TEMPLATES_DIR = dir;
  try {
    const templates = await import('./motion-templates.js'); const { Readable } = await import('node:stream');
    const png = Buffer.alloc(2000, 1);
    await assert.rejects(templates.addMotionTemplate({ fileName: 'x.gif', stream: Readable.from([png]) }), /PNG, JPG or WebP/);
    const entry = await templates.addMotionTemplate({ fileName: 'Sheet.PNG', name: 'Brand sheet', notes: 'panel 3 for stats', stream: Readable.from([png]) });
    assert.equal((await templates.listMotionTemplates()).length, 1);
    assert.equal((await templates.motionTemplatePath(entry.id))?.entry.name, 'Brand sheet');
    assert.equal((await templates.updateMotionTemplate(entry.id, { name: 'Renamed' })).name, 'Renamed');
    await templates.deleteMotionTemplate(entry.id);
    assert.equal((await templates.listMotionTemplates()).length, 0);
    assert.equal(await templates.motionTemplatePath(entry.id), null);
  } finally { if (previous === undefined) delete process.env.MOTION_TEMPLATES_DIR; else process.env.MOTION_TEMPLATES_DIR = previous; await fs.rm(dir, { recursive: true, force: true }); }
});

test('changing a graphic template clears its generated code so the next render redesigns it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-tpl-edit-'));
  try {
    const plan: MotionPlan = { version: 1, orientation: 'portrait', settings, notes: [], scenes: [scene({})] };
    const edited = await updateMotionScene(dir, plan, 'motion-001', { templateId: 'abc123' }, null);
    assert.equal(edited.templateId, 'abc123'); assert.equal(edited.code, undefined);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('planner retains library choices and rejects invented or out-of-window sound cues', () => {
  const soundEffects = [{ soundId: 'ui-chime', time: 0.5, gainDb: -16 }];
  const result = validatePlan(words, undefined, {scenes: [candidate(0, 7, {soundEffects})]}, settings, [], 1);
  assert.deepEqual(result.scenes[0].soundEffects, soundEffects);
  for (const cues of [[{soundId:'unknown',time:0,gainDb:-16}], [{soundId:'ui-chime',time:99,gainDb:-16}], []]) {
    assert.throws(() => validatePlan(words, undefined, {scenes:[candidate(0,7,{soundEffects:cues})]}, settings, [], 1), /sound cues/);
  }
});

test('every motion graphic type receives a useful click, whoosh or chime fallback', () => {
  const types = ['lower-third', 'stat-callout', 'kinetic-title', 'animated-chart', 'process-steps', 'comparison', 'checklist', 'quote-card', 'timeline', 'icon-diagram'] as const;
  for (const type of types) {
    const cues = defaultMotionSounds(type, 3);
    assert.ok(cues.length >= 1, `${type} should have a sound cue`);
    assert.ok(cues.every((cue) => cue.time >= 0 && cue.time < 3));
  }
  const ids = new Set(types.flatMap((type) => defaultMotionSounds(type, 3).map((cue) => cue.soundId)));
  assert.ok(ids.has('ui-click-button'));
  assert.ok(ids.has('ui-chime'));
  assert.ok([...ids].some((id) => id.includes('whoosh')));
});

test('sound edits persist and invalidate rendered graphics; empty cues explicitly mute', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-cues-'));
  try {
    const scene = validatePlan(words, undefined, {scenes:[candidate(0,7)]}, settings, [], 1).scenes[0];
    scene.status = 'ready'; scene.videoFile = '/graphic.webm'; scene.code = GOOD_CODE;
    const plan: MotionPlan = {version:1,orientation:'portrait',settings,scenes:[scene],notes:[]};
    await updateMotionScene(dir,plan,scene.id,{soundEffects:[]},null);
    assert.deepEqual(scene.soundEffects,[]);
    assert.equal(scene.status,'none');
    assert.equal(scene.code,undefined);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'motion-plan.json'),'utf8')).scenes[0].soundEffects,[]);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
