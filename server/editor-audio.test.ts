import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildEditorRender, type EditorTimeline } from './editor-render.js';
import type { Project } from './project-store.js';
import { importEditorMedia } from './editor-media.js';
import { createReadStream } from 'node:fs';

const hasFfmpeg = ['ffmpeg','ffprobe'].every(bin => spawnSync(bin,['-version'],{encoding:'utf8'}).status===0);
function run(bin: string,args: string[]) {
  const result=spawnSync(bin,args,{encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  return result;
}
function clip(id: string, trackId: string, type: 'video'|'audio', metadata: Record<string,string>, duration=1) {
  return {
    id,trackId,type,role:type==='video'?'base':'imported',name:id,metadata,
    start:0,duration,sourceStart:0,sourceDuration:1,x:50,y:50,scale:1,rotation:0,opacity:1,volume:1,speed:1,
  };
}
test('imported music plays over video with track gain and progressive volume in final MP4',{skip:!hasFfmpeg},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cjcut-audio-automation-'));
  try {
    const source=path.join(dir,'source.mp4'),music=path.join(dir,'music.wav'),output=path.join(dir,'edited.mp4');
    run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=96x160:rate=15','-t','1','-c:v','mpeg4','-q:v','5',source]);
    run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=523:sample_rate=48000','-t','1','-c:a','pcm_s16le',music]);
    const sound=await importEditorMedia({workDir:dir,fileName:'music.wav',kind:'audio',stream:createReadStream(music),probe:async()=>({duration:1,audioCodec:'pcm_s16le'})});
    const media={duration:1,size:1000,width:96,height:160,frameRate:15,hdr:false};
    const project={
      id:'audio-test',name:'Timeline audio',workDir:dir,sourcePath:source,sourceName:'source.mp4',media,
      clips:[{id:'base-clip',sourcePath:source,sourceName:'source.mp4',media,timelineStart:0,timelineEnd:1}],
    } as Project;
    const baseline=clip('talking-head','base','video',{sourceClipId:'base-clip'});
    const musicClip={
      ...clip('music','music','audio',{editorMediaId:sound.id}),
      fadeIn:0.25,fadeOut:0,volumeKeyframes:[{time:0,gain:0},{time:0.5,gain:1},{time:1,gain:1}],
    };
    const timeline:EditorTimeline={
      name:'Music over video',width:96,height:160,fps:15,duration:1,
      tracks:[
        {id:'music',name:'Music',type:'audio',visible:true,locked:false,volume:0.7,muted:false,clips:[musicClip]},
        {id:'base',name:'Base',type:'video',visible:true,locked:false,volume:1,muted:false,clips:[baseline]},
      ],
    };
    const render=await buildEditorRender({project,timeline,broll:null,ffmpegBin:'ffmpeg',outputPath:output,workDir:path.join(dir,'render'),mode:'fast',probe:async()=>({duration:1})});
    assert.equal(render.visualClips,1,'imported music must not replace or stop video');
    assert.equal(render.audioClips,1);
    const graph=render.args[render.args.indexOf('-filter_complex')+1];
    assert.match(graph,/volume=0\.700000/);
    assert.match(graph,/afade=t=in/);
    assert.match(graph,/volume='if\(/);
    run('ffmpeg',['-hide_banner','-loglevel','error','-y',...render.args]);
    const probe=JSON.parse(run('ffprobe',['-v','error','-show_entries','stream=codec_type:format=duration','-of','json',output]).stdout);
    assert.ok(probe.streams.some((item:{codec_type:string})=>item.codec_type==='video'));
    assert.ok(probe.streams.some((item:{codec_type:string})=>item.codec_type==='audio'));
    assert.ok(Math.abs(Number(probe.format.duration)-1)<0.2);
    const volumeIn=(start:number,length:number)=>{
      const r=spawnSync('ffmpeg',['-hide_banner','-ss',String(start),'-t',String(length),'-i',output,'-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8',timeout:120000});
      assert.equal(r.status,0,r.stderr);
      const match=r.stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      assert.ok(match,r.stderr);
      return Number(match[1]);
    };
    assert.ok(volumeIn(0.77,0.18)>volumeIn(0.02,0.15)+10,'the rendered volume should rise substantially along the clip');
    timeline.tracks[0].muted=true;
    const mute=await buildEditorRender({project,timeline,broll:null,ffmpegBin:'ffmpeg',outputPath:path.join(dir,'muted.mp4'),workDir:path.join(dir,'render-mute'),mode:'fast',probe:async()=>({duration:1})});
    assert.equal(mute.visualClips,1,'muting music must not hide video');
    assert.equal(mute.audioClips,0,'muted track must not be mixed');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
