import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MOTION_SOUNDS, motionSoundPath } from './motion-sfx.js';
import { formatSfxCredits, resolveOpenverseSfx, type OpenverseSfxEntry } from './openverse-sfx.js';
import { atomicWriteJson, type Project, type Word } from './project-store.js';

export const stickFaces = ['neutral', 'happy', 'surprised', 'thinking', 'smirk'] as const;
export type StickFace = typeof stickFaces[number];

export const stickPoses = [
  'point_stage',
  'present_both',
  'think_chin',
  'shrug',
  'celebrate',
  'arms_crossed',
  'lean_in',
  'wave',
  'phone_call',
  'typing',
  'facepalm',
  'thumbs_up',
  'hands_on_hips',
] as const;
export type StickPose = typeof stickPoses[number];

export const stickSides = ['left', 'right', 'center'] as const;
export type StickSide = typeof stickSides[number];

export const stickEnters = ['slide', 'pop', 'peek'] as const;
export type StickEnter = typeof stickEnters[number];

export const stickEnergies = ['calm', 'normal', 'hype'] as const;
export type StickEnergy = typeof stickEnergies[number];

export const stickTemplates = [
  'key_idea',
  'hero_icon',
  'metric',
  'checklist',
  'compare',
  'flow',
  'prompt_box',
  'chat_bubble',
  'steps',
  'cta_click',
] as const;
export type StickTemplateId = typeof stickTemplates[number];

export type StickTheme = {
  id: string;
  label: string;
  paper: string;
  ink: string;
  accent: string;
  highlight: string;
  surface: string;
};

export const STICK_THEMES: StickTheme[] = [
  { id: 'editorial', label: 'Paper & Ink', paper: '#f9f6ec', ink: '#172622', accent: '#ff8666', highlight: '#c9fb83', surface: '#fffdf7' },
  { id: 'dental', label: 'Clinical Mint', paper: '#f4fbf8', ink: '#102622', accent: '#20a388', highlight: '#d7f25b', surface: '#ffffff' },
  { id: 'physio', label: 'Cobalt Studio', paper: '#f5f7ff', ink: '#161f3d', accent: '#3f5bd8', highlight: '#c7d4ff', surface: '#ffffff' },
  { id: 'nutrition', label: 'Warm Saffron', paper: '#fdf8f0', ink: '#291c0e', accent: '#f4a93b', highlight: '#d5f296', surface: '#fffdf9' },
  { id: 'optometry', label: 'Violet Crisp', paper: '#faf6ff', ink: '#221433', accent: '#9a4fd0', highlight: '#e3c8ff', surface: '#ffffff' },
  { id: 'midnight', label: 'Midnight Tech', paper: '#11161c', ink: '#f2f5f7', accent: '#ff7854', highlight: '#b8ff6a', surface: '#1b232c' },
];

export type StickBeat = {
  at: number;
  wordId?: string;
  pose?: StickPose;
  face?: StickFace;
  sfx?: string;
  sfxQuery?: string;
  punch?: boolean;
};

export type StickSceneData = {
  title?: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  from?: string;
  to?: string;
  prompt?: string;
  button?: string;
  doneLabel?: string;
  leftTitle?: string;
  rightTitle?: string;
  leftItems?: string[];
  rightItems?: string[];
  items?: string[];
  rows?: Array<[string, string]>;
  messages?: Array<{ sender: 'them' | 'me'; text: string }>;
};

export type StickSceneV2 = {
  id: string;
  at: number;
  startWordId?: string;
  headline: string;
  note: string;
  template: StickTemplateId;
  data: StickSceneData;
  side: StickSide;
  enter: StickEnter;
  pose: StickPose;
  face: StickFace;
  energy: StickEnergy;
  sfx?: string;
  sfxQuery?: string;
  beats?: StickBeat[];
  /** Cinematic look. Index into draft.tracker (which of the 3 chapters this scene belongs to). */
  chapter?: number;
  /** Where the camera stands on the set, 0 (left edge) … 1 (right edge). */
  camera?: number;
  /** Other stick characters in this scene (from draft.cast), each with an optional speech bubble. */
  actors?: StickActor[];
  /** A speech bubble for the main figure. */
  myBubble?: StickTimedText;
  /** Big yellow box that slams in on a word ("60 DAYS", "NOT NORMAL"). */
  punchText?: StickTimedText;
  /** Index into draft.photos: a real photo shown framed in this scene. */
  photo?: number;
};

export type StickTimedText = { text: string; at: number; wordId?: string };
export type StickActor = { castId: string; pose: StickPose; bubble?: StickTimedText };
export type StickCastMember = { id: string; label: string };
export const stickStyles = ['cinematic', 'classic'] as const;
export type StickStyle = typeof stickStyles[number];

/** Legacy v1 tuple format retained for automatic migration of saved drafts & JSON imports. */
export type LegacyStickScene = [number, string, string, number, string];

