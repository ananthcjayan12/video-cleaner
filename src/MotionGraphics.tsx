import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, type Emotion, type EmotionCue, type EmotionCuePatch, type EmotionDensity, type EmotionId, type ModelOption, type MotionGraphicType, type MotionPlacement, type MotionPlan, type MotionScene, type MotionSettings, type MotionTemplate, type MotionSound, type MotionSoundCue, type SoundIntensity, type SystemStatus, type TextProvider } from './api';
import ModelPicker, { textProviderConfigured } from './ModelPicker';
import './motion.css';

const GRAPHIC_TYPES: Array<{ id: MotionGraphicType; label: string }> = [
  { id: 'lower-third', label: 'Lower third' }, { id: 'stat-callout', label: 'Stat callout' }, { id: 'kinetic-title', label: 'Kinetic title' },
  { id: 'animated-chart', label: 'Animated chart' }, { id: 'process-steps', label: 'Process steps' }, { id: 'comparison', label: 'Comparison' },
  { id: 'checklist', label: 'Checklist' }, { id: 'quote-card', label: 'Quote card' }, { id: 'timeline', label: 'Timeline' }, { id: 'icon-diagram', label: 'Icon diagram' },
];
const PLACEMENTS: Array<{ id: MotionPlacement; label: string }> = [{ id: 'top', label: 'Top' }, { id: 'center', label: 'Center' }, { id: 'bottom', label: 'Bottom' }, { id: 'full', label: 'Full frame' }];

const DEFAULT_SETTINGS: MotionSettings = {
  planningProvider: 'claude-cli', planningModel: '', countMode: 'auto', targetCount: 4, perMinute: 2, minDuration: 2.5, maxDuration: 5,
  accentColor: '#22D3EE', secondaryColor: '#0F172A', styleNotes: '', emotionSounds: true, emotionDensity: 'balanced',
};
const DENSITIES: Array<{ id: EmotionDensity; label: string }> = [{ id: 'subtle', label: 'Subtle · about 2–3 a minute' }, { id: 'balanced', label: 'Balanced · about 5 a minute' }, { id: 'expressive', label: 'Expressive · about 9 a minute' }];
const INTENSITIES: Array<{ id: SoundIntensity; label: string }> = [{ id: 'soft', label: 'Soft' }, { id: 'medium', label: 'Medium' }, { id: 'strong', label: 'Strong' }];

type Draft = { soundEffects: MotionSoundCue[]; templateId: string; title: string; graphicType: MotionGraphicType; placement: MotionPlacement; headline: string; subhead: string; items: string; designBrief: string; sourceStart: string; sourceEnd: string };

const itemsToText = (scene: MotionScene) => scene.content.items.map((item) => item.value ? `${item.label} | ${item.value}` : item.label).join('\n');
const textToItems = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6).map((line) => {
  const [label, ...rest] = line.split('|'); return { label: label.trim(), value: rest.join('|').trim() };
});
const draftOf = (scene: MotionScene): Draft => ({
  soundEffects: scene.soundEffects ?? [], templateId: scene.templateId ?? '', title: scene.title, graphicType: scene.graphicType, placement: scene.placement, headline: scene.content.headline, subhead: scene.content.subhead,
  items: itemsToText(scene), designBrief: scene.designBrief, sourceStart: scene.sourceStart.toFixed(2), sourceEnd: scene.sourceEnd.toFixed(2),
});
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type Props = {
  projectId: string;
  system: SystemStatus | null;
  agyModels: ModelOption[];
  codexModels: ModelOption[];
  refreshAgy: () => void;
  refreshCodex: () => void;
  brollPlanned: boolean;
  workflowMode: string;
  /** Global lock while another long-running app job is active. */
  locked: boolean;
  defaultProvider: TextProvider;
  defaultModel: string;
  onStatus: (text: string) => void;
  onError: (text: string) => void;
};

