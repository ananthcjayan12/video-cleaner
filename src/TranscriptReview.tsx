import { useMemo, useState } from 'react';
import { api, type AutoReview } from './api';
import { flagsToRanges, keepFlags, keptSeconds, sentences } from './review';

/**
 * Review the AI's clean before the reel is made: removed words are struck through; tap a sentence to keep or remove
 * it, or write notes ("keep the part about agencies") and let the AI redo the clean following them.
 */
export function TranscriptReview({ projectId, review }: { projectId: string; review: AutoReview }) {
  const original = useMemo(() => keepFlags(review.words, review.keepRanges), [review]);
  const [flags, setFlags] = useState(original);
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState<'' | 'continue' | 'redo'>('');
  const [error, setError] = useState('');
  const groups = useMemo(() => sentences(review.words), [review.words]);
  const changed = flags.some((flag, i) => flag !== original[i]);
  const seconds = keptSeconds(review.words, flags);

  function toggle(from: number, to: number) {
    const keepAll = flags.slice(from, to + 1).filter(Boolean).length <= (to - from + 1) / 2;
    setFlags((current) => current.map((flag, i) => (i >= from && i <= to ? keepAll : flag)));
  }
  async function send(action: 'continue' | 'redo') {
    try {
      setSending(action); setError('');
      if (action === 'continue') {
        const keepRanges = flagsToRanges(review.words, flags);
        if (!keepRanges.length) throw new Error('Keep at least one sentence.');
        await api.reviewAuto(projectId, { action, keepRanges: changed ? keepRanges : undefined });
      } else {
        await api.reviewAuto(projectId, { action, notes });
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setSending(''); }
  }

  return (
    <div className="review">
      <div className="reviewSummary">
        <strong>{Math.round(seconds)} s kept</strong><span> of {Math.round(review.sourceSeconds)} s</span>
        <small>Grey, struck-through text will be cut. Tap a sentence to keep or remove it.</small>
      </div>
      <div className="reviewText">
        {groups.map(({ from, to }) => {
          const kept = flags.slice(from, to + 1).filter(Boolean).length;
          const state = kept === 0 ? 'cut' : kept === to - from + 1 ? 'kept' : 'partial';
          return (
            <button key={from} type="button" className={`reviewSentence ${state}`} onClick={() => toggle(from, to)} disabled={!!sending}>
              {review.words.slice(from, to + 1).map((word, i) => <span key={word.id} className={flags[from + i] ? 'k' : 'x'}>{word.text} </span>)}
            </button>
          );
        })}
      </div>
      <label className="reviewNotes">Or tell the AI what to keep or remove
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Keep the part about agencies. Remove the hello at the start." disabled={!!sending} />
      </label>
      {error && <p className="autoError">{error}</p>}
      <div className="autoActions">
        <button type="button" className="primary" disabled={!!sending} onClick={() => void send('continue')}>{sending === 'continue' ? 'Continuing…' : changed ? 'Use my changes & continue' : 'Looks good, continue'}</button>
        <button type="button" disabled={!!sending || !notes.trim()} onClick={() => void send('redo')}>{sending === 'redo' ? 'Sending to AI…' : 'Redo with my notes'}</button>
      </div>
      {changed && <button type="button" className="ghost reviewReset" onClick={() => setFlags(original)} disabled={!!sending}>Undo my taps</button>}
    </div>
  );
}
