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
};

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
}) {
  const entrance = spring({ frame: localFrame, fps: 30, config: { damping: 15, stiffness: 150 } });
  const poseBlend = spring({ frame: Math.max(0, poseTransitionFrame), fps: 30, config: { damping: 14, stiffness: 180 } });

  const baseA = side === 'right' ? mirrorPose(POSES[fromPose]) : POSES[fromPose];
  const baseB = side === 'right' ? mirrorPose(POSES[toPose]) : POSES[toPose];
  const angles = mixAngles(baseA, baseB, poseBlend);

  const energyScale = energy === 'hype' ? 1.35 : energy === 'calm' ? 0.55 : 1.0;
  const talkWave = isSpeaking ? Math.sin(frame / 4.2) * 14 * energyScale : Math.sin(frame / 14) * 3;
  const waveExtra = toPose === 'wave' ? Math.sin(frame / 3.2) * 26 : 0;

  const leftArm = limbPath(0, 18, 74, 62, angles.lShoulder + talkWave * 0.35, angles.lElbow + talkWave * 0.5);
  const rightArm = limbPath(0, 18, 74, 62, angles.rShoulder - talkWave * 0.45, angles.rElbow - talkWave * 0.6 + waveExtra);

  const anchorX = side === 'left' ? 235 : side === 'right' ? 815 : 540;
  const enterOffsetX = enter === 'slide' ? (1 - entrance) * (side === 'right' ? 180 : -180) : 0;
  const enterOffsetY = enter === 'peek' ? (1 - entrance) * 220 : 0;
  const enterScale = enter === 'pop' ? interpolate(entrance, [0, 1], [0.45, 1]) : 0.88 + entrance * 0.12;

  const bounceY = (isSpeaking ? Math.sin(frame / 4.5) * 9 : Math.sin(frame / 12) * 4) * energyScale - angles.lift - punch * 34;
  const swayX = Math.sin(localFrame / 11) * 12 * energyScale;
  const bodyRotate = angles.lean + Math.sin(localFrame / 9) * 2.2 * energyScale;
  const headRotate = angles.headTilt + (isSpeaking ? Math.sin(frame / 5.5) * 5.5 : Math.sin(frame / 14) * 2) * energyScale;

  const faceSrc = facesPack.includes('/') ? `${facesPack}/${face}.png` : staticFile(`${facesPack}/${face}.png`);

  return (
    <div
      style={{
        position: 'absolute',
        left: anchorX,
        top: 1215 + bounceY + enterOffsetY,
        transform: `translateX(calc(-50% + ${(enterOffsetX + swayX).toFixed(1)}px)) rotate(${bodyRotate.toFixed(2)}deg) scale(${(enterScale + punch * 0.09).toFixed(3)})`,
        width: 340,
        height: 300,
        opacity: Math.min(1, entrance * 2.2),
      }}
    >
      <svg viewBox="-170 -20 340 290" width="340" height="290" style={{ position: 'absolute', top: 10 }}>
        <ellipse cx="0" cy="252" rx="94" ry="12" fill={shadowColor} />
        <path
          d="M0 0L0 113 M0 113L-31 183L-45 246L-70 246 M0 113L41 181L57 246L79 246"
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
      </svg>
      <Img
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
        }}
      />
    </div>
  );
}
