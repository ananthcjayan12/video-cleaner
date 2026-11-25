import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { MODERN_STACK, measure, useBrandFonts } from './fonts';

// "Glass Card": white Bold text on a frosted dark rounded card, English words in mint.
// This layer draws the tint, hairline border and text. The real background blur is added in FFmpeg:
// it blurs the video under the band and uses this layer's alpha as the card-shaped mask, so the card
// must have no soft shadow outside its edge.
export type GlassWord = { text: string; at: number; key?: boolean };
export type GlassPhrase = { start: number; end: number; words: GlassWord[] };
export type GlassCardProps = { phrases: GlassPhrase[]; size: number };

const MINT = '#7fe3d6';
const TINT = 'rgba(14, 16, 22, 0.46)';
const BORDER = 'rgba(255, 255, 255, 0.22)';
const MAX_TEXT_WIDTH = 820;
const WEIGHT = 700;

function packLines(words: GlassWord[], size: number) {
  const font = `${WEIGHT} ${size}px ${MODERN_STACK}`;
  const space = measure(' ', font);
  const lines: GlassWord[][] = []; let line: GlassWord[] = []; let used = 0;
  // Consecutive English words stay together on one line.
  const units: GlassWord[][] = [];
  for (const word of words) { const last = units.at(-1); if (last && word.key && last.at(-1)!.key) last.push(word); else units.push([word]); }
  for (const unit of units) {
    const w = measure(unit.map((x) => x.text).join(' '), font);
    if (line.length && used + space + w > MAX_TEXT_WIDTH) { lines.push(line); line = []; used = 0; }
    used += (line.length ? space : 0) + w; line.push(...unit);
  }
  if (line.length) lines.push(line);
  return lines;
}

export const GlassCard: React.FC<GlassCardProps> = ({ phrases, size }) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!ready) return null;
  const time = frame / fps;
  const phrase = phrases.find((p) => time >= p.start && time < p.end);
  if (!phrase) return null;
  const lines = packLines(phrase.words, size).slice(0, 2);
  const enter = interpolate(time, [phrase.start, phrase.start + 0.14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(time, [phrase.end - 0.1, phrase.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ fontFamily: MODERN_STACK, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: TINT, border: `1.5px solid ${BORDER}`, borderRadius: 30, padding: `${size * 0.42}px ${size * 0.78}px`,
        opacity: Math.min(enter, exit), transform: `scale(${0.96 + 0.04 * enter})`, textAlign: 'center',
        fontSize: size, fontWeight: WEIGHT, lineHeight: 1.3, color: 'white', letterSpacing: 0.2,
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: 'nowrap' }}>
            {line.map((word, j) => {
              const said = interpolate(time, [word.at, word.at + 0.08], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              return <React.Fragment key={j}>{j > 0 ? ' ' : ''}<span style={{ color: word.key ? MINT : 'white', opacity: 0.55 + 0.45 * said }}>{word.text}</span></React.Fragment>;
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