export type StickDraft = {
  version: 2;
  badge: string;
  marquee: string;
  themeId: string;
  faces: string;
  scenes: StickSceneV2[];
  words: Word[];
  music: number;
  sfx: number;
  useOpenverse: boolean;
  notes?: string[];
  /** 'cinematic' = photo set + moving camera + cast (default for new reels); 'classic' = card layout. */
  style?: StickStyle;
  /** Three chapter labels shown as a progress tracker at the top, e.g. ["MYTH", "WHY", "FIX"]. */
  tracker?: string[];
  cast?: StickCastMember[];
  /** File names inside the project's stick-assets folder. */
  set?: string;
  photos?: string[];
  /** What the AI Director asked for, so the pictures can be (re)made. */
  setPrompt?: string;
  photoPrompts?: string[];
  /** What each picture is: a real photo, a screen capture (chat, search, app) or an article / notes clipping. */
  photoKinds?: StickPhotoKind[];
};
export const stickPhotoKinds = ['photo', 'screenshot', 'article'] as const;
export type StickPhotoKind = typeof stickPhotoKinds[number];

export type StickRender = {
  state: 'running' | 'ready' | 'failed';
  progress: number;
  stage?: string;
  url?: string;
  creditsUrl?: string;
  error?: string;
  /** The last finished video, kept while a newer render runs or after it is stopped. */
  last?: { url: string; creditsUrl?: string };
};

const root = path.resolve('remotion/stick-reel');
const assets = path.resolve('assets/stick-reel');
let vaapiWorks: boolean | undefined;
/** Upscale the 3/4-size drawing to 1080x1920: Intel Quick Sync (VAAPI) on Linux or VideoToolbox on a Mac when it works, else x264. */
async function upscaleTo1080(ffmpeg: (args: string[]) => Promise<unknown>, input: string, output: string) {
  const device = process.env.VIDEO_CLEANER_VAAPI_DEVICE || '/dev/dri/renderD128';
  if (process.platform === 'darwin' && vaapiWorks !== false && process.env.VIDEO_CLEANER_NO_HW_ENCODE !== '1') { // Mac: VideoToolbox
    try {
      await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'h264_videotoolbox', '-b:v', '16M', '-allow_sw', '1', '-pix_fmt', 'yuv420p', '-an', output]);
      vaapiWorks = true; return;
    } catch { vaapiWorks = false; }
  }
  if (process.platform !== 'darwin' && vaapiWorks !== false && process.env.VIDEO_CLEANER_NO_HW_ENCODE !== '1') {
    try {
      await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-vaapi_device', device, '-i', input, '-vf', 'format=nv12,hwupload,scale_vaapi=w=1080:h=1920:mode=hq', '-c:v', 'h264_vaapi', '-qp', '18', '-an', output]);
      vaapiWorks = true; return;
    } catch { vaapiWorks = false; }
  }
  await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', output]);
}

const draftPath = (project: Project) => path.join(project.workDir, 'stick-draft.json');
export const stickMusicPath = (project: Project) => path.join(project.workDir, 'stick-music.m4a');

export function resolveStickTheme(themeId?: string): StickTheme {
  return STICK_THEMES.find(theme => theme.id === themeId) ?? STICK_THEMES[0];
}

const LEGACY_MODE_MAP: Record<number, StickTemplateId> = {
  0: 'hero_icon',
  1: 'prompt_box',
  2: 'metric',
  3: 'cta_click',
  4: 'checklist',
  5: 'flow',
  6: 'steps',
  7: 'key_idea',
};

function isFace(value: unknown): value is StickFace {
  return typeof value === 'string' && (stickFaces as readonly string[]).includes(value);
}
function isPose(value: unknown): value is StickPose {
  return typeof value === 'string' && (stickPoses as readonly string[]).includes(value);
}
function isSide(value: unknown): value is StickSide {
  return typeof value === 'string' && (stickSides as readonly string[]).includes(value);
}
function isEnter(value: unknown): value is StickEnter {
  return typeof value === 'string' && (stickEnters as readonly string[]).includes(value);
}
function isEnergy(value: unknown): value is StickEnergy {
  return typeof value === 'string' && (stickEnergies as readonly string[]).includes(value);
}
function isTemplate(value: unknown): value is StickTemplateId {
  return typeof value === 'string' && (stickTemplates as readonly string[]).includes(value);
}

