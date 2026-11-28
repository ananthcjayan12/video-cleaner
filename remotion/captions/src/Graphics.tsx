import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame } from 'remotion';
import { Calendar, Check, Heart, X } from 'lucide-react';
import { useBrandFonts } from './fonts';

/**
 * Motion graphics for talking-head reels, drawn in each clinic's own brand theme (colours, fonts, logo, decorations)
 * so the reels match the clinic's Instagram posts. Templates: headline stack, myth vs fact, counter, checklist,
 * split screen, comment call-to-action. Each graphic is drawn from `t` = seconds since it started, so the same
 * component serves still previews, "states" rendering and video.
 */
const FPS = 30;

/** A clinic's look. Colours are sampled from its posts; fonts are bundled faces (see fonts.ts). */
export type BrandTheme = {
  /** Darkest background (card shadows, split-screen ground). */ dark: string;
  /** Main brand colour: headline text on light cards, dark cards. */ deep: string;
  /** Ribbon / label fill. */ ribbon: string;
  /** Bright highlight for words and rings on dark backgrounds. */ glow: string;
  /** Soft highlight (light aqua). */ soft: string;
  /** Light card background. */ card: string;
  /** Text on ribbons and dark cards. */ onDark: string;
  /** Heavy display face (Malayalam + Latin) and the script face for taglines. */ display: string; script: string;
  /** Logo lockup: small line above, clinic name, line below (e.g. "Dr. Pooja's" / "Smile Craft" / "DENTAL CLINIC"). */
  logo?: { above?: string; name: string; below?: string; image?: string };
  tagline?: string;
  /** Text colour on ribbons when the ribbon is light (defaults to onDark). */ onRibbon?: string;
  /** The clinic's face/avatar badge (a data: URI of a round transparent PNG): watermark, split screen, comment. */ avatar?: string;
};

export const SMILE_CRAFT: BrandTheme = {
  dark: '#04252B', deep: '#033E49', ribbon: '#2A8C8A', glow: '#6DEDF3', soft: '#BDFBFC', card: '#FDFFFC', onDark: '#FFFFFF',
  display: "'VC Baloo Chettan', 'Noto Color Emoji', sans-serif", script: "'VC Dancing Script', cursive",
  logo: { above: "Dr. Pooja's", name: 'Smile Craft', below: 'DENTAL CLINIC' }, tagline: 'A confident smile changes everything',
};

export type GraphicKind = 'headline' | 'mythfact' | 'counter' | 'checklist' | 'split' | 'comment' | 'punch' | 'watermark';
export type GraphicProps = {
  kind: GraphicKind; t: number; theme?: BrandTheme;
  tag?: string; lines?: string[]; ribbon?: string; emoji?: string;
  myth?: string; fact?: string; factAt?: number;
  value?: number; from?: number; prefix?: string; suffix?: string; label?: string; sub?: string;
  title?: string; items?: string[]; itemAt?: number[];
  text?: string;
  speaker?: string; picture?: string;
  keyword?: string; line?: string;
};

const pop = (t: number, delay = 0, config = { damping: 10, stiffness: 210, mass: 0.6 }) => spring({ frame: (t - delay) * FPS, fps: FPS, config });
const ease = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (x) => 1 - (1 - x) ** 3 });

/** The tooth mark from the clinic's logo, as a line drawing. */
function ToothIcon({ size, color, stroke = 5 }: { size: number; color: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 8c-8 0-13 6-13 15 0 7 3 11 5 17 2 7 3 16 8 16 4 0 4-8 6-14 1-3 2-5 6-5s5 2 6 5c2 6 2 14 6 14 5 0 6-9 8-16 2-6 5-10 5-17 0-9-5-15-13-15-6 0-8 3-12 3s-6-3-12-3z" />
    </svg>
  );
}

