import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { assertTextEngineAllowed, estimateTokens, recordUsage } from './usage.js';

export type TextProvider = 'codex-cli' | 'claude-cli' | 'agy-cli' | 'gemini' | 'openai' | 'anthropic';
export const TEXT_PROVIDERS: TextProvider[] = ['codex-cli', 'claude-cli', 'agy-cli', 'gemini', 'openai', 'anthropic'];
/** effort: reasoning effort passed to the Claude CLI (--effort) or Codex (model_reasoning_effort), like story-reels. */
export type TextModelChoice = { provider: TextProvider; model: string; effort?: string };
export type TextModelConfig = {
  codexBin?: string; claudeBin?: string; agyBin?: string; openAiApiKey?: string; geminiApiKey?: string; anthropicApiKey?: string;
};
export type ModelOption = { id: string; label: string };

class CommandExecutionError extends Error {
  constructor(message: string, readonly stdout: string, readonly stderr: string, readonly exitCode?: number) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

async function command(bin: string, args: string[], input?: string, cwd?: string, timeoutMs = 600000, signal?: AbortSignal) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, shell: false, windowsHide: true, signal });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true; child.kill('SIGTERM');
        reject(new CommandExecutionError(path.basename(bin) + ' timed out', stdout, stderr));
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 8_000_000) child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { stderr += String(chunk); if (stderr.length > 200_000) child.kill('SIGTERM'); });
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) {
        const details = (stderr.trim() || stdout.trim()).slice(-3000);
        reject(new CommandExecutionError(path.basename(bin) + ' exited ' + code + (details ? ': ' + details : ''), stdout, stderr, code ?? undefined));
      }
      else resolve(stdout);
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && !settled) { settled = true; clearTimeout(timer); reject(error); }
    });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
async function inlineImage(file: string) { return { mimeType: IMAGE_MIME[path.extname(file).toLowerCase()] || 'image/png', data: (await fs.readFile(file)).toString('base64') }; }
async function dataUrl(file: string) { const image = await inlineImage(file); return 'data:' + image.mimeType + ';base64,' + image.data; }

export function parseAgyModels(output: string): ModelOption[] {
  // AGY currently emits tab-separated rows, while older releases used aligned
  // columns. Accept both formats and ignore status/progress lines.
  const options: ModelOption[] = []; const seen = new Set<string>();
  for (const line of output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-z0-9][a-z0-9._:/-]*)(?:\t+| {2,})(\S.*?)\s*$/i);
    if (!match || seen.has(match[1])) continue;
    options.push({ id: match[1], label: match[2].trim() }); seen.add(match[1]);
  }
  return options;
}

export async function availableAgyModels(bin?: string): Promise<ModelOption[]> {
  if (!bin) return [];
  const models = parseAgyModels(await command(bin, ['models'], undefined, undefined, 12000));
  if (!models.length) throw new Error('AGY CLI returned no recognizable models. Run `agy models` in Terminal to verify the signed-in account.');
  return models;
}

export function parseCodexModels(output: string): ModelOption[] {
  const catalog = JSON.parse(output) as { models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown; priority?: unknown }> };
  if (!Array.isArray(catalog.models)) throw new Error('Codex CLI returned an invalid model catalog.');
  return catalog.models
    .filter(model => model.visibility === 'list' && typeof model.slug === 'string' && model.slug.length > 0)
    .sort((left, right) => Number(left.priority ?? 999) - Number(right.priority ?? 999))
    .map(model => ({ id: model.slug as string, label: typeof model.display_name === 'string' ? model.display_name : model.slug as string }));
}

export async function availableCodexModels(bin?: string): Promise<ModelOption[]> {
  if (!bin) return [];
  return parseCodexModels(await command(bin, ['debug', 'models'], undefined, undefined, 15000));
}

export type ModelKind = 'text' | 'tts' | 'image' | 'stt';
export type ModelList = { models: ModelOption[]; source: 'live' | 'built-in'; note?: string };
/** Current Claude models; used for the Claude CLI (which cannot list models) and when no Claude API key is set. */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (best)' }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fastest)' }, { id: 'claude-fable-5-2', label: 'Fable 5.2' },
];
const CLAUDE_CLI_ALIASES: ModelOption[] = [{ id: 'opus', label: 'opus (latest Opus)' }, { id: 'sonnet', label: 'sonnet (latest Sonnet)' }, { id: 'haiku', label: 'haiku (latest Haiku)' }];

