import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { chooseFiles, uploadAll } from './device-files';
import type {
  StickDraft,
  StickEnergy,
  StickEnter,
  StickFace,
  StickPose,
  StickRender,
  StickSceneV2,
  StickSide,
  StickTemplateId,
  StickTheme,
} from '../server/stick-reel';
import './auto-reel.css';

const TEMPLATE_LABELS: Array<{ id: StickTemplateId; label: string }> = [
  { id: 'key_idea', label: 'Key idea' },
  { id: 'hero_icon', label: 'Hero icon' },
  { id: 'metric', label: 'Live metric' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'compare', label: 'Before / After' },
  { id: 'flow', label: 'Workflow' },
  { id: 'prompt_box', label: 'Prompt box' },
  { id: 'chat_bubble', label: 'Chat bubbles' },
  { id: 'steps', label: 'Numbered steps' },
  { id: 'cta_click', label: 'CTA click' },
];

const POSES: Array<{ id: StickPose; label: string }> = [
  { id: 'point_stage', label: 'Point at stage' },
  { id: 'present_both', label: 'Present (both hands)' },
  { id: 'think_chin', label: 'Thinking' },
  { id: 'shrug', label: 'Shrug' },
  { id: 'celebrate', label: 'Celebrate' },
  { id: 'arms_crossed', label: 'Arms crossed' },
  { id: 'lean_in', label: 'Lean in' },
  { id: 'wave', label: 'Wave' },
];

const EXPRESSIONS: StickFace[] = ['neutral', 'happy', 'surprised', 'thinking', 'smirk'];
const SIDES: StickSide[] = ['left', 'right', 'center'];
const ENTERS: StickEnter[] = ['slide', 'pop', 'peek'];
const ENERGIES: StickEnergy[] = ['calm', 'normal', 'hype'];