function clampString(value: unknown, max: number, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function sanitizeSceneData(raw: unknown): StickSceneData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const data: StickSceneData = {};
  if (typeof input.title === 'string' && input.title.trim()) data.title = input.title.trim().slice(0, 60);
  if (typeof input.subtitle === 'string' && input.subtitle.trim()) data.subtitle = input.subtitle.trim().slice(0, 100);
  if (typeof input.icon === 'string' && input.icon.trim()) data.icon = input.icon.trim().slice(0, 8);
  if (typeof input.badge === 'string' && input.badge.trim()) data.badge = input.badge.trim().slice(0, 24);
  if (typeof input.from === 'string' && input.from.trim()) data.from = input.from.trim().slice(0, 24);
  if (typeof input.to === 'string' && input.to.trim()) data.to = input.to.trim().slice(0, 24);
  if (typeof input.prompt === 'string' && input.prompt.trim()) data.prompt = input.prompt.trim().slice(0, 110);
  if (typeof input.button === 'string' && input.button.trim()) data.button = input.button.trim().slice(0, 40);
  if (typeof input.doneLabel === 'string' && input.doneLabel.trim()) data.doneLabel = input.doneLabel.trim().slice(0, 40);
  if (typeof input.leftTitle === 'string' && input.leftTitle.trim()) data.leftTitle = input.leftTitle.trim().slice(0, 32);
  if (typeof input.rightTitle === 'string' && input.rightTitle.trim()) data.rightTitle = input.rightTitle.trim().slice(0, 32);
  if (Array.isArray(input.items)) {
    const items = input.items.map(item => clampString(item, 60)).filter(Boolean).slice(0, 5);
    if (items.length) data.items = items;
  }
  if (Array.isArray(input.leftItems)) {
    const items = input.leftItems.map(item => clampString(item, 48)).filter(Boolean).slice(0, 4);
    if (items.length) data.leftItems = items;
  }
  if (Array.isArray(input.rightItems)) {
    const items = input.rightItems.map(item => clampString(item, 48)).filter(Boolean).slice(0, 4);
    if (items.length) data.rightItems = items;
  }
  if (Array.isArray(input.rows)) {
    const rows = input.rows
      .filter((row): row is [unknown, unknown] => Array.isArray(row) && row.length >= 2)
      .map(([k, v]): [string, string] => [clampString(k, 36), clampString(v, 24)])
      .filter(([k]) => Boolean(k))
      .slice(0, 4);
    if (rows.length) data.rows = rows;
  }
  if (Array.isArray(input.messages)) {
    const messages = input.messages
      .filter((m): m is { sender?: unknown; text?: unknown } => Boolean(m && typeof m === 'object'))
      .map(m => ({ sender: (m.sender === 'me' ? 'me' : 'them') as 'them' | 'me', text: clampString(m.text, 80) }))
      .filter(m => Boolean(m.text))
      .slice(0, 3);
    if (messages.length) data.messages = messages;
  }
  return data;
}

function upgradeScene(raw: unknown, index: number, duration: number): StickSceneV2 {
  if (Array.isArray(raw)) {
    if (raw.length !== 5) throw new Error(`Scene ${index + 1} must have five values.`);
    const [at, title, note, mode, face] = raw;
    if (!Number.isFinite(at) || at < 0 || at >= duration || typeof title !== 'string' || !title.trim() || title.length > 80 ||
      typeof note !== 'string' || note.length > 140 || !Number.isInteger(mode) || mode < 0 || mode > 7 || !isFace(face)) {
      throw new Error(`Check the timing, headline, preset and expression on scene ${index + 1}.`);
    }
    return {
      id: `sc-${index + 1}`,
      at: Number(at),
      headline: title.trim(),
      note: note.trim(),
      template: LEGACY_MODE_MAP[mode] ?? 'key_idea',
      data: { subtitle: note.trim() },
      side: index % 2 === 0 ? 'left' : 'right',
      enter: 'slide',
      pose: 'point_stage',
      face,
      energy: 'normal',
      sfx: 'whoosh-transitions-simple-whoosh-1',
    };
  }
  if (!raw || typeof raw !== 'object') throw new Error(`Scene ${index + 1} is invalid.`);
  const item = raw as Record<string, unknown>;
  const at = Number(item.at);
  const headline = clampString(item.headline, 80);
  const note = clampString(item.note, 140);
  if (!Number.isFinite(at) || at < 0 || at >= duration) {
    throw new Error(`Check the start time on scene ${index + 1} (must be between 0 and ${duration.toFixed(1)}s).`);
  }
  if (!headline) throw new Error(`Scene ${index + 1} needs a headline.`);
  const template: StickTemplateId = isTemplate(item.template) ? item.template : 'key_idea';
  const face: StickFace = isFace(item.face) ? item.face : 'neutral';
  const pose: StickPose = isPose(item.pose) ? item.pose : 'point_stage';
  const side: StickSide = isSide(item.side) ? item.side : (index % 2 === 0 ? 'left' : 'right');
  const enter: StickEnter = isEnter(item.enter) ? item.enter : 'slide';
  const energy: StickEnergy = isEnergy(item.energy) ? item.energy : 'normal';
  const beats: StickBeat[] | undefined = Array.isArray(item.beats)
    ? item.beats
      .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
      .map((b): StickBeat => ({
        at: Number(b.at),
        wordId: typeof b.wordId === 'string' ? b.wordId.slice(0, 64) : undefined,
        pose: isPose(b.pose) ? b.pose : undefined,
        face: isFace(b.face) ? b.face : undefined,
        sfx: typeof b.sfx === 'string' && b.sfx.trim() ? b.sfx.trim().slice(0, 80) : undefined,
        sfxQuery: typeof b.sfxQuery === 'string' && b.sfxQuery.trim() ? b.sfxQuery.trim().slice(0, 80) : undefined,
        punch: Boolean(b.punch),
      }))
      .filter(b => Number.isFinite(b.at) && b.at > at && b.at < duration)
      .slice(0, 4)
    : undefined;

  return {
    id: clampString(item.id, 40) || `sc-${index + 1}`,
    at: Math.round(at * 1000) / 1000,
    startWordId: typeof item.startWordId === 'string' ? item.startWordId.slice(0, 64) : undefined,
    headline,
    note,
    template,
    data: sanitizeSceneData(item.data),
    side,
    enter,
    pose,
    face,
    energy,
    sfx: typeof item.sfx === 'string' && item.sfx.trim() ? item.sfx.trim().slice(0, 80) : undefined,
    sfxQuery: typeof item.sfxQuery === 'string' && item.sfxQuery.trim() ? item.sfxQuery.trim().slice(0, 80) : undefined,
    ...(beats?.length ? { beats } : {}),
    ...cinematicSceneFields(item, at, duration),
  };
}