/** The little "\ | /" accent marks the clinic's posts put beside headlines; they draw in. */
function Burst({ x, y, color, t, flip = false, size = 70 }: { x: number; y: number; color: string; t: number; flip?: boolean; size?: number }) {
  const d = ease(t, 0.15, 0.45);
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" style={{ position: 'absolute', left: x, top: y, transform: flip ? 'scaleX(-1)' : undefined }}>
      {[[10, 60, 4, 34], [30, 54, 30, 22], [50, 60, 62, 38]].map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x1 + (x2 - x1) * d} y2={y1 + (y2 - y1) * d} stroke={color} strokeWidth={7} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** The teal wave the clinic's posts sit on. */
function Wave({ top, color, t, height = 140 }: { top: number; color: string; t: number; height?: number }) {
  const shift = Math.sin(t * 1.6) * 18;
  return (
    <svg width={1080} height={height} viewBox={`0 0 1080 ${height}`} style={{ position: 'absolute', left: 0, top }}>
      <path d={`M0 ${height * 0.45} C 270 ${height * 0.1 + shift}, 640 ${height * 0.85 - shift}, 1080 ${height * 0.3} L1080 ${height} L0 ${height} Z`} fill={color} />
    </svg>
  );
}

function Logo({ theme, x, y, scale = 1, light = false }: { theme: BrandTheme; x: number; y: number; scale?: number; light?: boolean }) {
  if (!theme.logo) return null;
  const color = light ? theme.onDark : theme.deep;
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 12 * scale, transform: `scale(${scale})`, transformOrigin: 'left top' }}>
      {theme.avatar ? <Img src={theme.avatar} style={{ width: 92, height: 92, borderRadius: 46, border: `4px solid ${theme.card}` }} />
        : theme.logo.image ? <Img src={theme.logo.image} style={{ height: 70 }} /> : <ToothIcon size={66} color={color} stroke={4.5} />}
      <div style={{ color, display: 'grid', lineHeight: 1, fontFamily: theme.display }}>
        {theme.logo.above && <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{theme.logo.above}</span>}
        <span style={{ fontSize: 38, fontWeight: 800 }}>{theme.logo.name}</span>
        {theme.logo.below && <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 3 }}>{theme.logo.below}</span>}
      </div>
    </div>
  );
}

/** Headline stack, as on the clinic's post tiles: a small tag pill, a white card with the question, a teal ribbon. */
function Headline({ t, theme, tag, lines = [], ribbon, emoji }: GraphicProps & { theme: BrandTheme }) {
  const card = pop(t); const band = pop(t, 0.18); const pill = pop(t, 0.05);
  return (
    <div style={{ position: 'absolute', top: 150, left: 60, right: 60, display: 'grid', justifyItems: 'center', gap: 0, fontFamily: theme.display }}>
      {tag && <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: theme.ribbon, color: theme.onRibbon ?? theme.onDark, borderRadius: 999, padding: '8px 24px 6px 12px', fontSize: 30, fontWeight: 800, letterSpacing: 2,
        transform: `scale(${pill.toFixed(3)})`, marginBottom: 18, border: `3px solid ${theme.card}` }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: theme.card, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ToothIcon size={30} color={theme.deep} stroke={6} /></div>{tag}
      </div>}
      <div style={{ position: 'relative', background: theme.card, borderRadius: 40, padding: '26px 46px 18px', boxShadow: `0 14px 0 ${theme.dark}55`, transform: `rotate(-2.5deg) scale(${(0.3 + 0.7 * card).toFixed(3)})`, opacity: Math.min(1, card * 3), textAlign: 'center' }}>
        {lines.map((line, i) => <div key={i} style={{ color: theme.deep, fontWeight: 800, fontSize: i === 0 ? 92 : 74, lineHeight: 1.08 }}>{line}</div>)}
        {emoji && <div style={{ position: 'absolute', right: -40, top: -70, fontSize: 110, transform: `rotate(14deg) scale(${pop(t, 0.3).toFixed(3)})` }}>{emoji}</div>}
      </div>
      {ribbon && <div style={{ marginTop: -14, background: theme.ribbon, color: theme.onRibbon ?? theme.onDark, borderRadius: 26, padding: '14px 40px 8px', fontWeight: 800, fontSize: 76, lineHeight: 1.05, border: `5px solid ${theme.card}`,
        boxShadow: `0 12px 0 ${theme.dark}55`, transform: `rotate(-2.5deg) translateX(${((1 - band) * 900).toFixed(1)}px)`, textAlign: 'center' }}>{ribbon}</div>}
      <Burst x={-30} y={70} color={theme.glow} t={t} flip />
      <Burst x={900} y={60} color={theme.glow} t={t} />
    </div>
  );
}

