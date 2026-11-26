import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

const FONTS = [
  { family: 'Stick Jakarta', file: 'fonts/PlusJakartaSans-VF.ttf', weight: '200 800' },
  { family: 'Stick Anek', file: 'fonts/AnekMalayalam-VF.ttf', weight: '100 800' },
];

export const STICK_FONT_STACK = "'Stick Jakarta', 'Stick Anek', 'Plus Jakarta Sans', 'Malayalam Sangam MN', Arial, sans-serif";

let loading: Promise<void> | null = null;
let loaded = false;

function ensureFonts() {
  if (loaded) return Promise.resolve();
  if (!loading) {
    const handle = delayRender('Loading stick-reel fonts');
    loading = Promise.all(
      FONTS.map(async ({ family, file, weight }) => {
        try {
          const face = new FontFace(family, `url(${staticFile(file)})`, { weight });
          await face.load();
          document.fonts.add(face);
        } catch {
          // Gracefully fall back to system fonts if bundled fonts are not synced into publicDir.
        }
      }),
    ).finally(() => {
      loaded = true;
      continueRender(handle);
    });
  }
  return loading;
}

export function useStickFonts() {
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    if (!ready) void ensureFonts().then(() => setReady(true));
  }, [ready]);
  if (!loaded && typeof document !== 'undefined') void ensureFonts();
  return ready;
}