/** Sort Gemini's catalogue into what each pipeline step can use. */
export function geminiKindOf(id: string): ModelKind | null {
  if (/embedding|aqa|lyria|robotics|computer-use|antigravity|deep-research|genie|decision|live|native-audio|gemma/.test(id)) return null;
  if (/tts/.test(id)) return 'tts';
  if (/image|banana/.test(id)) return 'image';
  if (/transcribe/.test(id)) return 'stt';
  return 'text';
}
/** Newest first: higher version number, stable before preview, dated names by date. */
export function modelRank(id: string): number[] {
  const version = (/(\d+(?:\.\d+)?)/.exec(id.replace(/^gpt-/, 'gpt-').replace(/(\d{4})-?(\d{2})/, ''))?.[1] ?? '0').split('.').map(Number);
  const preview = /preview|exp|latest|-\d{2}-\d{4}/.test(id) ? 0 : 1;
  return [version[0] ?? 0, version[1] ?? 0, preview];
}
export function topModels(models: ModelOption[], count = 5, keepOrder = false): ModelOption[] {
  const unique = [...new Map(models.map((m) => [m.id, m])).values()];
  if (keepOrder) return unique.slice(0, count);
  return unique.map((m, i) => ({ m, i, r: modelRank(m.id) }))
    .sort((a, b) => b.r[0] - a.r[0] || b.r[1] - a.r[1] || b.r[2] - a.r[2] || a.i - b.i)
    .slice(0, count).map((x) => x.m);
}

// Model lists are cached on disk for a day and served from there; a stale list is returned at once and refreshed in the background.
const MODEL_CACHE_TTL = 24 * 3600_000;
const modelCacheFile = () => path.join(process.env.VIDEO_CLEANER_CONFIG_DIR || path.join(os.homedir(), '.video-cleaner'), 'model-cache.json');
let modelCache: Map<string, { at: number; list: ModelList }> | null = null;
const refreshing = new Set<string>();
async function loadModelCache() {
  if (modelCache) return modelCache;
  const raw = await fs.readFile(modelCacheFile(), 'utf8').then((text) => JSON.parse(text) as Record<string, { at: number; list: ModelList }>).catch(() => ({}));
  modelCache = new Map(Object.entries(raw));
  return modelCache;
}
async function saveModelCache() {
  if (!modelCache) return;
  await fs.mkdir(path.dirname(modelCacheFile()), { recursive: true }).catch(() => undefined);
  await fs.writeFile(modelCacheFile(), JSON.stringify(Object.fromEntries(modelCache), null, 1)).catch(() => undefined);
}

/** Top 5 models a provider offers for one kind of job, from the day-old cache when there is one. */
export async function listProviderModels(provider: string, kind: ModelKind, config: TextModelConfig & { agyBin?: string }, options: { force?: boolean } = {}): Promise<ModelList> {
  const cache = await loadModelCache();
  const key = `${provider}:${kind}:${config.anthropicApiKey ? 'a' : ''}${config.openAiApiKey ? 'o' : ''}${config.geminiApiKey ? 'g' : ''}`;
  const cached = cache.get(key);
  const refresh = async () => {
    const list = await fetchProviderModels(provider, kind, config).catch((error): ModelList => ({ models: cached?.list.models ?? [], source: 'live', note: error instanceof Error ? error.message : String(error) }));
    cache.set(key, { at: Date.now(), list }); await saveModelCache();
    return list;
  };
  if (cached && !options.force) {
    if (Date.now() - cached.at > MODEL_CACHE_TTL && !refreshing.has(key)) {
      refreshing.add(key); void refresh().finally(() => refreshing.delete(key));
    }
    return cached.list;
  }
  return refresh();
}

