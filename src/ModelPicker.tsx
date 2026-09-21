import type { ModelOption, SystemStatus, TextProvider } from './api';

export type ModelChoiceProps = {
  title: string;
  provider: TextProvider;
  model: string;
  system: SystemStatus | null;
  agyModels: ModelOption[];
  busy?: boolean;
  onProvider: (value: TextProvider) => void;
  onModel: (value: string) => void;
  refreshAgy: () => void;
};

export function textProviderConfigured(system: SystemStatus | null, provider: TextProvider): boolean {
  if (!system) return false;
  if (provider === 'codex-cli') return system.codex.installed && system.codex.authenticated;
  if (provider === 'agy-cli') return system.agy?.installed ?? false;
  if (provider === 'gemini') return system.imageProviders.gemini.configured;
  return system.imageProviders.openai.configured;
}

export default function ModelPicker(props: ModelChoiceProps) {
  const { title, provider, model, system, agyModels, busy, onProvider, onModel, refreshAgy } = props;
  const installed = textProviderConfigured(system, provider);
  const models = agyModels.some(item => item.id === model)
    ? agyModels : model ? [...agyModels, { id: model, label: model + ' (saved selection)' }] : agyModels;
  return <fieldset className="modelPicker" disabled={busy}>
    <legend>{title}</legend>
    <label>Provider<select value={provider} onChange={event => onProvider(event.target.value as TextProvider)}>
      <option value="codex-cli">Codex CLI · signed-in account</option>
      <option value="agy-cli">AGY CLI · signed-in account</option>
      <option value="gemini">Gemini API · API usage</option>
      <option value="openai">OpenAI API · API usage</option>
    </select></label>
    {provider === 'agy-cli'
      ? <label>Available AGY models<select value={model} onChange={event => onModel(event.target.value)}>
        <option value="">Use AGY CLI default</option>
        {models.map(item => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}
      </select><span className="modelPickerFoot"><button type="button" onClick={refreshAgy}>Refresh installed models</button>{models.length ? models.length + ' models detected' : 'No models detected. Check AGY CLI login and refresh.'}</span></label>
      : <label>{provider === 'codex-cli' ? 'Codex model' : provider === 'gemini' ? 'Gemini text model' : 'OpenAI text model'}
        <input value={model} onChange={event => onModel(event.target.value)} placeholder={provider === 'codex-cli' ? 'CLI default (optional override)' : provider === 'gemini' ? 'e.g. gemini-2.5-flash' : 'e.g. gpt-4.1-mini'} />
        <small>{provider === 'codex-cli' ? 'Leave blank to use your signed-in Codex default.' : 'Enter a model ID enabled for your API key. This selection is separate from image models.'}</small>
      </label>}
    <p className={installed ? 'modelReady' : 'modelWarning'}>{installed ? 'Provider available' : 'Provider not configured or CLI not detected. Configure it in Settings before generating.'}</p>
  </fieldset>;
}