function MythFact({ t, theme, myth = '', fact = '', factAt = 1.2 }: GraphicProps & { theme: BrandTheme }) {
  const a = ease(t, 0, 0.35); const strike = ease(t, factAt - 0.35, factAt); const b = ease(t, factAt, factAt + 0.35);
  const card = (label: string, fill: string, icon: React.ReactNode, text: string, shift: number, dim = 0, line = 0): React.ReactNode => (
    <div style={{ background: theme.card, borderRadius: 34, padding: '18px 30px 22px', boxShadow: `0 14px 0 ${theme.dark}55`, display: 'grid', gap: 8,
      transform: `translateX(${shift.toFixed(1)}px) rotate(${label === 'Myth' ? -1.5 : 1.5}deg)`, opacity: 1 - dim * 0.4 }}>
      <div style={{ justifySelf: 'start', background: fill, color: theme.onDark, borderRadius: 999, padding: '4px 22px 0 10px', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 40 }}>{icon}{label}</div>
      <div style={{ position: 'relative', fontWeight: 800, fontSize: 56, lineHeight: 1.08, color: theme.deep }}>
        {text}
        {line > 0 && <div style={{ position: 'absolute', left: -6, top: '46%', height: 9, borderRadius: 5, background: '#E5484D', width: `${(line * 104).toFixed(1)}%` }} />}
      </div>
    </div>
  );
  return (
    <div style={{ position: 'absolute', top: 110, left: 60, right: 60, display: 'grid', gap: 22, fontFamily: theme.display }}>
      <div style={{ justifySelf: 'center', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 36, color: theme.deep, background: theme.card, borderRadius: 999, padding: '6px 26px 2px 26px', opacity: a, border: `3px solid ${theme.ribbon}` }}>
        Myth <span style={{ background: theme.ribbon, color: theme.onRibbon ?? theme.onDark, borderRadius: 999, padding: '0 14px', fontSize: 28 }}>vs</span> Fact
      </div>
      {card('Myth', theme.deep, <X size={40} strokeWidth={4} color="#FF6B6B" />, myth, (1 - a) * -1100, strike, strike)}
      {t >= factAt && card('Fact', theme.ribbon, <Check size={40} strokeWidth={4} color={theme.soft} />, fact, (1 - b) * 1100)}
    </div>
  );
}

