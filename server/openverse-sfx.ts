import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from './project-store.js';

export type OpenverseSfxEntry = {
  id: string;
  title: string;
  query: string;
  file: string;
  source: string;
  license: string;
  licenseVersion?: string;
  creator?: string;
  attribution: string;
  foreignUrl?: string;
  duration: number;
  peakTime: number;
  peakDb: number;
  loudnessDb: number;
  cachedAt: string;
};

type CacheIndex = {
  version: 1;
  queries: Record<string, string>; // normalized query -> entry id
  entries: Record<string, OpenverseSfxEntry>;
};

const CACHE_DIR = path.resolve('assets/sfx-cache');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');
const OPENVERSE_API = 'https://api.openverse.org/v1/audio/';

function normalizeQuery(query: string) {
  return query.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function loadIndex(): Promise<CacheIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8')) as CacheIndex;
    if (parsed && parsed.version === 1 && parsed.entries && parsed.queries) return parsed;
  } catch { /* fresh cache */ }
  return { version: 1, queries: {}, entries: {} };
}

async function saveIndex(index: CacheIndex) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await atomicWriteJson(INDEX_PATH, index);
}

/** Measure duration, RMS loudness, peak dB, and approximate peak timestamp using FFmpeg. */
export async function analyzeAudioClip(
  filePath: string,
  runFfmpeg: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
): Promise<{ duration: number; peakTime: number; peakDb: number; loudnessDb: number }> {
  let duration = 1.0;
  let peakDb = -3;
  let loudnessDb = -18;
  let peakTime = 0.08;
  try {
    const { stderr } = await runFfmpeg([
      '-hide_banner', '-i', filePath,
      '-af', 'volumedetect',
      '-f', 'null', '-',
    ]);
    const durMatch = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
    if (durMatch) duration = Math.max(0.05, Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]));
    const maxMatch = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
    const meanMatch = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/i);
    if (maxMatch && Number.isFinite(Number(maxMatch[1]))) peakDb = Number(maxMatch[1]);
    if (meanMatch && Number.isFinite(Number(meanMatch[1]))) loudnessDb = Number(meanMatch[1]);
    // Short UI/foley one-shots generally peak right near the transient; risers peak later.
    peakTime = duration <= 0.6 ? Math.min(0.06, duration * 0.2) : Math.min(0.18, duration * 0.15);
  } catch { /* keep safe defaults */ }
  return {
    duration: Math.round(duration * 1000) / 1000,
    peakTime: Math.round(peakTime * 1000) / 1000,
    peakDb: Math.round(peakDb * 10) / 10,
    loudnessDb: Math.round(loudnessDb * 10) / 10,
  };
}

type OpenverseAudioResult = {
  id?: string;
  title?: string;
  url?: string;
  audio_set?: { title?: string };
  duration?: number; // milliseconds in Openverse API
  source?: string;
  license?: string;
  license_version?: string;
  creator?: string;
  attribution?: string;
  foreign_landing_url?: string;
  filetype?: string;
};

/**
 * Search Openverse for a short, commercially usable sound effect (CC0 / CC-BY / PDM from Freesound),
 * download it into `assets/sfx-cache/`, measure its loudness/peak with FFmpeg, and cache metadata.
 * Returns null gracefully when offline, rate-limited, or when no suitable short SFX is found.
 */
export async function resolveOpenverseSfx(
  query: string,
  options: {
    commercialOnly?: boolean;
    maxDurationSec?: number;
    runFfmpeg?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  } = {},
): Promise<{ path: string; entry: OpenverseSfxEntry } | null> {
  const clean = normalizeQuery(query);
  if (!clean) return null;

  const index = await loadIndex();
  const cachedId = index.queries[clean];
  if (cachedId && index.entries[cachedId]) {
    const entry = index.entries[cachedId];
    const cachedFile = path.join(CACHE_DIR, entry.file);
    if (await fs.stat(cachedFile).then(s => s.isFile() && s.size > 500).catch(() => false)) {
      return { path: cachedFile, entry };
    }
  }

  const maxMs = Math.round((options.maxDurationSec ?? 5) * 1000);
  const params = new URLSearchParams({
    q: clean,
    source: 'freesound',
    license: options.commercialOnly ? 'cc0,pdm' : 'cc0,by,pdm',
    length: 'shortest',
    page_size: '10',
  });

  let results: OpenverseAudioResult[] = [];
  try {
    const response = await fetch(`${OPENVERSE_API}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'video-cleaner-stick-reel/2.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { results?: OpenverseAudioResult[] };
    results = Array.isArray(body.results) ? body.results : [];
  } catch {
    return null;
  }

  // Prefer CC0 / PDM first, then shortest duration under maxMs with a valid audio URL.
  const candidates = results
    .filter(item => item.id && item.url && (!item.duration || item.duration <= maxMs))
    .sort((a, b) => {
      const aFree = a.license === 'cc0' || a.license === 'pdm' ? 0 : 1;
      const bFree = b.license === 'cc0' || b.license === 'pdm' ? 0 : 1;
      if (aFree !== bFree) return aFree - bFree;
      return (a.duration ?? 2000) - (b.duration ?? 2000);
    });

  const pick = candidates[0];
  if (!pick || !pick.id || !pick.url) return null;

  const ext = pick.filetype && /^[a-z0-9]{2,5}$/i.test(pick.filetype) ? `.${pick.filetype.toLowerCase()}` : '.mp3';
  const safeId = pick.id.replace(/[^a-z0-9_-]+/gi, '').slice(0, 48) || createHash('sha1').update(pick.url).digest('hex').slice(0, 16);
  const fileName = `ov-${safeId}${ext}`;
  const targetPath = path.join(CACHE_DIR, fileName);

  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    const audioRes = await fetch(pick.url, {
      headers: { 'User-Agent': 'video-cleaner-stick-reel/2.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!audioRes.ok) return null;
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    if (buffer.length < 500 || buffer.length > 8_000_000) return null;
    await fs.writeFile(targetPath, buffer);
  } catch {
    return null;
  }

  const metrics = options.runFfmpeg
    ? await analyzeAudioClip(targetPath, options.runFfmpeg)
    : { duration: (pick.duration ?? 1000) / 1000, peakTime: 0.08, peakDb: -3, loudnessDb: -18 };

  const attribution = (pick.attribution || `"${pick.title || clean}" by ${pick.creator || 'Unknown'} (${String(pick.license || 'cc0').toUpperCase()}) via Openverse / ${pick.source || 'freesound'}${pick.foreign_landing_url ? ` — ${pick.foreign_landing_url}` : ''}`).trim();

  const entry: OpenverseSfxEntry = {
    id: safeId,
    title: String(pick.title || clean).slice(0, 120),
    query: clean,
    file: fileName,
    source: String(pick.source || 'freesound'),
    license: String(pick.license || 'cc0'),
    licenseVersion: pick.license_version,
    creator: pick.creator,
    attribution,
    foreignUrl: pick.foreign_landing_url,
    ...metrics,
    cachedAt: new Date().toISOString(),
  };

  index.entries[safeId] = entry;
  index.queries[clean] = safeId;
  await saveIndex(index);

  return { path: targetPath, entry };
}

export function formatSfxCredits(entries: OpenverseSfxEntry[]): string {
  const unique = new Map<string, OpenverseSfxEntry>();
  for (const entry of entries) unique.set(entry.id, entry);
  if (!unique.size) return '';
  const lines = [
    'Audio & Sound Effects Credits (Openverse)',
    '=========================================',
    '',
    ...[...unique.values()].map(entry => `- ${entry.attribution}`),
    '',
  ];
  return lines.join('\n');
}
