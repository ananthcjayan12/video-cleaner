import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame } from 'remotion';
import type { StickCastMember, StickFace, StickPose, StickSceneV2, StickStyle, StickTheme } from '../../server/stick-reel';
import { Cinematic } from './Cinematic';
import { STICK_FONT_STACK, useStickFonts } from './fonts';
import { Stage } from './Stage';
import { StickRig } from './StickRig';

export type Word = { id: string; text: string; start: number; end: number };
export type ReelProps = {
  scenes: StickSceneV2[];
  words: Word[];
  duration: number;
  faces?: string;
  badge?: string;
  marquee?: string;
  theme?: StickTheme;
  style?: StickStyle;
  tracker?: string[];
  cast?: StickCastMember[];
  setUrl?: string;
  photoUrls?: string[];
  photoKinds?: string[];
};

const DEFAULT_THEME: StickTheme = {
  id: 'editorial',
  label: 'Paper & Ink',
  paper: '#f9f6ec',
  ink: '#172622',
  accent: '#ff8666',
  highlight: '#c9fb83',
  surface: '#fffdf7',
};

export const demoScenes: StickSceneV2[] = [
  {
    id: 'sc-1',
    at: 0,
    headline: 'Dynamic AI Stick Reels',
    note: 'Every scene, pose, and sound effect planned from your script',
    template: 'hero_icon',
    data: { icon: '⚡', title: 'AI Director', subtitle: 'Dynamic templates + pose rig', badge: 'V2 ENGINE' },
    side: 'left',
    enter: 'slide',
    pose: 'wave',
    face: 'happy',
    energy: 'normal',
  },
  {
    id: 'sc-2',
    at: 4,
    headline: 'Cut edit time by 70%',
    note: 'Structured JSON drives templates and peak-aligned SFX',
    template: 'metric',
    data: { title: 'Weekly editing', badge: 'LIVE', from: '10 hrs', to: '3 hrs', rows: [['Scenes', 'AI Planned'], ['SFX', 'Openverse + Local']] },
    side: 'right',
    enter: 'pop',
    pose: 'point_stage',
    face: 'smirk',
    energy: 'hype',
  },
  {
    id: 'sc-3',
    at: 8,
    headline: 'Ready to ship?',
    note: 'One click from voiceover to mastered MP4',
    template: 'cta_click',
    data: { title: 'Try Stick Reels v2', subtitle: 'AI Director + Openverse SFX', button: 'Render Reel →', doneLabel: '✓ Mastered' },
    side: 'left',
    enter: 'slide',
    pose: 'celebrate',
    face: 'happy',
    energy: 'hype',
  },
];

