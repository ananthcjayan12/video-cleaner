/**
 * Each clinic's brand theme for reel graphics: colours, fonts, logo text, tagline and the face/avatar badge, so reels
 * match the clinic's own Instagram posts. Stored per account outside the repo:
 *   ~/.video-cleaner/brands/<workspaceId>/theme.json   (BrandTheme fields, all optional)
 *   ~/.video-cleaner/brands/<workspaceId>/avatar.png   (round, transparent; used as watermark and in graphics)
 * An account without a theme gets one built from its niche pack's colours.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NichePack } from './niche-packs.js';

/** Mirrors BrandTheme in remotion/captions/src/Graphics.tsx. */
export type BrandTheme = {
  dark: string; deep: string; ribbon: string; glow: string; soft: string; card: string; onDark: string; onRibbon?: string;
  display: string; script: string;
  logo?: { above?: string; name: string; below?: string };
  tagline?: string;
  /** data: URI of the avatar badge (filled in when loading; theme.json does not store it). */
  avatar?: string;
};

export const BRAND_FONTS = {
  rounded: "'VC Baloo Chettan', 'Noto Color Emoji', sans-serif",
  script: "'VC Dancing Script', cursive",
};

export const brandsDir = () => process.env.VIDEO_CLEANER_BRANDS_DIR || path.join(os.homedir(), '.video-cleaner', 'brands');
const safeId = (workspaceId: string) => workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
export const brandDir = (workspaceId: string) => path.join(brandsDir(), safeId(workspaceId));

const HEX = /^#[0-9a-fA-F]{6}$/;
const colourKeys = ['dark', 'deep', 'ribbon', 'glow', 'soft', 'card', 'onDark', 'onRibbon'] as const;

/** A theme from the niche pack alone (accounts that have not set up their own look yet). */
export function packTheme(pack: NichePack): BrandTheme {
  return { dark: '#0B0D0C', deep: '#14181A', ribbon: pack.accent, glow: pack.highlight, soft: pack.highlight, card: '#FFFFFF', onDark: '#FFFFFF', onRibbon: pack.onAccent,
    display: BRAND_FONTS.rounded, script: BRAND_FONTS.script };
}

/** The account's theme (theme.json over the pack theme) with its avatar badge, if it has one. */
export async function loadBrandTheme(workspaceId: string | undefined, pack: NichePack): Promise<BrandTheme> {
  const theme = packTheme(pack);
  if (!workspaceId) return theme;
  const dir = brandDir(workspaceId);
  const saved = await fs.readFile(path.join(dir, 'theme.json'), 'utf8').then((text) => JSON.parse(text) as Partial<BrandTheme>, () => null);
  if (saved) {
    for (const key of colourKeys) if (typeof saved[key] === 'string' && HEX.test(saved[key]!)) theme[key] = saved[key]!;
    if (saved.display === 'rounded' || saved.display === BRAND_FONTS.rounded) theme.display = BRAND_FONTS.rounded;
    if (saved.logo && typeof saved.logo.name === 'string') theme.logo = { above: saved.logo.above?.slice(0, 40), name: saved.logo.name.slice(0, 40), below: saved.logo.below?.slice(0, 40) };
    if (typeof saved.tagline === 'string') theme.tagline = saved.tagline.slice(0, 60);
  }
  const avatar = await fs.readFile(path.join(dir, 'avatar.png')).catch(() => null);
  if (avatar) theme.avatar = `data:image/png;base64,${avatar.toString('base64')}`;
  return theme;
}