function Counter({ t, theme, value = 0, from = 0, prefix = '', suffix = '', label = '', sub = '' }: GraphicProps & { theme: BrandTheme }) {
  const s = pop(t, 0, { damping: 12, stiffness: 180, mass: 0.8 }); const run = ease(t, 0.15, 1.1);
  const shown = Math.round(from + (value - from) * run);
  const r = 140; const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'absolute', top: 150, left: 0, right: 0, display: 'flex', justifyContent: 'center', transform: `scale(${(0.5 + 0.5 * s).toFixed(3)})`, opacity: Math.min(1, s * 2), fontFamily: theme.display }}>
      <div style={{ position: 'relative', background: theme.deep, borderRadius: 48, padding: '34px 50px 38px', display: 'flex', alignItems: 'center', gap: 36, border: `5px solid ${theme.card}`, boxShadow: `0 14px 0 ${theme.dark}66` }}>
        <div style={{ position: 'relative', width: 2 * r + 40, height: 2 * r + 40 }}>
          <svg width={2 * r + 40} height={2 * r + 40} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle cx={r + 20} cy={r + 20} r={r} fill="none" stroke={`${theme.glow}2E`} strokeWidth={24} />
            <circle cx={r + 20} cy={r + 20} r={r} fill="none" stroke={theme.glow} strokeWidth={24} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - run)} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: theme.onDark, fontWeight: 800 }}>
            <div style={{ fontSize: 150, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>{prefix}{shown}{suffix}</div>
            <div style={{ fontSize: 36, letterSpacing: 3, color: theme.glow }}>{label}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 16, maxWidth: 330 }}>
          <div style={{ width: 92, height: 92, borderRadius: 26, background: theme.ribbon, color: theme.onRibbon ?? theme.onDark, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${(-8 + 8 * pop(t, 0.3)).toFixed(1)}deg)` }}><Calendar size={54} strokeWidth={2.6} /></div>
          <div style={{ color: theme.onDark, fontWeight: 700, fontSize: 48, lineHeight: 1.1, opacity: ease(t, 0.5, 0.9) }}>{sub}</div>
        </div>
        <Burst x={-46} y={-46} color={theme.glow} t={t} flip size={80} />
      </div>
    </div>
  );
}

function Checklist({ t, theme, title = '', items = [], itemAt }: GraphicProps & { theme: BrandTheme }) {
  const s = ease(t, 0, 0.3);
  return (
    <div style={{ position: 'absolute', top: 140, left: 70, right: 70, transform: `translateY(${((1 - s) * -80).toFixed(1)}px)`, opacity: s, fontFamily: theme.display }}>
      <div style={{ background: theme.card, borderRadius: 40, overflow: 'hidden', boxShadow: `0 14px 0 ${theme.dark}55` }}>
        <div style={{ background: theme.deep, color: theme.onDark, fontWeight: 800, fontSize: 56, padding: '18px 34px 10px', display: 'flex', alignItems: 'center', gap: 16 }}><ToothIcon size={50} color={theme.glow} stroke={5} />{title}</div>
        <div style={{ display: 'grid', gap: 16, padding: '24px 34px 28px' }}>
          {items.map((item, i) => {
            const at = itemAt?.[i] ?? 0.35 + i * 0.45; const a = ease(t, at, at + 0.25); const tick = ease(t, at + 0.15, at + 0.4);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: a, transform: `translateX(${((1 - a) * 60).toFixed(1)}px)` }}>
                <svg width={64} height={64} viewBox="0 0 70 70" style={{ flex: 'none' }}>
                  <circle cx={35} cy={35} r={33} fill={theme.ribbon} />
                  <path d="M20 36 L31 47 L51 25" fill="none" stroke="white" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={50} strokeDashoffset={50 * (1 - tick)} />
                </svg>
                <div style={{ fontWeight: 700, fontSize: 52, color: theme.deep, lineHeight: 1.05, paddingTop: 6 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Where the speaker sits in the split screen (FFmpeg scales the live video into this box under the layer). */
export const SPLIT_BOX = { x: 40, y: 942, w: 1000, h: 828, r: 44 };

/**
 * Split screen: the picture on top sits on the brand wave, the speaker shows through a rounded window below
 * (live video underneath; in still previews `speaker` is drawn in the window), logo and tagline at the bottom.
 */
function Split({ t, theme, speaker, picture, title = '' }: GraphicProps & { theme: BrandTheme }) {
  const s = ease(t, 0, 0.35); const b = SPLIT_BOX; const top = b.y - 40;
  const hole = `M${b.x + b.r} ${b.y} H${b.x + b.w - b.r} A${b.r} ${b.r} 0 0 1 ${b.x + b.w} ${b.y + b.r} V${b.y + b.h - b.r} A${b.r} ${b.r} 0 0 1 ${b.x + b.w - b.r} ${b.y + b.h} H${b.x + b.r} A${b.r} ${b.r} 0 0 1 ${b.x} ${b.y + b.h - b.r} V${b.y + b.r} A${b.r} ${b.r} 0 0 1 ${b.x + b.r} ${b.y} Z`;
  return (
    <AbsoluteFill style={{ fontFamily: theme.display, opacity: Math.min(1, s * 3) }}>
      {speaker && <Img src={speaker} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, objectFit: 'cover', objectPosition: '50% 30%' }} />}
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <path d={`M0 0 H1080 V1920 H0 Z ${hole}`} fill={theme.deep} fillRule="evenodd" />
        <path d={hole} fill="none" stroke={theme.card} strokeWidth={10} />
      </svg>
      {picture && <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: top + 60, overflow: 'hidden' }}><Img src={picture} style={{ width: 1080, height: top + 60, objectFit: 'cover', transform: `translateY(${((1 - s) * -60).toFixed(1)}px)` }} /></div>}
      <Wave top={top - 70} color={theme.deep} t={Math.min(t, 0.8)} />
      <div style={{ position: 'absolute', left: 50, top: 170, background: theme.card, color: theme.deep, fontWeight: 800, fontSize: 66, padding: '14px 34px 6px', borderRadius: 24, boxShadow: `0 12px 0 ${theme.dark}55`, transform: `rotate(-2deg) scale(${pop(t, 0.2).toFixed(3)})`, maxWidth: 900 }}>{title}</div>
      <Logo theme={theme} x={50} y={1790} light />
      {theme.tagline && <div style={{ position: 'absolute', right: 50, top: 1812, fontFamily: theme.script, fontSize: 44, color: theme.soft, transform: 'rotate(-4deg)' }}>{theme.tagline}</div>}
    </AbsoluteFill>
  );
}

/** Punch box: 1-4 words slammed in on the word, on the brand ribbon with a white rim. */
function Punch({ t, theme, text = '' }: GraphicProps & { theme: BrandTheme }) {
  const f = t * FPS; const s = spring({ frame: f, fps: FPS, config: { damping: 10, stiffness: 260, mass: 0.7 } });
  const shake = f < 10 ? Math.sin(f * 2.4) * (10 - f) * 0.9 : 0;
  return (
    <div style={{ position: 'absolute', top: 300, left: 60, right: 60, display: 'flex', justifyContent: 'center', opacity: Math.min(1, s * 2) }}>
      <div style={{ position: 'relative', background: theme.ribbon, color: theme.onRibbon ?? theme.onDark, fontFamily: theme.display, fontWeight: 800, fontSize: text.length > 16 ? 70 : 92, lineHeight: 1.05, textAlign: 'center',
        padding: '18px 40px 8px', borderRadius: 26, border: `6px solid ${theme.card}`, boxShadow: `0 14px 0 ${theme.dark}66`, transform: `translateX(${shake.toFixed(1)}px) rotate(-2.5deg) scale(${(1.6 - 0.6 * s).toFixed(3)})` }}>
        {text}
        <Burst x={-62} y={-50} color={theme.glow} t={t} flip size={64} />
      </div>
    </div>
  );
}

/** Brand watermark: the clinic's avatar badge with its name, small, top left. */
function Watermark({ t, theme }: GraphicProps & { theme: BrandTheme }) {
  const s = ease(t, 0, 0.3);
  return (
    <div style={{ position: 'absolute', left: 36, top: 170, display: 'flex', alignItems: 'center', opacity: 0.96 * s, transform: `translateX(${((1 - s) * -40).toFixed(1)}px)`, fontFamily: theme.display }}>
      {theme.avatar ? <Img src={theme.avatar} style={{ width: 118, height: 118, borderRadius: 59, border: `5px solid ${theme.card}`, position: 'relative', zIndex: 1, boxShadow: `0 6px 0 ${theme.dark}55` }} />
        : <div style={{ width: 118, height: 118, borderRadius: 59, background: theme.deep, border: `5px solid ${theme.card}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}><ToothIcon size={64} color={theme.onDark} /></div>}
      {theme.logo && <div style={{ marginLeft: -24, background: theme.deep, color: theme.onDark, borderRadius: '0 22px 22px 0', padding: '8px 22px 4px 36px', display: 'grid', lineHeight: 1 }}>
        {theme.logo.above && <span style={{ fontSize: 20, fontWeight: 600, color: theme.soft }}>{theme.logo.above}</span>}
        <span style={{ fontSize: 34, fontWeight: 800 }}>{theme.logo.name}</span>
      </div>}
    </div>
  );
}

