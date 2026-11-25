import React, { useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { HEAVY_STACK, measure, useBrandFonts } from './fonts';

export type HookWord = { text: string; color: 'white' | 'yellow' | 'red'; at: number };
export type HookProps = { lines: HookWord[][]; y: number; size: number; outAt: number };

const FILL = { white: '#ffffff', yellow: '#ffe11a', red: '#e3201b' } as const;
// White and yellow words sit on a hard red drop shadow; red words get a light one so they still lift off the picture.
const SHADOW = { white: '#d71c1c', yellow: '#d71c1c', red: '#fff1ec' } as const;

function Word({ word, size }: { word: HookWord; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = Math.round(word.at * fps);
  const pop = spring({ frame: frame - start, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } });
  const opacity = interpolate(frame - start, [0, 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = word.color === 'red' ? 1.18 : 1;
  const depth = Math.max(4, Math.round(size * 0.075));
  const glow = word.color === 'yellow' ? `, 0 0 ${Math.round(size * 0.4)}px rgba(255,255,255,0.6)` : '';
  return (
    <span style={{
      display: 'inline-block', margin: `0 ${size * 0.12}px`, opacity,
      transform: `scale(${0.5 + 0.5 * pop})`, transformOrigin: '50% 80%',
      color: FILL[word.color], fontSize: size * scale, fontWeight: 900, letterSpacing: -size * 0.01,
      textShadow: `${depth}px ${depth}px 0 ${SHADOW[word.color]}, ${Math.round(depth / 2)}px ${Math.round(depth / 2)}px 0 ${SHADOW[word.color]}${glow}`,
    }}>{word.text}</span>
  );
}

// Safe width: 50 px left margin, 150 px clear of the right-side Reels buttons.
const SAFE_LEFT = 50;
const SAFE_WIDTH = 1080 - 50 - 150;

// Each line stays on one row and shrinks to fit the safe width instead of wrapping or running off screen.
function Line({ words, size }: { words: HookWord[]; size: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.transform = 'scaleX(1.06)';
    const width = el.scrollWidth * 1.06;
    const fit = Math.min(1, SAFE_WIDTH / width);
    el.style.transform = `scale(${fit}) scaleX(1.06)`;
  });
  return (
    <div style={{ width: SAFE_WIDTH, display: 'flex', justifyContent: 'center' }}>
      <div ref={ref} style={{ whiteSpace: 'nowrap', transformOrigin: '50% 60%' }}>
        {words.map((word, i) => <Word key={i} word={word} size={size} />)}
      </div>
    </div>
  );
}

// Re-pack any line that is too wide (measured with the real font) so text stays big instead of shrinking.
function pack(lines: HookWord[][], size: number) {
  const out: HookWord[][] = [];
  for (const line of lines) {
    let current: HookWord[] = []; let used = 0;
    for (const word of line) {
      const px = word.color === 'red' ? size * 1.18 : size;
      const w = measure(word.text, `900 ${px}px ${HEAVY_STACK}`) * 1.06 + size * 0.24;
      if (current.length && used + w > SAFE_WIDTH) { out.push(current); current = []; used = 0; }
      current.push(word); used += w;
    }
    if (current.length) out.push(current);
  }
  return out;
}

export const HookCaption: React.FC<HookProps> = ({ lines: rawLines, y, size, outAt }) => {
  const fontsReady = useBrandFonts();
  const lines = fontsReady ? pack(rawLines, size) : [];
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [outAt * fps, outAt * fps + 5], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ fontFamily: HEAVY_STACK, opacity: out }}>
      <div style={{ position: 'absolute', left: SAFE_LEFT, top: y, lineHeight: 1.12 }}>
        {lines.map((line, index) => <Line key={index} words={line} size={size} />)}
      </div>
    </AbsoluteFill>
  );
};