async function fetchProviderModels(provider: string, kind: ModelKind, config: TextModelConfig & { agyBin?: string }): Promise<ModelList> {
  const all = await (async (): Promise<ModelList> => {
    if (provider === 'codex-cli' || provider === 'codex') return { models: await availableCodexModels(config.codexBin), source: 'live' };
    if (provider === 'agy-cli') { const models = await availableAgyModels(config.agyBin); return { models, source: 'live', ...(models.length ? {} : { note: 'Antigravity reported no models.' }) }; }
    if (provider === 'anthropic' || provider === 'claude-cli' || provider === 'claude') {
      const cli = provider !== 'anthropic';
      if (config.anthropicApiKey) {
        try {
          const client = new Anthropic({ apiKey: config.anthropicApiKey }); const models: ModelOption[] = [];
          for await (const model of client.models.list({ limit: 100 })) models.push({ id: model.id, label: model.display_name || model.id });
          if (models.length) return { models: cli ? [...models, ...CLAUDE_CLI_ALIASES] : models, source: 'live' };
        } catch { /* fall back to the built-in list */ }
      }
      return { models: cli ? [...CLAUDE_MODELS, ...CLAUDE_CLI_ALIASES] : CLAUDE_MODELS, source: 'built-in', note: cli ? 'The Claude CLI cannot list models; add a Claude API key to read the live list.' : 'Add a Claude API key to read the live list.' };
    }
    if (provider === 'openai') {
      if (!config.openAiApiKey) return { models: [], source: 'live', note: 'Add an OpenAI API key to list its models.' };
      const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + config.openAiApiKey }, signal: AbortSignal.timeout(15000) });
      const body = await response.json() as { data?: Array<{ id: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error('OpenAI: ' + (body.error?.message || response.status));
      const wanted = kind === 'image' ? /image|dall-e/ : kind === 'tts' ? /tts/ : kind === 'stt' ? /transcribe|whisper/ : /^(gpt|o\d|chatgpt)/;
      const skip = kind === 'text' ? /audio|realtime|tts|transcribe|image|search|embedding/ : /$^/;
      return { models: (body.data ?? []).map((m) => m.id).filter((id) => wanted.test(id) && !skip.test(id)).sort().reverse().map((id) => ({ id, label: id })), source: 'live' };
    }
    if (provider === 'gemini') {
      if (!config.geminiApiKey) return { models: [], source: 'live', note: 'Add a Gemini API key to list its models.' };
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': config.geminiApiKey }, signal: AbortSignal.timeout(15000) });
      const body = await response.json() as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>; error?: { message?: string } };
      if (!response.ok) throw new Error('Gemini: ' + (body.error?.message || response.status));
      const models = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
        .filter((m) => { const k = geminiKindOf(m.id); return k === kind || (kind === 'stt' && k === 'text'); });
      return { models: models.reverse(), source: 'live' };
    }
    return { models: [], source: 'live', note: `Unknown provider ${provider}.` };
  })();
  // Codex and Claude lists are already in the provider's own order of importance; the rest are ranked newest first.
  const keepOrder = ['codex-cli', 'codex', 'agy-cli', 'anthropic', 'claude-cli', 'claude'].includes(provider);
  if (provider === 'gemini' && kind === 'stt') {
    // Dedicated transcription models first, then the newest general models.
    const dedicated = topModels(all.models.filter((m) => geminiKindOf(m.id) === 'stt'), 2);
    return { ...all, models: [...dedicated, ...topModels(all.models.filter((m) => geminiKindOf(m.id) !== 'stt'), 5 - dedicated.length)] };
  }
  return { ...all, models: topModels(all.models, 5, keepOrder) };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* Try embedded JSON below. */ }

  // AGY can return the requested JSON in a fenced block and append a second
  // tool-status JSON object. Parsing from the first "{" to the last "}" joins
  // those two valid objects into invalid JSON, so inspect each fence first.
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try { return JSON.parse(match[1].trim()); } catch { /* Try the next block. */ }
  }

  // Finally find the first complete JSON object/array. This accepts prose around
  // JSON while respecting braces inside quoted strings.
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{' && trimmed[start] !== '[') continue;
    const stack: string[] = []; let inString = false; let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') { inString = true; continue; }
      if (character === '{' || character === '[') stack.push(character);
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (!stack.length) {
          try { return JSON.parse(trimmed.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error('No valid JSON object or array was found in the model response.');
}

async function writeGenerationLog(workDir: string, outputName: string, details: Record<string, unknown>): Promise<string | undefined> {
  try {
    const directory = path.join(workDir, 'generation-logs', 'text');
    await fs.mkdir(directory, { recursive: true });
    const safeName = outputName.replace(/[^a-z0-9._-]+/gi, '-');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const contents = JSON.stringify(details, null, 2);
    const datedPath = path.join(directory, `${safeName}-${timestamp}.json`);
    const latestPath = path.join(directory, `${safeName}-latest.json`);
    await fs.writeFile(datedPath, contents);
    await fs.writeFile(latestPath, contents);
    return latestPath;
  } catch {
    // Diagnostics must never replace the original generation error.
    return undefined;
  }
}

/** Effort (low/medium/high/xhigh/max) mapped to OpenAI reasoning_effort and Gemini thinkingLevel, which top out at high. */
export const openAiEffort = (effort: string) => (effort === 'low' || effort === 'medium' ? effort : 'high');
export const geminiThinkingLevel = (effort: string) => (effort === 'low' || effort === 'medium' ? effort : 'high');

export async function generateStructuredText(options: {
  choice: TextModelChoice; config: TextModelConfig; workDir: string;
  prompt: string; schema: Record<string, unknown>; outputName: string;
  /** Reference images. Files must sit inside workDir so tool-restricted CLIs may read them. */
  images?: string[];
  signal?: AbortSignal;
}): Promise<unknown> {
  const { choice, config, workDir, schema, prompt } = options;
  assertTextEngineAllowed(choice.provider);
  const model = choice.model.trim();
  const images = options.images ?? [];
  const imageNote = images.length ? '\n\nREFERENCE IMAGE FILES (look at every one before answering):\n' + images.map(file => '- ' + file).join('\n') : '';
  const jsonPrompt = prompt + imageNote + '\n\nReturn ONLY a complete JSON object satisfying this JSON schema, with no markdown or commentary:\n' + JSON.stringify(schema);
  if (choice.provider === 'codex-cli') {
    if (!config.codexBin) throw new Error('Codex CLI was not found.');
    const schemaFile = path.join(workDir, options.outputName + '.schema.json');
    const outputFile = path.join(workDir, options.outputName + '.json');
    await fs.writeFile(schemaFile, JSON.stringify(schema, null, 2));
    const args = ['exec', '--ephemeral', '--skip-git-repo-check'];
    if (model) args.push('--model', model);
    if (choice.effort) args.push('--config', `model_reasoning_effort=${JSON.stringify(choice.effort)}`);
    for (const image of images) args.push('--image', image);
    args.push('--output-schema', schemaFile, '--output-last-message', outputFile, '-');
    await command(config.codexBin, args, jsonPrompt, workDir, undefined, options.signal);
    const output = await fs.readFile(outputFile, 'utf8');
    await recordUsage({ kind: 'text', provider: choice.provider, model: model || 'codex default', inputTokens: estimateTokens(jsonPrompt) + images.length * 1600, outputTokens: estimateTokens(output), estimated: true });
    return parseModelJson(output);
  }
  if (choice.provider === 'claude-cli') {
    if (!config.claudeBin) throw new Error('Claude CLI was not found.');
    const args = ['--print', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--tools', images.length ? 'Read' : '', ...(images.length ? ['--allowedTools', 'Read'] : []), '--output-format', 'json', '--json-schema', JSON.stringify(schema)];
    if (model) args.push('--model', model);
    if (choice.effort) args.push('--effort', choice.effort);
    const envelope = parseModelJson(await command(config.claudeBin, args, jsonPrompt, workDir, undefined, options.signal)) as {
      is_error?: boolean; result?: string; structured_output?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const reported = envelope?.usage;
    await recordUsage(reported ? { kind: 'text', provider: choice.provider, model: model || 'claude default', inputTokens: reported.input_tokens, outputTokens: reported.output_tokens, cacheReadTokens: reported.cache_read_input_tokens, cacheWriteTokens: reported.cache_creation_input_tokens }
      : { kind: 'text', provider: choice.provider, model: model || 'claude default', inputTokens: estimateTokens(jsonPrompt), outputTokens: estimateTokens(JSON.stringify(envelope?.structured_output ?? envelope?.result ?? '')), estimated: true });
    if (envelope?.is_error) throw new Error('Claude CLI: ' + (envelope.result || 'Generation failed.'));
    const parsed = envelope?.structured_output != null ? envelope.structured_output : parseModelJson(envelope?.result || '');
    await fs.writeFile(path.join(workDir, options.outputName + '.json'), JSON.stringify(parsed, null, 2));
    return parsed;
  }
  if (choice.provider === 'agy-cli') {
    if (!config.agyBin) throw new Error('AGY CLI is not installed or configured.');
    if (images.length) throw new Error('AGY cannot receive reference images in a tool-free request. Use Claude, Codex, Gemini or OpenAI for template-based designs.');
    // AGY is an agentic CLI and may otherwise decide to inspect the workspace
    // instead of answering a self-contained structured-output request. Keep the
    // turn explicitly tool-free; all required input is already in the prompt.
    const agyPrompt = `TOOL-FREE STRUCTURED-OUTPUT TASK. Do not call tools, run commands, read files, browse, create artifacts, or inspect the workspace. Everything required is included below. Respond immediately with only the JSON object required by the schema.\n\n${jsonPrompt}`;
    const args = ['--disable-slash-commands', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--print-timeout', '10m'];
    if (model) args.push('--model', model);
    args.push('-p', agyPrompt);
    const startedAt = new Date(); let rawOutput = ''; let result: {
      conversation_id?: string; status?: string; error?: string; structured_output?: unknown; response?: string;
      denied_actions?: Array<{ action?: string; display_name?: string }>;
    } | undefined;
    try {
      rawOutput = await command(config.agyBin, args, undefined, workDir, undefined, options.signal);
      const envelope = parseModelJson(rawOutput);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('AGY CLI returned an invalid response envelope.');
      result = envelope as typeof result;
      if (result?.status !== 'SUCCESS') throw new Error('AGY CLI: ' + (result?.error || result?.status || 'No response'));
      if (result.structured_output === undefined && !result.response?.trim() && result.denied_actions?.length) {
        const actions = result.denied_actions.map((action) => action.display_name || action.action || 'unknown tool').join(', ');
        throw new Error(`AGY returned an empty response after attempting disallowed tool actions (${actions}). The request was self-contained and did not require tools.`);
      }
      const parsed = result.structured_output !== null && typeof result.structured_output === 'object'
        ? result.structured_output
        : parseModelJson(result.response || '');
      await fs.writeFile(path.join(workDir, options.outputName + '.json'), JSON.stringify(parsed, null, 2));
      await recordUsage({ kind: 'text', provider: choice.provider, model: model || 'agy default', inputTokens: estimateTokens(agyPrompt), outputTokens: estimateTokens(JSON.stringify(parsed)), estimated: true });
      await writeGenerationLog(workDir, options.outputName, {
        timestamp: new Date().toISOString(), provider: choice.provider, model: model || '(AGY default)', status: 'success',
        durationMs: Date.now() - startedAt.getTime(), conversationId: result.conversation_id, promptCharacters: agyPrompt.length,
        schema, rawOutput, parsedOutput: parsed,
      });
      return parsed;
    } catch (error) {
      if (error instanceof CommandExecutionError && !rawOutput) rawOutput = error.stdout;
      const message = error instanceof Error ? error.message : String(error);
      const logPath = await writeGenerationLog(workDir, options.outputName, {
        timestamp: new Date().toISOString(), provider: choice.provider, model: model || '(AGY default)', status: 'failed',
        durationMs: Date.now() - startedAt.getTime(), conversationId: result?.conversation_id, promptCharacters: agyPrompt.length,
        schema, error: message, stack: error instanceof Error ? error.stack : undefined,
        stdout: rawOutput, stderr: error instanceof CommandExecutionError ? error.stderr : undefined, responseEnvelope: result,
      });
      throw new Error(`${message}${logPath ? ` Diagnostic log: ${logPath}` : ''}`);
    }
  }
  if (choice.provider === 'anthropic') return generateWithAnthropic({ ...options, model: model || DEFAULT_ANTHROPIC_MODEL, jsonPrompt, images });
  if (!model) throw new Error('Choose a model for ' + choice.provider + ' text generation.');
  if (choice.provider === 'openai') {
    if (!config.openAiApiKey) throw new Error('OpenAI API key is missing.');
    const messages = [{ role: 'user', content: images.length ? [{ type: 'text', text: jsonPrompt }, ...await Promise.all(images.map(async file => ({ type: 'image_url', image_url: { url: await dataUrl(file) } })))] : jsonPrompt }];
    const callOpenAi = (withEffort: boolean) => fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + config.openAiApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, ...(withEffort ? { reasoning_effort: openAiEffort(choice.effort!) } : {}) }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
    });
    let response = await callOpenAi(Boolean(choice.effort));
    let body = await response.json() as any;
    // Models without reasoning reject reasoning_effort: retry once without it rather than failing the reel.
    if (!response.ok && choice.effort && /reasoning/i.test(String(body.error?.message))) { response = await callOpenAi(false); body = await response.json() as any; }
    if (!response.ok) throw new Error('OpenAI: ' + (body.error?.message || response.status));
    await recordUsage({ kind: 'text', provider: 'openai', model, inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens });
    return parseModelJson(body.choices?.[0]?.message?.content || '');
  }
  if (!config.geminiApiKey) throw new Error('Gemini API key is missing.');
  const parts = [{ text: jsonPrompt }, ...await Promise.all(images.map(async file => ({ inlineData: await inlineImage(file) })))];
  const callGemini = (withEffort: boolean) => fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', headers: { 'x-goog-api-key': config.geminiApiKey!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', ...(withEffort ? { thinkingConfig: { thinkingLevel: geminiThinkingLevel(choice.effort!) } } : {}) } }),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
  });
  let response = await callGemini(Boolean(choice.effort));
  let body = await response.json() as any;
  // Older Gemini models have no thinking levels: retry once without.
  if (!response.ok && choice.effort && /think/i.test(String(body.error?.message))) { response = await callGemini(false); body = await response.json() as any; }
  if (!response.ok) throw new Error('Gemini: ' + (body.error?.message || response.status));
  await recordUsage({ kind: 'text', provider: 'gemini', model, inputTokens: body.usageMetadata?.promptTokenCount, outputTokens: (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0) });
  return parseModelJson((body.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text || '').join(''));
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const CLAUDE_IMAGE_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * Claude API (paid key, for "api" accounts). Structured output through output_config.format with the task's JSON
 * schema; if the API refuses a schema feature, the request is repeated with the schema only in the prompt.
 * Server-side fallbacks keep a reel going if the main model declines a request.
 */
