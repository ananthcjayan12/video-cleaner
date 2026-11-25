import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { MODERN_STACK, measure, useBrandFonts } from './fonts';

// "Minimal Lower": one short line of SemiBold white text low on screen with a soft shadow.
// The whole phrase appears together; words not yet spoken sit at reduced opacity and brighten as they are said.
// English words get a warm-yellow underline that draws in when spoken.
export type MlWord = { text: string; at: number; key?: boolean };
export type MlPhrase = { start: number; end: number; words: MlWord[] };
export type MinimalLowerProps = { phrases: MlPhrase[]; size: number; width: number; height: number };

const ACCENT = '#ffd64d';
const SHADOW = '0 4px 14px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.45)';
const MAX_WIDTH = 900;
const WEIGHT = 600;

export const MinimalLower: React.FC<MinimalLowerProps> = ({ phrases, size }) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (!ready) return null;
  const time = frame / fps;
  const phrase = phrases.find((p) => time >= p.start && time < p.end);
  if (!phrase) return null;
  const text = phrase.words.map((w) => w.text).join(' ');
  const fit = Math.min(1, MAX_WIDTH / Math.max(1, measure(text, `${WEIGHT} ${size}px ${MODERN_STACK}`)));
  const opacity = interpolate(time, [phrase.start, phrase.start + 0.1, phrase.end - 0.1, phrase.end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rise = interpolate(time, [phrase.start, phrase.start + 0.16], [8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ fontFamily: MODERN_STACK, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ whiteSpace: 'nowrap', fontSize: size * fit, fontWeight: WEIGHT, color: 'white', textShadow: SHADOW,
          opacity, transform: `translateY(${rise}px)`, letterSpacing: 0.2 }}>
          {phrase.words.map((word, i) => {
            const said = interpolate(time, [word.at, word.at + 0.08], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const line = interpolate(time, [word.at, word.at + 0.22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <React.Fragment key={i}>
                {i > 0 ? ' ' : ''}
                <span style={{ position: 'relative', display: 'inline-block', opacity: 0.5 + 0.5 * said }}>
                  {word.text}
                  {word.key ? <span style={{ position: 'absolute', left: 0, bottom: -size * 0.16, height: Math.max(4, size * 0.1), width: `${line * 100}%`,
                    background: ACCENT, borderRadius: 4, boxShadow: '0 2px 6px rgba(0,0,0,0.35)' }} /> : null}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
