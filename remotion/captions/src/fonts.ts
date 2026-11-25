import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

// Fonts ship with the templates so every machine renders the same glyphs.
// Latin falls through to Montserrat; Malayalam code points fall through to Noto Sans Malayalam.
const FONTS: Array<{ family: string; file: string; weight: string }> = [
  { family: 'VC Montserrat', file: 'fonts/Montserrat-VF.ttf', weight: '100 900' },
  { family: 'VC Malayalam Black', file: 'fonts/NotoSansMalayalam-Black.ttf', weight: '100 900' },
  { family: 'VC Malayalam Bold', file: 'fonts/NotoSansMalayalam-Bold.ttf', weight: '100 900' },
  { family: 'VC Jakarta', file: 'fonts/PlusJakartaSans-VF.ttf', weight: '200 800' },
  { family: 'VC Anek', file: 'fonts/AnekMalayalam-VF.ttf', weight: '100 800' },
  { family: 'VC Mono', file: 'fonts/NotoSansMono-ExtraBold.ttf', weight: '800' },
];

export const HEAVY_STACK = "'VC Montserrat', 'VC Malayalam Black', sans-serif";
export const BOLD_STACK = "'VC Montserrat', 'VC Malayalam Bold', sans-serif";
// Modern pairing: Plus Jakarta Sans for English, Anek Malayalam for Malayalam (Jakarta has no Malayalam glyphs, so they fall through).
export const MODERN_STACK = "'VC Jakarta', 'VC Anek', sans-serif";
export const MONO_STACK = "'VC Mono', 'VC Anek', monospace";

let ready: Promise<void> | null = null;
let isReady = false;
function loadFonts() {
  if (!ready) {
    const handle = delayRender('Loading caption fonts');
    ready = Promise.all(FONTS.map(async ({ family, file, weight }) => {
      const face = new FontFace(family, `url(${staticFile(file)})`, { weight });
      await face.load();
      document.fonts.add(face);
    })).then(() => {
      // A missing font would silently show tofu boxes; fail the render instead.
      for (const { family } of FONTS) if (!document.fonts.check(`700 40px '${family}'`)) throw new Error(`Font ${family} did not load`);
      isReady = true;
      continueRender(handle);
    });
  }
  return ready;
}

/** True once the bundled fonts are loaded; components render nothing until then so measurements are real. */
export function useBrandFonts() {
  const [loaded, setLoaded] = useState(isReady);
  useEffect(() => { if (!loaded) loadFonts().then(() => setLoaded(true)); }, [loaded]);
  if (!isReady && typeof document !== 'undefined') loadFonts();
  return loaded;
}

let canvas: HTMLCanvasElement | null = null;
/** Pixel width of text drawn with the given CSS font (uses the same fallback chain as the page). */
export function measure(text: string, font: string) {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  return ctx.measureText(text).width;
}
