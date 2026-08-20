import { useEffect, useState } from 'react';
import {
  api,
  saveSelectedBrollDisplayTemplate,
  selectedBrollDisplayTemplate,
  type BrollDisplayTemplate,
  type PresenterMatteStatus,
  type SystemStatus,
} from './api';
import './broll-templates.css';

type TemplateDefinition = {
  id: BrollDisplayTemplate;
  label: string;
  description: string;
  cutout: boolean;
};

const TEMPLATES: TemplateDefinition[] = [
  { id: 'full-frame', label: 'Full screen', description: 'B-roll takes over the full video frame.', cutout: false },
  { id: 'top-card', label: 'Top card', description: 'Large B-roll card at the top while the talking head stays visible.', cutout: false },
  { id: 'split-top', label: 'Top split', description: 'B-roll fills the upper section with the presenter below.', cutout: false },
  { id: 'picture-in-picture', label: 'Picture in picture', description: 'Talking head stays full-frame with a large B-roll card over it.', cutout: false },
  { id: 'top-card-presenter', label: 'Top card + presenter', description: 'Top B-roll card with the extracted presenter allowed to overlap it.', cutout: true },
  { id: 'presenter-overlay', label: 'Presenter over B-roll', description: 'B-roll fills the frame and the background-free presenter stays in front.', cutout: true },
];

function lastProjectId() {
  return typeof window === 'undefined' ? '' : window.localStorage.getItem('video-cleaner:lastProjectId') || '';
}

export default function BrollDisplayTemplates() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<BrollDisplayTemplate>(() => selectedBrollDisplayTemplate());
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [matte, setMatte] = useState<PresenterMatteStatus | null>(null);
  const [projectId, setProjectId] = useState(() => lastProjectId());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => { void refreshContext(); }, []);

  async function refreshContext() {
    const id = lastProjectId(); setProjectId(id);
    try { setSystem(await api.status()); } catch { /* Settings panel surfaces core errors. */ }
    if (!id) { setMatte(null); return; }
    try { setMatte(await api.presenterMatteStatus(id)); } catch { setMatte(null); }
  }

  async function choose(template: TemplateDefinition) {
    setSelected(template.id); saveSelectedBrollDisplayTemplate(template.id); setNote('Layout saved locally.');
    const id = lastProjectId(); setProjectId(id);
    if (id) {
      try { await api.updateBrollSettings(id, template.id); }
      catch { /* A B-roll plan may not exist yet; export still receives the selected template. */ }
    }
    if (template.cutout && id) {
      try { setMatte(await api.presenterMatteStatus(id)); } catch { setMatte(null); }
    }
  }

  async function prepareCutout() {
    const id = lastProjectId();
    if (!id) { setNote('Open a project first.'); return; }
    try {
      setBusy(true); setNote('Preparing presenter cutout locally…');
      const result = await api.preparePresenterMatte(id); setMatte(result);
      setNote('Presenter cutout is ready and cached in this project.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  const selectedDefinition = TEMPLATES.find((template) => template.id === selected) ?? TEMPLATES[0];
  const needsCutout = selectedDefinition.cutout;
  return <aside className={`brollTemplateDock ${open ? 'open' : ''}`}>
    <button className="brollTemplateToggle" onClick={() => { const next = !open; setOpen(next); if (next) void refreshContext(); }} aria-expanded={open}>
      <span className={`templateTiny ${selected}`}><i className="tinyPresenter" /><i className="tinyBroll" /></span>
      <span><small>B-roll layout</small><strong>{selectedDefinition.label}</strong></span>
      <b>{open ? '×' : '⌃'}</b>
    </button>
    {open && <div className="brollTemplatePanel">
      <div className="templatePanelHead"><div><span className="templateEyebrow">DISPLAY STYLE</span><h3>How should B-roll appear?</h3></div><span className="localOnly">LOCAL</span></div>
      <p className="templateIntro">Switching layout does not regenerate your images or videos. The selection is applied when you render the final video.</p>
      <div className="templateGrid">{TEMPLATES.map((template) => <button key={template.id} className={`templateCard ${selected === template.id ? 'selected' : ''}`} onClick={() => void choose(template)}>
        <TemplateMini id={template.id} />
        <span className="templateCardCopy"><strong>{template.label}</strong><small>{template.description}</small>{template.cutout && <em>Presenter cutout</em>}</span>
      </button>)}</div>
      {needsCutout && <div className={`cutoutStatus ${matte?.ready ? 'ready' : ''}`}>
        <div><strong>{matte?.ready ? 'Presenter cutout ready' : 'Presenter cutout required'}</strong><span>{matte?.ready ? `Cached locally${matte.analysisSource ? ` · ${matte.analysisSource}` : ''}.` : system?.matting?.configured ? 'MediaPipe is ready. Prepare now, or Video Cleaner will prepare it automatically on first export.' : system?.matting?.detail || 'Install the optional local matting dependencies.'}</span></div>
        {!matte?.ready && <button onClick={() => void prepareCutout()} disabled={busy || !projectId || !system?.matting?.configured}>{busy ? 'Preparing…' : 'Prepare cutout'}</button>}
      </div>}
      {note && <p className="templateNote">{note}</p>}
      <p className="templateFootnote">Presenter extraction stays on this computer. Only an alpha mask is generated from the proxy; final RGB comes from the original master.</p>
    </div>}
  </aside>;
}

function TemplateMini({ id }: { id: BrollDisplayTemplate }) {
  return <span className={`templateMini ${id}`} aria-hidden="true">
    <i className="miniRoom" />
    <i className="miniBroll" />
    <i className="miniPresenter"><u /><u /></i>
  </span>;
}
