import { useEffect, useState } from 'react';

type Option = { id: string; label: string };
type List = { models: Option[]; source: 'live' | 'built-in'; note?: string };
// One request per provider/kind per page visit; the server itself answers from a day-old disk cache.
const lists = new Map<string, Promise<List>>();
export function modelList(provider: string, kind = 'text'): Promise<List> {
  const key = `${provider}:${kind}`;
  if (!lists.has(key)) {
    lists.set(key, fetch(`/api/models/list?provider=${encodeURIComponent(provider)}&kind=${kind}`, { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<List>).catch(() => ({ models: [], source: 'live' as const, note: 'Could not load models.' })));
  }
  return lists.get(key)!;
}

/** Dropdown of a provider's top 5 models (+ the current one and "Other…" for any model id). */
export function ModelSelect({ provider, kind = 'text', value, onChange, allowDefault = true, className, ariaLabel = 'Model' }: {
  provider: string; kind?: 'text' | 'tts' | 'image' | 'stt'; value: string; onChange: (model: string) => void; allowDefault?: boolean; className?: string; ariaLabel?: string;
}) {
  const [list, setList] = useState<List | null>(null);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { let live = true; setList(null); void modelList(provider, kind).then((l) => { if (live) setList(l); }); return () => { live = false; }; }, [provider, kind]);
  useEffect(() => setDraft(value), [value]);

  if (custom) {
    return <input className={className} aria-label={ariaLabel} autoFocus value={draft} placeholder="model id"
      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setCustom(false); }}
      onBlur={() => { setCustom(false); if (draft.trim() !== value) onChange(draft.trim()); }} />;
  }
  const models = list?.models ?? [];
  const known = !value || models.some((m) => m.id === value);
  return (
    <select className={className} aria-label={ariaLabel} value={value} title={list?.note}
      onChange={(e) => { if (e.target.value === '__other') { setCustom(true); return; } onChange(e.target.value); }}>
      {allowDefault && <option value="">Default model</option>}
      {!known && <option value={value}>{value}</option>}
      {models.map((m) => <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label}`}</option>)}
      {!list && <option disabled>Loading…</option>}
      <option value="__other">Other…</option>
    </select>
  );
}
