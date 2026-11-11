import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BrollWord } from './broll.js';
import { buildEditorRender, type EditorTimeline } from './editor-render.js';
import { EMOTIONS, editEmotionCue, emotionCueClip, isLeadIn, newEmotionCue, normalizeEmotionCues, validateEmotionCues } from './emotion-sfx.js';
import { addEmotionCue, deleteEmotionCue, emptyMotionPlan, loadMotionPlan, updateEmotionCue } from './motion.js';
import { MOTION_SOUNDS, motionSound } from './motion-sfx.js';
import type { Project } from './project-store.js';

// Forty words, half a second each: w1 starts at 0.5s, w40 at 20s.
const words: BrollWord[] = Array.from({ length: 40 }, (_, i) => ({ id: `w${i + 1}`, text: `word${i + 1}`, start: (i + 1) * 0.5, end: (i + 1) * 0.5 + 0.4 }));
const pick = (wordId: string, emotion: string, soundId: string, intensity = 'medium') => ({ emotion, wordId, soundId, intensity, reason: 'The viewer should feel it here.' });
const options = { maxBeats: 8, graphics: [] as Array<{ start: number; end: number; label: string }> };
const SHOCK = 'impacts-impact-hit-2'; const BUILD = 'buildups-dramatic-buildup-1';

test('every emotion palette uses real, measured library sounds', () => {
  for (const emotion of EMOTIONS) {
    assert.ok(emotion.sounds.length >= 6, `${emotion.id} needs enough sounds to vary`);
    assert.equal(new Set(emotion.sounds).size, emotion.sounds.length, `${emotion.id} lists a sound twice`);
    for (const id of emotion.sounds) assert.ok(MOTION_SOUNDS.some((sound) => sound.id === id), `${emotion.id}: unknown sound ${id}`);
  }
  for (const sound of MOTION_SOUNDS) for (const field of ['peakTime', 'peakDb', 'loudnessDb'] as const) assert.ok(Number.isFinite(sound[field]), `${sound.id} is missing ${field}; run scripts/analyze-motion-sfx.mjs`);
});

test('a cue clip lands the sound\'s loudest moment on the word and levels sounds against each other', () => {
  const hit = emotionCueClip('shock', SHOCK, 'medium');
  assert.ok(hit.lead < 0.5 && hit.sourceOffset === 0, 'an impact starts on the word');
  const build = emotionCueClip('suspense', BUILD, 'medium');
  assert.ok(isLeadIn(BUILD) && build.lead > 1.5, 'a build-up starts well before the word');
  for (const emotion of EMOTIONS) for (const id of emotion.sounds) {
    const clip = emotionCueClip(emotion.id, id, 'strong'); const sound = motionSound(id);
    assert.ok(clip.volume > 0 && clip.volume <= 1, `${id} volume ${clip.volume}`);
    assert.ok(clip.lead <= 2.5 && clip.duration <= 5.5 && clip.sourceOffset + clip.duration <= sound.duration + 0.01, `${id} clip window`);
  }
  // Long risers keep the tail that reaches the hit, not the quiet start.
  const wildfire = emotionCueClip('suspense', 'cinematic-cinematic-riser-wildfire', 'medium');
  assert.ok(wildfire.sourceOffset > 3 && wildfire.fadeIn > 0);
  // Two sounds of very different loudness get different volumes so they sit at a similar level.
  const loud = emotionCueClip('emphasis', 'impacts-impact-hit-3', 'medium'); const quiet = emotionCueClip('emphasis', 'camera-fx-camera-6', 'medium');
  assert.ok(loud.volume < quiet.volume);
  const soft = emotionCueClip('shock', 'cinematic-cinematic-heavy-hit', 'soft'); const strong = emotionCueClip('shock', 'cinematic-cinematic-heavy-hit', 'strong');
  assert.ok(soft.volume < strong.volume);
});

test('valid picks become cues anchored on the spoken word with a readable snippet', () => {
  const { cues, notes } = validateEmotionCues(words, undefined, { cues: [pick('w10', 'shock', SHOCK, 'strong')] }, options);
  assert.equal(cues.length, 1); assert.deepEqual(notes, []);
  assert.match(cues[0].id, /^emo-[0-9a-f]{8}$/);
  assert.deepEqual({ wordId: cues[0].wordId, sourceTime: cues[0].sourceTime, emotion: cues[0].emotion, intensity: cues[0].intensity, enabled: cues[0].enabled }, { wordId: 'w10', sourceTime: 5, emotion: 'shock', intensity: 'strong', enabled: true });
  assert.match(cues[0].narration, /word10/);
  assert.equal(Object.keys(cues[0]).includes('final'), false, 'planning scratch fields must not be saved');
});

