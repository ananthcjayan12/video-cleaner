import React from 'react';
import { Img, interpolate, spring, staticFile } from 'remotion';
import type { StickEnergy, StickEnter, StickFace, StickPose, StickSide } from '../../server/stick-reel';

type RigAngles = {
  lShoulder: number;
  lElbow: number;
  rShoulder: number;
  rElbow: number;
  lean: number;
  headTilt: number;
  lift: number;
};

const POSES: Record<StickPose, RigAngles> = {
  point_stage: { lShoulder: 135, lElbow: 105, rShoulder: -18, rElbow: -52, lean: 4, headTilt: -3, lift: 0 },
  present_both: { lShoulder: 162, lElbow: 138, rShoulder: 18, rElbow: 42, lean: 0, headTilt: 2, lift: 8 },
  think_chin: { lShoulder: 122, lElbow: 85, rShoulder: -25, rElbow: -135, lean: -5, headTilt: 9, lift: 0 },
  shrug: { lShoulder: 150, lElbow: 235, rShoulder: 30, rElbow: -55, lean: 0, headTilt: 8, lift: 4 },
  celebrate: { lShoulder: 215, lElbow: 245, rShoulder: -35, rElbow: -65, lean: 0, headTilt: -4, lift: 18 },
  arms_crossed: { lShoulder: 95, lElbow: 18, rShoulder: 85, rElbow: 162, lean: -3, headTilt: -5, lift: 0 },
  lean_in: { lShoulder: 130, lElbow: 100, rShoulder: 5, rElbow: -25, lean: 11, headTilt: 5, lift: 0 },
  wave: { lShoulder: 128, lElbow: 96, rShoulder: -42, rElbow: -102, lean: -2, headTilt: 6, lift: 6 },
  // Acting poses (the figure faces +x; "r" is the front arm).
  phone_call: { lShoulder: 185, lElbow: 284, rShoulder: 72, rElbow: 96, lean: -1, headTilt: -9, lift: 0 },
  typing: { lShoulder: 72, lElbow: 12, rShoulder: 58, rElbow: 6, lean: 7, headTilt: 10, lift: 0 },
  facepalm: { lShoulder: 118, lElbow: 96, rShoulder: -55, rElbow: -125, lean: -3, headTilt: 15, lift: -4 },
  thumbs_up: { lShoulder: 112, lElbow: 100, rShoulder: 28, rElbow: -84, lean: 2, headTilt: -5, lift: 4 },
  hands_on_hips: { lShoulder: 150, lElbow: 50, rShoulder: 30, rElbow: 130, lean: -2, headTilt: -4, lift: 0 },
};
/** Poses where the hands are busy: less talking wobble on the arms. */
const BUSY_HANDS = new Set<StickPose>(['phone_call', 'typing', 'facepalm', 'hands_on_hips', 'arms_crossed', 'think_chin']);

function mirrorPose(angles: RigAngles): RigAngles {
  return {
    lShoulder: 180 - angles.rShoulder,
    lElbow: 180 - angles.rElbow,
    rShoulder: 180 - angles.lShoulder,
    rElbow: 180 - angles.lElbow,
    lean: -angles.lean,
    headTilt: -angles.headTilt,
    lift: angles.lift,
  };
}

/** Legs as angles from straight down (positive = towards +x): standing pose and walk cycle. */
const STAND_LEGS = { lThigh: -24, lShin: -12.5, lToe: -25, rThigh: 31, rShin: 14, rToe: 22 };
function legPath(thighDeg: number, shinDeg: number, toe: number) {
  const r1 = (thighDeg * Math.PI) / 180; const r2 = (shinDeg * Math.PI) / 180;
  const kx = Math.sin(r1) * 78; const ky = 113 + Math.cos(r1) * 78;
  const fx = kx + Math.sin(r2) * 66; const fy = ky + Math.cos(r2) * 66;
  return `M0 113L${kx.toFixed(1)} ${ky.toFixed(1)}L${fx.toFixed(1)} ${fy.toFixed(1)}L${(fx + toe).toFixed(1)} ${fy.toFixed(1)}`;
}

