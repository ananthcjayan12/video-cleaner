import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { MODERN_STACK, MONO_STACK, measure, useBrandFonts } from './fonts';

/**
 * Reel cover (1080x1920 still): a frame of the speaker, darkened at the top and bottom, with a three-line headline
 * (the middle line on a lime block), up to two glowing icon cards beside the face and a mono label strip lower down.
 * Instagram's profile grid shows the middle 1080x1440 (3:4), so the headline starts below y=270 and the label sits
 * above y=1650.
 */
export type ThumbnailBadge = { icon: string; label?: string };
export type ThumbnailProps = {
  image: string; lines: [string, string, string] | string[]; label?: string; badges?: ThumbnailBadge[]; accent?: string;
  /** Where the face is across the frame (0 = left edge, 1 = right edge); icon cards go where they do not cover it. */
  faceX?: number;
};

const LIME = '#d7f25b';
const MAX_WIDTH = 960;

function fit(text: string, size: number, weight: number, max: number, spacing = -0.035) {
  if (!text) return size;
  const width = measure(text, `${weight} ${size}px ${MODERN_STACK}`) * (1 + spacing * 0.6);
  return width > max ? Math.floor(size * max / width) : size;
}

function Badge({ badge, accent, style }: { badge: ThumbnailBadge; accent: string; style: React.CSSProperties }) {
  return (
    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, ...style }}>
      <div style={{
        width: 230, height: 230, borderRadius: 40, background: 'linear-gradient(160deg, #1d2120, #0d0f0f)',
        border: `3px solid ${accent}`, boxShadow: `0 0 38px ${accent}66, inset 0 0 22px ${accent}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 118, lineHeight: 1,
        fontFamily: "'Noto Color Emoji', sans-serif",
      }}>{badge.icon}</div>
      {badge.label ? <div style={{ fontFamily: MONO_STACK, fontWeight: 800, fontSize: 34, color: '#f4f6ef', letterSpacing: 2, textShadow: '0 2px 10px rgba(0,0,0,.8)' }}>{badge.label}</div> : null}
    </div>
  );
}

/** Face in the middle: one card each side. Face to one side: the cards stack on the other side. */
function badgeSpots(faceX: number, count: number): React.CSSProperties[] {
  if (faceX > 0.38 && faceX < 0.62) return [{ left: 30, top: 930, transform: 'rotate(-6deg)' }, { right: 30, top: 800, transform: 'rotate(6deg)' }].slice(0, count);
  const side = faceX >= 0.62 ? 'left' : 'right';
  return [{ [side]: 40, top: 800, transform: `rotate(${side === 'left' ? -6 : 6}deg)` }, { [side]: 70, top: 1130, transform: `rotate(${side === 'left' ? 5 : -5}deg)` }].slice(0, count);
}

export const Thumbnail: React.FC<ThumbnailProps> = ({ image, lines, label, badges = [], accent = LIME, faceX = 0.5 }) => {
  const ready = useBrandFonts();
  if (!ready) return null;
  const [top = '', middle = '', bottom = ''] = lines;
  // One size for the white lines so they read as a pair; the block line is sized on its own (it has padding).
  const white = Math.min(fit(top, 128, 800, MAX_WIDTH), fit(bottom, 128, 800, MAX_WIDTH));
  const block = fit(middle, 118, 800, MAX_WIDTH - 60);
  const head: React.CSSProperties = { fontFamily: MODERN_STACK, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.04, textAlign: 'center' };
  return (
    <AbsoluteFill style={{ background: '#0b0d0c' }}>
      <Img src={image} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'contrast(1.05) saturate(0.92)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(8,10,9,.97) 0%, rgba(8,10,9,.92) 24%, rgba(8,10,9,.55) 38%, rgba(8,10,9,0) 50%, rgba(8,10,9,0) 68%, rgba(8,10,9,.75) 88%, rgba(8,10,9,.95) 100%)' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(90% 60% at 50% 55%, transparent 55%, rgba(0,0,0,.45) 100%)' }} />
      <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {top ? <div style={{ ...head, fontSize: white, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,.6)' }}>{top}</div> : null}
        {middle ? <div style={{ ...head, fontSize: block, color: '#0b0d0c', background: accent, padding: '6px 30px 10px', borderRadius: 22, boxShadow: `0 0 44px ${accent}55` }}>{middle}</div> : null}
        {bottom ? <div style={{ ...head, fontSize: white, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,.6)' }}>{bottom}</div> : null}
      </div>
      {badgeSpots(faceX, badges.length).map((spot, i) => <Badge key={i} badge={badges[i]} accent={accent} style={spot} />)}
      {label ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 1480, display: 'flex', justifyContent: 'center' }}>
          <div style={{ fontFamily: MONO_STACK, fontWeight: 800, fontSize: Math.min(60, Math.floor(56 * 22 / Math.max(22, label.length))), color: accent, letterSpacing: 4,
            background: 'rgba(10,12,11,.86)', padding: '20px 36px', borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', textTransform: 'uppercase', maxWidth: 980, textAlign: 'center' }}>{label}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