test('cues that break a rule are dropped with an explanation instead of failing the plan', () => {
  const graphics = [{ start: 10, end: 13, label: 'graphic “Stat”' }];
  const result = validateEmotionCues(words, undefined, { cues: [
    pick('w4', 'shock', SHOCK),                      // fine
    pick('nope', 'sadness', 'ui-ui-sound-8'),        // unknown word
    pick('w6', 'joy', SHOCK),                        // sound not in the joy palette
    pick('w22', 'warning', 'cinematic-inception-thump'), // inside the graphic (w22 = 11s)
    pick('w8', 'insight', 'ui-chime'),               // 2s after w4: allowed
    pick('w9', 'insight', 'ui-notification-1'),      // 0.5s later: too close
    pick('w30', 'melancholy', 'ui-chime'),           // unknown emotion
  ] }, { ...options, graphics });
  assert.deepEqual(result.cues.map((cue) => cue.wordId), ['w4', 'w8']);
  assert.equal(result.notes.length, 5);
  for (const pattern of [/not a word/, /palette/, /own sound design/, /within 2s/, /not an emotion/]) assert.ok(result.notes.some((note) => pattern.test(note)), String(pattern));
});

test('a build-up and a hit on the same word form one stinger; two hits do not', () => {
  const stinger = validateEmotionCues(words, undefined, { cues: [pick('w12', 'shock', SHOCK), pick('w12', 'suspense', BUILD)] }, options);
  assert.deepEqual(stinger.cues.map((cue) => cue.soundId), [BUILD, SHOCK], 'the build sorts before the hit');
  assert.equal(stinger.cues[0].sourceTime, stinger.cues[1].sourceTime);
  const doubled = validateEmotionCues(words, undefined, { cues: [pick('w12', 'shock', SHOCK), pick('w12', 'warning', 'impacts-impact-hit-1')] }, options);
  assert.equal(doubled.cues.length, 1);
});

test('the density limit keeps the strongest beats, and a stinger counts as one beat', () => {
  const crowded = { cues: [pick('w2', 'emphasis', 'ui-pop-sound', 'soft'), pick('w8', 'shock', SHOCK, 'strong'), pick('w14', 'joy', 'ui-chime', 'medium'), pick('w20', 'warning', 'cinematic-inception-thump', 'strong'), pick('w26', 'joy', 'ui-success', 'soft')] };
  const limited = validateEmotionCues(words, undefined, crowded, { ...options, maxBeats: 3 });
  assert.deepEqual(limited.cues.map((cue) => cue.wordId), ['w8', 'w14', 'w20']);
  assert.ok(limited.notes.some((note) => /3 strongest of 5/.test(note)));
  const withStinger = validateEmotionCues(words, undefined, { cues: [pick('w8', 'suspense', BUILD, 'strong'), pick('w8', 'shock', SHOCK, 'strong'), pick('w20', 'joy', 'ui-chime')] }, { ...options, maxBeats: 2 });
  assert.equal(withStinger.cues.length, 3);
});

test('the same sound is never used on consecutive beats', () => {
  const { cues } = validateEmotionCues(words, undefined, { cues: [pick('w4', 'shock', SHOCK), pick('w12', 'shock', SHOCK), pick('w20', 'shock', SHOCK)] }, options);
  assert.equal(cues.length, 3);
  for (let i = 1; i < cues.length; i += 1) assert.notEqual(cues[i].soundId, cues[i - 1].soundId);
  for (const cue of cues) assert.ok(EMOTIONS.find((emotion) => emotion.id === 'shock')!.sounds.includes(cue.soundId));
});

test('cues outside the kept narration are ignored when the cleaned edit removes those words', () => {
  const keep = [{ startWordId: 'w1', endWordId: 'w10' }];
  const { cues, notes } = validateEmotionCues(words, keep, { cues: [pick('w5', 'shock', SHOCK), pick('w30', 'joy', 'ui-chime')] }, options);
  assert.deepEqual(cues.map((cue) => cue.wordId), ['w5']); assert.equal(notes.length, 1);
});