function timedText(raw: unknown, sceneAt: number, duration: number, max: number): StickTimedText | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const text = clampString(value.text, max);
  const at = Number(value.at);
  if (!text) return undefined;
  return { text, at: Number.isFinite(at) && at >= sceneAt && at < duration ? Math.round(at * 1000) / 1000 : sceneAt, ...(typeof value.wordId === 'string' ? { wordId: value.wordId.slice(0, 64) } : {}) };
}
function cinematicSceneFields(item: Record<string, unknown>, at: number, duration: number): Partial<StickSceneV2> {
  const out: Partial<StickSceneV2> = {};
  if (Number.isInteger(item.chapter) && Number(item.chapter) >= 0 && Number(item.chapter) < 3) out.chapter = Number(item.chapter);
  if (Number.isFinite(Number(item.camera)) && item.camera !== null && item.camera !== undefined) out.camera = Math.min(1, Math.max(0, Number(item.camera)));
  if (Array.isArray(item.actors)) {
    const actors = item.actors
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
      .map((a): StickActor => ({ castId: clampString(a.castId, 24), pose: isPose(a.pose) ? a.pose : 'present_both', ...(timedText(a.bubble, at, duration, 60) ? { bubble: timedText(a.bubble, at, duration, 60) } : {}) }))
      .filter((a) => Boolean(a.castId))
      .slice(0, 3);
    if (actors.length) out.actors = actors;
  }
  const mine = timedText(item.myBubble, at, duration, 60); if (mine) out.myBubble = mine;
  const punch = timedText(item.punchText, at, duration, 28); if (punch) out.punchText = punch;
  if (Number.isInteger(item.photo) && Number(item.photo) >= 0 && Number(item.photo) < 12) out.photo = Number(item.photo);
  return out;
}

export function makeStickDraft(words: Word[]): StickDraft {
  const scenes: StickSceneV2[] = [];
  let last = -4;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word.start - last < 3.6 || scenes.length >= 80) continue;
    const headline = words.slice(index, index + 4).map(item => item.text).join(' ').slice(0, 65);
    const note = words.slice(index, index + 9).map(item => item.text).join(' ').slice(0, 115);
    last = scenes.length ? word.start : 0;
    scenes.push({
      id: `sc-${scenes.length + 1}`,
      at: last,
      startWordId: word.id,
      headline,
      note,
      template: 'key_idea',
      data: { subtitle: note },
      side: scenes.length % 2 === 0 ? 'left' : 'right',
      enter: 'slide',
      pose: scenes.length === 0 ? 'wave' : 'point_stage',
      face: stickFaces[scenes.length % stickFaces.length],
      energy: 'normal',
      sfx: 'whoosh-transitions-simple-whoosh-1',
    });
  }
  return {
    version: 2,
    badge: 'QUICK EXPLAINER',
    marquee: 'EXPLAIN / VISUALIZE / SHIP',
    themeId: 'editorial',
    faces: 'stick-demo',
    scenes: scenes.length ? scenes : [{
      id: 'sc-1',
      at: 0,
      headline: 'Your opening hook',
      note: 'Transcribe and click AI Plan Reel to generate dynamic scenes',
      template: 'key_idea',
      data: { subtitle: 'Transcribe and click AI Plan Reel to generate dynamic scenes' },
      side: 'left',
      enter: 'slide',
      pose: 'wave',
      face: 'neutral',
      energy: 'normal',
      sfx: 'whoosh-transitions-simple-whoosh-1',
    }],
    words,
    music: 0.25,
    sfx: 0.75,
    useOpenverse: true,
  };
}