/** Comment call-to-action: the clinic's logo comments the keyword, a heart pops, the line sits on a ribbon. */
function Comment({ t, theme, keyword = '', line = '' }: GraphicProps & { theme: BrandTheme }) {
  const s = pop(t); const typed = Math.round(keyword.length * ease(t, 0.35, 0.35 + 0.08 * keyword.length));
  const heart = pop(t, 0.4 + 0.08 * keyword.length + 0.2);
  return (
    <div style={{ position: 'absolute', top: 210, left: 60, right: 60, display: 'grid', gap: 0, justifyItems: 'center', transform: `scale(${(0.4 + 0.6 * s).toFixed(3)})`, opacity: Math.min(1, s * 2), fontFamily: theme.display }}>
      <div style={{ width: '100%', background: theme.card, borderRadius: 36, padding: '24px 30px', display: 'flex', alignItems: 'center', gap: 22, boxShadow: `0 14px 0 ${theme.dark}55` }}>
        <div style={{ width: 96, height: 96, borderRadius: 48, background: theme.deep, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `4px solid ${theme.glow}` }}><ToothIcon size={56} color={theme.onDark} stroke={5} /></div>
        <div style={{ flex: 1, display: 'grid' }}>
          <div style={{ fontWeight: 600, fontSize: 32, color: `${theme.deep}99` }}>you · now</div>
          <div style={{ fontWeight: 800, fontSize: 80, color: theme.deep, letterSpacing: 2, lineHeight: 1 }}>{keyword.slice(0, typed)}<span style={{ opacity: t < 0.6 + 0.08 * keyword.length && Math.floor(t * 3) % 2 === 0 ? 1 : 0, color: theme.ribbon }}>|</span></div>
        </div>
        <Heart size={70} strokeWidth={2.6} color="#E5484D" fill={heart > 0.5 ? '#E5484D' : 'none'} style={{ transform: `scale(${(0.6 + 0.6 * heart).toFixed(3)})` }} />
      </div>
      {line && <div style={{ marginTop: -10, background: theme.ribbon, color: theme.onRibbon ?? theme.onDark, borderRadius: 24, padding: '14px 34px 6px', fontWeight: 800, fontSize: 56, border: `5px solid ${theme.card}`, transform: `rotate(-2deg) scale(${pop(t, 0.5).toFixed(3)})`, textAlign: 'center' }}>{line}</div>}
      <div style={{ fontSize: 110, marginTop: 10, transform: `translateY(${(Math.sin(t * 8) * 14 * Math.max(0, 1 - t / 2.2)).toFixed(1)}px)` }}>👇</div>
    </div>
  );
}