test('stored cues are re-validated and their clip recomputed on load', () => {
  const stored = normalizeEmotionCues([
    { id: 'emo-001', emotion: 'shock', soundId: SHOCK, intensity: 'strong', sourceTime: 4, narration: 'a', reason: 'r', enabled: true, clip: { volume: 99 } },
    { id: 'emo-001', emotion: 'shock', soundId: SHOCK, sourceTime: 5 },       // duplicate id
    { id: 'emo-002', emotion: 'shock', soundId: '../etc/passwd', sourceTime: 5 }, // not a library sound
    { id: 'bad id', emotion: 'shock', soundId: SHOCK, sourceTime: 5 },
    { id: 'emo-003', emotion: 'boredom', soundId: SHOCK, sourceTime: 5 },
    { id: 'emo-004', emotion: 'joy', soundId: 'ui-chime', sourceTime: Infinity },
  ]);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].clip, emotionCueClip('shock', SHOCK, 'strong'));
  assert.deepEqual(normalizeEmotionCues('nonsense'), []);
});

test('moving a cue re-anchors it to the nearest word; manual cues get a fresh id', () => {
  const [cue] = validateEmotionCues(words, undefined, { cues: [pick('w4', 'shock', SHOCK)] }, options).cues;
  const moved = editEmotionCue(cue, { sourceTime: 9.9, soundId: 'impacts-impact-hit', intensity: 'soft' }, words);
  assert.equal(moved.wordId, 'w20'); assert.match(moved.narration, /word20/); assert.equal(moved.soundId, 'impacts-impact-hit'); assert.equal(moved.intensity, 'soft');
  assert.deepEqual(moved.clip, emotionCueClip('shock', 'impacts-impact-hit', 'soft'));
  assert.throws(() => editEmotionCue(cue, { soundId: 'nope' }, words), /Unknown motion sound/);
  const added = newEmotionCue({ emotion: 'sadness', sourceTime: 3 }, words);
  assert.notEqual(added.id, cue.id); assert.equal(added.emotion, 'sadness'); assert.ok(EMOTIONS.find((emotion) => emotion.id === 'sadness')!.sounds.includes(added.soundId));
  assert.throws(() => newEmotionCue({ sourceTime: -1 }, words), /time/);
});

