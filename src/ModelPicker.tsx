import { useEffect, useState } from 'react';
import type { ModelOption, SystemStatus, TextProvider } from './api';

const CLAUDE_MODELS: ModelOption[] = [
  { id: 'best', label: 'Best available (Fable or Opus)' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet[1m]', label: 'Sonnet · 1M context' },
  { id: 'opus[1m]', label: 'Opus · 1M context' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 · pinned' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 · pinned' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · pinned' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 · pinned' },
];

export type ModelChoiceProps = {
  title: string;
  provider: TextProvider;
  model: string;
  system: SystemStatus | null;
  agyModels: ModelOption[];
  codexModels: ModelOption[];
  busy?: boolean;
  onProvider: (value: TextProvider) => void;
  onModel: (value: string) => void;
  refreshAgy: () => void;
  refreshCodex: () => void;
};

export function textProviderConfigured(system: SystemStatus | null, provider: TextProvider): boolean {
  if (!system) return false;
  if (provider === 'codex-cli') return system.codex.installed && system.codex.authenticated;
  if (provider === 'claude-cli') return system.claude.installed && system.claude.authenticated;
  if (provider === 'agy-cli') return system.agy?.installed ?? false;
  if (provider === 'gemini') return system.imageProviders.gemini.configured;
  return system.imageProviders.openai.configured;
}

export default function ModelPicker(props: ModelChoiceProps) {
  const { title, provider, model, system, agyModels, codexModels, busy, onProvider, onModel, refreshAgy, refreshCodex } = props;
  const [customClaudeModel, setCustomClaudeModel] = useState(false);
  useEffect(() => setCustomClaudeModel(false), [provider]);
  const installed = textProviderConfigured(system, provider);
  const availableModels = provider === 'codex-cli' ? codexModels : agyModels;
  const models = availableModels.some(item => item.id === model)
    ? availableModels : model ? [...availableModels, { id: model, label: model + ' (saved selection)' }] : availableModels;
  return <fieldset className="modelPicker" disabled={busy}>
    <legend>{title}</legend>
    <label>Provider<select value={provider} onChange={event => onProvider(event.target.value as TextProvider)}>
      <option value="codex-cli">Codex CLI · signed-in account</option>
      <option value="claude-cli">Claude Code CLI · signed-in account</option>
      <option value="agy-cli">AGY CLI · signed-in account</option>
      <option value="gemini">Gemini API · API usage</option>
      <option value="openai">OpenAI API · API usage</option>
    </select></label>
    {provider === 'claude-cli'
      ? <label>Claude model<select value={customClaudeModel || (model && !CLAUDE_MODELS.some(item => item.id === model)) ? '__custom__' : model} onChange={event => {
        if (event.target.value === '__custom__') { setCustomClaudeModel(true); onModel(''); }
        else { setCustomClaudeModel(false); onModel(event.target.value); }
      }}>
        <option value="">Use Claude CLI default</option>
        <optgroup label="Claude Code aliases">{CLAUDE_MODELS.slice(0, 7).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
        <optgroup label="Current model IDs">{CLAUDE_MODELS.slice(7).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
        <option value="__custom__">Custom model ID…</option>
      </select>{(customClaudeModel || (model && !CLAUDE_MODELS.some(item => item.id === model))) && <input value={model} onChange={event => onModel(event.target.value)} placeholder="Full Claude model ID" />}
      <small>Aliases follow Claude Code updates. Pinned IDs select a specific version. Availability depends on your account; Fable may use usage credits.</small></label>
      : provider === 'agy-cli' || provider === 'codex-cli'
      ? <label>Available {provider === 'codex-cli' ? 'Codex' : 'AGY'} models<select value={model} onChange={event => onModel(event.target.value)}>
        <option value="">Use {provider === 'codex-cli' ? 'Codex' : 'AGY'} CLI default</option>
        {models.map(item => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}
      </select><span className="modelPickerFoot"><button type="button" onClick={provider === 'codex-cli' ? refreshCodex : refreshAgy}>Refresh available models</button>{availableModels.length ? availableModels.length + ' models available' : `No models detected. Check ${provider === 'codex-cli' ? 'Codex' : 'AGY'} CLI login and refresh.`}</span></label>
      : <label>{provider === 'gemini' ? 'Gemini text model' : 'OpenAI text model'}
        <input value={model} onChange={event => onModel(event.target.value)} placeholder={provider === 'gemini' ? 'e.g. gemini-2.5-flash' : 'e.g. gpt-4.1-mini'} />
        <small>Enter a model ID enabled for your API key. This selection is separate from image models.</small>
      </label>}
    <p className={installed ? 'modelReady' : 'modelWarning'}>{installed ? 'Provider available' : 'Provider not configured or CLI not detected. Configure it in Settings before generating.'}</p>
  </fieldset>;
}