export function Reel({
  scenes,
  words: transcript,
  duration,
  faces = 'stick-demo',
  badge = 'QUICK EXPLAINER',
  marquee = 'EXPLAIN / VISUALIZE / SHIP',
  theme = DEFAULT_THEME,
  style = 'classic',
  tracker = [],
  cast = [],
  setUrl,
  photoUrls = [],
  photoKinds = [],
}: ReelProps) {
  useStickFonts();
  if (style === 'cinematic' && scenes.length) {
    return <Cinematic scenes={scenes} words={transcript} duration={duration} faces={faces} badge={badge} theme={theme} tracker={tracker} cast={cast} setUrl={setUrl} photoUrls={photoUrls} photoKinds={photoKinds} />;
  }
  const frame = useCurrentFrame();
  const time = frame / 30;
  const safeScenes = scenes.length ? scenes : demoScenes;
  const index = safeScenes.reduce((current, scene, i) => (frame >= scene.at * 30 ? i : current), 0);
  const scene = safeScenes[index];
  const local = Math.max(0, frame - scene.at * 30);
  const entrance = spring({ frame: local, fps: 30, config: { damping: 16, stiffness: 145 } });

  // Evaluate word-anchored mid-scene choreography beats.
  const beats = scene.beats ?? [];
  let activeBeatIndex = -1;
  for (let i = 0; i < beats.length; i++) {
    if (time >= beats[i].at) activeBeatIndex = i;
  }
  const activeBeat = activeBeatIndex >= 0 ? beats[activeBeatIndex] : undefined;
  const prevBeat = activeBeatIndex > 0 ? beats[activeBeatIndex - 1] : undefined;
  const isFinalScene = index === safeScenes.length - 1 && safeScenes.length > 1;

  const fromPose: StickPose = prevBeat?.pose ?? scene.pose;
  const toPose: StickPose = activeBeat?.pose ?? (isFinalScene && scene.template === 'cta_click' && local > 46 ? 'celebrate' : scene.pose);
  const poseTransitionFrame = activeBeat ? Math.max(0, frame - activeBeat.at * 30) : local;
  const expression: StickFace = activeBeat?.face ?? scene.face;

  const punchFrame = activeBeat?.punch ? Math.max(0, frame - activeBeat.at * 30) : -1;
  const punch = punchFrame >= 0 && punchFrame < 16 ? Math.max(0, 1 - punchFrame / 16) : 0;
  const burstHit = punchFrame >= 0 ? spring({ frame: punchFrame, fps: 30, config: { damping: 14, stiffness: 220 } }) : 0;

  // Speech-reactive word grouping and highlight.
  const activeWord = transcript.findIndex(word => time >= word.start && time < word.end);
  const isSpeaking = activeWord >= 0;
  let groupStart = 0;
  let groupEnd = 0;
  while (groupEnd < transcript.length) {
    groupStart = groupEnd++;
    while (
      groupEnd < transcript.length &&
      groupEnd - groupStart < 5 &&
      transcript[groupEnd].start - transcript[groupEnd - 1].end < 0.38 &&
      !/[.!?]$/.test(transcript[groupEnd - 1].text)
    ) {
      groupEnd++;
    }
    if (time < (transcript[groupEnd]?.start ?? duration)) break;
  }
  const group = transcript.slice(groupStart, groupEnd);
  const captionWords = group.length ? group.map(word => word.text) : scene.note.split(' ').filter(Boolean);
  const highlighted = group.length ? (activeWord < 0 ? -1 : activeWord - groupStart) : -1;

  const left = scene.side !== 'right';
  const cameraScale = 1 + 0.02 * Math.sin(local / 16) + 0.055 * punch;
  const progressPct = Math.min(100, Math.max(0, (frame / Math.max(1, duration * 30)) * 100));
  const dark = theme.id === 'midnight';
  const marqueeStroke = dark ? '#222d38' : '#e6e7d9';
  const shadowColor = dark ? '#080c10' : '#dce0ce';
  const onHighlight = '#111a17';

  return (
    <AbsoluteFill style={{ background: theme.paper, color: theme.ink, fontFamily: STICK_FONT_STACK, overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: 42 + ((i * 137) % 990),
            top: 180 + ((i * 193) % 1350) + 24 * Math.sin(frame / 16 + i),
            color: i % 2 ? theme.accent : theme.highlight,
            opacity: dark ? 0.32 : 0.55,
            fontSize: 28,
            fontWeight: 900,
            transform: `rotate(${frame * 1.4 + i * 22}deg)`,
          }}
        >
          {i % 2 ? '+' : '○'}
        </span>
      ))}

      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 470 + i * 328,
            left: -350 + ((frame * 1.1 + i * 190) % 540),
            whiteSpace: 'nowrap',
            fontSize: 184,
            fontWeight: 900,
            letterSpacing: -8,
            color: 'transparent',
            WebkitTextStroke: `2px ${marqueeStroke}`,
          }}
        >
          {marquee} / {marquee}
        </div>
      ))}

      <div style={{ position: 'absolute', inset: '118px 90px auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 25, fontWeight: 900, letterSpacing: 2.5 }}>
        <span style={{ background: theme.ink, color: theme.paper, borderRadius: 30, padding: '11px 22px' }}>
          {badge}
        </span>
        <span>{String(Math.floor(frame / 30)).padStart(2, '0')}s</span>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 234,
          left: 86,
          right: 86,
          fontSize: scene.headline.length > 26 ? 88 : scene.headline.length > 18 ? 98 : 110,
          lineHeight: 0.92,
          fontWeight: 900,
          letterSpacing: -4,
          transform: `translateY(${(1 - entrance) * 52}px) scale(${1 + 0.032 * punch})`,
          opacity: Math.min(1, entrance * 2),
          overflowWrap: 'anywhere',
          maxHeight: 300,
          overflow: 'hidden',
        }}
      >
        {scene.headline}
        <div style={{ height: 15, width: 150, background: theme.accent, marginTop: 22, transform: 'rotate(-2.5deg)', borderRadius: 6 }} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 562,
          left: 100,
          right: 120,
          transform: `translate(${(1 - entrance) * (left ? -190 : 190)}px, ${(1 - entrance) * 65}px) rotate(${(left ? -1.4 : 1.4) + (1 - entrance) * 7}deg) scale(${cameraScale})`,
        }}
      >
        <Stage template={scene.template} data={scene.data} note={scene.note} beat={local} theme={theme} />
        {punchFrame >= 0 && punchFrame < 18 && (
          <svg
            width="93"
            height="93"
            viewBox="0 0 90 90"
            style={{
              position: 'absolute',
              right: left ? -42 : undefined,
              left: left ? undefined : -42,
              top: 50,
              transform: `scale(${0.65 + burstHit * 0.55})`,
              opacity: Math.min(1, (18 - punchFrame) / 8),
            }}
          >
            <path d="M45 6v24M45 60v24M6 45h24m30 0h24M17 17l17 17m22 22 17 17M17 73l17-17m22-22 17-17" stroke={theme.accent} strokeWidth="7" strokeLinecap="round" />
          </svg>
        )}
      </div>

      <StickRig
        frame={frame}
        localFrame={local}
        side={scene.side}
        enter={scene.enter}
        energy={scene.energy}
        fromPose={fromPose}
        toPose={toPose}
        poseTransitionFrame={poseTransitionFrame}
        face={expression}
        facesPack={faces}
        ink={theme.ink}
        shadowColor={shadowColor}
        isSpeaking={isSpeaking}
        punch={punch}
      />

      {/* Lifted into Reels/Shorts safe zone above bottom platform chrome */}
      <div
        style={{
          position: 'absolute',
          top: 1555,
          left: 88,
          right: 136,
          border: `3px solid ${theme.ink}`,
          borderRadius: 42,
          background: theme.surface,
          boxShadow: `5px 6px 0 ${theme.ink}`,
          textAlign: 'center',
          padding: '20px 24px',
          fontSize: 33,
          fontWeight: 800,
        }}
      >
        {captionWords.map((word, i) => (
          <React.Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span
              style={{
                background: i === highlighted ? theme.highlight : 'transparent',
                color: i === highlighted ? onHighlight : theme.ink,
                borderRadius: 9,
                padding: '3px 4px',
              }}
            >
              {word}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div style={{ position: 'absolute', top: 1682, left: 88, right: 136, height: 7, borderRadius: 10, background: dark ? '#2a3542' : '#dfdfd2', overflow: 'hidden' }}>
        <div style={{ width: `${progressPct.toFixed(2)}%`, height: '100%', background: theme.ink }} />
      </div>
    </AbsoluteFill>
  );
}
