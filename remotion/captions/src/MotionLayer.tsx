import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from 'remotion';
import { packStack, useBrandFonts } from './fonts';

// Motion layer for talking-head reels, drawn above the speaker's head (the caption card sits lower down):
// a hook title for the first seconds, punch boxes slammed in on the word (stick-reel style, in the brand colour)
// and a call-to-action sticker near the end. "States" mode like GlassCardStates: frame N shows frameTimes[N].
// Animation lengths must match MOTION_IN / MOTION_OUT in server/reel-motion.ts.
export type MotionElement = { kind: 'hook' | 'punch' | 'cta'; text: string; start: number; end: number };
export type MotionLayerProps = { elements: MotionElement[]; frameTimes: number[]; font?: string; accent?: string; onAccent?: string; highlight?: string };

const FPS = 30;
const OUT = 0.2;
const INK = '#0B0D0C';

function exitOf(element: MotionElement, time: number) {
  return interpolate(time, [element.end - OUT, element.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

function Hook({ element, time, stack, accent }: { element: MotionElement; time: number; stack: string; accent: string }) {
  const s = spring({ frame: (time - element.start) * FPS, fps: FPS, config: { damping: 14, stiffness: 180 } });
  const out = exitOf(element, time);
  return (
    <div style={{ position: 'absolute', top: 210, left: 70, right: 70, display: 'flex', justifyContent: 'center', opacity: Math.min(1, s * 1.5) * out,
      transform: `translateY(${((1 - s) * -60).toFixed(1)}px) scale(${(0.94 + 0.06 * s).toFixed(3)})` }}>
      <div style={{ background: 'rgba(11, 13, 12, 0.78)', borderRadius: 28, padding: '26px 40px 30px', textAlign: 'center', maxWidth: 900,
        fontFamily: stack, fontWeight: 800, fontSize: element.text.length > 26 ? 60 : 72, lineHeight: 1.15, color: 'white', letterSpacing: -0.5 }}>
        {element.text}
        <div style={{ height: 10, borderRadius: 5, background: accent, marginTop: 16, width: `${Math.round(100 * Math.min(1, Math.max(0, (time - element.start - 0.12) / 0.3)))}%` }} />
      </div>
    </div>
  );
}

function Punch({ element, time, stack, accent, onAccent }: { element: MotionElement; time: number; stack: string; accent: string; onAccent: string }) {
  const t = (time - element.start) * FPS;
  const s = spring({ frame: t, fps: FPS, config: { damping: 10, stiffness: 260, mass: 0.7 } });
  const shake = t < 10 ? Math.sin(t * 2.4) * (10 - t) * 0.9 : 0;
  const out = exitOf(element, time);
  return (
    <div style={{ position: 'absolute', top: 330, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: Math.min(1, s * 2) * out }}>
      <div style={{ background: accent, color: onAccent, fontFamily: stack, fontSize: element.text.length > 14 ? 74 : 92, fontWeight: 900, letterSpacing: -1,
        padding: '10px 32px 14px', borderRadius: 10, border: `5px solid ${INK}`, boxShadow: `10px 12px 0 ${INK}`, whiteSpace: 'nowrap',
        transform: `translateX(${shake.toFixed(1)}px) rotate(-2deg) scale(${((1.6 - 0.6 * s) * (0.85 + 0.15 * out)).toFixed(3)})` }}>
        {element.text}
      </div>
    </div>
  );
}

function Cta({ element, time, stack, accent, onAccent }: { element: MotionElement; time: number; stack: string; accent: string; onAccent: string }) {
  const t = (time - element.start) * FPS;
  const s = spring({ frame: t, fps: FPS, config: { damping: 9, stiffness: 200 } });
  // Two small bounces after it lands, then it holds still.
  const bounce = t > 12 && t < 39 ? Math.sin(((t - 12) / 13.5) * Math.PI) * 0.05 : 0;
  const out = exitOf(element, time);
  return (
    <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: Math.min(1, s * 2) * out }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, background: 'white', color: INK, fontFamily: stack, fontWeight: 800, fontSize: 64,
        padding: '20px 40px 22px 26px', borderRadius: 999, border: `5px solid ${INK}`, boxShadow: `8px 10px 0 ${INK}`, whiteSpace: 'nowrap',
        transform: `rotate(2deg) scale(${((0.3 + 0.7 * s) * (1 + Math.abs(bounce))).toFixed(3)})` }}>
        {/* A speech bubble drawn in CSS (emoji fonts are not on every render machine). */}
        <div style={{ position: 'relative', width: 78, height: 62, borderRadius: 18, background: accent, border: `4px solid ${INK}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: onAccent }} />)}
          <div style={{ position: 'absolute', bottom: -16, left: 12, width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: `16px solid ${INK}` }} />
        </div>
        {element.text}
      </div>
    </div>
  );
}

export const MotionLayer: React.FC<MotionLayerProps> = ({ elements, frameTimes, font, accent = '#D7F25B', onAccent = INK }) => {
  const stack = packStack(font);
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  if (!ready) return null;
  const time = frameTimes[frame] ?? -1;
  const live = elements.filter((element) => time >= element.start && time < element.end);
  return (
    <AbsoluteFill>
      {live.map((element, i) => element.kind === 'hook' ? <Hook key={i} element={element} time={time} stack={stack} accent={accent} />
        : element.kind === 'punch' ? <Punch key={i} element={element} time={time} stack={stack} accent={accent} onAccent={onAccent} />
          : <Cta key={i} element={element} time={time} stack={stack} accent={accent} onAccent={onAccent} />)}
    </AbsoluteFill>
  );
};
