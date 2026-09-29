import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ModelOption, type MotionGraphicType, type MotionPlacement, type MotionPlan, type MotionScene, type MotionSettings, type MotionTemplate, type SystemStatus, type TextProvider } from './api';
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
  accentColor: '#22D3EE', secondaryColor: '#0F172A', styleNotes: '',
};

type Draft = { templateId: string; title: string; graphicType: MotionGraphicType; placement: MotionPlacement; headline: string; subhead: string; items: string; designBrief: string; sourceStart: string; sourceEnd: string };

const itemsToText = (scene: MotionScene) => scene.content.items.map((item) => item.value ? `${item.label} | ${item.value}` : item.label).join('\n');
const textToItems = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 6).map((line) => {
  const [label, ...rest] = line.split('|'); return { label: label.trim(), value: rest.join('|').trim() };
});
const draftOf = (scene: MotionScene): Draft => ({
  templateId: scene.templateId ?? '', title: scene.title, graphicType: scene.graphicType, placement: scene.placement, headline: scene.content.headline, subhead: scene.content.subhead,
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

  const busy = planning || batchRunning || locked;
  const designReady = textProviderConfigured(system, settings.planningProvider);
  const planningReady = designReady && Boolean(system?.elevenLabs.configured);
  const browser = system?.motionGraphics?.browserPath;

  function patchSettings(patch: Partial<MotionSettings>) {
    const next = { ...settings, ...patch }; setSettings(next);
    if (plan) void api.updateMotionSettings(projectId, patch).then((updated) => setPlan((current) => current ? { ...current, settings: updated.settings } : updated)).catch((error) => onError(message(error)));
  }

  async function planMotion() {
    if (busy) return;
    if (plan && !window.confirm('Re-planning replaces the current motion-graphics plan and deletes its rendered clips. Continue?')) return;
    try {
      setPlanning(true); onError(''); onStatus(`${settings.planningProvider} is planning motion graphics around your B-roll and will repair timing or validation issues…`);
      const next = await api.planMotion(projectId, { ...settings }); adopt(next); onStatus(`Planned ${next.scenes.length} motion graphic${next.scenes.length === 1 ? '' : 's'} ✓`);
    } catch (error) { onError(message(error)); } finally { setPlanning(false); }
  }

  async function saveScene(scene: MotionScene) {
    const draft = draftsRef.current[scene.id]; if (!draft) return scene;
    const patch = {
      templateId: draft.templateId || null, title: draft.title, graphicType: draft.graphicType, placement: draft.placement, headline: draft.headline, subhead: draft.subhead,
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
      onError(message(error)); try { const latest = await api.getMotion(projectId); if (latest) setPlan(latest); } catch { /* keep the render error visible */ }
      return false;
    }
  }
  async function renderAll(onlyMissing: boolean) {
    if (!plan || busy) return;
    const targets = plan.scenes.filter((scene) => scene.enabled && (!onlyMissing || scene.status !== 'ready'));
    if (!targets.length) { onStatus('Every enabled motion graphic is already rendered.'); return; }
    setBatchRunning(true); let failures = 0;
    // The AI design step is network bound, so several graphics go at once; the server limits concurrent frame capture to what the CPU can handle.
    const queue = [...targets];
    const worker = async () => { for (let scene = queue.shift(); scene; scene = queue.shift()) if (!await render(scene)) failures += 1; };
    try { await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker)); onStatus(failures ? `Rendered ${targets.length - failures}/${targets.length} graphics — ${failures} failed` : `Rendered ${targets.length} motion graphic${targets.length === 1 ? '' : 's'} ✓`); }
    finally { setBatchRunning(false); }
  }

  const ready = plan?.scenes.filter((scene) => scene.status === 'ready').length ?? 0;
  const enabledScenes = plan?.scenes.filter((scene) => scene.enabled).length ?? 0;

  return <section className="panel motionPanel">
    <div className="sectionTitle">
      <div><span className="label">MOTION GRAPHICS · REMOTION</span><h3>Animated overlays planned with your B-roll</h3></div>
      <div className="motionTitleActions">
        <button className="primary" onClick={() => void planMotion()} disabled={busy || !planningReady}>{planning ? 'Planning…' : plan ? 'Re-plan motion graphics' : 'Plan motion graphics'}</button>
      </div>
    </div>
    <p className="muted motionIntro">
      The AI picks the moments where a number, list, sequence or key phrase deserves a professional animated graphic, keeps them clear of your {brollPlanned ? 'planned B-roll' : 'B-roll (plan B-roll first for best spacing)'}, then writes a Remotion component per graphic and renders it on a transparent background. {browser ? `Rendering with ${browser.split('/').pop()}.` : 'No Chrome found — Remotion will download a headless browser on the first render.'}
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

    {!loaded ? <p className="muted">Loading motion plan…</p> : !plan ? <p className="muted motionEmpty">No motion graphics yet. Click “Plan motion graphics” — a transcript is required (it is created automatically if missing).</p> : <>
      {plan.notes.length > 0 && <ul className="motionNotes">{plan.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      <div className="motionBatch">
        <span>{ready}/{enabledScenes} rendered</span>
        <button onClick={() => void renderAll(true)} disabled={busy || anyRendering || !enabledScenes}>Render missing</button>
        <button onClick={() => void renderAll(false)} disabled={busy || anyRendering || !enabledScenes}>Re-render all</button>
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
            {scene.videoFile && <div className="motionPreview"><video key={scene.renderedAt} src={api.motionVideoUrl(projectId, scene.id, scene.renderedAt)} controls loop muted playsInline preload="metadata" /></div>}
            {rendering && <div className="progressTrack"><span style={{ width: `${Math.round((scene.renderProgress ?? 0) * 100)}%` }} /></div>}
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
              <button className="primary" disabled={busy || rendering || !scene.enabled || (!designReady && !scene.codeGeneratedAt)} onClick={() => void render(scene)}>{scene.codeGeneratedAt ? (scene.status === 'ready' ? 'Re-render' : 'Render') : 'Design & render'}</button>
              <button disabled={busy || rendering || !scene.enabled || !designReady} onClick={() => void render(scene, { regenerateCode: true })}>Redesign with AI</button>
              <button className="ghost" disabled={busy || rendering} onClick={() => void remove(scene)}>Delete</button>
            </div>
          </article>;
        })}
      </div>
    </>}
  </section>;
}
