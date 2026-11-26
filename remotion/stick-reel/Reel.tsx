import React from "react";
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame} from "remotion";

const ink = "#172622";
const paper = "#f9f6ec";
const green = "#c9fb83";
const orange = "#ff8666";

export type Scene = [number, string, string, number, string];
export type Word = {id: string; text: string; start: number; end: number};
export type ReelProps = {scenes: Scene[]; words: Word[]; duration: number; faces?: string};

export const demoScenes: Scene[] = [
  [0, "Build your own desktop app", "From an idea to an icon", 0, "neutral"],
  [4, "It works like software", "Open it from your dock", 0, "smirk"],
  [10, "Install as an app", "One action puts it on your desktop", 3, "surprised"],
  [14, "Start with a prompt", "Open Claude and describe your idea", 1, "thinking"],
  [20, "Ask for a dashboard", "Try an expense tracker", 1, "neutral"],
  [25, "Test the artifact", "Add a row and check the total", 2, "thinking"],
  [31, "Ready to install?", "Open the menu and select Install", 3, "smirk"],
  [37, "A real desktop app", "Own icon · Own window", 4, "happy"],
  [42, "Desktop controls", "Notifications · Shortcuts · File access", 4, "neutral"],
  [47, "Share it with your team", "One app, multiple desks", 5, "happy"],
  [53, "Build → Share → Team", "A small tool everyone can use", 5, "smirk"],
  [58, "See how it’s done", "Claude desktop app guide", 6, "thinking"],
  [63, 'Comment “APP”', "Get the setup details", 6, "happy"],
];

const box: React.CSSProperties = {border: `4px solid ${ink}`, borderRadius: 28, background: "#fffdf7", boxShadow: `9px 11px 0 ${ink}`, overflow: "hidden"};
const row: React.CSSProperties = {display: "flex", alignItems: "center", justifyContent: "space-between"};