async function generateWithAnthropic(options: {
  choice: TextModelChoice; config: TextModelConfig; workDir: string; schema: Record<string, unknown>; outputName: string;
  model: string; jsonPrompt: string; images: string[]; signal?: AbortSignal;
}): Promise<unknown> {
  if (!options.config.anthropicApiKey) throw new Error('Claude API key is missing (Settings → Claude API key).');
  const client = new Anthropic({ apiKey: options.config.anthropicApiKey });
  const effort = EFFORTS.find((value) => value === options.choice.effort) ?? 'medium';
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...await Promise.all(options.images.map(async (file) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: CLAUDE_IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'image/jpeg', data: (await fs.readFile(file)).toString('base64') },
    }))),
    { type: 'text', text: options.jsonPrompt },
  ];
  const request = (withSchema: boolean) => client.beta.messages.stream({
    model: options.model, max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: withSchema ? { effort, format: { type: 'json_schema', schema: options.schema } } : { effort },
    messages: [{ role: 'user', content }],
  }, { signal: options.signal }).finalMessage();
  let message: Anthropic.Beta.BetaMessage;
  try { message = await request(true); }
  catch (error) {
    // Some task schemas use JSON-schema features structured outputs does not accept; the prompt already carries the schema.
    if (!(error instanceof Anthropic.BadRequestError) || !/schema|format/i.test(error.message)) throw error;
    message = await request(false);
  }
  const usage = message.usage;
  await recordUsage({ kind: 'text', provider: 'anthropic', model: message.model || options.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0 });
  if (message.stop_reason === 'refusal') throw new Error('Claude declined this request. Edit the transcript or notes and try again.');
  if (message.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing the answer.');
  const text = message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('');
  const parsed = parseModelJson(text);
  await fs.writeFile(path.join(options.workDir, options.outputName + '.json'), JSON.stringify(parsed, null, 2));
  return parsed;
}
