import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame } from 'remotion';
import type { StickCastMember, StickFace, StickPose, StickSceneV2, StickTheme, StickTimedText } from '../../server/stick-reel';
import { STICK_FONT_STACK } from './fonts';
import { Stage } from './Stage';
import { StickRig } from './StickRig';
import type { Word } from './Reel';

/**
 * Cinematic stick reel: a photo-real set the camera glides across, the owner's figure plus a small cast standing in
 * it, speech bubbles and yellow punch boxes landing on the spoken word, a chapter tracker on top and clean captions.
 * Something new appears every second or so, so it plays like a short film rather than a slideshow.
 */

const FPS = 30;
const YELLOW = '#ffd23f';
const INK = '#f5f5f0';
const OUTLINE = '#0b0d0e';
const FLOOR_TOP = 1170; // rig "top": feet land near y≈1460
const SET_W = 1720; const SET_H = 2140;

export type CinematicProps = {
  scenes: StickSceneV2[];
  words: Word[];
  duration: number;
  faces: string;
  badge: string;
  theme: StickTheme;
  tracker: string[];
  cast: StickCastMember[];
  setUrl?: string;
  photoUrls: string[];
};

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const defaultCamera = (i: number) => [0.18, 0.82, 0.5, 0.05, 0.95, 0.35, 0.65][i % 7];
const EDGE_L = -190; const EDGE_R = 1270;

type Spot = { castId: string; x: number; pose: StickPose; bubble?: StickTimedText; label: string };
type Blocking = { mainX: number; mainLeft: boolean; actors: Spot[]; camera: number };

/** Where everyone stands in each scene. People stay in the room between scenes and walk when their spot changes. */
function blockScenes(scenes: StickSceneV2[], cast: StickCastMember[]): Blocking[] {
  const out: Blocking[] = [];
  scenes.forEach((scene, i) => {
    const actors = (scene.actors ?? []).map((a) => ({ ...a, member: cast.find((c) => c.id === a.castId) })).filter((a) => a.member).slice(0, 3);
    const prevB = out[i - 1];
    // People in a running conversation don't swap places: if someone from the last scene is still here, keep sides.
    const stays = prevB && actors.some((a) => prevB.actors.some((b) => b.castId === a.castId));
    const mainLeft = stays ? prevB.mainLeft : actors.length ? scene.side !== 'right' : scene.side === 'left' || (scene.side === 'center' ? false : true);
    const mainX = actors.length ? (mainLeft ? 250 : 830) : scene.side === 'center' ? 540 : mainLeft ? 270 : 810;
    const xs = actors.length === 1 ? [mainLeft ? 760 : 320] : actors.length === 2 ? (mainLeft ? [640, 880] : [200, 440]) : mainLeft ? [560, 740, 920] : [160, 340, 520];
    // Keep the camera steady inside a chapter (small drifts); big moves only when the chapter changes.
    const want = scene.camera ?? defaultCamera(i);
    const prev = out[i - 1];
    const camera = !prev || scenes[i - 1].chapter !== scene.chapter ? want : prev.camera + Math.max(-0.1, Math.min(0.1, want - prev.camera));
    out.push({ mainX, mainLeft, camera, actors: actors.map((a, k) => ({ castId: a.castId, x: xs[k], pose: a.pose, bubble: a.bubble, label: a.member!.label })) });
  });
  return out;
}

/** A walk from one spot to another starting at frame `t0` of the scene: position, how much it is walking, stride phase. */
function walkTo(from: number, to: number, t: number) {
  const dist = Math.abs(to - from);
  if (dist < 8) return { x: to, walk: 0, phase: 0, dir: 0, done: t >= 0, arrive: 0 };
  const dur = Math.max(14, Math.min(34, dist / 20));
  const p = Math.max(0, Math.min(1, t / dur));
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const x = from + (to - from) * e;
  const walk = p <= 0 || p >= 1 ? 0 : Math.min(1, p * 6, (1 - p) * 6);
  return { x, walk, phase: (Math.abs(x - from) / 62) * Math.PI, dir: Math.sign(to - from), done: p >= 1, arrive: dur };
}
const lastPose = (scene: StickSceneV2) => [...(scene.beats ?? [])].reverse().find((b) => b.pose)?.pose ?? scene.pose;

