import { useEffect, useRef, useState } from 'react';
import type { Idea } from '../api';

/**
 * Record with prompts: the front camera fills the screen, a teleprompter card shows the hook and one talking point at
 * a time (tap it for the next), a 3-minute limit, and several takes that join in order. Nothing is uploaded until the
 * person taps "Use these takes".
 */
const LIMIT = 180; const WARN = 150;
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const pickType = () => (typeof MediaRecorder === 'undefined' ? '' : TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type Take = { file: File; url: string; seconds: number };

export function RecordScreen({ idea, onCancel, onDone }: { idea?: Idea; onCancel: () => void; onDone: (files: File[]) => void }) {
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [point, setPoint] = useState(-1); // -1 = the hook
  const [takes, setTakes] = useState<Take[]>([]);
  const [reviewing, setReviewing] = useState<Take | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false); setError('');
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser cannot use the camera. Use "Upload video" with your camera app instead.'); return; }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then((media) => {
      if (cancelled) { media.getTracks().forEach((t) => t.stop()); return; }
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = media;
      if (live.current) { live.current.srcObject = media; void live.current.play().catch(() => undefined); }
      setReady(true);
    }).catch((err: DOMException) => {
      setError(err?.name === 'NotAllowedError'
        ? 'PractiReel needs the camera and microphone. Allow them in your browser or phone settings, then try again.'
        : 'The camera could not start. Close other apps using it, or use "Upload video" with your camera app.');
    });
    return () => { cancelled = true; };
  }, [facing]);
  // Release the camera when leaving the screen; free the take previews.
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => () => { takes.forEach((take) => URL.revokeObjectURL(take.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000; setSeconds(elapsed);
      if (elapsed >= LIMIT) stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    if (!stream.current) return;
    const type = pickType();
    try {
      const rec = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
      chunks.current = [];
      rec.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      rec.onstop = () => {
        const mime = rec.mimeType || type || 'video/webm';
        const blob = new Blob(chunks.current, { type: mime });
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `take-${takes.length + 1}-${Date.now()}.${ext}`, { type: mime });
        const take = { file, url: URL.createObjectURL(blob), seconds: (Date.now() - started.current) / 1000 };
        setReviewing(take);
      };
      rec.start(1000); recorder.current = rec; started.current = Date.now(); setSeconds(0); setRecording(true); setPoint(-1);
    } catch { setError('Recording is not supported in this browser. Use "Upload video" with your camera app.'); }
  }
  function stop() { if (recorder.current?.state === 'recording') recorder.current.stop(); setRecording(false); }
  function keepTake(next: 'more' | 'done') {
    if (!reviewing) return; const all = [...takes, reviewing]; setTakes(all); setReviewing(null);
    if (next === 'done') { stream.current?.getTracks().forEach((t) => t.stop()); onDone(all.map((take) => take.file)); }
  }
  function discardTake() { if (reviewing) URL.revokeObjectURL(reviewing.url); setReviewing(null); }

  const points = idea?.points ?? [];
  const warn = recording && seconds >= WARN;
  return (
    <div className="pr pr-cam">
      <video ref={live} className={`live${facing === 'user' ? ' mirror' : ''}`} playsInline muted autoPlay />
      {error ? (
        <div className="camerr"><strong>Camera not available</strong><span>{error}</span>
          <button type="button" className="pr-btn primary" onClick={onCancel}>Back</button></div>
      ) : reviewing ? (
        <div className="take">
          <video src={reviewing.url} controls playsInline autoPlay />
          <div className="pr-prompter" style={{ alignItems: 'stretch' }}>
            <strong>Take {takes.length + 1} · {clock(reviewing.seconds)}</strong>
            <span className="hint">Happy with it? Pauses, “umm”s and repeats are cut for you.</span>
            <button type="button" className="pr-btn primary block" onClick={() => keepTake('done')}>{takes.length ? `Use these ${takes.length + 1} takes` : 'Use this take'}</button>
            <div className="pr-grid2">
              <button type="button" className="pr-btn" onClick={() => keepTake('more')}>Keep + record more</button>
              <button type="button" className="pr-btn" onClick={discardTake}>Record again</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="top">
            <div className="bar">
              <button type="button" className="icon" onClick={() => { stop(); onCancel(); }} disabled={recording}>✕ Close</button>
              {takes.length > 0 && <span className="icon" style={{ display: 'inline-flex', alignItems: 'center' }}>{takes.length} take{takes.length === 1 ? '' : 's'} kept</span>}
            </div>
            <button type="button" className="pr-prompter" onClick={() => setPoint((p) => Math.min(points.length - 1, p + 1))} aria-label="Teleprompter: tap for the next point">
              <span className="lbl">{point < 0 ? 'START WITH' : `POINT ${point + 1} OF ${points.length}`}</span>
              <span className="hook">{idea ? (point < 0 ? idea.hook : idea.points[point]) : 'Start with a question your patients ask you.'}</span>
              {idea && points.map((text, i) => <span key={text} className={`pt${i === point ? ' now' : ''}`}>{text}</span>)}
              <span className="hint">{idea ? 'Tap this card for the next point. Talk naturally.' : 'Talk naturally. Pauses and repeats are cut for you.'}</span>
            </button>
          </div>
          <div className="bottom">
            <span className={`pr-timer${recording ? ' live' : ''}${warn ? ' warn' : ''}`}>{recording ? `● ${clock(seconds)}` : ready ? 'Up to 3:00' : 'Starting camera…'}{warn ? ' · 30 s left' : ''}</span>
            <button type="button" className={`pr-rec${recording ? ' on' : ''}`} disabled={!ready} onClick={() => (recording ? stop() : start())} aria-label={recording ? 'Stop recording' : 'Start recording'}><i /></button>
            <span style={{ justifySelf: 'end' }}><button type="button" className="icon" disabled={recording} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>Flip</button></span>
          </div>
        </>
      )}
    </div>
  );
}