test('cue edits persist with the plan and survive a reload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'emotion-plan-'));
  try {
    const plan = emptyMotionPlan('portrait', {});
    assert.equal(plan.settings.emotionSounds, true); assert.equal(plan.settings.emotionDensity, 'balanced');
    const first = await addEmotionCue(dir, plan, { emotion: 'joy', sourceTime: 6 }, words);
    const second = await addEmotionCue(dir, plan, { emotion: 'shock', sourceTime: 2 }, words);
    assert.deepEqual(plan.emotionCues!.map((cue) => cue.id), [second.id, first.id], 'kept in time order');
    await updateEmotionCue(dir, plan, first.id, { enabled: false, intensity: 'strong' }, words);
    await deleteEmotionCue(dir, plan, second.id);
    await assert.rejects(updateEmotionCue(dir, plan, 'emo-099', {}, words), /not found/);
    const reloaded = await loadMotionPlan(dir);
    assert.equal(reloaded!.emotionCues!.length, 1);
    assert.equal(reloaded!.emotionCues![0].enabled, false); assert.equal(reloaded!.emotionCues![0].intensity, 'strong');
    // Plans written before this feature have no cues and load unchanged.
    await fs.writeFile(path.join(dir, 'motion-plan.json'), JSON.stringify({ version: 1, orientation: 'portrait', settings: {}, scenes: [], notes: [] }));
    assert.deepEqual((await loadMotionPlan(dir))!.emotionCues, []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

const available = ['ffmpeg', 'ffprobe'].every((bin) => spawnSync(bin, ['-version']).status === 0);
test('an emotion cue on the timeline is mixed into the exported MP4 at its hit time, and mute or a forged sound id is honoured', { skip: !available }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'emotion-export-'));
  try {
    const source = path.join(dir, 'source.mp4'); const output = path.join(dir, 'final.mp4');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x160:rate=15', '-t', '2', '-c:v', 'mpeg4', '-q:v', '5', source]);
    assert.equal(made.status, 0, String(made.stderr));
    const media = { duration: 2, size: 1000, width: 96, height: 160, frameRate: 15, hdr: false };
    const project = { id: 'p', name: 'P', workDir: dir, sourcePath: source, sourceName: 'source.mp4', media, clips: [{ id: 'c', sourcePath: source, sourceName: 'source.mp4', media, timelineStart: 0, timelineEnd: 2 }] } as unknown as Project;
    const clip = emotionCueClip('shock', 'impacts-impact-hit', 'strong');
    const base = { id: 'base', trackId: 'base', type: 'video', role: 'base', name: 'Talking head', metadata: { sourceClipId: 'c' }, start: 0, duration: 2, sourceStart: 0, sourceDuration: 2, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: 1, speed: 1 };
    const sfx = { id: 'sfx', externalId: 'emo-001', trackId: 'sfx', type: 'audio', role: 'audio', name: clip.label, metadata: { emotionCueId: 'emo-001', sfxSoundId: 'impacts-impact-hit' }, start: 1 - clip.lead, duration: 0.8, sourceStart: clip.sourceOffset, sourceDuration: clip.soundDuration, x: 50, y: 50, scale: 1, rotation: 0, opacity: 1, volume: clip.volume, speed: 1, fadeIn: 0, fadeOut: 0.1 };
    const timeline = { name: 'T', width: 96, height: 160, fps: 15, duration: 2, tracks: [
      { id: 'sfx', name: 'SFX', type: 'audio', visible: true, locked: false, volume: 1, muted: false, clips: [sfx] },
      { id: 'base', name: 'Base', type: 'video', visible: true, locked: false, volume: 1, muted: false, clips: [base] },
    ] } as unknown as EditorTimeline;
    const request = { project, timeline, broll: null, ffmpegBin: 'ffmpeg', outputPath: output, workDir: path.join(dir, 'render'), mode: 'fast' as const, probe: async () => ({ duration: 2 }) };
    const render = await buildEditorRender(request);
    assert.equal(render.audioClips, 1); assert.equal(render.visualClips, 1);
    const encoded = spawnSync('ffmpeg', ['-v', 'error', '-y', ...render.args]); assert.equal(encoded.status, 0, String(encoded.stderr));
    const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'], { timeout: 60000 }); assert.equal(pcm.status, 0);
    const rms = (from: number, to: number) => { let power = 0; let count = 0; for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i += 1) { power += pcm.stdout.readFloatLE(i * 4) ** 2; count += 1; } return Math.sqrt(power / count); };
    assert.ok(rms(1.0, 1.15) > rms(0.2, 0.9) * 10 + 0.001, 'silence before the hit, sound right after it');
    // The usual case: the talking head has its own audio, so the cue is mixed with it.
    const talking = path.join(dir, 'talking.mp4'); const mixed = path.join(dir, 'mixed.mp4');
    const withAudio = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '2', '-c:v', 'copy', '-c:a', 'aac', '-af', 'volume=0.05', talking]); assert.equal(withAudio.status, 0, String(withAudio.stderr));
    const talkingProject = { ...project, sourcePath: talking, media: { ...media, audioCodec: 'aac' }, clips: [{ id: 'c', sourcePath: talking, sourceName: 'talking.mp4', media: { ...media, audioCodec: 'aac' }, timelineStart: 0, timelineEnd: 2 }] } as unknown as Project;
    const both = await buildEditorRender({ ...request, project: talkingProject, outputPath: mixed });
    assert.equal(both.audioClips, 2);
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...both.args]).status, 0);
    const mixedPcm = spawnSync('ffmpeg', ['-v', 'error', '-i', mixed, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1e9 });
    const mixedRms = (from: number, to: number) => { let power = 0; let count = 0; for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i += 1) { power += mixedPcm.stdout.readFloatLE(i * 4) ** 2; count += 1; } return Math.sqrt(power / count); };
    assert.ok(mixedRms(0.2, 0.9) > 0.001, 'the talking-head audio is still there before the cue');
    assert.ok(mixedRms(1.0, 1.15) > mixedRms(0.2, 0.9) * 3, 'the cue stands out from the narration at its hit time');
    (timeline.tracks[0] as { muted?: boolean }).muted = true;
    assert.equal((await buildEditorRender(request)).audioClips, 0);
    (timeline.tracks[0] as { muted?: boolean }).muted = false; (sfx.metadata as Record<string, string>).sfxSoundId = '../../etc/passwd';
    await assert.rejects(buildEditorRender(request), /Unknown motion sound/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
