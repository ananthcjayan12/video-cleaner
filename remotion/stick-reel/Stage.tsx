import React from 'react';
import { interpolate, spring } from 'remotion';
import type { StickSceneData, StickTemplateId, StickTheme } from '../../server/stick-reel';
import { STICK_FONT_STACK } from './fonts';

const TEMPLATE_TITLES: Record<StickTemplateId, string> = {
  key_idea: 'Key Idea',
  hero_icon: 'Spotlight',
  metric: 'Live Metric',
  checklist: 'Checklist',
  compare: 'Compare',
  flow: 'Workflow',
  prompt_box: 'Prompt',
  chat_bubble: 'Conversation',
  steps: 'Step-by-Step',
  cta_click: 'Next Step',
};

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };

export function Stage({
  template,
  data,
  note,
  beat,
  theme,
  glass = false,
}: {
  template: StickTemplateId;
  data: StickSceneData;
  note: string;
  beat: number;
  theme: StickTheme;
  /** Cinematic look: dark frosted panel instead of the bordered card. */
  glass?: boolean;
}) {
  const { ink, paper, accent, highlight, surface } = theme;
  const dark = theme.id === 'midnight';
  const divider = dark ? '#323d49' : '#d8dfd4';
  const softFill = dark ? '#24303c' : '#eef1ea';
  const onHighlight = '#111a17';
  const onAccent = '#111a17';

  const click = beat >= 46;
  const cursor = interpolate(beat, [16, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const headerTitle = data.title || TEMPLATE_TITLES[template];

  return (
    <div
      style={{
        border: glass ? '2px solid rgba(255,255,255,0.16)' : `4px solid ${ink}`,
        borderRadius: 28,
        background: glass ? 'rgba(14,17,19,0.84)' : surface,
        color: ink,
        boxShadow: glass ? '0 40px 90px rgba(0,0,0,0.6)' : `9px 11px 0 ${ink}`,
        overflow: 'hidden',
        position: 'relative',
        height: 575,
        fontFamily: STICK_FONT_STACK,
      }}
    >
      <div style={{ ...row, height: 68, background: glass ? 'rgba(255,255,255,0.06)' : ink, color: glass ? highlight : paper, padding: '0 26px', fontSize: 23, fontWeight: 700, letterSpacing: glass ? 1.5 : undefined, textTransform: glass ? 'uppercase' : undefined }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[accent, '#ffdf79', highlight].map((color, idx) => (
            <i key={idx} style={{ width: 13, height: 13, background: color, borderRadius: 20, display: 'block' }} />
          ))}
        </div>
        <span style={{ maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headerTitle}</span>
      </div>

      <div style={{ padding: 34, height: 507, boxSizing: 'border-box', position: 'relative' }}>
        {template === 'hero_icon' && (
          <div style={{ display: 'grid', placeItems: 'center', alignContent: 'center', height: '100%', gap: 22, textAlign: 'center' }}>
            {data.badge && (
              <span style={{ background: highlight, color: onHighlight, padding: '8px 18px', borderRadius: 99, fontSize: 22, fontWeight: 800 }}>
                {data.badge}
              </span>
            )}
            <div
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                background: accent,
                color: onAccent,
                border: `4px solid ${ink}`,
                borderRadius: 30,
                width: 124,
                height: 124,
                fontSize: 64,
                fontWeight: 900,
                transform: `rotate(${Math.sin(beat / 12) * 7}deg)`,
              }}
            >
              {data.icon || '✦'}
            </div>
            <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>{data.title || note}</div>
            {data.subtitle && <div style={{ fontSize: 26, opacity: 0.78, maxWidth: 640 }}>{data.subtitle}</div>}
          </div>
        )}

        {template === 'prompt_box' && (
          <div style={{ display: 'grid', alignContent: 'center', height: '100%', gap: 28 }}>
            <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1.1 }}>{data.title || 'Type your prompt'}</div>
            <div
              style={{
                ...row,
                gap: 16,
                border: `3px solid ${ink}`,
                borderRadius: 20,
                padding: '22px 24px',
                fontSize: 30,
                minHeight: 96,
                background: softFill,
              }}
            >
              <span style={{ overflowWrap: 'anywhere' }}>
                {(data.prompt || note || 'Describe what you want to build').slice(0, Math.max(1, Math.floor(beat * 1.4)))}
                <span style={{ opacity: Math.floor(beat / 8) % 2 === 0 ? 1 : 0 }}>|</span>
              </span>
              <b style={{ background: accent, color: onAccent, padding: '10px 16px', borderRadius: 12, flexShrink: 0 }}>↑</b>
            </div>
            {data.badge && (
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ background: highlight, color: onHighlight, padding: '8px 18px', borderRadius: 14, fontSize: 22, fontWeight: 800 }}>
                  {data.badge}
                </span>
              </div>
            )}
          </div>
        )}

        {template === 'metric' && (
          <div>
            <div style={{ ...row, fontSize: 27, fontWeight: 800 }}>
              <span>{data.subtitle || data.title || 'Impact'}</span>
              <span style={{ background: highlight, color: onHighlight, padding: '8px 16px', borderRadius: 16, fontSize: 22 }}>
                {data.badge || 'LIVE'}
              </span>
            </div>
            <div style={{ fontSize: 78, fontWeight: 900, margin: '14px 0 18px', letterSpacing: -2 }}>
              {click ? (data.to || data.from || '3×') : (data.from || data.to || '1×')}
            </div>
            {(data.rows?.length ? data.rows : [[note.slice(0, 32) || 'Result', 'Updated']]).map(([label, value], i) => {
              const revealed = spring({ frame: Math.max(0, beat - i * 10), fps: 30, config: { damping: 16, stiffness: 160 } });
              return (
                <div
                  key={`${label}-${i}`}
                  style={{
                    ...row,
                    borderTop: `2px solid ${divider}`,
                    padding: '15px 0',
                    fontSize: 26,
                    fontWeight: 700,
                    opacity: revealed,
                    transform: `translateY(${(1 - revealed) * 14}px)`,
                  }}
                >
                  <span>{label}</span>
                  <span style={{ color: dark ? highlight : ink }}>{value}</span>
                </div>
              );
            })}
          </div>
        )}

        {template === 'checklist' && (
          <div style={{ display: 'grid', alignContent: 'center', height: '100%', gap: 8 }}>
            {(data.items?.length ? data.items : [note || 'Clear first step']).map((item, i) => {
              const active = beat > i * 10;
              return (
                <div
                  key={`${item}-${i}`}
                  style={{
                    ...row,
                    gap: 16,
                    borderBottom: `2px solid ${divider}`,
                    padding: '16px 8px',
                    fontSize: 30,
                    fontWeight: 800,
                    opacity: active ? 1 : 0.25,
                  }}
                >
                  <span>{item}</span>
                  <b
                    style={{
                      background: active ? highlight : softFill,
                      color: onHighlight,
                      borderRadius: 12,
                      padding: '4px 12px',
                      fontSize: 24,
                      flexShrink: 0,
                    }}
                  >
                    ✓
                  </b>
                </div>
              );
            })}
          </div>
        )}

        {template === 'compare' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, height: '100%' }}>
            <div style={{ background: softFill, border: `3px solid ${ink}`, borderRadius: 20, padding: 22, display: 'grid', alignContent: 'start', gap: 14 }}>
              <div style={{ fontSize: 26, fontWeight: 900, opacity: 0.72 }}>{data.leftTitle || 'Before'}</div>
              {(data.leftItems?.length ? data.leftItems : ['Manual work']).map((item, i) => (
                <div key={i} style={{ fontSize: 24, fontWeight: 700, opacity: 0.82 }}>✕ {item}</div>
              ))}
            </div>
            <div style={{ background: highlight, color: onHighlight, border: `3px solid ${ink}`, borderRadius: 20, padding: 22, display: 'grid', alignContent: 'start', gap: 14 }}>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{data.rightTitle || 'After'}</div>
              {(data.rightItems?.length ? data.rightItems : ['Automated']).map((item, i) => (
                <div key={i} style={{ fontSize: 24, fontWeight: 800, opacity: beat > i * 8 + 6 ? 1 : 0.3 }}>✓ {item}</div>
              ))}
            </div>
          </div>
        )}

        {template === 'flow' && (
          <div style={{ display: 'grid', alignContent: 'center', height: '100%', gap: 18 }}>
            {(data.items?.length ? data.items : ['Input', 'Process', 'Result']).map((step, i, arr) => {
              const active = beat > i * 11;
              return (
                <React.Fragment key={`${step}-${i}`}>
                  <div
                    style={{
                      ...row,
                      background: i === arr.length - 1 ? highlight : i === 0 ? accent : softFill,
                      color: i === 0 || i === arr.length - 1 ? onHighlight : ink,
                      border: `3px solid ${ink}`,
                      borderRadius: 18,
                      padding: '18px 24px',
                      fontSize: 29,
                      fontWeight: 900,
                      opacity: active ? 1 : 0.28,
                    }}
                  >
                    <span>{step}</span>
                    <span>{i === arr.length - 1 ? '✓' : '→'}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}

        {template === 'chat_bubble' && (
          <div style={{ display: 'grid', alignContent: 'center', height: '100%', gap: 18 }}>
            {(data.messages?.length ? data.messages : [{ sender: 'them' as const, text: note || 'How does this work?' }]).map((msg, i) => {
              const pop = spring({ frame: Math.max(0, beat - i * 14), fps: 30, config: { damping: 14, stiffness: 170 } });
              const mine = msg.sender === 'me';
              return (
                <div
                  key={i}
                  style={{
                    justifySelf: mine ? 'end' : 'start',
                    maxWidth: '86%',
                    background: mine ? highlight : softFill,
                    color: mine ? onHighlight : ink,
                    border: `3px solid ${ink}`,
                    borderRadius: 22,
                    padding: '18px 24px',
                    fontSize: 27,
                    fontWeight: 800,
                    transform: `scale(${0.75 + pop * 0.25})`,
                    opacity: pop,
                  }}
                >
                  {msg.text}
                </div>
              );
            })}
          </div>
        )}

        {template === 'steps' && (
          <div style={{ display: 'grid', alignContent: 'center', height: '100%', gap: 14 }}>
            {data.subtitle && <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 6 }}>{data.subtitle}</div>}
            {(data.items?.length ? data.items : [note || 'Start here']).map((item, i, arr) => {
              const highlightRow = beat > i * 12 && (i === arr.length - 1 || beat <= (i + 1) * 12);
              return (
                <div
                  key={`${item}-${i}`}
                  style={{
                    background: highlightRow ? highlight : softFill,
                    color: highlightRow ? onHighlight : ink,
                    border: highlightRow ? `3px solid ${ink}` : '3px solid transparent',
                    padding: '16px 22px',
                    borderRadius: 16,
                    fontSize: 28,
                    fontWeight: 800,
                  }}
                >
                  {i + 1}. {item}
                </div>
              );
            })}
          </div>
        )}

        {template === 'cta_click' && (
          <div style={{ display: 'grid', placeItems: 'center', alignContent: 'center', height: '100%', textAlign: 'center', gap: 18 }}>
            <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1.08 }}>{data.title || 'Ready to try?'}</div>
            <div style={{ fontSize: 28, opacity: 0.8 }}>{data.subtitle || note}</div>
            <div
              style={{
                display: 'inline-block',
                background: click ? highlight : accent,
                color: onHighlight,
                border: `3px solid ${ink}`,
                padding: '20px 44px',
                borderRadius: 18,
                fontSize: 36,
                fontWeight: 900,
                transform: `scale(${click && beat < 52 ? 0.94 : 1})`,
              }}
            >
              {click ? (data.doneLabel || '✓ Done') : (data.button || 'Get started →')}
            </div>
            <svg
              width="58"
              height="64"
              viewBox="0 0 50 55"
              style={{
                position: 'absolute',
                left: 340 + cursor * 70,
                top: 320 + cursor * 22,
                transform: `scale(${click && beat < 52 ? 0.8 : 1})`,
              }}
            >
              <path d="M4 3L43 32L25 33L17 50Z" fill="white" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
            </svg>
            {click && beat < 66 && (
              <div
                style={{
                  position: 'absolute',
                  left: 416,
                  top: 348,
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  border: `5px solid ${accent}`,
                  transform: `translate(-50%,-50%) scale(${1 + (beat - 46) / 7})`,
                  opacity: Math.max(0, 1 - (beat - 46) / 20),
                }}
              />
            )}
          </div>
        )}

        {template === 'key_idea' && (
          <div style={{ display: 'grid', alignContent: 'center', height: '100%', gap: 24 }}>
            <span
              style={{
                fontSize: 40,
                width: 88,
                textAlign: 'center',
                padding: '12px 0',
                background: highlight,
                color: onHighlight,
                border: `3px solid ${ink}`,
                borderRadius: 18,
              }}
            >
              {data.icon || '↗'}
            </span>
            <b style={{ fontSize: 42, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{data.subtitle || note}</b>
            <div style={{ height: 12, width: `${Math.min(100, beat * 1.8)}%`, background: accent, borderRadius: 8 }} />
          </div>
        )}
      </div>
    </div>
  );
}
