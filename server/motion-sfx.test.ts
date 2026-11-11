import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { MOTION_SOUNDS, motionSoundPath, motionSoundEncoding, normalizeMotionSounds } from './motion-sfx.js';
import { buildEditorRender } from './editor-render.js';
import type { Project } from './project-store.js';
import type { MotionPlan } from './motion.js';

test('bundled sounds match their documented source checksums', async () => {
  for (const sound of MOTION_SOUNDS) {
    assert.equal(createHash('sha256').update(await fs.readFile(motionSoundPath(sound.id))).digest('hex'), sound.sha256);
    assert.ok(sound.category.length > 0);
    assert.ok(sound.sampleRate > 0);
  }
  assert.throws(() => motionSoundPath('../outside'), /Unknown/);
});
test('sound cues reject unknown files, nonfinite/out-of-range times and cap gain/count', () => {
  assert.deepEqual(normalizeMotionSounds([{soundId:'../outside',time:0}, {soundId:'ui-chime',time:Infinity}, {soundId:'ui-pop-sound',time:3}], 2), []);
  assert.deepEqual(normalizeMotionSounds([{soundId:'ui-chime',time:0.12,gainDb:100}], 2), [{soundId:'ui-chime',time:4/30,gainDb:-6}]);
  assert.equal(normalizeMotionSounds(Array(10).fill({soundId:'ui-chime',time:0,gainDb:-16}), 2).length, 1);
  assert.deepEqual(motionSoundEncoding([], 2), {inputs:[],output:[]});
});
const available = ['ffmpeg', 'ffprobe'].every(bin => spawnSync(bin, ['-version']).status === 0);
function run(bin: string, args: string[]) {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
test('motion audio stays delayed, preserves alpha metadata and reaches final MP4; track mute works', {skip: !available}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-sfx-'));
  try {
    const file = path.join(dir, 'graphic.webm');
    const audio = motionSoundEncoding([{soundId:'ui-chime',time:0.5,gainDb:-16},{soundId:'ui-pop-sound',time:1.2,gainDb:-16}], 2);
    run('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=c=red@0.5:s=96x160:r=30:d=2,format=yuva420p',...audio.inputs,...audio.output,'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0', file]);
    const probe = JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',file]));
    assert.ok(probe.streams.some((s:any) => s.codec_name === 'opus'));
    assert.equal(probe.streams.find((s:any) => s.codec_type === 'video').tags.alpha_mode, '1');
    const project = {id:'test',name:'Test',workDir:dir,clips:[],media:{width:96,height:160,duration:2,frameRate:30}} as unknown as Project;
    const motion = {scenes:[{id:'m',title:'M',enabled:true,status:'ready',videoFile:file}]} as unknown as MotionPlan;
    const clip = {id:'m',externalId:'m',trackId:'motion',type:'video',role:'overlay',name:'M',metadata:{motionId:'m'},start:0,duration:2,sourceStart:0,sourceDuration:2,x:50,y:50,scale:1,rotation:0,opacity:1,volume:1,speed:1};
    const timeline = {name:'Test',width:96,height:160,fps:30,duration:2,tracks:[{id:'motion',name:'Motion',type:'video',visible:true,locked:false,muted:false,clips:[clip]}]};
    const output = path.join(dir,'final.mp4');
    const options = {project,timeline,motion,broll:null,ffmpegBin:'ffmpeg',outputPath:output,workDir:path.join(dir,'render'),mode:'fast' as const,probe:async()=>({duration:2,audioCodec:'opus'})};
    const render = await buildEditorRender(options);
    assert.equal(render.audioClips, 1);
    run('ffmpeg',['-v','error','-y',...render.args]);
    const samples = spawnSync('ffmpeg',['-v','error','-i',output,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1'],{timeout:60000});
    assert.equal(samples.status,0);
    const rms = (start:number,end:number) => {
      let power=0,count=0; for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){ power+=samples.stdout.readFloatLE(i*4)**2;count++; }
      return Math.sqrt(power/count);
    };
    assert.ok(rms(0.5,0.8)>rms(0.05,0.35)+0.001, 'cue should be audible at its planned time, with silence before');
    timeline.tracks[0].muted=true;
    assert.equal((await buildEditorRender(options)).audioClips,0);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
