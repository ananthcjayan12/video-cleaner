import type { ReelLook } from '../api';

/** A small picture of how this account's reels look: the cover headline and a caption line, in the field's font and colours. */
export function LookPreview({ look, compact = false }: { look: ReelLook; compact?: boolean }) {
  const font = `'${look.font}', system-ui, sans-serif`;
  return (
    <div className={`pr-look${compact ? ' compact' : ''}`} aria-label={`${look.label} look: ${look.font}`}>
      <div className="pr-look-cover" style={{ fontFamily: font }}>
        <span>Is your</span>
        <span className="block" style={{ background: look.accent, color: look.onAccent }}>BIG TIP</span>
        <span>for today?</span>
        <em style={{ color: look.coverHighlight }}>SAVE THIS</em>
      </div>
      {!compact && (
        <div className="pr-look-side">
          <div className="pr-look-caption" style={{ fontFamily: font }}>Two minutes a day <b style={{ color: look.highlight }}>makes a difference</b></div>
          <small><strong>{look.label}</strong> · {look.font}</small>
          <small>Captions, cover and pictures in every reel use this look.</small>
        </div>
      )}
    </div>
  );
}
