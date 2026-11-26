import { useEffect, useRef, useState } from 'react';
import { api, type StudioInfo } from '../api';
import type { StickStudioSettings } from '../../server/stick-narration';

const LENGTHS = [30, 45, 60, 90];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Every knob of the stick studio: voice, script writer, and the look new stick reels start with. */
export function StudioSettings({ info, onSaved, onBack }: { info: StudioInfo; onSaved: (settings: StickStudioSettings) => void; onBack: () => void }) {
  const [s, setS] = useState<StickStudioSettings>(info.settings);
  const [defaults] = useState(() => info.settings);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const player = useRef<HTMLAudioElement>(null);
  const set = (patch: Partial<StickStudioSettings>) => { setSaved(false); setS((current) => ({ ...current, ...patch })); };

  useEffect(() => { if (previewUrl) void player.current?.play().catch(() => undefined); }, [previewUrl]);

  async function preview() {
    setError(''); setBusy('Making a sample…');
    try { setPreviewUrl((await api.previewVoice({ voice: s.voice, voiceStyle: s.voiceStyle })).url); }
    catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  }
  async function save() {
    setError(''); setBusy('Saving…');
    try { const result = await api.saveStudio(s); setS(result.settings); setSaved(true); onSaved(result.settings); }
    catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  }

  return (
    <main className="pr-page">
      <button type="button" className="pr-back" onClick={onBack}>‹ Back</button>
      <h1>Stick reel settings</h1>

      <section className="pr-card pr-options">
        <h2>AI voice</h2>
        {!info.geminiReady && <p className="pr-error">No Gemini API key is set, so the AI voice cannot be made. Add it in the old editor's Settings.</p>}
        <label className="pr-field">Voice (male)
          <select value={s.voice} onChange={(e) => set({ voice: e.target.value })}>
            {info.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
          </select>
        </label>
        <div className="pr-row">
          <button type="button" className="pr-btn small" disabled={Boolean(busy)} onClick={() => void preview()}>▶ Hear this voice</button>
          {busy === 'Making a sample…' && <small>Making a sample…</small>}
        </div>
        {previewUrl && <audio ref={player} className="st-audio" src={previewUrl} controls />}
        <label className="pr-field">How he should sound
          <textarea rows={5} value={s.voiceStyle} onChange={(e) => set({ voiceStyle: e.target.value })} />
          <small>Accent, age, mood and pace. English words stay Manglish.</small>
        </label>
        <div className="st-range">Speed · {s.speed.toFixed(2)}×
          <input type="range" min="0.8" max="1.25" step="0.01" value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })} />
        </div>
        <div className="st-range">Pause between lines · {s.lineGapMs} ms
          <input type="range" min="0" max="800" step="10" value={s.lineGapMs} onChange={(e) => set({ lineGapMs: Number(e.target.value) })} />
        </div>
        <details className="st-more"><summary>Voice model</summary>
          <label className="pr-field">Gemini TTS model<input value={s.ttsModel} onChange={(e) => set({ ttsModel: e.target.value.trim() })} /></label>
        </details>
      </section>

      <section className="pr-card pr-options">
        <h2>Script writer</h2>
        <small className="muted">Engine: {({ 'claude-cli': 'Claude CLI', 'codex-cli': 'Codex CLI', 'agy-cli': 'Antigravity CLI', anthropic: 'Claude API', openai: 'OpenAI API', gemini: 'Gemini API' } as Record<string, string>)[info.scriptEngine.provider] ?? info.scriptEngine.provider} · {info.scriptEngine.model} · {info.scriptEngine.effort} effort. Change it in <a href="/?view=console#engines">Console → Engines → Stick script</a>.</small>
        <div className="pr-field">Language<div className="pr-chips">
          <button type="button" className={`pr-chip${s.scriptLanguage === 'malayalam' ? ' on' : ''}`} onClick={() => set({ scriptLanguage: 'malayalam' })}>Malayalam</button>
          <button type="button" className={`pr-chip${s.scriptLanguage === 'english' ? ' on' : ''}`} onClick={() => set({ scriptLanguage: 'english' })}>English</button>
        </div></div>
        <div className="pr-field">Default length<div className="pr-chips">
          {LENGTHS.map((value) => <button key={value} type="button" className={`pr-chip${s.scriptSeconds === value ? ' on' : ''}`} onClick={() => set({ scriptSeconds: value })}>{value} s</button>)}
        </div></div>
        <label className="pr-field">Always end with (call to action)
          <input value={s.cta} maxLength={200} placeholder="e.g. Follow for Day 4 · Comment SMILE" onChange={(e) => set({ cta: e.target.value })} />
        </label>
        <label className="pr-field">Standing notes for every script
          <textarea rows={4} value={s.scriptNotes} maxLength={1500} placeholder="Audience, tone, words to avoid, your clinic's angle…" onChange={(e) => set({ scriptNotes: e.target.value })} />
        </label>
      </section>

      <section className="pr-card pr-options st-look">
        <h2>New reels start with</h2>
        <div className="pr-field">Look<div className="pr-chips">
          {info.themes.map((theme) => (
            <button key={theme.id} type="button" className={`pr-chip${s.themeId === theme.id ? ' on' : ''}`} onClick={() => set({ themeId: theme.id })}>
              <span className="st-swatch" style={{ background: theme.accent }} />{theme.label}
            </button>
          ))}
        </div></div>
        <label>Face pack
          <select value={s.faces} onChange={(e) => set({ faces: e.target.value })}>
            {(info.facePacks.length ? info.facePacks : [s.faces]).map((pack) => <option key={pack} value={pack}>{pack === 'stick-demo' ? 'My face (stick-demo)' : pack}</option>)}
          </select>
        </label>
        <label>Top badge (empty: AI picks)
          <input value={s.badge} maxLength={32} placeholder="e.g. DAY 03 / 15" onChange={(e) => set({ badge: e.target.value })} />
        </label>
        <div className="st-range">Music · {Math.round(s.music * 100)}%
          <input type="range" min="0" max="1" step="0.01" value={s.music} onChange={(e) => set({ music: Number(e.target.value) })} />
        </div>
        <div className="st-range">Sound effects · {Math.round(s.sfx * 100)}%
          <input type="range" min="0" max="1" step="0.01" value={s.sfx} onChange={(e) => set({ sfx: Number(e.target.value) })} />
        </div>
        <label className="st-check"><input type="checkbox" checked={s.useOpenverse} onChange={(e) => set({ useOpenverse: e.target.checked })} />Fetch extra sound effects from Openverse</label>
      </section>

      {error && <p className="pr-error">{error}</p>}
      <div className="pr-actions st-sticky">
        <button type="button" className="pr-btn" disabled={Boolean(busy)} onClick={() => { setS(defaults); setSaved(false); }}>Undo changes</button>
        <button type="button" className="pr-btn primary" disabled={Boolean(busy)} onClick={() => void save()}>{saved ? 'Saved ✓' : busy === 'Saving…' ? 'Saving…' : 'Save'}</button>
      </div>
    </main>
  );
}