function Graphic(p: GraphicProps & { theme: BrandTheme }) {
  switch (p.kind) {
    case 'headline': return <Headline {...p} />;
    case 'mythfact': return <MythFact {...p} />;
    case 'counter': return <Counter {...p} />;
    case 'checklist': return <Checklist {...p} />;
    case 'comment': return <Comment {...p} />;
    case 'punch': return <Punch {...p} />;
    case 'watermark': return <Watermark {...p} />;
    default: return <Split {...p} />;
  }
}

export const GraphicStill: React.FC<GraphicProps & { background?: string }> = (props) => {
  const ready = useBrandFonts();
  if (!ready) return null;
  const theme = props.theme ?? SMILE_CRAFT;
  return (
    <AbsoluteFill>
      {props.background && props.kind !== 'split' && <Img src={props.background} style={{ width: 1080, height: 1920 }} />}
      <Graphic {...props} theme={theme} />
    </AbsoluteFill>
  );
};

/** One timed graphic on the reel. Times are seconds on the edited reel. */
export type ReelGraphic = Omit<GraphicProps, 't' | 'theme'> & { start: number; end: number };
export const GRAPHIC_OUT = 0.2;

/**
 * The whole motion layer of a reel, "states" mode: frame N shows the reel at frameTimes[N] (the server draws each
 * distinct look once). Graphics scale/fade out over their last GRAPHIC_OUT seconds.
 */
export const ReelGraphics: React.FC<{ graphics: ReelGraphic[]; frameTimes: number[]; theme: BrandTheme }> = ({ graphics, frameTimes, theme }) => {
  const ready = useBrandFonts();
  const frame = useCurrentFrame();
  if (!ready) return null;
  const time = frameTimes[frame] ?? -1;
  return (
    <AbsoluteFill>
      {graphics.filter((g) => time >= g.start && time < g.end).map((g, i) => {
        const out = interpolate(time, [g.end - GRAPHIC_OUT, g.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return <AbsoluteFill key={i} style={{ opacity: out, transform: g.kind === 'split' || g.kind === 'watermark' ? undefined : `scale(${(0.92 + 0.08 * out).toFixed(3)})` }}><Graphic {...g} t={time - g.start} theme={theme} /></AbsoluteFill>;
      })}
    </AbsoluteFill>
  );
};