function Stage({mode, beat, note}: {mode: number; beat: number; note: string}) {
  const click = beat >= 63;
  const type = "Build me an expense dashboard";
  const cursor = interpolate(beat, [25, 63], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return <div style={{...box, position:"relative", height:590}}>
    <div style={{...row, height:72, background:ink, color:paper, padding:"0 26px", fontSize:24, fontWeight:700}}>
      <div style={{display:"flex",gap:8}}>{[orange,"#ffdf79",green].map(color=><i key={color} style={{width:13,height:13,background:color,borderRadius:20}}/>)}</div>
      {["Desktop","Claude / New artifact","Expense dashboard","Install app","App settings","Shared workspace","Setup guide","Key idea"][mode]}
    </div>
    <div style={{padding:36,height:510,boxSizing:"border-box", background:mode===0?"#dcefd5":undefined}}>
      {mode===0 && <div style={{display:"grid", placeItems:"center",height:"100%"}}>
        <div style={{textAlign:"center"}}><div style={{display:"inline-grid",placeItems:"center",background:orange,border:"4px solid",borderRadius:28,width:112,height:112,fontSize:62,fontWeight:900,transform:`rotate(${Math.sin(beat/14)*7}deg)`}}>₹</div>
        <div style={{fontSize:36,fontWeight:900,marginTop:18}}>Expense Tracker</div></div>
        <div style={{display:"flex",gap:14,background:"#ffffffaf",padding:15,borderRadius:20}}>{["⌘","▦","↗","₹"].map((icon,i)=><div key={icon} style={{background:i===3?orange:paper,border:"2px solid",width:56,height:56,borderRadius:14,display:"grid",placeItems:"center",fontSize:28}}>{icon}</div>)}</div>
      </div>}
      {mode===1 && <><div style={{fontSize:48,fontWeight:900,margin:"60px 0 60px"}}>What should we build?</div><div style={{...row,border:"3px solid",borderRadius:19,padding:24,fontSize:32,minHeight:52}}>{type.slice(0,Math.max(0,Math.floor((beat-10)/2)))}<b style={{background:orange,padding:"8px 14px",borderRadius:10}}>↑</b></div></>}
      {mode===2 && <><div style={{...row,fontSize:29,fontWeight:800}}>This month <span style={{background:green,padding:"8px 16px",borderRadius:16}}>LIVE</span></div><div style={{fontSize:79,fontWeight:900,margin:"12px 0"}}>{click?"₹1,260":"₹1,240"}</div>{["Food","Travel","Bills"].slice(0,click?3:2).map((item,i)=><div key={item} style={{...row,borderTop:"2px solid #d4ddd0",padding:"13px 0",fontSize:26,fontWeight:700}}>{item}<span>{["₹450","₹600","₹210"][i]}</span></div>)}<b style={{position:"absolute",bottom:32,right:36,background:green,padding:"13px 23px",fontSize:25,borderRadius:13}}>+ Add</b></>}
      {mode===3 && <div style={{textAlign:"center",paddingTop:48}}><div style={{fontSize:55,fontWeight:900}}>Expense Tracker</div><p style={{fontSize:30}}>Add it to your desktop</p><div style={{display:"inline-block",background:click?green:orange,border:"3px solid",padding:"20px 44px",borderRadius:18,fontSize:39,fontWeight:900}}>{click?"✓ Installed":"↓ Install as app"}</div></div>}
      {mode===4 && <div>{["App icon","Separate window","Notifications","Keyboard shortcuts","File access"].map((item,i)=><div key={item} style={{...row,borderBottom:"2px solid #d4ddd0",padding:"17px 8px",fontSize:31,fontWeight:800,opacity:beat>i*8?1:.3}}>{item}<b style={{color:"#285b39"}}>✓</b></div>)}</div>}
      {mode===5 && <div style={{height:"100%",...row,gap:15}}><div style={{background:orange,border:"3px solid",borderRadius:21,padding:28,fontSize:49,fontWeight:900}}>₹</div><b style={{fontSize:75}}>→</b><div style={{display:"grid",gap:16}}>{["DESIGN","FINANCE","OPS"].map((item,i)=><div key={item} style={{background:green,border:"3px solid",borderRadius:14,padding:"17px 28px",fontSize:24,fontWeight:900,opacity:beat>12+i*8?1:.25}}>{item}　✓</div>)}</div></div>}
      {mode===7 && <div style={{display:"grid",alignContent:"center",height:"100%",gap:24}}>
        <span style={{fontSize:40,width:90,textAlign:"center",padding:"12px 0",background:green,borderRadius:17}}>↗</span>
        <b style={{fontSize:44,lineHeight:1.2,overflowWrap:"anywhere"}}>{note}</b>
        <div style={{height:11,width:`${Math.min(100,beat*1.5)}%`,background:orange,borderRadius:8}} />
      </div>}
      {mode===6 && <><div style={{fontSize:51,fontWeight:900,marginTop:24}}>From prompt to app</div>{["Describe your tool","Test the artifact","Install and share"].map((item,i)=><div key={item} style={{background:i===2?green:"#edf0e8",padding:"16px 20px",borderRadius:13,fontSize:29,fontWeight:750,marginTop:15}}>{i+1}. {item}</div>)}</>}
    </div>
    {(mode===2||mode===3) && <svg width="58" height="64" viewBox="0 0 50 55" style={{position:"absolute",left:(mode===2?460:240)+cursor*90,top:365+cursor*(mode===2?174:15),transform:`scale(${click&&beat<69?.8:1})`}}>
      <path d="M4 3L43 32L25 33L17 50Z" fill="white" stroke={ink} strokeWidth="4" strokeLinejoin="round"/>
    </svg>}
  </div>;
}

export function Reel({scenes, words: transcript, duration, faces}: ReelProps) {
  const frame = useCurrentFrame();
  const index = scenes.reduce((current, [start], i) => frame >= start*30 ? i : current, 0);
  const [start, headline, note, mode, face] = scenes[index];
  const local = frame-start*30;
  const beat = local;
  const entrance = spring({frame:local,fps:30,config:{damping:16,stiffness:143}});
  const left = index%2===0;
  const accent = local % 54;
  const accentIndex = Math.floor(local / 54);
  const hit = spring({frame:accent,fps:30,config:{damping:14,stiffness:220}});
  const pulse = Math.max(0,1-accent/15);
  const wave = Math.sin(local/5)*18 + pulse*40;
  const expression = accentIndex % 2 === 0 ? face : mode === 2 || mode === 3 ? "surprised" : "smirk";
  const time = frame / 30;
  const active = transcript.findIndex(word => time >= word.start && time < word.end);
  let groupStart = 0;
  let groupEnd = 0;
  while (groupEnd < transcript.length) {
    groupStart = groupEnd++;
    while (groupEnd < transcript.length && groupEnd - groupStart < 5 &&
      transcript[groupEnd].start - transcript[groupEnd - 1].end < .38 &&
      !/[.!?]$/.test(transcript[groupEnd - 1].text)) groupEnd++;
    if (time < (transcript[groupEnd]?.start ?? duration)) break;
  }
  const group = transcript.slice(groupStart, groupEnd);
  const words = group.length ? group.map(word => word.text) : note.split(" ");
  const highlighted = group.length ? (active < 0 ? -1 : active - groupStart) : 0;
  const cameraScale = 1+0.025*Math.sin(local/16)+0.056*pulse;
  const pose = index===12 ? "M0 18L-71 -14L-103 -94 M0 18L73 -15L110 -90" :
    left ? `M0 18L-56 76L-47 119 M0 18L71 51L139 ${8+wave}` : `M0 18L-71 51L-139 ${8+wave} M0 18L56 76L47 119`;
  return <AbsoluteFill style={{background:paper,color:ink,fontFamily:"Arial, sans-serif",overflow:"hidden"}}>
    {[0,1,2,3,4,5,6,7].map(i=><span key={i} style={{position:"absolute",left:42+(i*137)%990,top:180+(i*193)%1350+24*Math.sin(frame/16+i),color:i%2?"#dfa18d":"#a6bb9c",fontSize:28,fontWeight:900,transform:`rotate(${frame*1.5+i*22}deg)`}}>{i%2?"+":"○"}</span>)}
    {[0,1,2].map(i=><div key={i} style={{position:"absolute",top:490+i*328,left:-350+(frame*1.1+i*190)%540,whiteSpace:"nowrap",fontSize:191,fontWeight:900,letterSpacing:-8,color:"transparent",WebkitTextStroke:"2px #e6e7d9"}}>DESKTOP TOOLS / DESKTOP TOOLS</div>)}
    <div style={{position:"absolute",inset:"125px 90px auto",...row,fontSize:26,fontWeight:900,letterSpacing:3}}>
      <span style={{background:ink,color:paper,borderRadius:30,padding:"12px 21px"}}>{mode === 7 ? "TECH EXPLAINER" : "CLAUDE → DESKTOP"}</span>
      <span>{String(Math.floor(frame/30)).padStart(2,"0")}s</span>
    </div>
    <div style={{position:"absolute",top:246,left:86,right:86,fontSize:headline.length>23?100:114,lineHeight:.89,fontWeight:950,letterSpacing:-7,transform:`translateY(${(1-entrance)*55}px) scale(${1+.032*pulse})`,opacity:Math.min(1,entrance*2),fontFamily:"Arial, Malayalam Sangam MN, sans-serif",overflowWrap:"anywhere",maxHeight:312,overflow:"hidden"}}>
      {headline}<div style={{height:17,width:155,background:orange,marginTop:24,transform:"rotate(-3deg)"}}/>
    </div>
    <div style={{position:"absolute",top:588,left:110,right:126,transform:`translate(${(1-entrance)*(left?-210:210)}px,${(1-entrance)*70}px) rotate(${(left?-1.6:1.6)+(1-entrance)*8}deg) scale(${cameraScale})`}}>
      <Stage mode={mode} beat={beat} note={note}/>
      {(mode===2||mode===3) && beat>=63 && beat<83 && <div style={{position:"absolute",left:mode===2?553:332,top:mode===2?546:385,width:50,height:50,borderRadius:"50%",border:`5px solid ${orange}`,transform:`translate(-50%,-50%) scale(${1+(beat-63)/7})`,opacity:1-(beat-63)/20}}/>}
      {accentIndex>0 && accent<18 && <svg width="93" height="93" viewBox="0 0 90 90" style={{position:"absolute",right:accentIndex%2?-42:undefined,left:accentIndex%2?undefined:-42,top:accentIndex%2?55:360,transform:`scale(${.65+hit*.55})`,opacity:Math.min(1,(18-accent)/8)}}><path d="M45 6v24M45 60v24M6 45h24m30 0h24M17 17l17 17m22 22 17 17M17 73l17-17m22-22 17-17" stroke={orange} strokeWidth="7" strokeLinecap="round"/></svg>}
    </div>
    <div style={{position:"absolute",left:left?245:793,top:1260+Math.sin(frame/5)*10-42*pulse,transform:`translateX(calc(-50% + ${(1-entrance)*(left?-150:150)+Math.sin(local/10)*18}px)) rotate(${Math.sin(local/8)*2.7}deg) scale(${.89+entrance*.11+.08*pulse})`,width:340,height:300}}>
      <svg viewBox="-170 -20 340 290" width="340" height="290" style={{position:"absolute",top:10}}>
        <ellipse cx="0" cy="252" rx="94" ry="12" fill="#dce0ce"/>
        <path d="M0 0L0 113 M0 113L-31 183L-45 246L-70 246 M0 113L41 181L57 246L79 246" stroke={ink} strokeWidth="16" strokeLinecap="round" fill="none" strokeLinejoin="round"/>
        <path d={pose} stroke={ink} strokeWidth="14" strokeLinecap="round" fill="none" strokeLinejoin="round"/>
      </svg>
      <Img src={faces ? `${faces}/${expression}.png` : staticFile(`stick-demo/${expression}.png`)} style={{position:"absolute",width:210,height:236,objectFit:"contain",objectPosition:"center bottom",bottom:266,left:65,transform:`rotate(${Math.sin(frame/7)*6}deg)`}}/>
    </div>
    <div style={{position:"absolute",top:1610,left:90,right:130,border:"3px solid",borderRadius:44,background:"#fffdf7",boxShadow:`5px 6px 0 ${ink}`,textAlign:"center",padding:"22px 24px",fontSize:34,fontWeight:800,fontFamily:"Arial, Malayalam Sangam MN, sans-serif"}}>
      {words.map((word,i)=><React.Fragment key={i}>{i>0?" ":null}<span style={{background:i===highlighted?green:"transparent",borderRadius:9,padding:"4px 2px"}}>{word}</span></React.Fragment>)}
    </div>
    <div style={{position:"absolute",top:1735,left:90,right:130,height:7,borderRadius:10,background:"#dfdfd2",overflow:"hidden"}}><div style={{width:`${frame/(duration*30)*100}%`,height:"100%",background:ink}}/></div>
  </AbsoluteFill>;
}