export function validateStickDraft(value: unknown, duration: number): StickDraft {
  if (!value || typeof value !== 'object') {
    throw new Error('Provide a valid stick-figure reel draft.');
  }
  const input = value as Record<string, unknown>;
  const music = Number(input.music ?? 0.25);
  const sfx = Number(input.sfx ?? 0.75);
  if (!Array.isArray(input.scenes) || !input.scenes.length || input.scenes.length > 100 ||
    !Array.isArray(input.words) || input.words.length > 4000 ||
    ![music, sfx].every(gain => Number.isFinite(gain) && gain >= 0 && gain <= 1)) {
    throw new Error('Provide 1–100 scenes, up to 4,000 caption words, and mix levels between 0 and 1.');
  }
  const scenes = input.scenes.map((scene, i) => upgradeScene(scene, i, duration));
  for (let i = 0; i < scenes.length; i++) {
    if (i === 0 ? scenes[i].at !== 0 : scenes[i].at <= scenes[i - 1].at) {
      throw new Error(`Check the timing on scene ${i + 1}: scene 1 must start at 0s and each following scene must start later than the previous one.`);
    }
  }
  const rawWords = input.words;
  const words = rawWords.map((rawWord, i) => {
    const word = rawWord as Record<string, unknown>;
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!word || typeof word.text !== 'string' || !word.text.trim() || word.text.length > 100 ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
      start >= duration || end < start || (i && start < Number((rawWords[i - 1] as Record<string, unknown>).start))) {
      throw new Error(`Check the caption word at position ${i + 1}.`);
    }
    return {
      id: typeof word.id === 'string' ? word.id.slice(0, 100) : String(i),
      text: word.text.trim(),
      start,
      end: Math.min(end, duration),
    };
  });

  const themeId = STICK_THEMES.some(t => t.id === input.themeId) ? String(input.themeId) : 'editorial';
  const faces = typeof input.faces === 'string' && /^[a-z0-9_-]{1,40}$/i.test(input.faces.trim()) ? input.faces.trim() : 'stick-demo';

  return {
    version: 2,
    badge: clampString(input.badge, 32, 'QUICK EXPLAINER') || 'QUICK EXPLAINER',
    marquee: clampString(input.marquee, 48, 'EXPLAIN / VISUALIZE / SHIP') || 'EXPLAIN / VISUALIZE / SHIP',
    themeId,
    faces,
    scenes,
    words,
    music,
    sfx,
    useOpenverse: input.useOpenverse !== false,
    ...(Array.isArray(input.notes) ? { notes: input.notes.map(n => clampString(n, 200)).filter(Boolean).slice(0, 10) } : {}),
    style: input.style === 'classic' ? 'classic' : input.style === 'cinematic' ? 'cinematic' : undefined,
    ...(Array.isArray(input.tracker) ? { tracker: input.tracker.map(n => clampString(n, 18).toUpperCase()).filter(Boolean).slice(0, 3) } : {}),
    ...(Array.isArray(input.cast) ? { cast: input.cast.filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object')).map((c) => ({ id: clampString(c.id, 24), label: clampString(c.label, 20).toUpperCase() })).filter((c) => c.id && c.label).slice(0, 4) } : {}),
    ...(typeof input.set === 'string' && /^[\w.-]{1,80}$/.test(input.set) ? { set: input.set } : {}),
    ...(Array.isArray(input.photos) ? { photos: input.photos.filter((p): p is string => typeof p === 'string' && /^[\w.-]{1,80}$/.test(p)).slice(0, 12) } : {}),
    ...(typeof input.setPrompt === 'string' && input.setPrompt.trim() ? { setPrompt: input.setPrompt.trim().slice(0, 1200) } : {}),
    ...(Array.isArray(input.photoPrompts) ? { photoPrompts: input.photoPrompts.map(p => clampString(p, 600)).filter(Boolean).slice(0, 6) } : {}),
    ...(Array.isArray(input.photoKinds) ? { photoKinds: input.photoKinds.slice(0, 6).map((k): StickPhotoKind => (stickPhotoKinds as readonly unknown[]).includes(k) ? k as StickPhotoKind : 'photo') } : {}),
  };
}

/** Folder for a stick reel's generated pictures (set + cut-out photos). */
export const stickAssetsDir = (project: Project) => path.join(project.workDir, 'stick-assets');

export async function loadStickDraft(project: Project) {
  const stored = await fs.readFile(draftPath(project), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  return stored ? validateStickDraft(JSON.parse(stored), project.media.duration) : makeStickDraft(project.transcript?.words ?? []);
}

export async function saveStickDraft(project: Project, input: unknown) {
  const draft = validateStickDraft(input, project.media.duration);
  await atomicWriteJson(draftPath(project), draft);
  return draft;
}

/** Lists available face packs under `remotion/stick-reel/local/<pack>/` that have all 5 expression PNGs. */
export async function listStickFacePacks(): Promise<string[]> {
  const localDir = path.join(root, 'local');
  const entries = await fs.readdir(localDir, { withFileTypes: true }).catch(() => []);
  const valid: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const ok = await Promise.all(stickFaces.map(face => fs.access(path.join(localDir, entry.name, `${face}.png`))))
      .then(() => true, () => false);
    if (ok) valid.push(entry.name);
  }
  return valid;
}

let bundled: { mtime: number; promise: Promise<string> } | undefined;

async function remotionSourceMtime(): Promise<number> {
  const files = await fs.readdir(root).catch(() => []);
  let max = 0;
  for (const name of files) {
    if (!/\.(tsx?|css)$/.test(name)) continue;
    const stat = await fs.stat(path.join(root, name)).catch(() => null);
    if (stat && stat.mtimeMs > max) max = stat.mtimeMs;
  }
  return max;
}

async function syncStickFonts() {
  const srcDir = path.resolve('remotion/captions/public/fonts');
  const destDir = path.join(root, 'local', 'fonts');
  await fs.mkdir(destDir, { recursive: true });
  for (const file of ['PlusJakartaSans-VF.ttf', 'AnekMalayalam-VF.ttf']) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    const hasDest = await fs.access(dest).then(() => true, () => false);
    if (!hasDest && await fs.access(src).then(() => true, () => false)) {
      await fs.copyFile(src, dest);
    }
  }
}

