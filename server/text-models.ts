import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + config.openAiApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: images.length ? [{ type: 'text', text: jsonPrompt }, ...await Promise.all(images.map(async file => ({ type: 'image_url', image_url: { url: await dataUrl(file) } })))] : jsonPrompt }], response_format: { type: 'json_object' } }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
    });
    const body = await response.json() as any;
    if (!response.ok) throw new Error('OpenAI: ' + (body.error?.message || response.status));
    await recordUsage({ kind: 'text', provider: 'openai', model, inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens });
    return parseModelJson(body.choices?.[0]?.message?.content || '');
  }
  if (!config.geminiApiKey) throw new Error('Gemini API key is missing.');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', headers: { 'x-goog-api-key': config.geminiApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: jsonPrompt }, ...await Promise.all(images.map(async file => ({ inlineData: await inlineImage(file) })))] }], generationConfig: { responseMimeType: 'application/json' } }),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
  });
  const body = await response.json() as any;
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