const projectKey = 'video-cleaner:stickProject';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function StickReel() {
  const [id, setId] = useState(() => localStorage.getItem(projectKey) || '');
  const [draft, setDraft] = useState<StickDraft | null>(null);
  const [render, setRender] = useState<StickRender | null>(null);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [facePacks, setFacePacks] = useState<string[]>(['stick-demo']);
  const [themes, setThemes] = useState<StickTheme[]>([]);
  const [customMusic, setCustomMusic] = useState(false);
  const [brief, setBrief] = useState('');
  const [task, setTask] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const enabled = !task && render?.state !== 'running';

  useEffect(() => {
    if (!id) return;
    let lost = false;
    void api.stick(id).then(result => {
      if (lost) return;
      setDraft(result.draft);
      setRender(result.render);
      setDuration(result.duration);
      setAudioUrl(result.audioUrl);
      setCustomMusic(result.customMusic);
      if (result.facePacks?.length) setFacePacks(result.facePacks);
      if (result.themes?.length) setThemes(result.themes);
    }).catch(err => {
      if (!lost) setError(message(err));
    });
    return () => { lost = true; };
  }, [id]);

  useEffect(() => {
    if (!id || render?.state !== 'running') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.stick(id).then(result => {
        if (!cancelled) setRender(result.render);
      }).catch(err => {
        if (!cancelled) {
          setError(message(err));
          setRender({ state: 'failed', progress: 0 });
        }
      });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, render]);

  async function work(label: string, action: () => Promise<void>) {
    setError('');
    setNotice('');
    setTask(label);
    try { await action(); }
    catch (err) { setError(message(err)); }
    finally { setTask(''); }
  }

  function resetProject() {
    localStorage.removeItem(projectKey);
    setId('');
    setDraft(null);
    setRender(null);
    setAudioUrl('');
    setError('');
    setNotice('');
  }

  function seekTo(seconds: number) {
    if (video.current) {
      video.current.currentTime = seconds;
      void video.current.play().catch(() => undefined);
    }
    if (audio.current) {
      audio.current.currentTime = seconds;
      void audio.current.play().catch(() => undefined);
    }
  }

  async function pick() {
    const files = await chooseFiles('audio/*,video/*,.mp3,.wav,.m4a,.aac,.mov,.mp4,.m4v,.webm,.mkv', false);
    if (!files.length) return;
    await work('Uploading recording…', async () => {
      const [uploadId] = await uploadAll(files, setTask);
      const project = await api.createStick(uploadId);
      localStorage.setItem(projectKey, project.id);
      setRender(null);
      setDraft(null);
      setId(project.id);
    });
  }

  async function pickMusic() {
    const [file] = await chooseFiles('audio/*,.mp3,.wav,.m4a,.aac', false);
    if (!file) return;
    await work('Importing music…', async () => {
      const [uploadId] = await uploadAll([file], setTask);
      setCustomMusic((await api.stickMusic(id, uploadId)).customMusic);
      setNotice('Music imported. Render again to hear it.');
    });
  }

  function patchScene(index: number, patch: Partial<StickSceneV2>) {
    setDraft(current => current && {
      ...current,
      scenes: current.scenes.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  function addScene() {
    if (!draft) return;
    const lastAt = draft.scenes.at(-1)?.at ?? 0;
    const maxAt = Math.max(0.2, duration - 0.5);
    const nextAt = Math.min(maxAt, Math.round((lastAt + 2.5) * 100) / 100);
    if (nextAt <= lastAt) {
      setError('Recording is too short to add another scene after the last one. Adjust an earlier start time first.');
      return;
    }
    const next: StickSceneV2 = {
      id: `sc-${draft.scenes.length + 1}`,
      at: nextAt,
      headline: 'New visual beat',
      note: '',
      template: 'key_idea',
      data: {},
      side: draft.scenes.length % 2 === 0 ? 'left' : 'right',
      enter: 'slide',
      pose: 'point_stage',
      face: 'neutral',
      energy: 'normal',
      sfx: 'whoosh-transitions-simple-whoosh-1',
    };
    setDraft({ ...draft, scenes: [...draft.scenes, next] });
  }

  function sortScenes() {
    if (!draft) return;
    const sorted = [...draft.scenes]
      .sort((a, b) => a.at - b.at)
      .map((scene, idx) => (idx === 0 ? { ...scene, at: 0 } : scene));
    setDraft({ ...draft, scenes: sorted });
    setNotice('Scenes sorted by start time.');
  }

  async function importDraft() {
    const [file] = await chooseFiles('.json,application/json', false);
    if (!file || !draft) return;
    await work('Importing…', async () => {
      const input = JSON.parse(await file.text());
      const incoming = Array.isArray(input) ? { scenes: input } : input;
      const words = Array.isArray(incoming.words)
        ? incoming.words.filter((word: { type?: string }) => word.type === undefined || word.type === 'word')
        : draft.words;
      const next = { ...draft, ...incoming, words };
      setDraft((await api.saveStick(id, next)).draft);
      setNotice('Draft imported.');
    });
  }

  return (
    <div className="app" style={{ maxWidth: 1180, margin: '0 auto', padding: 24 }}>
      <header className="autoHead">
        <div>
          <a href="/">← PractiReel</a>
          <h1>Stick-figure reel</h1>
        </div>
        <div className="autoActions">
          {id && <button disabled={!enabled} onClick={resetProject}>New / reset</button>}
          <button className="primary" disabled={!enabled} onClick={() => void pick()}>Choose recording</button>
        </div>
      </header>

      {task && <p role="status">{task}</p>}
      {notice && <p role="status">{notice}</p>}
      {(error || render?.error) && (
        <div role="alert" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <span>{error || render?.error}</span>
          {!draft && id && <button onClick={resetProject}>Clear stale project</button>}
        </div>
      )}

      {!draft ? (
        <p>Choose a voiceover or a video with sound to start.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%, 360px),1fr))', gap: 24, alignItems: 'start' }}>
          <section className="panel autoProgress">
            <h2>AI Director &amp; Scenes</h2>
            <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
              <label>
                Creative brief (optional)
                <input
                  value={brief}
                  placeholder="e.g., Punchy Malayalam/English tech explainer, high energy, CTA: Comment APP"
                  onChange={e => setBrief(e.target.value)}
                  disabled={!enabled}
                />
              </label>
              <div className="autoActions" style={{ flexWrap: 'wrap' }}>
                <button
                  className="primary"
                  disabled={!enabled}
                  onClick={() => void work('AI Director is planning scenes, poses & SFX…', async () => {
                    const res = await api.planStick(id, { brief: brief.trim() || undefined, themeId: draft.themeId });
                    setDraft(res.draft);
                    setNotice(`Planned ${res.draft.scenes.length} dynamic scenes.`);
                  })}
                >
                  AI Plan Reel
                </button>
                <button
                  disabled={!enabled}
                  onClick={() => void work('Transcribing with your configured provider…', async () => {
                    if (draft.words.length && !window.confirm('Regenerate captions and default scenes from the transcript?')) return;
                    setDraft((await api.transcribeStick(id)).draft);
                    setNotice('Transcript ready. Click AI Plan Reel to generate choreography.');
                  })}
                >
                  Transcribe
                </button>
                <button disabled={!enabled} onClick={() => void importDraft()}>Import JSON</button>
                <button disabled={!enabled} onClick={sortScenes}>Sort by time</button>
              </div>
            </div>

            {draft.notes && draft.notes.length > 0 && (
              <details style={{ marginBottom: 12 }}>
                <summary>Director notes ({draft.notes.length})</summary>
                <ul>{draft.notes.map((n, idx) => <li key={idx}>{n}</li>)}</ul>
              </details>
            )}

            <fieldset disabled={!enabled} style={{ border: 0, padding: 0, margin: 0 }}>
              {draft.scenes.map((scene, i) => (
                <div key={scene.id || i} style={{ display: 'grid', gap: 8, borderBottom: '1px solid #8884', padding: '14px 0' }}>
                  <div className="autoActions" style={{ flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => seekTo(scene.at)}>▶ Seek</button>
                    <label>
                      Start (s)
                      <input
                        type="number"
                        min="0"
                        max={duration ? Number((duration - 0.1).toFixed(2)) : undefined}
                        step="0.05"
                        value={scene.at}
                        disabled={i === 0}
                        onChange={e => patchScene(i, { at: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                    {scene.beats && scene.beats.length > 0 && (
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{scene.beats.length} mid-scene beat{scene.beats.length === 1 ? '' : 's'}</span>
                    )}
                    {i > 0 && (
                      <button type="button" onClick={() => setDraft({ ...draft, scenes: draft.scenes.filter((_, idx) => idx !== i) })}>
                        Remove
                      </button>
                    )}
                  </div>

                  <label>
                    Headline
                    <input value={scene.headline} maxLength={80} onChange={e => patchScene(i, { headline: e.target.value })} />
                  </label>
                  <label>
                    Supporting text
                    <input value={scene.note} maxLength={140} onChange={e => patchScene(i, { note: e.target.value })} />
                  </label>

                  <div className="autoActions" style={{ flexWrap: 'wrap' }}>
                    <label>
                      Template
                      <select value={scene.template} onChange={e => patchScene(i, { template: e.target.value as StickTemplateId })}>
                        {TEMPLATE_LABELS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </label>
                    <label>
                      Pose
                      <select value={scene.pose} onChange={e => patchScene(i, { pose: e.target.value as StickPose })}>
                        {POSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </label>
                    <label>
                      Face
                      <select value={scene.face} onChange={e => patchScene(i, { face: e.target.value as StickFace })}>
                        {EXPRESSIONS.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="autoActions" style={{ flexWrap: 'wrap' }}>
                    <label>
                      Side
                      <select value={scene.side} onChange={e => patchScene(i, { side: e.target.value as StickSide })}>
                        {SIDES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label>
                      Enter
                      <select value={scene.enter} onChange={e => patchScene(i, { enter: e.target.value as StickEnter })}>
                        {ENTERS.map(en => <option key={en} value={en}>{en}</option>)}
                      </select>
                    </label>
                    <label>
                      Energy
                      <select value={scene.energy} onChange={e => patchScene(i, { energy: e.target.value as StickEnergy })}>
                        {ENERGIES.map(en => <option key={en} value={en}>{en}</option>)}
                      </select>
                    </label>
                  </div>

                  <label>
                    Openverse foley SFX query (optional)
                    <input
                      value={scene.sfxQuery || ''}
                      maxLength={80}
                      placeholder="e.g., cash register bell, camera shutter, keyboard click"
                      onChange={e => patchScene(i, { sfxQuery: e.target.value || undefined })}
                    />
                  </label>
                </div>
              ))}

              <div className="autoActions" style={{ marginTop: 12 }}>
                <button type="button" onClick={addScene}>+ Add scene</button>
              </div>

              <details style={{ marginTop: 16 }}>
                <summary>Captions · {draft.words.length} words</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
                  {draft.words.map((word, i) => (
                    <input
                      key={word.id || i}
                      aria-label={`Caption at ${word.start.toFixed(2)} seconds`}
                      value={word.text}
                      size={Math.min(18, Math.max(5, word.text.length))}
                      maxLength={100}
                      onChange={e => setDraft({
                        ...draft,
                        words: draft.words.map((item, idx) => (idx === i ? { ...item, text: e.target.value } : item)),
                      })}
                    />
                  ))}
                </div>
              </details>
            </fieldset>
          </section>

          <section className="panel autoProgress">
            <h2>Look, Audio &amp; Export</h2>
            {audioUrl && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Voiceover scrubber ({duration.toFixed(1)}s)</div>
                <audio ref={audio} src={audioUrl} controls style={{ width: '100%' }} preload="metadata" />
              </div>
            )}

            <fieldset disabled={!enabled} style={{ border: 0, padding: 0, display: 'grid', gap: 10 }}>
              <div className="autoActions" style={{ flexWrap: 'wrap' }}>
                <label>
                  Theme
                  <select value={draft.themeId} onChange={e => setDraft({ ...draft, themeId: e.target.value })}>
                    {(themes.length ? themes : [{ id: draft.themeId, label: draft.themeId }]).map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Face pack
                  <select value={draft.faces} onChange={e => setDraft({ ...draft, faces: e.target.value })}>
                    {facePacks.map(pack => <option key={pack} value={pack}>{pack}</option>)}
                  </select>
                </label>
              </div>

              <label>
                Top badge
                <input value={draft.badge} maxLength={32} onChange={e => setDraft({ ...draft, badge: e.target.value })} />
              </label>
              <label>
                Background marquee
                <input value={draft.marquee} maxLength={48} onChange={e => setDraft({ ...draft, marquee: e.target.value })} />
              </label>

              <div className="autoActions">
                <button type="button" onClick={() => void pickMusic()}>Import music</button>
                {customMusic && (
                  <button
                    type="button"
                    onClick={() => void work('Restoring default music…', async () => {
                      setCustomMusic((await api.stickMusic(id)).customMusic);
                    })}
                  >
                    Use default music
                  </button>
                )}
              </div>

              <label>
                Music ({Math.round(draft.music * 100)}%)
                <input type="range" min="0" max="1" step=".01" value={draft.music} onChange={e => setDraft({ ...draft, music: Number(e.target.value) })} />
              </label>
              <label>
                Sound effects ({Math.round(draft.sfx * 100)}%)
                <input type="range" min="0" max="1" step=".01" value={draft.sfx} onChange={e => setDraft({ ...draft, sfx: Number(e.target.value) })} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={draft.useOpenverse}
                  onChange={e => setDraft({ ...draft, useOpenverse: e.target.checked })}
                />
                Fetch bespoke CC0/CC-BY foley from Openverse
              </label>

              <div className="autoActions">
                <button
                  type="button"
                  onClick={() => void work('Saving…', async () => {
                    setDraft((await api.saveStick(id, draft)).draft);
                    setNotice('Draft saved.');
                  })}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void work('Starting render…', async () => {
                    setRender((await api.renderStick(id, draft)).render);
                  })}
                >
                  Render MP4
                </button>
              </div>
            </fieldset>

            {render?.state === 'running' && (
              <p role="status">
                {render.stage || `Rendering ${Math.round(render.progress * 100)}%`}{' '}
                <progress max={1} value={render.progress} />
              </p>
            )}
            {render?.state === 'ready' && render.url && (
              <div className="autoPreview">
                <video ref={video} src={`${render.url}?inline=1`} controls playsInline preload="metadata" />
                <div className="autoActions">
                  <a href={render.url}>Download MP4</a>
                  {render.creditsUrl && <a href={render.creditsUrl}>Download credits.txt</a>}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