function limbPath(startX: number, startY: number, upperLen: number, lowerLen: number, deg1: number, deg2: number) {
  const r1 = (deg1 * Math.PI) / 180;
  const r2 = (deg2 * Math.PI) / 180;
  const ex = startX + Math.cos(r1) * upperLen;
  const ey = startY + Math.sin(r1) * upperLen;
  const hx = ex + Math.cos(r2) * lowerLen;
  const hy = ey + Math.sin(r2) * lowerLen;
  return `M${startX.toFixed(1)} ${startY.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${hx.toFixed(1)} ${hy.toFixed(1)}`;
}

function mixAngles(a: RigAngles, b: RigAngles, t: number): RigAngles {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    lShoulder: lerp(a.lShoulder, b.lShoulder),
    lElbow: lerp(a.lElbow, b.lElbow),
    rShoulder: lerp(a.rShoulder, b.rShoulder),
    rElbow: lerp(a.rElbow, b.rElbow),
    lean: lerp(a.lean, b.lean),
    headTilt: lerp(a.headTilt, b.headTilt),
    lift: lerp(a.lift, b.lift),
  };
}

export function StickRig({
  frame,
  localFrame,
  side,
  enter,
  energy,
  fromPose,
  toPose,
  poseTransitionFrame,
  face,
  facesPack,
  ink,
  shadowColor,
  isSpeaking,
  punch,
  x,
  top = 1215,
  scale = 1,
  plain = false,
  outline,
  settled = false,
  walk = 0,
  walkPhase = 0,
  facing,
}: {
  frame: number;
  localFrame: number;
  side: StickSide;
  enter: StickEnter;
  energy: StickEnergy;
  fromPose: StickPose;
  toPose: StickPose;
  poseTransitionFrame: number;
  face: StickFace;
  facesPack: string;
  ink: string;
  shadowColor: string;
  isSpeaking: boolean;
  punch: number;
  /** Cinematic look: stand anywhere, any size, plain round head (cast), dark outline for dark sets. */
  x?: number;
  top?: number;
  scale?: number;
  plain?: boolean;
  outline?: string;
  /** Already on stage (no entrance animation): the figure stays put between scenes. */
  settled?: boolean;
  /** 0..1 how much it is walking, and the stride phase (radians), so feet match the distance moved. */
  walk?: number;
  walkPhase?: number;
  /** Which way it looks; defaults to facing the middle from its side. */
  facing?: 'left' | 'right';
}) {
  const entrance = settled ? 1 : spring({ frame: localFrame, fps: 30, config: { damping: 15, stiffness: 150 } });
  const poseBlend = spring({ frame: Math.max(0, poseTransitionFrame), fps: 30, config: { damping: 14, stiffness: 180 } });

  const lookLeft = (facing ?? (side === 'right' ? 'left' : 'right')) === 'left';
  const f = lookLeft ? -1 : 1;
  const baseA = lookLeft ? mirrorPose(POSES[fromPose]) : POSES[fromPose];
  const baseB = lookLeft ? mirrorPose(POSES[toPose]) : POSES[toPose];
  const posed = mixAngles(baseA, baseB, poseBlend);
  // Walking: arms swing against the legs and the body leans into the step.
  const w = Math.max(0, Math.min(1, walk));
  const sw = Math.sin(walkPhase);
  const walkArms: RigAngles = { lShoulder: 96 + f * 24 * sw, lElbow: 96 + f * 24 * sw - f * 20, rShoulder: 84 - f * 24 * sw, rElbow: 84 - f * 24 * sw - f * 20, lean: f * 6, headTilt: 0, lift: Math.abs(sw) * 6 };
  const angles = mixAngles(posed, walkArms, w);

  const energyScale = energy === 'hype' ? 1.35 : energy === 'calm' ? 0.55 : 1.0;
  const busy = BUSY_HANDS.has(toPose) ? 0.25 : 1;
  const talkWave = ((isSpeaking ? Math.sin(frame / 4.2) * 14 * energyScale : Math.sin(frame / 14) * 3) * busy) * (1 - w);
  const waveExtra = toPose === 'wave' ? Math.sin(frame / 3.2) * 26 * (1 - w) : 0;
  const typeTap = toPose === 'typing' ? Math.sin(frame * 1.35) * 8 * poseBlend * (1 - w) : 0;

  const leftArm = limbPath(0, 18, 74, 62, angles.lShoulder + talkWave * 0.35, angles.lElbow + talkWave * 0.5 + typeTap);
  const rightArm = limbPath(0, 18, 74, 62, angles.rShoulder - talkWave * 0.45, angles.rElbow - talkWave * 0.6 + waveExtra - typeTap);
  // Front hand, for the thumbs-up mark.
  const rs = ((angles.rShoulder - talkWave * 0.45) * Math.PI) / 180; const re = ((angles.rElbow - talkWave * 0.6) * Math.PI) / 180;
  const hand = { x: Math.cos(rs) * 74 + Math.cos(re) * 62, y: 18 + Math.sin(rs) * 74 + Math.sin(re) * 62 };
  // Arms that touch the head (phone at the ear, hand on the face) are drawn again in front of it.
  const weight = (pose: StickPose) => (toPose === pose ? poseBlend : fromPose === pose ? 1 - poseBlend : 0) * (1 - w);
  const phoneW = weight('phone_call'); const palmW = weight('facepalm');
  const ls = ((angles.lShoulder + talkWave * 0.35) * Math.PI) / 180; const le = ((angles.lElbow + talkWave * 0.5 + typeTap) * Math.PI) / 180;
  const backHand = { x: Math.cos(ls) * 74 + Math.cos(le) * 62, y: 18 + Math.sin(ls) * 74 + Math.sin(le) * 62 };
  // Mirrored (looking left) swaps the arms: the front arm is then the "l" one.
  const front = lookLeft ? { arm: leftArm, hand: backHand } : { arm: rightArm, hand };
  const back = lookLeft ? { arm: rightArm, hand } : { arm: leftArm, hand: backHand };
  const thumb = (toPose === 'thumbs_up' ? poseBlend : fromPose === 'thumbs_up' ? 1 - poseBlend : 0) * (1 - w);

  // Legs: stand, or walk (one leg half a stride behind the other; the knee bends on the forward swing).
  const stride = (p: number) => { const thigh = 27 * Math.sin(p); return { thigh: f * thigh, shin: f * (thigh - 44 * Math.max(0, Math.cos(p))) }; };
  const a = stride(walkPhase); const b = stride(walkPhase + Math.PI);
  const mix = (x: number, y: number) => x + (y - x) * w;
  const legs = `${legPath(mix(STAND_LEGS.lThigh, a.thigh), mix(STAND_LEGS.lShin, a.shin), mix(STAND_LEGS.lToe, f * 22))} ${legPath(mix(STAND_LEGS.rThigh, b.thigh), mix(STAND_LEGS.rShin, b.shin), mix(STAND_LEGS.rToe, f * 22))}`;

  const anchorX = x ?? (side === 'left' ? 235 : side === 'right' ? 815 : 540);
  const enterOffsetX = enter === 'slide' ? (1 - entrance) * (side === 'right' ? 180 : -180) : 0;
  const enterOffsetY = enter === 'peek' ? (1 - entrance) * 220 : 0;
  const enterScale = enter === 'pop' ? interpolate(entrance, [0, 1], [0.45, 1]) : 0.88 + entrance * 0.12;

  const bounceY = (1 - w) * (isSpeaking ? Math.sin(frame / 4.5) * 9 : Math.sin(frame / 12) * 4) * energyScale - angles.lift - punch * 34;

  const swayClock = settled ? frame : localFrame;
  const swayX = Math.sin(swayClock / 11) * 12 * energyScale * (1 - w);
  const bodyRotate = angles.lean + Math.sin(swayClock / 9) * 2.2 * energyScale * (1 - w);
  const headRotate = angles.headTilt + (isSpeaking ? Math.sin(frame / 5.5) * 5.5 : Math.sin(frame / 14) * 2) * energyScale;

  const faceSrc = facesPack.includes('/') ? `${facesPack}/${face}.png` : staticFile(`${facesPack}/${face}.png`);

  return (
    <div
      style={{
        position: 'absolute',
        left: anchorX,
        top: top + bounceY + enterOffsetY,
        transform: `translateX(calc(-50% + ${(enterOffsetX + swayX).toFixed(1)}px)) rotate(${bodyRotate.toFixed(2)}deg) scale(${((enterScale + punch * 0.09) * scale).toFixed(3)})`,
        transformOrigin: '50% 100%',
        width: 340,
        height: 300,
        opacity: Math.min(1, entrance * 2.2),
      }}
    >
      <svg viewBox="-170 -20 340 290" width="340" height="290" style={{ position: 'absolute', top: 10 }}>
        <ellipse cx="0" cy="252" rx="94" ry="12" fill={shadowColor} />
        {outline && (
          <g stroke={outline} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={`M0 0L0 113 ${legs}`} strokeWidth="26" />
            <path d={`${leftArm} ${rightArm}`} strokeWidth="24" />
          </g>
        )}
        <path
          d={`M0 0L0 113 ${legs}`}
          stroke={ink}
          strokeWidth="16"
          strokeLinecap="round"
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d={`${leftArm} ${rightArm}`}
          stroke={ink}
          strokeWidth="14"
          strokeLinecap="round"
          fill="none"
          strokeLinejoin="round"
        />
        {thumb > 0.02 && (
          <g opacity={thumb} transform={`translate(${front.hand.x.toFixed(1)} ${front.hand.y.toFixed(1)})`}>
            {outline && <path d="M0 0L0 -26" stroke={outline} strokeWidth="20" strokeLinecap="round" />}
            {outline && <circle r="15" fill={outline} />}
            <circle r="11" fill={ink} />
            <path d="M0 0L0 -26" stroke={ink} strokeWidth="11" strokeLinecap="round" />
          </g>
        )}
      </svg>
      {plain ? (
        <div style={{ position: 'absolute', width: 132, height: 132, left: 104, bottom: 262, borderRadius: '50%', border: `11px solid ${ink}`, background: outline ?? '#1b1f22', boxShadow: outline ? `0 0 0 6px ${outline}` : undefined, transform: `rotate(${headRotate.toFixed(2)}deg)`, boxSizing: 'border-box' }}>
          <i style={{ position: 'absolute', width: 14, height: 18, borderRadius: 8, background: ink, top: 40, left: 34 }} />
          <i style={{ position: 'absolute', width: 14, height: 18, borderRadius: 8, background: ink, top: 40, right: 34 }} />
          <i style={{ position: 'absolute', width: 34, height: 10, borderBottom: `5px solid ${ink}`, borderRadius: '0 0 20px 20px', top: 66, left: 38 }} />
        </div>
      ) : <Img
        src={faceSrc}
        style={{
          position: 'absolute',
          width: 210,
          height: 236,
          objectFit: 'contain',
          objectPosition: 'center bottom',
          bottom: 266,
          left: 65,
          transform: `rotate(${headRotate.toFixed(2)}deg)`,
          filter: outline ? `drop-shadow(0 0 6px ${outline})` : undefined,
        }}
      />}
      {(phoneW > 0.02 || palmW > 0.02) && (
        <svg viewBox="-170 -20 340 290" width="340" height="290" style={{ position: 'absolute', top: 10, overflow: 'visible' }}>
          {phoneW > 0.02 && (
            <g opacity={phoneW}>
              {outline && <path d={back.arm} stroke={outline} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
              <path d={back.arm} stroke={ink} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <rect x={back.hand.x - 13} y={back.hand.y - 30} width="26" height="48" rx="6" fill="#16191b" stroke={ink} strokeWidth="5" transform={`rotate(${lookLeft ? 14 : -14} ${back.hand.x} ${back.hand.y})`} />
            </g>
          )}
          {palmW > 0.02 && (
            <g opacity={palmW}>
              {outline && <path d={front.arm} stroke={outline} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
              <path d={front.arm} stroke={ink} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx={front.hand.x} cy={front.hand.y} r="15" fill={ink} stroke={outline ?? ink} strokeWidth="5" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
