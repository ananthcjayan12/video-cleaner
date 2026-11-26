import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { HookCaption } from './HookCaption';
import { ChatBubble } from './ChatBubble';
import { NameTag } from './NameTag';
import { CleanPop } from './CleanPop';
import { MinimalLower } from './MinimalLower';
import { GlassCard } from './GlassCard';
import { Thumbnail } from './Thumbnail';

const common = { width: 1080, height: 1920, fps: 30 } as const;

// Duration comes from inputProps.duration so one bundle serves every cue.
const Root: React.FC = () => (
  <>
    {/* Rendered as a short band (not full frame): far fewer pixels for Chromium and the VP9 alpha encode. */}
    <Composition id="MinimalLower" component={MinimalLower as React.ComponentType<any>} durationInFrames={90} fps={30} width={1080} height={200}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(Number((props as any).duration ?? 3) * 30) })}
      defaultProps={{ phrases: [], size: 50, width: 1080, height: 200, duration: 3 }} />
    <Composition id="GlassCard" component={GlassCard as React.ComponentType<any>} durationInFrames={90} fps={30} width={1080} height={300}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(Number((props as any).duration ?? 3) * 30) })}
      defaultProps={{ phrases: [], size: 46, duration: 3 }} />
    <Composition id="GlassCardStates" component={GlassCard as React.ComponentType<any>} durationInFrames={1} fps={30} width={1080} height={300}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, ((props as any).frameTimes ?? []).length) })}
      defaultProps={{ phrases: [], size: 46, frameTimes: [-1] }} />
    <Composition id="Thumbnail" component={Thumbnail as React.ComponentType<any>} durationInFrames={1} fps={30} width={1080} height={1920}
      defaultProps={{ image: '', lines: ['', '', ''], label: '', badges: [] }} />
    <Composition id="CleanPop" component={CleanPop as React.ComponentType<any>} durationInFrames={90} {...common}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(Number((props as any).duration ?? 3) * 30) })}
      defaultProps={{ phrases: [], y: 1180, size: 76, duration: 3 }} />
    <Composition id="HookCaption" component={HookCaption as React.ComponentType<any>} durationInFrames={90} {...common}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(Number((props as any).duration ?? 3) * 30) })}
      defaultProps={{ lines: [], y: 1000, size: 92, outAt: 2.6, duration: 3 }} />
    <Composition id="ChatBubble" component={ChatBubble as React.ComponentType<any>} durationInFrames={75} {...common}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(Number((props as any).duration ?? 2.5) * 30) })}
      defaultProps={{ text: '', name: '', x: 330, y: 1050, outAt: 2.2, duration: 2.5 }} />
    <Composition id="NameTag" component={NameTag as React.ComponentType<any>} durationInFrames={90} {...common}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(Number((props as any).duration ?? 3) * 30) })}
      defaultProps={{ text: '', x: 560, y: 1330, outAt: 2.7, duration: 3 }} />
  </>
);

registerRoot(Root);
