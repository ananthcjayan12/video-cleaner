import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { BOLD_STACK, useBrandFonts } from './fonts';

export type NameTagProps = { text: string; x: number; y: number; outAt: number };

// A thin cursor bar appears first, then the name types out one letter at a time.
export const NameTag: React.FC<NameTagProps> = ({ text, x, y, outAt }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = [...new Intl.Segmenter('ml', { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  // The whole name finishes typing within ~0.6 s after the cursor appears, however long it is.
  const perLetter = Math.min(2, 18 / Math.max(1, letters.length));
  const typed = Math.max(0, Math.min(letters.length, Math.floor((frame - 5) / perLetter)));
  const out = interpolate(frame, [outAt * fps, outAt * fps + 5], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cursorOn = typed < letters.length || Math.floor(frame / 8) % 2 === 0;
  return (
    <AbsoluteFill style={{ fontFamily: BOLD_STACK, opacity: out }}>
      <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', color: 'white', fontSize: 40, fontWeight: 600, textShadow: '0 2px 8px rgba(0,0,0,0.75)' }}>
        <div style={{ width: 4, height: 50, background: 'white', marginRight: 12, opacity: cursorOn ? 1 : 0, boxShadow: '0 2px 8px rgba(0,0,0,0.6)' }} />
        <span>{letters.slice(0, typed).join('')}</span>
      </div>
    </AbsoluteFill>
  );
};
