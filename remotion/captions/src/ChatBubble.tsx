import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { BOLD_STACK, useBrandFonts } from './fonts';

export type BubbleProps = { text: string; name: string; x: number; y: number; outAt: number };

const MINT = '#e8f8ee';
const DARK = '#1d5a37';

export const ChatBubble: React.FC<BubbleProps> = ({ text, name, x, y, outAt }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 10, stiffness: 240, mass: 0.7 } });
  const leave = interpolate(frame, [outAt * fps, outAt * fps + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = pop * leave;
  return (
    <AbsoluteFill style={{ fontFamily: BOLD_STACK }}>
      <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${scale})`, transformOrigin: '92% 100%' }}>
        <div style={{ textAlign: 'right', color: 'white', fontSize: 30, fontWeight: 600, marginBottom: 10, marginRight: 30, textShadow: '0 2px 6px rgba(0,0,0,0.6)' }}>{name}</div>
        <div style={{ position: 'relative' }}>
          {/* Hard offset shadow, then the bubble with a tail on the top-right corner like the reference. */}
          <div style={{ position: 'absolute', inset: 0, transform: 'translate(10px, 14px)', background: DARK, borderRadius: 30 }} />
          <svg width="70" height="60" viewBox="0 0 70 60" style={{ position: 'absolute', right: -26, top: -18 }}>
            <path d="M0 22 L70 0 L44 60 Z" fill={MINT} stroke={DARK} strokeWidth="4" strokeLinejoin="round" />
          </svg>
          <div style={{ position: 'relative', background: MINT, border: `4px solid ${DARK}`, borderRadius: 30, padding: '26px 56px 30px', color: DARK, fontSize: 54, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