export function Cinematic({ scenes, words, duration, faces, badge, theme, tracker, cast, setUrl, photoUrls }: CinematicProps) {
  const frame = useCurrentFrame();
  const time = frame / FPS;
  const index = scenes.reduce((current, scene, i) => (time >= scene.at ? i : current), 0);
  const scene = scenes[index];
  const prev = scenes[index - 1];
  const local = Math.max(0, frame - scene.at * FPS);
  const sceneLen = Math.max(1, ((scenes[index + 1]?.at ?? duration) - scene.at) * FPS);

  const blocking = React.useMemo(() => blockScenes(scenes, cast), [scenes, cast]);
  const here = blocking[index]; const before = blocking[index - 1];
  // Camera: glide from the previous scene's spot to this one, then a slow push-in and drift.
  const camTo = here.camera;
  const camFrom = before ? before.camera : camTo;
  const glide = interpolate(local, [0, 22], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const cam = camFrom + (camTo - camFrom) * glide + Math.sin(frame / 70) * 0.015;
  // Punch boxes lose their punch if every scene has one: never two scenes in a row.
  const punchShown = scenes.reduce<boolean[]>((acc, s, i) => { acc.push(Boolean(s.punchText) && !acc[i - 1]); return acc; }, []);
  const punchText = punchShown[index] ? scene.punchText : undefined;
  const punchAt = punchText ? punchText.at * FPS : Infinity;
  const punchKick = frame >= punchAt ? Math.max(0, 1 - (frame - punchAt) / 14) : 0;
  const zoom = 1.02 + 0.05 * (local / sceneLen) + 0.035 * punchKick;
  const moveDir = Math.sign(camTo - camFrom) || (index % 2 ? 1 : -1);

  // Beats (pose / face changes on exact words), as in the classic look.
  const beats = scene.beats ?? [];
  let activeBeat = -1; for (let i = 0; i < beats.length; i++) if (time >= beats[i].at) activeBeat = i;
  // The figure carries on from where it was: its pose blends from the end of the previous scene.
  const fromPose: StickPose = activeBeat > 0 ? beats[activeBeat - 1].pose ?? scene.pose : activeBeat === 0 ? scene.pose : prev ? lastPose(prev) : scene.pose;
  const toPose: StickPose = activeBeat >= 0 ? beats[activeBeat].pose ?? scene.pose : scene.pose;
  const poseFrame = activeBeat >= 0 ? frame - beats[activeBeat].at * FPS : local;
  const face: StickFace = activeBeat >= 0 ? beats[activeBeat].face ?? scene.face : scene.face;
  const beatPunchFrame = activeBeat >= 0 && beats[activeBeat].punch ? frame - beats[activeBeat].at * FPS : -1;
  const punch = Math.max(beatPunchFrame >= 0 && beatPunchFrame < 16 ? 1 - beatPunchFrame / 16 : 0, punchKick);

  // Captions: the current breath group, the spoken word in yellow.
  const activeWord = words.findIndex((w) => time >= w.start && time < w.end);
  let gStart = 0; let gEnd = 0;
  while (gEnd < words.length) {
    gStart = gEnd++;
    while (gEnd < words.length && gEnd - gStart < 5 && words[gEnd].start - words[gEnd - 1].end < 0.38 && !/[.!?]$/.test(words[gEnd - 1].text)) gEnd++;
    if (time < (words[gEnd]?.start ?? duration)) break;
  }
  const group = words.slice(gStart, gEnd);

  // Layout: the owner stands on one side, the cast on the other; the visual (panel or photo) floats above.
  // Nobody re-enters on a cut: whoever was already there walks to the new spot, newcomers walk in, leavers walk out.
  const me = walkTo(before ? before.mainX : here.mainX, here.mainX, local);
  const mainX = me.x;
  const castCenter = here.actors.length ? here.actors.reduce((sum, a) => sum + a.x, 0) / here.actors.length : 540;
  const mainFacing: 'left' | 'right' = me.walk > 0.3 ? (me.dir < 0 ? 'left' : 'right') : (here.actors.length ? castCenter : 540) < mainX - 4 ? 'left' : 'right';
  const people = here.actors.map((spot, i) => {
    const was = before?.actors.find((a) => a.castId === spot.castId);
    const delay = was ? 0 : 3 + i * 6;
    const move = walkTo(was ? was.x : spot.x > 540 ? EDGE_R : EDGE_L, spot.x, local - delay);
    return { spot, move, was, delay, leaving: false };
  });
  const leavers = (before?.actors ?? []).filter((a) => !here.actors.some((b) => b.castId === a.castId)).map((spot) => {
    const move = walkTo(spot.x, spot.x > 540 ? EDGE_R : EDGE_L, local);
    return { spot, move, was: spot, delay: 0, leaving: true };
  }).filter((p) => !p.move.done);
  const photo = scene.photo !== undefined ? photoUrls[scene.photo] : undefined;
  const glassTheme: StickTheme = { ...theme, ink: INK, paper: '#0e1113', surface: 'rgba(14,17,19,0.84)', accent: YELLOW, highlight: YELLOW };
  const visualIn = index === 0 && local < 1 ? 0.6 : 0.6 + 0.4 * spring({ frame: local, fps: FPS, config: { damping: 18, stiffness: 170 } });
  const headIn = 0.55 + 0.45 * spring({ frame: local, fps: FPS, config: { damping: 16, stiffness: 190 } });
  const chapter = scene.chapter ?? Math.min(2, Math.floor((index / Math.max(1, scenes.length)) * 3));

  return (
    <AbsoluteFill style={{ background: '#0b0d0e', color: INK, fontFamily: STICK_FONT_STACK, overflow: 'hidden' }}>
      {/* SET: one photo-real environment, panned and slowly pushed in. */}
      <div style={{ position: 'absolute', left: 540 - SET_W / 2, top: 960 - SET_H / 2, width: SET_W, height: SET_H,
        transform: `translateX(${((0.5 - cam) * (SET_W - 1080)).toFixed(1)}px) scale(${zoom.toFixed(4)})`, transformOrigin: '50% 62%' }}>
        {setUrl ? <Img src={setUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.62) contrast(1.08) saturate(0.9)' }} /> : <FallbackSet />}
      </div>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 16%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.78) 86%, rgba(0,0,0,0.88) 100%)' }} />

      {/* TRACKER: where we are in the story. */}
      <Tracker labels={tracker.length ? tracker : [badge]} active={chapter} />

      {/* HEADLINE TAG */}
      <div style={{ position: 'absolute', top: 214, left: 64, maxWidth: 940, background: YELLOW, color: '#111', fontSize: scene.headline.length > 30 ? 40 : 46, fontWeight: 900,
        lineHeight: 1.12, padding: '12px 22px', borderRadius: 10, transform: `translateX(${((1 - headIn) * -80).toFixed(1)}px) rotate(-1deg)`, opacity: Math.min(1, headIn * 1.6), boxShadow: '0 14px 30px rgba(0,0,0,0.45)' }}>
        {scene.headline}
      </div>

      {/* VISUAL: a real photo when the Director picked one, otherwise a building info panel. */}
      <div style={{ position: 'absolute', top: 330, left: 90, right: 90, transform: `translate(${((1 - visualIn) * moveDir * 160).toFixed(1)}px, ${((1 - visualIn) * 40).toFixed(1)}px) scale(${(0.9 + visualIn * 0.1) * (1 + punch * 0.02)})`, opacity: visualIn }}>
        {photo ? <PhotoFrame src={photo} local={local} tilt={index % 2 ? 2.2 : -2.2} /> : (
          <div style={{ transform: 'scale(0.86)', transformOrigin: '50% 0%' }}>
            <Stage template={scene.template} data={{ ...scene.data, title: scene.data.title || scene.note || undefined }} note={scene.note} beat={local} theme={glassTheme} glass />
          </div>
        )}
      </div>

      {/* CAST + OWNER on the floor of the set. */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {[...leavers, ...people].map(({ spot, move, was, delay, leaving }, i) => {
          const talking = Boolean(!leaving && spot.bubble && time >= spot.bubble.at && time < spot.bubble.at + 2.2);
          const facing: 'left' | 'right' = move.walk > 0.3 ? (move.dir < 0 ? 'left' : 'right') : mainX < move.x ? 'left' : 'right';
          const arrived = local - delay - move.arrive * 0.7;
          const tagIn = was ? 60 : arrived;
          return (
            <React.Fragment key={`${spot.castId}-${leaving ? 'out' : 'in'}`}>
              <StickRig frame={frame + i * 17} localFrame={local} side={move.x > 540 ? 'right' : 'left'} enter="slide" energy="normal" settled
                fromPose={was ? was.pose : spot.pose} toPose={spot.pose} poseTransitionFrame={local - delay} face="neutral" facesPack="" ink={INK} shadowColor="rgba(0,0,0,0.55)"
                isSpeaking={talking} punch={move.walk ? 0 : punchKick * 0.45} x={move.x} top={FLOOR_TOP + 40} scale={0.82} plain outline={OUTLINE}
                walk={move.walk} walkPhase={move.phase} facing={facing} />
              {!leaving && tagIn > 0 && <NameTag x={move.x} y={FLOOR_TOP - 50} text={spot.label} local={tagIn} />}
              {!leaving && spot.bubble && <Bubble text={spot.bubble.text} at={spot.bubble.at} time={time} x={move.x} y={FLOOR_TOP - 120} />}
            </React.Fragment>
          );
        })}
        <StickRig frame={frame} localFrame={local + 6} side={here.mainLeft ? 'left' : 'right'} enter="pop" energy={scene.energy} fromPose={fromPose} toPose={toPose}
          poseTransitionFrame={poseFrame} face={face} facesPack={faces} ink={INK} shadowColor="rgba(0,0,0,0.55)" isSpeaking={activeWord >= 0} punch={me.walk ? 0 : punch}
          x={mainX} top={FLOOR_TOP} outline={OUTLINE} settled={index > 0} walk={me.walk} walkPhase={me.phase} facing={mainFacing} />
        {scene.myBubble && <Bubble text={scene.myBubble.text} at={scene.myBubble.at} time={time} x={mainX} y={FLOOR_TOP - 250} />}
      </div>

      {/* PUNCH BOX: slams in on its word. */}
      {punchText && time >= punchText.at && <PunchBox text={punchText} time={time} />}

      {/* CAPTIONS: clean white, spoken word in yellow. */}
      <div style={{ position: 'absolute', top: 1555, left: 70, right: 70, textAlign: 'center', fontSize: 50, fontWeight: 800, lineHeight: 1.3, textShadow: '0 4px 16px rgba(0,0,0,0.9), 0 0 2px #000' }}>
        {group.map((word, i) => (
          <React.Fragment key={word.id || i}>{i > 0 ? ' ' : null}<span style={{ color: gStart + i === activeWord ? YELLOW : '#fff' }}>{word.text}</span></React.Fragment>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 150, left: 70, right: 70, height: 6, borderRadius: 6, background: 'rgba(255,255,255,0.14)' }}>
        <div style={{ width: `${Math.min(100, (time / Math.max(0.1, duration)) * 100).toFixed(2)}%`, height: '100%', borderRadius: 6, background: YELLOW }} />
      </div>
    </AbsoluteFill>
  );
}

function Tracker({ labels, active }: { labels: string[]; active: number }) {
  return (
    <div style={{ position: 'absolute', top: 112, left: 64, right: 64, display: 'flex', alignItems: 'center', gap: 14, fontSize: 25, fontWeight: 900, letterSpacing: 1.6 }}>
      {labels.map((label, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 28 }}>→</span>}
          <span style={{ padding: '8px 16px', borderRadius: 8, background: i === active ? YELLOW : 'rgba(255,255,255,0.08)', color: i === active ? '#111' : 'rgba(255,255,255,0.72)',
            border: i === active ? 'none' : '1.5px solid rgba(255,255,255,0.18)', whiteSpace: 'nowrap' }}>{label}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function PhotoFrame({ src, local, tilt }: { src: string; local: number; tilt: number }) {
  const kb = 1 + Math.min(1, local / 150) * 0.08;
  return (
    <div style={{ width: 800, height: 620, margin: '0 auto', background: '#f4f1ea', padding: 16, borderRadius: 10, transform: `rotate(${tilt}deg)`, boxShadow: '0 40px 90px rgba(0,0,0,0.65)' }}>
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 4 }}>
        <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb.toFixed(4)})` }} />
      </div>
    </div>
  );
}

function NameTag({ x, y, text, local }: { x: number; y: number; text: string; local: number }) {
  const s = spring({ frame: local, fps: FPS, config: { damping: 13, stiffness: 190 } });
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translateX(-50%) scale(${s.toFixed(3)})`, background: YELLOW, color: '#111', fontSize: 22, fontWeight: 900,
      letterSpacing: 1.4, padding: '5px 12px', borderRadius: 6, whiteSpace: 'nowrap' }}>{text}</div>
  );
}

