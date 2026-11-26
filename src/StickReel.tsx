import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { chooseFiles, uploadAll } from './device-files';
import type { StickDraft, StickRender, StickScene } from '../server/stick-reel';
import './auto-reel.css';

const presets = ['Desktop', 'Prompt window', 'Expense dashboard', 'Install app', 'Settings', 'Shared workspace', 'Setup guide', 'Key idea'];
const expressions = ['neutral', 'happy', 'surprised', 'thinking', 'smirk'];
const projectKey = 'video-cleaner:stickProject';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function StickReel() {
  const [id, setId] = useState(() => localStorage.getItem(projectKey) || '');
  const [draft, setDraft] = useState<StickDraft | null>(null);
  const [render, setRender] = useState<StickRender | null>(null);
  const [customMusic, setCustomMusic] = useState(false);
  const [task, setTask] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const enabled = !task && render?.state !== 'running';

  useEffect(() => {
    if (!id) return;
    let lost = false;
    void api.stick(id).then(result => {
      if (!lost) { setDraft(result.draft); setRender(result.render); setCustomMusic(result.customMusic); }
    }).catch(err => { if (!lost) setError(message(err)); });
    return () => { lost = true; };
  }, [id]);

  useEffect(() => {
    if (!id || render?.state !== 'running') return;
    const timer = setTimeout(() => {
      void api.stick(id).then(result => setRender(result.render))
        .catch(err => { setError(message(err)); setRender({ state: 'failed', progress: 0 }); });
    }, 1200);
    return () => clearTimeout(timer);
  }, [id, render]);

  async function work(label: string, action: () => Promise<void>) {
    setError(''); setNotice(''); setTask(label);
    try { await action(); } catch (err) { setError(message(err)); }
    finally { setTask(''); }
  }

  async function pick() {
    const files = await chooseFiles('audio/*,video/*,.mp3,.wav,.m4a,.aac,.mov,.mp4,.m4v,.webm,.mkv', false);
    if (!files.length) return;
    await work('Uploading recording…', async () => {
      const [uploadId] = await uploadAll(files, setTask);
      const project = await api.createStick(uploadId);
      localStorage.setItem(projectKey, project.id);
      setRender(null); setDraft(null); setId(project.id);
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

  function editScene(index: number, scene: StickScene) {
    setDraft(current => current && { ...current, scenes: current.scenes.map((item, i) => i === index ? scene : item) });
  }
  async function importDraft() {
    const [file] = await chooseFiles('.json,application/json', false);
    if (!file || !draft) return;
    await work('Importing…', async () => {
      const input = JSON.parse(await file.text());
      const incoming = Array.isArray(input) ? { scenes: input } : input;
      const words = Array.isArray(incoming.words) ? incoming.words
        .filter((word: { type?: string }) => word.type === undefined || word.type === 'word') : draft.words;
      const next = { ...draft, ...incoming, words };
      setDraft((await api.saveStick(id, next)).draft);
      setNotice('Draft imported.');
    });
  }

  return <div className="app" style={{maxWidth:1100,margin:'0 auto',padding:24}}>
    <header className="autoHead"><div><a href="/">← PractiReel</a><h1>Stick-figure reel</h1></div>
      <button className="primary" disabled={!enabled} onClick={() => void pick()}>Choose recording</button></header>
    {task && <p role="status">{task}</p>}
    {notice && <p role="status">{notice}</p>}
    {(error || render?.error) && <p role="alert">{error || render?.error}</p>}
    {!draft ? <p>Choose a voiceover or a video with sound to start.</p> : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%, 320px),1fr))',gap:24,alignItems:'start'}}>
      <section className="panel autoProgress">
        <h2>Scenes</h2>
        <div className="autoActions" style={{flexWrap:'wrap'}}>
          <button disabled={!enabled} onClick={() => void work('Transcribing with your configured provider…', async () => {
            if (draft.words.length && !window.confirm('Regenerate the captions and scenes from the project transcript?')) return;
            setDraft((await api.transcribeStick(id)).draft);
          })}>Transcribe &amp; draft</button>
          <button disabled={!enabled} onClick={() => void importDraft()}>Import JSON</button>
          <button disabled={!enabled} onClick={() => void work('Copying…', async () => {
            await navigator.clipboard.writeText(`Return a JSON array of scenes [startSeconds, headline, supportingText, presetIndex, expression]. First scene starts at 0. Anchor later scenes to spoken word starts. Headlines max 80 characters; supporting text max 140. Use presets only where relevant: ${presets.join(', ')} (indices 0–7). Expressions: ${expressions.join(', ')}.\n${JSON.stringify(draft.words)}`);
            setNotice('Scene prompt copied.');
          })}>Copy scene prompt</button>
        </div>
        <fieldset disabled={!enabled} style={{border:0,padding:0,margin:0}}>
        {draft.scenes.map((scene, i) => <div key={i} style={{display:'grid',gap:8,borderBottom:'1px solid #8884',padding:'14px 0'}}>
          <div className="autoActions">
            <button onClick={() => { if (video.current) video.current.currentTime = scene[0]; }}>Seek</button>
            <label>Start <input type="number" min="0" step=".033333" value={scene[0]} disabled={i === 0} onChange={event => editScene(i, [Number(event.target.value), ...scene.slice(1)] as StickScene)} /></label>
            {i > 0 && <button onClick={() => setDraft({ ...draft, scenes: draft.scenes.filter((_, index) => index !== i) })}>Remove</button>}
          </div>
          <label>Headline <input value={scene[1]} maxLength={80} onChange={event => editScene(i, [scene[0], event.target.value, scene[2], scene[3], scene[4]])} /></label>
          <label>Supporting text <input value={scene[2]} maxLength={140} onChange={event => editScene(i, [scene[0], scene[1], event.target.value, scene[3], scene[4]])} /></label>
          <div className="autoActions"><label>Stage <select value={scene[3]} onChange={event => editScene(i, [scene[0], scene[1], scene[2], Number(event.target.value), scene[4]])}>
            {presets.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
            <label>Face <select value={scene[4]} onChange={event => editScene(i, [scene[0], scene[1], scene[2], scene[3], event.target.value])}>
              {expressions.map(name => <option key={name}>{name}</option>)}</select></label></div>
        </div>)}
        <button onClick={() => setDraft({ ...draft, scenes: [...draft.scenes, [(draft.scenes.at(-1)?.[0] ?? 0) + 2, 'New scene', '', 7, 'neutral']] })}>Add scene</button>
        <details style={{marginTop:16}}><summary>Captions · {draft.words.length} words</summary>
          <div style={{display:'flex',flexWrap:'wrap',gap:7,marginTop:8}}>
          {draft.words.map((word, i) => <input key={i} aria-label={`Caption at ${word.start.toFixed(2)} seconds`} value={word.text} size={Math.min(18, Math.max(5, word.text.length))} maxLength={100}
            onChange={event => setDraft({ ...draft, words: draft.words.map((item, index) => index === i ? { ...item, text: event.target.value } : item) })} />)}
          </div>
        </details>
        </fieldset>
      </section>
      <section className="panel autoProgress">
        <h2>Preview and export</h2>
        <fieldset disabled={!enabled} style={{border:0,padding:0,display:'grid',gap:10}}>
          <div className="autoActions"><button onClick={() => void pickMusic()}>Import music</button>
            {customMusic && <button onClick={() => void work('Restoring music…', async () => {
              setCustomMusic((await api.stickMusic(id)).customMusic);
            })}>Use default music</button>}</div>
          <label>Music <input type="range" min="0" max="1" step=".01" value={draft.music} onChange={event => setDraft({ ...draft, music: Number(event.target.value) })} /></label>
          <label>Sound effects <input type="range" min="0" max="1" step=".01" value={draft.sfx} onChange={event => setDraft({ ...draft, sfx: Number(event.target.value) })} /></label>
          <div className="autoActions">
            <button onClick={() => void work('Saving…', async () => { setDraft((await api.saveStick(id, draft)).draft); setNotice('Draft saved.'); })}>Save draft</button>
            <button className="primary" onClick={() => void work('Starting render…', async () => setRender((await api.renderStick(id, draft)).render))}>Render preview</button>
          </div>
        </fieldset>
        {render?.state === 'running' && <p role="status">Rendering {Math.round(render.progress * 100)}% <progress max={1} value={render.progress} /></p>}
        {render?.state === 'ready' && render.url && <div className="autoPreview"><video ref={video} src={`${render.url}?inline=1`} controls playsInline preload="metadata" /><a href={render.url}>Download MP4</a></div>}
      </section>
    </div>}
  </div>;
}