export default function MotionGraphics(props: Props) {
  const { projectId, system, brollPlanned, locked, onStatus, onError } = props;
  const [plan, setPlan] = useState<MotionPlan | null>(null);
  const [settings, setSettings] = useState<MotionSettings>({ ...DEFAULT_SETTINGS, planningProvider: props.defaultProvider, planningModel: props.defaultModel });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sounds, setSounds] = useState<MotionSound[]>([]);
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [planningSounds, setPlanningSounds] = useState(false);
  const [newCue, setNewCue] = useState<{ emotion: EmotionId; time: string }>({ emotion: 'shock', time: '' });
  const [templates, setTemplates] = useState<MotionTemplate[]>([]);
  const [uploading, setUploading] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateNotes, setTemplateNotes] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const draftsRef = useRef(drafts); draftsRef.current = drafts;

  const adopt = useCallback((next: MotionPlan) => {
    setPlan(next); setSettings(next.settings);
    setDrafts((current) => Object.fromEntries(next.scenes.map((scene) => [scene.id, scene.status === 'generating' && current[scene.id] ? current[scene.id] : draftOf(scene)])));
  }, []);

  useEffect(() => {
    let active = true; setLoaded(false); setPlan(null);
    void api.getMotion(projectId).then((result) => { if (!active) return; if (result) adopt(result); setLoaded(true); }).catch((error) => { if (active) { onError(message(error)); setLoaded(true); } });
    return () => { active = false; };
  }, [projectId, adopt]);

  useEffect(() => { void api.motionSounds().then(result => { setSounds(result.sounds); setEmotions(result.emotions); }).catch(error => onError(message(error))); }, []);
  useEffect(() => { void api.motionTemplates().then((result) => setTemplates(result.templates)).catch((error) => onError(message(error))); }, []);

  async function uploadTemplate(file: File | undefined) {
    if (!file) return;
    try {
      setUploading(true); onError('');
      const entry = await api.uploadMotionTemplate(file, templateName, templateNotes);
      setTemplates((current) => [...current, entry]); setTemplateName(''); setTemplateNotes('');
      onStatus(`Template “${entry.name}” added. Pick it as the default or per graphic, then use Redesign.`);
    } catch (error) { onError(message(error)); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function removeTemplate(template: MotionTemplate) {
    if (!window.confirm(`Delete template “${template.name}”? Graphics already rendered keep working.`)) return;
    try { await api.deleteMotionTemplate(template.id); setTemplates((current) => current.filter((item) => item.id !== template.id)); if (settings.defaultTemplateId === template.id) patchSettings({ defaultTemplateId: '' }); }
    catch (error) { onError(message(error)); }
  }

  const anyRendering = Boolean(plan?.scenes.some((scene) => scene.status === 'generating'));
  useEffect(() => {
    if (!anyRendering) return;
    const timer = window.setInterval(() => {
      void api.getMotion(projectId).then((result) => { if (result) setPlan((current) => current ? { ...current, scenes: result.scenes } : result); }).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [anyRendering, projectId]);

  const busy = planning || planningSounds || batchRunning || locked;
  const designReady = textProviderConfigured(system, settings.planningProvider);
  const planningReady = designReady && Boolean(system?.transcription?.configured);
  const browser = system?.motionGraphics?.browserPath;

  function patchSettings(patch: Partial<MotionSettings>) {
    const next = { ...settings, ...patch }; setSettings(next);
    if (plan) void api.updateMotionSettings(projectId, patch).then((updated) => setPlan((current) => current ? { ...current, settings: updated.settings } : updated)).catch((error) => onError(message(error)));
  }

  async function planMotion() {
    if (busy) return;
    if (plan?.scenes.length && !window.confirm('Re-planning replaces the current motion-graphics plan and deletes its rendered clips. Your emotion sound cues are kept. Continue?')) return;
    try {
      setPlanning(true); onError(''); onStatus(`${settings.planningProvider} is planning motion graphics around your B-roll${settings.emotionSounds && !plan?.emotionCues?.length ? ', then reading the narration for emotional beats' : ''}…`);
      const next = await api.planMotion(projectId, { ...settings }); adopt(next); onStatus(`Planned ${next.scenes.length} motion graphic${next.scenes.length === 1 ? '' : 's'} ✓`);
    } catch (error) { onError(message(error)); } finally { setPlanning(false); }
  }

  const cues = plan?.emotionCues ?? [];
  const byTime = (a: EmotionCue, b: EmotionCue) => a.sourceTime - b.sourceTime;
  async function planEmotionSounds() {
    if (busy) return;
    if (cues.length && !window.confirm('Re-planning replaces every emotion sound cue, including ones you edited. Motion graphics are not affected. Continue?')) return;
    try {
      setPlanningSounds(true); onError(''); onStatus(`${settings.planningProvider} is reading the narration for shocking, sad and happy beats…`);
      const next = await api.planEmotionSounds(projectId, { ...settings }); adopt(next);
      const count = next.emotionCues?.length ?? 0; onStatus(count ? `Placed ${count} emotion sound${count === 1 ? '' : 's'} ✓ — they are on their own tracks in the Live editor` : 'No strong emotional beats found — see the notes');
    } catch (error) { onError(message(error)); } finally { setPlanningSounds(false); }
  }
  async function patchCue(cue: EmotionCue, patch: EmotionCuePatch) {
    try { onError(''); const updated = await api.updateEmotionCue(projectId, cue.id, patch); setPlan((current) => current ? { ...current, emotionCues: (current.emotionCues ?? []).map((item) => item.id === updated.id ? updated : item).sort(byTime) } : current); }
    catch (error) { onError(message(error)); }
  }
  async function removeCue(cue: EmotionCue) {
    try { onError(''); const next = await api.deleteEmotionCue(projectId, cue.id); setPlan((current) => current ? { ...current, emotionCues: next.emotionCues ?? [] } : next); } catch (error) { onError(message(error)); }
  }
  async function addCue() {
    const time = Number(newCue.time);
    if (!newCue.time.trim() || !Number.isFinite(time) || time < 0) { onError('Enter the time in the video (seconds) where the sound should land.'); return; }
    try { onError(''); const created = await api.addEmotionCue(projectId, { emotion: newCue.emotion, sourceTime: time }); setPlan((current) => current ? { ...current, emotionCues: [...(current.emotionCues ?? []), created].sort(byTime) } : current); setNewCue({ ...newCue, time: '' }); }
    catch (error) { onError(message(error)); }
  }

  async function saveScene(scene: MotionScene) {
    const draft = draftsRef.current[scene.id]; if (!draft) return scene;
    const patch = {
      soundEffects: draft.soundEffects, templateId: draft.templateId || null, title: draft.title, graphicType: draft.graphicType, placement: draft.placement, headline: draft.headline, subhead: draft.subhead,
      items: textToItems(draft.items), designBrief: draft.designBrief, sourceStart: Number(draft.sourceStart), sourceEnd: Number(draft.sourceEnd),
    };
    const unchanged = JSON.stringify(draftOf(scene)) === JSON.stringify(draft); if (unchanged) return scene;
    const updated = await api.updateMotionScene(projectId, scene.id, patch);
    setPlan((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === updated.id ? updated : item) } : current);
    setDrafts((current) => ({ ...current, [updated.id]: draftOf(updated) }));
    return updated;
  }
  async function autosave(scene: MotionScene) {
    if (scene.status === 'generating') return;
    try { onError(''); await saveScene(scene); onStatus('Motion graphic saved locally ✓'); }
    catch (error) { onError(message(error)); setDrafts((current) => ({ ...current, [scene.id]: draftOf(scene) })); }
  }
  function edit(sceneId: string, patch: Partial<Draft>) { setDrafts((current) => ({ ...current, [sceneId]: { ...current[sceneId], ...patch } })); }

  async function toggle(scene: MotionScene, enabled: boolean) {
    try { onError(''); const updated = await api.updateMotionScene(projectId, scene.id, { enabled }); setPlan((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === updated.id ? updated : item) } : current); }
    catch (error) { onError(message(error)); }
  }
  async function remove(scene: MotionScene) {
    if (busy || !window.confirm(`Delete “${scene.title}” and its rendered clip?`)) return;
    try { onError(''); adopt(await api.deleteMotionScene(projectId, scene.id)); onStatus(`Deleted ${scene.title}`); } catch (error) { onError(message(error)); }
  }

  async function render(scene: MotionScene, options: { regenerateCode?: boolean } = {}): Promise<boolean> {
    try {
      onError(''); const saved = await saveScene(scene);
      const comment = comments[scene.id]?.trim();
      setPlan((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, status: 'generating', renderProgress: 0, error: undefined } : item) } : current);
      onStatus(`${options.regenerateCode || comment || !saved.codeGeneratedAt ? 'Designing and rendering' : 'Rendering'} “${saved.title}” with Remotion…`);
      const generated = await api.generateMotionScene(projectId, scene.id, { regenerateCode: options.regenerateCode, comment });
      setPlan((current) => current ? { ...current, scenes: current.scenes.map((item) => item.id === generated.id ? generated : item) } : current);
      setDrafts((current) => ({ ...current, [generated.id]: draftOf(generated) })); setComments((current) => ({ ...current, [scene.id]: '' }));
      onStatus(`“${generated.title}” is ready ✓`); return true;
    } catch (error) {
      if (/Render stopped/i.test(message(error))) { onStatus(`Stopped “${scene.title}”`); try { const latest = await api.getMotion(projectId); if (latest) setPlan(latest); } catch { /* ignore */ } return true; }
      onError(message(error)); try { const latest = await api.getMotion(projectId); if (latest) setPlan(latest); } catch { /* keep the render error visible */ }
      return false;
    }
  }
  const stopBatch = useRef(false);
  async function stopRendering(sceneId?: string) {
    if (!sceneId) stopBatch.current = true;
    try { await api.stopMotionRender(projectId, sceneId); onStatus('Stopping render…'); } catch (error) { onError(message(error)); }
  }
  async function renderAll(onlyMissing: boolean) {
    if (!plan || busy) return;
    const targets = plan.scenes.filter((scene) => scene.enabled && (!onlyMissing || scene.status !== 'ready'));
    if (!targets.length) { onStatus('Every enabled motion graphic is already rendered.'); return; }
    stopBatch.current = false; setBatchRunning(true); let failures = 0;
    // The AI design step is network bound, so several graphics go at once; the server limits concurrent frame capture to what the CPU can handle.
    const queue = [...targets];
    const worker = async () => { for (let scene = queue.shift(); scene && !stopBatch.current; scene = queue.shift()) if (!await render(scene)) failures += 1; };
    try { await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker)); onStatus(failures ? `Rendered ${targets.length - failures}/${targets.length} graphics — ${failures} failed` : `Rendered ${targets.length} motion graphic${targets.length === 1 ? '' : 's'} ✓`); }
    finally { setBatchRunning(false); }
  }

  const ready = plan?.scenes.filter((scene) => scene.status === 'ready').length ?? 0;
  const enabledScenes = plan?.scenes.filter((scene) => scene.enabled).length ?? 0;

  const emotionById = new Map(emotions.map((emotion) => [emotion.id, emotion]));
  const soundOptions = (emotion: Emotion | undefined) => {
    const suggested = new Set(emotion?.sounds ?? []);
    return <>
      {emotion && <optgroup label={`Suggested for ${emotion.label}`}>{emotion.sounds.map((id) => sounds.find((sound) => sound.id === id)).filter((sound): sound is MotionSound => Boolean(sound)).map((sound) => <option key={sound.id} value={sound.id}>{sound.label} · {sound.duration.toFixed(1)}s</option>)}</optgroup>}
      {Array.from(new Set(sounds.map((sound) => sound.category))).map((category) => <optgroup key={category} label={category}>{sounds.filter((sound) => sound.category === category && !suggested.has(sound.id)).map((sound) => <option key={sound.id} value={sound.id}>{sound.label} · {sound.duration.toFixed(1)}s</option>)}</optgroup>)}
    </>;
  };
  const emotionSection = <div className="emotionPanel">
    <div className="emotionHead">
      <div><span className="label">EMOTION SOUND DESIGN</span><h4>Sound effects that follow the feeling of each sentence</h4></div>
      <button className="primary" onClick={() => void planEmotionSounds()} disabled={busy || !planningReady}>{planningSounds ? 'Reading the narration…' : cues.length ? 'Re-plan emotion sounds' : 'Plan emotion sounds'}</button>
    </div>
    <p className="muted motionIntro">The AI reads the narration like an editor and puts a matching effect on the exact word that carries each feeling — a hit on a shock, a build-up before a reveal, a low fall on something sad, a bright chime on good news. Every cue sits on its own audio track in the Live editor (move, mute or delete it there) and is included in the export. No rendering needed.</p>
    <div className="emotionControls">
      <label>How many<select value={settings.emotionDensity} disabled={busy} onChange={(event) => patchSettings({ emotionDensity: event.target.value as EmotionDensity })}>{DENSITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="motionToggle"><input type="checkbox" checked={settings.emotionSounds} disabled={busy} onChange={(event) => patchSettings({ emotionSounds: event.target.checked })} />Also plan emotion sounds when planning graphics</label>
    </div>
    <div className="emotionLegend">{emotions.map((emotion) => <span key={emotion.id} className="emotionChip" title={emotion.cue} style={{ '--emotion': emotion.color } as CSSProperties}>{emotion.label}{cues.some((cue) => cue.emotion === emotion.id) ? ` · ${cues.filter((cue) => cue.emotion === emotion.id).length}` : ''}</span>)}</div>
    {cues.length === 0 ? <p className="muted motionEmpty">{plan ? 'No emotion sounds yet.' : 'No emotion sounds yet — you can plan them before any graphic.'} Click “Plan emotion sounds”, or add one by hand below once a plan exists.</p> : <div className="emotionGrid">{cues.map((cue) => {
      const emotion = emotionById.get(cue.emotion);
      return <article key={cue.id} className={`emotionCue ${cue.enabled ? '' : 'disabled'}`} style={{ '--emotion': emotion?.color ?? '#94a3b8' } as CSSProperties}>
        <header><span className="emotionChip">{emotion?.label ?? cue.emotion}</span><span className="emotionTime">lands at {clock(cue.sourceTime)}</span>
          <label className="motionToggle"><input type="checkbox" checked={cue.enabled} disabled={busy} onChange={(event) => void patchCue(cue, { enabled: event.target.checked })} />On</label></header>
        {cue.narration && <blockquote className="motionNarration">“{cue.narration}”</blockquote>}
        {cue.reason && <p className="emotionReason">{cue.reason}</p>}
        <div className="motionForm">
          <label>Feeling<select value={cue.emotion} disabled={busy} onChange={(event) => { const next = emotionById.get(event.target.value as EmotionId); void patchCue(cue, { emotion: event.target.value as EmotionId, ...(next && !next.sounds.includes(cue.soundId) ? { soundId: next.sounds[0] } : {}) }); }}>{emotions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Strength<select value={cue.intensity} disabled={busy} onChange={(event) => void patchCue(cue, { intensity: event.target.value as SoundIntensity })}>{INTENSITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="motionWide">Sound<select value={cue.soundId} disabled={busy} onChange={(event) => void patchCue(cue, { soundId: event.target.value })}>{soundOptions(emotion)}</select></label>
          <label>Time (s)<input key={`${cue.id}-${cue.sourceTime}`} inputMode="decimal" defaultValue={cue.sourceTime.toFixed(2)} disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={(event) => { const time = Number(event.target.value); if (Number.isFinite(time) && time >= 0 && Math.abs(time - cue.sourceTime) > 0.004) void patchCue(cue, { sourceTime: time }); else event.target.value = cue.sourceTime.toFixed(2); }} /></label>
        </div>
        {cue.clip.lead >= 0.3 && <small className="muted">This sound builds for {cue.clip.lead.toFixed(1)}s, so it starts before the word and reaches its peak on it.</small>}
        <audio controls preload="none" ref={(element) => { if (element) element.volume = cue.clip.volume; }} src={api.motionSoundUrl(cue.soundId)} aria-label={`Preview ${cue.clip.label}`} />
        <div className="motionActions"><button className="ghost" disabled={busy} onClick={() => void removeCue(cue)}>Delete</button></div>
      </article>;
    })}</div>}
    <div className="emotionAdd">
      <strong>Add a sound by hand</strong>
      <select value={newCue.emotion} disabled={busy || !plan} onChange={(event) => setNewCue({ ...newCue, emotion: event.target.value as EmotionId })} aria-label="Feeling">{emotions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <input inputMode="decimal" placeholder="Time in video (s)" value={newCue.time} disabled={busy || !plan} onChange={(event) => setNewCue({ ...newCue, time: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void addCue(); }} aria-label="Time in the video, in seconds" />
      <button disabled={busy || !plan} onClick={() => void addCue()}>Add sound</button>
    </div>
  </div>;

  return <section className="panel motionPanel">
    <div className="sectionTitle">
      <div><span className="label">MOTION GRAPHICS · REMOTION</span><h3>Animated overlays planned with your B-roll</h3></div>
      <div className="motionTitleActions">
        <button className="primary" onClick={() => void planMotion()} disabled={busy || !planningReady}>{planning ? 'Planning…' : plan ? 'Re-plan motion graphics' : 'Plan motion graphics'}</button>
      </div>
    </div>
    <p className="muted motionIntro">
      The AI picks the moments where a number, list, sequence or key phrase deserves a professional animated graphic, keeps them clear of your {brollPlanned ? 'planned B-roll' : 'B-roll (plan B-roll first for best spacing)'}, selects matching clicks, bells or whooshes from the sound library, then writes a Remotion component per graphic and renders it on a transparent background. {browser ? `Rendering with ${browser.split('/').pop()}.` : 'No Chrome found — Remotion will download a headless browser on the first render.'}
    </p>
    {!brollPlanned && <p className="motionHint">Tip: plan B-roll first. Motion graphics are placed around existing B-roll windows; they will not overlap it, but B-roll planned later cannot see them.</p>}

    <div className="motionConfig">
      <ModelPicker title="Motion design AI (plans and writes the graphics)" provider={settings.planningProvider} model={settings.planningModel} system={system} agyModels={props.agyModels} codexModels={props.codexModels} busy={busy}
        onProvider={(provider) => patchSettings({ planningProvider: provider, planningModel: '' })} onModel={(model) => patchSettings({ planningModel: model })} refreshAgy={props.refreshAgy} refreshCodex={props.refreshCodex} />
      <div className="motionFields">
        <label>How many<select value={settings.countMode} disabled={busy} onChange={(event) => patchSettings({ countMode: event.target.value as MotionSettings['countMode'] })}><option value="auto">Auto · only where it helps</option><option value="exact">Exact number</option><option value="per-minute">Per minute</option></select></label>
        {settings.countMode === 'exact' && <label>Graphics<input type="number" min={1} max={30} value={settings.targetCount} disabled={busy} onChange={(event) => setSettings({ ...settings, targetCount: Number(event.target.value) })} onBlur={() => patchSettings({ targetCount: settings.targetCount })} /></label>}
        {settings.countMode === 'per-minute' && <label>Per minute<input type="number" min={0.5} max={10} step={0.5} value={settings.perMinute} disabled={busy} onChange={(event) => setSettings({ ...settings, perMinute: Number(event.target.value) })} onBlur={() => patchSettings({ perMinute: settings.perMinute })} /></label>}
        <label>Min seconds<input type="number" min={1.5} max={15} step={0.5} value={settings.minDuration} disabled={busy} onChange={(event) => setSettings({ ...settings, minDuration: Number(event.target.value) })} onBlur={() => patchSettings({ minDuration: settings.minDuration })} /></label>
        <label>Max seconds<input type="number" min={2} max={15} step={0.5} value={settings.maxDuration} disabled={busy} onChange={(event) => setSettings({ ...settings, maxDuration: Number(event.target.value) })} onBlur={() => patchSettings({ maxDuration: settings.maxDuration })} /></label>
        <label>Accent colour<span className="motionColor"><input type="color" value={settings.accentColor} disabled={busy} onChange={(event) => setSettings({ ...settings, accentColor: event.target.value })} onBlur={() => patchSettings({ accentColor: settings.accentColor })} /><code>{settings.accentColor}</code></span></label>
        <label>Card colour<span className="motionColor"><input type="color" value={settings.secondaryColor} disabled={busy} onChange={(event) => setSettings({ ...settings, secondaryColor: event.target.value })} onBlur={() => patchSettings({ secondaryColor: settings.secondaryColor })} /><code>{settings.secondaryColor}</code></span></label>
      </div>
      <label className="motionStyle">House style notes (optional)<input value={settings.styleNotes} maxLength={600} disabled={busy} placeholder="e.g. calm clinical tone, rounded cards, no bounce, brand teal" onChange={(event) => setSettings({ ...settings, styleNotes: event.target.value })} onBlur={() => patchSettings({ styleNotes: settings.styleNotes })} /></label>
    </div>

    <div className="motionTemplates">
      <div className="motionTemplatesHead"><strong>Reference templates</strong><small className="muted">Upload a design (PNG/JPG/WebP). The AI looks at it and rebuilds that style as an animated graphic. A contact sheet of several layouts works — it picks the panel matching each graphic type. Templates are saved once and reused in every project. Works with Claude, Codex, Gemini and OpenAI (not AGY).</small></div>
      {templates.length > 0 && <div className="motionTemplateList">{templates.map((template) => <figure key={template.id} className={settings.defaultTemplateId === template.id ? 'active' : ''}>
        <img src={api.motionTemplateImageUrl(template.id)} alt={template.name} loading="lazy" />
        <figcaption><strong>{template.name}</strong>{template.notes && <small>{template.notes}</small>}
          <span><button disabled={busy} onClick={() => patchSettings({ defaultTemplateId: settings.defaultTemplateId === template.id ? '' : template.id })}>{settings.defaultTemplateId === template.id ? 'Default ✓' : 'Use as default'}</button><button className="ghost" disabled={busy} onClick={() => void removeTemplate(template)}>Delete</button></span></figcaption>
      </figure>)}</div>}
      <div className="motionTemplateUpload">
        <input value={templateName} placeholder="Name, e.g. SmileCraft short-form sheet" maxLength={80} onChange={(event) => setTemplateName(event.target.value)} disabled={uploading} />
        <input value={templateNotes} placeholder="Notes for the AI (optional), e.g. panels 1–10; use panel 3 for stats" maxLength={600} onChange={(event) => setTemplateNotes(event.target.value)} disabled={uploading} />
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadTemplate(event.target.files?.[0])} />
        <button disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? 'Uploading…' : 'Upload template image'}</button>
      </div>
    </div>

    {!loaded ? <p className="muted">Loading motion plan…</p> : <>
      {emotionSection}
      {plan && plan.notes.length > 0 && <ul className="motionNotes">{plan.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {!plan?.scenes.length ? <p className="muted motionEmpty">{plan ? 'This plan has no motion graphics.' : 'No motion graphics yet.'} Click “Plan motion graphics” — a transcript is required (it is created automatically if missing).</p> : <>
      <div className="motionBatch">
        <span>{ready}/{enabledScenes} rendered</span>
        <button onClick={() => void renderAll(true)} disabled={busy || anyRendering || !enabledScenes}>Render missing</button>
        <button onClick={() => void renderAll(false)} disabled={busy || anyRendering || !enabledScenes}>Re-render all</button>
        {(anyRendering || batchRunning) && <button className="danger" onClick={() => void stopRendering()}>Stop rendering</button>}
      </div>
      <div className="motionGrid">
        {plan.scenes.map((scene, index) => {
          const draft = drafts[scene.id] ?? draftOf(scene); const rendering = scene.status === 'generating';
          return <article key={scene.id} className={`motionCard ${scene.enabled ? '' : 'disabled'}`}>
            <header>
              <span className="motionIndex">{index + 1}</span>
              <input className="motionTitleInput" value={draft.title} disabled={rendering} onChange={(event) => edit(scene.id, { title: event.target.value })} onBlur={() => void autosave(scene)} aria-label="Graphic title" />
              <label className="motionToggle"><input type="checkbox" checked={scene.enabled} disabled={rendering} onChange={(event) => void toggle(scene, event.target.checked)} />On</label>
            </header>
            <div className="motionMeta"><span>{clock(scene.sourceStart)} → {clock(scene.sourceEnd)} · {(scene.sourceEnd - scene.sourceStart).toFixed(1)}s</span><span className={`motionStatus ${scene.status}`}>{scene.status === 'ready' ? 'Rendered' : scene.status === 'generating' ? `Rendering ${Math.round((scene.renderProgress ?? 0) * 100)}%` : scene.status === 'failed' ? 'Failed' : scene.videoFile ? 'Needs re-render' : 'Not rendered'}</span></div>
            <p className="motionWhy"><strong>{scene.keyPoint}</strong><br />{scene.whyThisGraphicMatters}</p>
            <blockquote className="motionNarration">“{scene.narration}”</blockquote>
            {scene.videoFile && <div className="motionPreview"><video key={scene.renderedAt} src={api.motionVideoUrl(projectId, scene.id, scene.renderedAt)} controls loop playsInline preload="metadata" /></div>}
            {rendering && <div className="progressTrack"><span style={{ width: `${Math.round((scene.renderProgress ?? 0) * 100)}%` }} /></div>}
            <details className="motionBrief"><summary>Sound effects · {draft.soundEffects.length} cues</summary>
              <small className="muted">Cues play with the graphic. Time is seconds after it starts. Save changes, then render to hear them.</small>
              {draft.soundEffects.map((cue, cueIndex) => <div className="motionForm" key={cueIndex}>
                <label>Sound<select value={cue.soundId} disabled={rendering} onChange={event => edit(scene.id, { soundEffects: draft.soundEffects.map((item, i) => i === cueIndex ? { ...item, soundId: event.target.value } : item) })} onBlur={() => void autosave(scene)}>{Array.from(new Set(sounds.map(sound => sound.category))).map(category => <optgroup key={category} label={category}>{sounds.filter(sound => sound.category === category).map(sound => <option key={sound.id} value={sound.id}>{sound.label} · {sound.duration.toFixed(1)}s</option>)}</optgroup>)}</select></label>
                <label>Time (s)<input type="number" min="0" max={Math.max(0, scene.sourceEnd - scene.sourceStart - 0.04)} step="0.033333" value={cue.time} disabled={rendering} onChange={event => edit(scene.id, { soundEffects: draft.soundEffects.map((item, i) => i === cueIndex ? { ...item, time: Number(event.target.value) } : item) })} onBlur={() => void autosave(scene)} /></label>
                <label>Volume (dB)<input type="number" min="-30" max="-6" value={cue.gainDb} disabled={rendering} onChange={event => edit(scene.id, { soundEffects: draft.soundEffects.map((item, i) => i === cueIndex ? { ...item, gainDb: Number(event.target.value) } : item) })} onBlur={() => void autosave(scene)} /></label>
                <audio controls preload="none" ref={element => { if (element) element.volume = Math.pow(10, cue.gainDb / 20); }} src={api.motionSoundUrl(cue.soundId)} aria-label={`Preview ${cue.soundId}`} style={{ width: '100%' }} />
                <button disabled={rendering} onClick={() => edit(scene.id, { soundEffects: draft.soundEffects.filter((_, i) => i !== cueIndex) })}>Remove sound</button>
              </div>)}
              <div className="motionActions"><button disabled={rendering || draft.soundEffects.length >= 3} onClick={() => edit(scene.id, { soundEffects: [...draft.soundEffects, { soundId: 'ui-pop-sound', time: Math.min(scene.sourceEnd - scene.sourceStart - 0.04, draft.soundEffects.length * 0.5 + 0.1), gainDb: -16 }] })}>Add sound</button><button disabled={rendering} onClick={() => void autosave(scene)}>Save sounds</button></div>
            </details>
            <div className="motionForm">
              <label>Type<select value={draft.graphicType} disabled={rendering} onChange={(event) => { edit(scene.id, { graphicType: event.target.value as MotionGraphicType }); }} onBlur={() => void autosave(scene)}>{GRAPHIC_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
              <label>Placement<select value={draft.placement} disabled={rendering} onChange={(event) => edit(scene.id, { placement: event.target.value as MotionPlacement })} onBlur={() => void autosave(scene)}>{PLACEMENTS.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
              <label className="motionWide">Template<select value={draft.templateId} disabled={rendering} onChange={(event) => edit(scene.id, { templateId: event.target.value })} onBlur={() => void autosave(scene)}><option value="">{settings.defaultTemplateId && templates.some((item) => item.id === settings.defaultTemplateId) ? 'Project default' : 'None · AI freestyle'}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
              <label>Start (s)<input inputMode="decimal" value={draft.sourceStart} disabled={rendering} onChange={(event) => edit(scene.id, { sourceStart: event.target.value })} onBlur={() => void autosave(scene)} /></label>
              <label>End (s)<input inputMode="decimal" value={draft.sourceEnd} disabled={rendering} onChange={(event) => edit(scene.id, { sourceEnd: event.target.value })} onBlur={() => void autosave(scene)} /></label>
            </div>
            <label className="motionWide">Headline<input value={draft.headline} maxLength={90} disabled={rendering} onChange={(event) => edit(scene.id, { headline: event.target.value })} onBlur={() => void autosave(scene)} /></label>
            <label className="motionWide">Subhead<input value={draft.subhead} maxLength={140} disabled={rendering} onChange={(event) => edit(scene.id, { subhead: event.target.value })} onBlur={() => void autosave(scene)} /></label>
            <label className="motionWide">Items <small>one per line · “Label | Value”</small><textarea rows={3} value={draft.items} disabled={rendering} onChange={(event) => edit(scene.id, { items: event.target.value })} onBlur={() => void autosave(scene)} /></label>
            <details className="motionBrief"><summary>Design brief{scene.codeModel ? ` · code by ${scene.codeModel}` : ''}</summary><textarea rows={4} value={draft.designBrief} disabled={rendering} onChange={(event) => edit(scene.id, { designBrief: event.target.value })} onBlur={() => void autosave(scene)} /><small className="muted">Editing the brief or type makes the AI redesign the graphic on the next render. Editing text or timing only re-renders.</small></details>
            <label className="motionWide">Ask for a change (optional)<input value={comments[scene.id] ?? ''} disabled={rendering} placeholder="e.g. slower count-up, larger number, add a subtle underline sweep" onChange={(event) => setComments((current) => ({ ...current, [scene.id]: event.target.value }))} /></label>
            {scene.error && <p className="motionError">{scene.error}</p>}
            <div className="motionActions">
              {rendering && <button className="danger" onClick={() => void stopRendering(scene.id)}>Stop</button>}
              <button className="primary" disabled={busy || rendering || !scene.enabled || (!designReady && !scene.codeGeneratedAt)} onClick={() => void render(scene)}>{scene.codeGeneratedAt ? (scene.status === 'ready' ? 'Re-render' : 'Render') : 'Design & render'}</button>
              <button disabled={busy || rendering || !scene.enabled || !designReady} onClick={() => void render(scene, { regenerateCode: true })}>Redesign with AI</button>
              <button className="ghost" disabled={busy || rendering} onClick={() => void remove(scene)}>Delete</button>
            </div>
          </article>;
        })}
      </div>
      </>}
    </>}
  </section>;
}