async function stickBundle(facePack: string) {
  const packDir = path.join(root, 'local', facePack);
  await Promise.all(stickFaces.map(face => fs.access(path.join(packDir, `${face}.png`))))
    .catch(() => { throw new Error(`Add the five expression PNGs (${stickFaces.join(', ')}) to remotion/stick-reel/local/${facePack}/`); });
  await syncStickFonts();

  const mtime = await remotionSourceMtime();
  if (!bundled || bundled.mtime !== mtime) {
    const promise = (async () => {
      const { bundle } = await import('@remotion/bundler');
      return bundle({ entryPoint: path.join(root, 'index.tsx'), publicDir: path.join(root, 'local') });
    })().catch(error => {
      bundled = undefined;
      throw error;
    });
    bundled = { mtime, promise };
  }
  return bundled.promise;
}

export type ResolvedSfxCue = {
  at: number;
  filePath: string;
  lead: number;
  sourceOffset: number;
  clipDuration: number;
  gain: number;
  credit?: OpenverseSfxEntry;
};

const LEGACY_LOCAL_SFX = new Set(['sweep', 'pop', 'chime']);
const MOTION_SFX_MAP = new Map(MOTION_SOUNDS.map(entry => [entry.id, entry]));

export async function resolveSingleSfx(
  cue: { at: number; sfx?: string; sfxQuery?: string; gainScale: number },
  options: { useOpenverse: boolean; runFfmpeg: (args: string[]) => Promise<{ stdout: string; stderr: string }> },
): Promise<ResolvedSfxCue | null> {
  const computeLevel = (loudnessDb: number, peakDb: number, targetDb: number) => {
    const byRms = 10 ** ((targetDb - loudnessDb) / 20);
    const byPeak = 10 ** ((-3 - peakDb) / 20);
    return Math.max(0.04, Math.min(1, byRms, byPeak)) * cue.gainScale;
  };

  // 1. If an Openverse foley query is specified and enabled, try Openverse first (cached locally).
  if (options.useOpenverse && cue.sfxQuery) {
    const resolved = await resolveOpenverseSfx(cue.sfxQuery, { runFfmpeg: options.runFfmpeg });
    if (resolved) {
      const { entry, path: filePath } = resolved;
      const peak = Math.min(Math.max(entry.peakTime, 0), entry.duration);
      const lead = Math.min(peak, 1.5);
      const tail = Math.min(Math.max(0.15, entry.duration - peak), 2.0);
      return {
        at: cue.at,
        filePath,
        lead,
        sourceOffset: Math.max(0, peak - lead),
        clipDuration: Math.min(2.5, lead + tail),
        gain: computeLevel(entry.loudnessDb, entry.peakDb, -24),
        credit: entry,
      };
    }
  }

  // 2. Local peak-analyzed motion-sfx library (VideoEditingSFX / Real SFX packs).
  const id = cue.sfx?.trim();
  if (id && MOTION_SFX_MAP.has(id)) {
    const entry = MOTION_SFX_MAP.get(id)!;
    const filePath = motionSoundPath(id);
    if (await fs.access(filePath).then(() => true, () => false)) {
      const peak = Math.min(Math.max(entry.peakTime ?? 0, 0), entry.duration);
      const lead = Math.min(peak, 1.6);
      const tail = Math.min(Math.max(0.15, entry.duration - peak), 2.0);
      return {
        at: cue.at,
        filePath,
        lead,
        sourceOffset: Math.max(0, peak - lead),
        clipDuration: Math.min(2.5, lead + tail),
        gain: computeLevel(entry.loudnessDb ?? -20, entry.peakDb ?? -3, -25),
      };
    }
  }

  // 3. Legacy stick-reel local clips (sweep, pop, chime) with graceful fallback.
  const legacyName = id && LEGACY_LOCAL_SFX.has(id) ? id : 'pop';
  const legacyPath = path.join(assets, `${legacyName}.mp3`);
  if (await fs.access(legacyPath).then(() => true, () => false)) {
    const clipDuration = legacyName === 'chime' ? 0.6 : legacyName === 'sweep' ? 0.4 : 0.22;
    return {
      at: cue.at,
      filePath: legacyPath,
      lead: 0,
      sourceOffset: 0,
      clipDuration,
      gain: 0.16 * cue.gainScale,
    };
  }

  // 4. Final fallback to a guaranteed UI sound from motion-sfx if available.
  const fallbackEntry = MOTION_SFX_MAP.get('ui-pop-sound') ?? MOTION_SOUNDS[0];
  if (fallbackEntry) {
    const filePath = motionSoundPath(fallbackEntry.id);
    if (await fs.access(filePath).then(() => true, () => false)) {
      return {
        at: cue.at,
        filePath,
        lead: 0,
        sourceOffset: 0,
        clipDuration: Math.min(0.5, fallbackEntry.duration),
        gain: computeLevel(fallbackEntry.loudnessDb ?? -20, fallbackEntry.peakDb ?? -3, -26),
      };
    }
  }

  return null;
}

