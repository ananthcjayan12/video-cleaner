import type { StickDraft, StickEnergy, StickEnter, StickFace, StickPose, StickSceneV2, StickSide, StickTemplateId, StickTheme } from '../../server/stick-reel';

const TEMPLATES: Array<{ id: StickTemplateId; label: string }> = [
  { id: 'key_idea', label: 'Key idea' }, { id: 'hero_icon', label: 'Big icon' }, { id: 'metric', label: 'Number' },
  { id: 'checklist', label: 'Checklist' }, { id: 'compare', label: 'Before / after' }, { id: 'flow', label: 'Flow' },
  { id: 'prompt_box', label: 'Prompt box' }, { id: 'chat_bubble', label: 'Chat' }, { id: 'steps', label: 'Steps' }, { id: 'cta_click', label: 'Call to action' },
];
const POSES: Array<{ id: StickPose; label: string }> = [
  { id: 'point_stage', label: 'Point' }, { id: 'present_both', label: 'Present' }, { id: 'think_chin', label: 'Think' }, { id: 'shrug', label: 'Shrug' },
  { id: 'celebrate', label: 'Celebrate' }, { id: 'arms_crossed', label: 'Arms crossed' }, { id: 'lean_in', label: 'Lean in' }, { id: 'wave', label: 'Wave' },
  { id: 'phone_call', label: 'On the phone' }, { id: 'typing', label: 'Typing' }, { id: 'facepalm', label: 'Facepalm' }, { id: 'thumbs_up', label: 'Thumbs up' }, { id: 'hands_on_hips', label: 'Hands on hips' },
];
const FACES: StickFace[] = ['neutral', 'happy', 'surprised', 'thinking', 'smirk'];
const SIDES: StickSide[] = ['left', 'right', 'center'];
const ENTERS: StickEnter[] = ['slide', 'pop', 'peek'];
const ENERGIES: StickEnergy[] = ['calm', 'normal', 'hype'];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type Props = {
  draft: StickDraft; setDraft: (next: StickDraft) => void; duration: number; themes: StickTheme[]; facePacks: string[];
  customMusic: boolean; onPickMusic: () => void; onDefaultMusic: () => void; onSeek: (seconds: number) => void; disabled: boolean;
};

