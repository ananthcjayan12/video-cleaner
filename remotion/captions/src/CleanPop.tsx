import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { MODERN_STACK, measure, useBrandFonts } from './fonts';

// "Clean Pop": white ExtraBold, soft blurred shadow, key words in warm yellow.
// Each word fades and lifts in on its spoken time; the phrase fades out when the next one starts.
export type PopWord = { text: string; at: number; key?: boolean };
export type PopPhrase = { start: number; end: number; words: PopWord[] };
export type CleanPopProps = { phrases: PopPhrase[]; y: number; size: number };

const WHITE = '#ffffff';
const KEY = '#ffd64d';
const SHADOW = '0 8px 22px rgba(0,0,0,0.55), 0 2px 5px rgba(0,0,0,0.35)';
const SAFE_LEFT = 90;
const SAFE_WIDTH = 1080 - 90 - 90; // centred; 90 px each side keeps text off the Reels buttons
const WEIGHT = 800;

function packLines(words: PopWord[], size: number) {
  const lines: PopWord[][] = [];
  let line: PopWord[] = []; let used = 0;
  const font = `${WEIGHT} ${size}px ${MODERN_STACK}`;
  const space = measure(' ', font);
  // Consecutive English (key) words form one unit so "Social Media" never splits across lines.
  const units: PopWord[][] = [];
  for (const word of words) {
    const last = units.at(-1);
    if (last && word.key && last.at(-1)!.key) last.push(word); else units.push([word]);
  }
  for (const unit of units) {
    const w = measure(unit.map((word) => word.text).join(' '), font);
    if (line.length && used + space + w > SAFE_WIDTH) { lines.push(line); line = []; used = 0; }
    used += (line.length ? space : 0) + w; line.push(...unit);
  }
  if (line.length) lines.push(line);
  return lines;
}

function Word({ word, frame, fps }: { word: PopWord; frame: number; fps: number }) {
  const t = frame - word.at * fps;
  const progress = interpolate(t, [0, 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ease = 1 - Math.pow(1 - progress, 3);
  return (
    <span style={{
      display: 'inline-block', opacity: progress, color: word.key ? KEY : WHITE,
      transform: `translateY(${(1 - ease) * 14}px) scale(${0.94 + 0.06 * ease})`, transformOrigin: '50% 100%',
    }}>{word.text}</span>
  );
}

export const CleanPop: React.FC<CleanPopProps> = ({ phrases, y, size }) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!ready) return null;
  const time = frame / fps;
  const phrase = phrases.find((p) => time >= p.start && time < p.end);
  if (!phrase) return null;
  const fadeOut = interpolate(time, [phrase.end - 0.12, phrase.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lines = packLines(phrase.words, size);
  return (
    <AbsoluteFill style={{ fontFamily: MODERN_STACK }}>
      <div style={{ position: 'absolute', left: SAFE_LEFT, width: SAFE_WIDTH, top: y, opacity: fadeOut, textAlign: 'center',
        fontSize: size, fontWeight: WEIGHT, lineHeight: 1.28, textShadow: SHADOW, letterSpacing: -0.3 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: 'nowrap' }}>
            {line.map((word, j) => <React.Fragment key={j}>{j > 0 ? ' ' : ''}<Word word={word} frame={frame} fps={fps} /></React.Fragment>)}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