export async function renderStickReel(options: {
  project: Project;
  draft: StickDraft;
  visual: string;
  output: string;
  creditsPath?: string;
  chromeBin?: string | null;
  ffmpeg: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  progress: (value: number, stage?: string) => void;
  signal?: AbortSignal;
  /** URL the renderer's browser can load stick-assets files from (the app itself, on this computer). */
  assetBase?: string;
}) {
  const { project, draft, visual, output, progress, ffmpeg, signal } = options;
  const stopped = () => { if (signal?.aborted) throw new Error('Stopped.'); };
  const theme = resolveStickTheme(draft.themeId);

  // Pre-flight check: verify music track exists before spending time on Remotion render.
  const customMusic = stickMusicPath(project);
  const defaultMusic = path.join(assets, 'tech-bed.mp3');
  const track = await fs.access(customMusic).then(() => customMusic, () => defaultMusic);
  const hasMusic = draft.music > 0 && await fs.access(track).then(() => true, () => false);

  // Pre-flight check + resolve SFX cues (including Openverse search & local caching) before video render.
  progress(0.02, 'Resolving sound effects…');
  const rawCues: Array<{ at: number; sfx?: string; sfxQuery?: string; gainScale: number }> = [];
  if (draft.sfx > 0) {
    for (let i = 0; i < draft.scenes.length; i++) {
      const scene = draft.scenes[i];
      if (i > 0 || scene.sfx || scene.sfxQuery) {
        rawCues.push({
          at: scene.at,
          sfx: scene.sfx || 'whoosh-transitions-simple-whoosh-1',
          sfxQuery: scene.sfxQuery,
          gainScale: i === 0 ? 0.85 : 0.9,
        });
      }
      // Cinematic accents: an impact under each punch box, a soft pop for each speech bubble.
      if (scene.punchText) rawCues.push({ at: scene.punchText.at, sfx: 'impacts-deep-hit-2', gainScale: 1.1 });
      for (const bubble of [scene.myBubble, ...(scene.actors ?? []).map((a) => a.bubble)]) {
        if (bubble && bubble.at > scene.at + 0.2) rawCues.push({ at: bubble.at, sfx: 'ui-pop-sound', gainScale: 0.7 });
      }
      for (const beat of scene.beats ?? []) {
        if (beat.sfx || beat.sfxQuery) {
          rawCues.push({
            at: beat.at,
            sfx: beat.sfx,
            sfxQuery: beat.sfxQuery,
            gainScale: beat.punch ? 1.15 : 0.95,
          });
        }
      }
    }
  }

  // Enforce restraint: sort chronologically, keep >= 0.45s apart, cap at 48 cues to keep FFmpeg fast.
  rawCues.sort((a, b) => a.at - b.at);
  const spacedCues: typeof rawCues = [];
  for (const cue of rawCues) {
    if (spacedCues.length >= 48) break;
    const prev = spacedCues.at(-1);
    if (prev && cue.at - prev.at < 0.45) continue;
    spacedCues.push(cue);
  }

  const resolvedCues: ResolvedSfxCue[] = [];
  for (const cue of spacedCues) {
    const resolved = await resolveSingleSfx(cue, { useOpenverse: draft.useOpenverse, runFfmpeg: ffmpeg });
    if (resolved) resolvedCues.push(resolved);
  }

  // Write credits.txt if any Openverse clip was used.
  const openverseCredits = resolvedCues.map(c => c.credit).filter((c): c is OpenverseSfxEntry => Boolean(c));
  let wroteCredits = false;
  if (openverseCredits.length && options.creditsPath) {
    await fs.writeFile(options.creditsPath, formatSfxCredits(openverseCredits), 'utf8');
    wroteCredits = true;
  }

  progress(0.05, 'Bundling Remotion composition…');
  stopped();
  const { selectComposition, renderMedia, makeCancelSignal } = await import('@remotion/renderer');
  const cancel = makeCancelSignal(); signal?.addEventListener('abort', () => cancel.cancel(), { once: true });
  const serveUrl = await stickBundle(draft.faces || 'stick-demo');
  const inputProps = {
    scenes: draft.scenes,
    words: draft.words,
    duration: project.media.duration,
    faces: draft.faces || 'stick-demo',
    badge: draft.badge,
    marquee: draft.marquee,
    theme,
    style: draft.style ?? 'classic',
    tracker: draft.tracker ?? [],
    cast: draft.cast ?? [],
    setUrl: draft.set && options.assetBase ? `${options.assetBase}/${draft.set}` : undefined,
    photoUrls: (draft.photos ?? []).map((name) => (options.assetBase ? `${options.assetBase}/${name}` : '')).filter(Boolean),
    photoKinds: draft.photoKinds ?? [],
  };
  const browserExecutable = options.chromeBin || undefined;
  const composition = await selectComposition({ serveUrl, id: 'ReelStudio', inputProps, browserExecutable });

  // Speed (measured on the HD 520 laptop, 57 s cinematic reel): Chrome drawing with the Intel GPU ('angle') is 1.5x
  // faster than its default software drawing, and drawing at 3/4 size then upscaling to 1080x1920 is another 1.5x,
  // with no visible difference after upscaling. STICK_RENDER_GL=off / STICK_RENDER_SCALE=1 turn these off.
  const gl = process.env.STICK_RENDER_GL === 'off' ? undefined : (process.env.STICK_RENDER_GL || 'angle') as 'angle';
  const scale = Math.min(1, Math.max(0.5, Number(process.env.STICK_RENDER_SCALE) || 0.75));
  const drawn = scale < 1 ? visual.replace(/\.mp4$/, '.small.mp4') : visual;
  const draw = (withGl: typeof gl) => renderMedia({
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    codec: 'h264',
    muted: true,
    scale,
    chromiumOptions: withGl ? { gl: withGl } : undefined,
    outputLocation: drawn,
    cancelSignal: cancel.cancelSignal,
    onProgress: ({ progress: fraction }) => progress(0.08 + fraction * 0.78, `Rendering frames (${Math.round(fraction * 100)}%)…`),
  });
  try { await draw(gl); } catch (error) {
    if (signal?.aborted || !gl) throw error;
    console.error('[stick render] GPU drawing failed, retrying without it:', error instanceof Error ? error.message : error);
    await draw(undefined);
  }
  if (drawn !== visual) {
    stopped();
    progress(0.87, 'Sharpening to 1080p…');
    await upscaleTo1080(ffmpeg, drawn, visual);
    await fs.rm(drawn, { force: true });
  }

  stopped();
  progress(0.90, 'Mastering audio & mixing SFX…');
  const duration = composition.durationInFrames / 30;
  const fade = Math.min(1.4, duration / 4);

  // Deduplicate SFX files so FFmpeg opens each unique sound file once and splits it.
  const uniqueSfxFiles = [...new Set(resolvedCues.map(c => c.filePath))];
  const fileIndexMap = new Map(uniqueSfxFiles.map((file, idx) => [file, idx]));

  const inputs: string[] = ['-i', visual, '-i', project.sourcePath];
  const musicInputIdx = hasMusic ? 2 : -1;
  if (hasMusic) inputs.push('-stream_loop', '-1', '-i', track);
  const sfxBaseIdx = hasMusic ? 3 : 2;
  for (const file of uniqueSfxFiles) inputs.push('-i', file);

  const filter: string[] = [];

  // Vocal mastering chain: clean low-end rumble, gentle compression for even presence, stereo 48k.
  if (hasMusic) {
    filter.push(
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=10:release=120:makeup=2,apad,atrim=duration=${duration},asplit=2[voice][key]`,
      `[${musicInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${draft.music},atrim=duration=${duration},afade=t=in:d=${(fade / 3).toFixed(3)},afade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade.toFixed(3)}[bed]`,
      '[bed][key]sidechaincompress=threshold=.035:ratio=5:attack=22:release=320[music]',
    );
  } else {
    filter.push(
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=10:release=120:makeup=2,apad,atrim=duration=${duration}[voice]`,
    );
  }

  // Group cues by unique file to use `asplit` cleanly.
  const cuesByFile = new Map<number, Array<{ cue: ResolvedSfxCue; idx: number }>>();
  resolvedCues.forEach((cue, idx) => {
    const fIdx = fileIndexMap.get(cue.filePath)!;
    const list = cuesByFile.get(fIdx) ?? [];
    list.push({ cue, idx });
    cuesByFile.set(fIdx, list);
  });

  for (const [fIdx, list] of cuesByFile) {
    const inputStream = `[${sfxBaseIdx + fIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo`;
    if (list.length > 1) {
      filter.push(`${inputStream},asplit=${list.length}${list.map(item => `[s${item.idx}]`).join('')}`);
    } else {
      filter.push(`${inputStream}[s${list[0].idx}]`);
    }
    for (const { cue, idx } of list) {
      const startMs = Math.max(0, Math.round((cue.at - cue.lead) * 1000));
      const clipEnd = cue.sourceOffset + cue.clipDuration;
      const fadeOutStart = Math.max(0, cue.clipDuration * 0.75);
      const fadeOutDur = Math.max(0.02, cue.clipDuration * 0.25);
      const gain = Math.max(0.01, Math.min(1, cue.gain * draft.sfx));
      filter.push(
        `[s${idx}]atrim=start=${cue.sourceOffset.toFixed(3)}:end=${clipEnd.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)},volume=${gain.toFixed(4)},adelay=${startMs}:all=1[e${idx}]`,
      );
    }
  }

  const mixInputs = ['[voice]', ...(hasMusic ? ['[music]'] : []), ...resolvedCues.map((_, i) => `[e${i}]`)];
  if (mixInputs.length === 1) {
    filter.push('[voice]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=.95:level=0:latency=1[a]');
  } else {
    filter.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=.95:level=0:latency=1[a]`);
  }

  await ffmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', filter.join(';'),
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
    '-movflags', '+faststart', output,
  ]);

  progress(0.99, 'Finalizing…');
  return { wroteCredits, openverseCount: openverseCredits.length };
}