function Bubble({ text, at, time, x, y }: { text: string; at: number; time: number; x: number; y: number }) {
  if (time < at) return null;
  const s = spring({ frame: (time - at) * FPS, fps: FPS, config: { damping: 12, stiffness: 200 } });
  const left = Math.min(1080 - 250, Math.max(250, x));
  return (
    <div style={{ position: 'absolute', left, top: y, transform: `translate(-50%, -100%) scale(${s.toFixed(3)})`, transformOrigin: '50% 100%', maxWidth: 440, background: '#fff', color: '#111',
      fontSize: 32, fontWeight: 800, lineHeight: 1.22, padding: '16px 22px', borderRadius: 24, textAlign: 'center', boxShadow: '0 16px 36px rgba(0,0,0,0.5)' }}>
      “{text}”
      <span style={{ position: 'absolute', left: `calc(50% + ${(x - left).toFixed(0)}px)`, bottom: -18, width: 0, height: 0, borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderTop: '20px solid #fff', transform: 'translateX(-50%)' }} />
    </div>
  );
}

function PunchBox({ text, time }: { text: StickTimedText; time: number }) {
  const t = (time - text.at) * FPS;
  const s = spring({ frame: t, fps: FPS, config: { damping: 10, stiffness: 260, mass: 0.7 } });
  const shake = t < 10 ? Math.sin(t * 2.4) * (10 - t) * 0.9 : 0;
  return (
    <div style={{ position: 'absolute', top: 1330, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
      <div style={{ background: YELLOW, color: '#111', fontSize: text.text.length > 14 ? 74 : 92, fontWeight: 950, letterSpacing: -1, padding: '10px 30px', borderRadius: 8,
        border: '5px solid #111', boxShadow: '10px 12px 0 #111', transform: `translateX(${shake.toFixed(1)}px) rotate(-2deg) scale(${(1.6 - 0.6 * s).toFixed(3)})`, opacity: Math.min(1, s * 2), whiteSpace: 'nowrap' }}>
        {text.text}
      </div>
    </div>
  );
}

/** Used when no set picture has been made yet: a simple dark room so the look still holds. */
function FallbackSet() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'linear-gradient(180deg, #23292d 0%, #171b1e 58%, #0d1012 58.2%, #090b0c 100%)' }}>
      {[0.12, 0.42, 0.72].map((x, i) => (
        <div key={i} style={{ position: 'absolute', left: `${x * 100}%`, top: '24%', width: '18%', height: '24%', background: 'linear-gradient(180deg, #5d7a80 0%, #2d3d40 100%)', opacity: 0.55, border: '10px solid #111518', boxShadow: '0 0 120px rgba(150,190,200,0.25)' }} />
      ))}
      {[0.08, 0.55].map((x, i) => (
        <div key={i} style={{ position: 'absolute', left: `${x * 100}%`, top: '50%', width: '28%', height: '7%', background: '#2b2219', borderTop: '8px solid #3b2f22', boxShadow: '0 30px 60px rgba(0,0,0,0.6)' }} />
      ))}
    </div>
  );
}