/** Scenes as simple cards (headline, words, card type); acting and sound tucked under "More". Then the look. */
export function SceneEditor({ draft, setDraft, duration, themes, facePacks, customMusic, onPickMusic, onDefaultMusic, onSeek, disabled }: Props) {
  const patch = (index: number, change: Partial<StickSceneV2>) => setDraft({ ...draft, scenes: draft.scenes.map((scene, i) => (i === index ? { ...scene, ...change } : scene)) });
  const remove = (index: number) => setDraft({ ...draft, scenes: draft.scenes.filter((_, i) => i !== index) });
  function add() {
    const last = draft.scenes.at(-1)?.at ?? 0; const at = Math.min(Math.max(0.2, duration - 0.5), Math.round((last + 2.5) * 100) / 100);
    if (at <= last) return;
    setDraft({ ...draft, scenes: [...draft.scenes, { id: `sc-${Date.now()}`, at, headline: 'New point', note: '', template: 'key_idea', data: {}, side: draft.scenes.length % 2 ? 'right' : 'left', enter: 'slide', pose: 'point_stage', face: 'neutral', energy: 'normal' }] });
  }

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="pr-card">
        <div className="pr-row" style={{ justifyContent: 'space-between' }}><h2>Scenes</h2><small className="muted">{draft.scenes.length} scenes · tap a time to play</small></div>
        {draft.scenes.map((scene, i) => (
          <div className="st-scene" key={scene.id || i}>
            <div className="head">
              <button type="button" className="time" onClick={() => onSeek(scene.at)}>▶ {clock(scene.at)}</button>
              <select className="grow" aria-label="Card type" value={scene.template} onChange={(e) => patch(i, { template: e.target.value as StickTemplateId })}>
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {i > 0 && <button type="button" className="pr-btn small text" aria-label="Remove scene" onClick={() => remove(i)}>Remove</button>}
            </div>
            <input aria-label="Headline" value={scene.headline} maxLength={80} onChange={(e) => patch(i, { headline: e.target.value })} />
            <input aria-label="Card text" value={scene.note} maxLength={140} placeholder="Card text (optional)" onChange={(e) => patch(i, { note: e.target.value })} />
            <details>
              <summary>More: timing, pose, face, sound</summary>
              <div className="st-grid">
                <label>Starts at (s)<input type="number" min="0" step="0.05" value={scene.at} disabled={i === 0} max={duration ? Number((duration - 0.1).toFixed(2)) : undefined} onChange={(e) => patch(i, { at: Math.max(0, Number(e.target.value)) })} /></label>
                <label>Pose<select value={scene.pose} onChange={(e) => patch(i, { pose: e.target.value as StickPose })}>{POSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label>Face<select value={scene.face} onChange={(e) => patch(i, { face: e.target.value as StickFace })}>{FACES.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
                <label>Side<select value={scene.side} onChange={(e) => patch(i, { side: e.target.value as StickSide })}>{SIDES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
                <label>Entrance<select value={scene.enter} onChange={(e) => patch(i, { enter: e.target.value as StickEnter })}>{ENTERS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
                <label>Energy<select value={scene.energy} onChange={(e) => patch(i, { energy: e.target.value as StickEnergy })}>{ENERGIES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 8 }}>Sound effect search (Openverse)
                <input value={scene.sfxQuery || ''} maxLength={80} placeholder="e.g. camera shutter" onChange={(e) => patch(i, { sfxQuery: e.target.value || undefined })} />
              </label>
            </details>
          </div>
        ))}
        <button type="button" className="pr-btn small" onClick={add}>+ Add scene</button>
      </section>

      <section className="pr-card st-look">
        <h2>Look &amp; sound</h2>
        <div className="pr-chips">
          {themes.map((theme) => (
            <button key={theme.id} type="button" className={`pr-chip${draft.themeId === theme.id ? ' on' : ''}`} onClick={() => setDraft({ ...draft, themeId: theme.id })}>
              <span className="st-swatch" style={{ background: theme.accent }} />{theme.label}
            </button>
          ))}
        </div>
        <div className="pr-grid2">
          <label>Top badge<input value={draft.badge} maxLength={32} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} /></label>
          <label>Background words<input value={draft.marquee} maxLength={48} onChange={(e) => setDraft({ ...draft, marquee: e.target.value })} /></label>
        </div>
        {facePacks.length > 1 && (
          <label>Face pack<select value={draft.faces} onChange={(e) => setDraft({ ...draft, faces: e.target.value })}>{facePacks.map((pack) => <option key={pack} value={pack}>{pack}</option>)}</select></label>
        )}
        <div className="st-range">Music · {Math.round(draft.music * 100)}%<input type="range" min="0" max="1" step="0.01" value={draft.music} onChange={(e) => setDraft({ ...draft, music: Number(e.target.value) })} /></div>
        <div className="st-range">Sound effects · {Math.round(draft.sfx * 100)}%<input type="range" min="0" max="1" step="0.01" value={draft.sfx} onChange={(e) => setDraft({ ...draft, sfx: Number(e.target.value) })} /></div>
        <div className="pr-row">
          <button type="button" className="pr-btn small" onClick={onPickMusic}>{customMusic ? 'Change music' : 'Use my own music'}</button>
          {customMusic && <button type="button" className="pr-btn small text" onClick={onDefaultMusic}>Back to default music</button>}
        </div>
        <label className="st-check"><input type="checkbox" checked={draft.useOpenverse} onChange={(e) => setDraft({ ...draft, useOpenverse: e.target.checked })} />Fetch extra sound effects from Openverse</label>
      </section>

      <details className="pr-card st-more">
        <summary>Fix caption spelling · {draft.words.length} words</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {draft.words.map((word, i) => (
            <input key={word.id || i} aria-label={`Caption at ${word.start.toFixed(2)} s`} value={word.text} size={Math.min(18, Math.max(4, word.text.length))} maxLength={100}
              style={{ border: '1.5px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontSize: 15 }}
              onChange={(e) => setDraft({ ...draft, words: draft.words.map((item, idx) => (idx === i ? { ...item, text: e.target.value } : item)) })} />
          ))}
        </div>
      </details>
    </fieldset>
  );
}
