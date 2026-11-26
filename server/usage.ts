import { AsyncLocalStorage } from 'node:async_hooks';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Cost meter + engine guard.
 *
 * Every AI call and render records what it used into the reel's own `usage.jsonl`, with two prices:
 * - `costUsd`: what it really cost (subscriptions, ChatGPT in Chrome and this computer count as 0);
 * - `apiUsd`: what the same work costs when it runs on paid APIs and a cloud renderer (the price a customer reel has).
 *
 * The context also carries the account's engine profile, so low-level code can refuse a subscription engine
 * (Claude/Codex CLI, ChatGPT in Chrome) for an "api" account no matter which route asked for it.
 */

export type EngineProfile = 'in-house' | 'api';
export const ENGINE_PROFILES: EngineProfile[] = ['in-house', 'api'];
export type UsageKind = 'text' | 'stt' | 'image' | 'render' | 'tts';
export type UsageContext = { file?: string; task: string; profile: EngineProfile; apiTextModel: string };
export type UsageInput = {
  kind: UsageKind; provider: string; model?: string; task?: string;
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number;
  images?: number; audioSeconds?: number; renderSeconds?: number;
  /** Token counts guessed from text length (CLIs that do not report usage). */
  estimated?: boolean;
};
export type UsageEntry = UsageInput & { at: string; task: string; profile: EngineProfile; costUsd: number; apiUsd: number };

/** USD per million tokens [input, output, cache read]. Claude prices from the Anthropic price list (Nov 2026); Gemini/OpenAI text are estimates. */
export const TEXT_PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.1], 'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-fable-5-2': [8, 40, 0.2], 'claude-opus-5': [5, 25, 0.5], 'claude-sonnet-5': [2, 10, 0.2],
  gemini: [0.5, 3, 0.05], openai: [2, 8, 0.5],
};
/** Estimated: Gemini Flash Image is about $0.067 per picture; used as the API price for every picture engine. */
export const IMAGE_PRICE_USD = 0.067;
/** Estimated Gemini audio input price per million tokens (about 32 tokens per second of audio). */
export const AUDIO_INPUT_PRICE = 1;
export const AUDIO_TOKENS_PER_SECOND = 32;
/** Estimated Gemini Flash TTS price: about 25 audio tokens per second at $10 per million output tokens. */
export const TTS_USD_PER_SECOND = 25 * 10 / 1_000_000;
/** Cloud rendering (Cloudflare Containers): 4 vCPU at $0.00002 per vCPU-second plus 4 GiB at $0.0000025 per GiB-second. */
export const RENDER_USD_PER_SECOND = 4 * 0.00002 + 4 * 0.0000025;
export const DEFAULT_API_TEXT_MODEL = 'claude-opus-5-5';

/** Engines that run on a personal subscription or this computer's browser; never allowed for an "api" account. */
export const SUBSCRIPTION_TEXT_PROVIDERS = new Set(['claude-cli', 'codex-cli', 'agy-cli']);
export const SUBSCRIPTION_IMAGE_PROVIDERS = new Set(['chatgpt-browser', 'codex-cli', 'grok-cli']);

const store = new AsyncLocalStorage<UsageContext>();
/** Outside any account context: in-house only when this server may run subscription engines (ALLOWED_ENGINES). */
function defaultContext(): UsageContext {
  const allowed = String(process.env.ALLOWED_ENGINES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return { task: 'other', profile: !allowed.length || allowed.includes('in-house') ? 'in-house' : 'api', apiTextModel: DEFAULT_API_TEXT_MODEL };
}

export function runWithUsage<T>(context: Partial<UsageContext>, work: () => T): T {
  return store.run({ ...defaultContext(), ...store.getStore(), ...context }, work);
}
export function withTask<T>(task: string, work: () => T): T { return runWithUsage({ task }, work); }
export function usageContext(): UsageContext { return store.getStore() ?? defaultContext(); }
export const currentProfile = () => usageContext().profile;

export class EngineNotAllowedError extends Error {
  constructor(engine: string) { super(`${engine} runs on a personal subscription and is turned off for this account. It uses the API engines instead.`); this.name = 'EngineNotAllowedError'; }
}
export function assertTextEngineAllowed(provider: string) {
  if (currentProfile() === 'api' && SUBSCRIPTION_TEXT_PROVIDERS.has(provider)) throw new EngineNotAllowedError(provider);
}
export function assertImageEngineAllowed(provider: string) {
  if (currentProfile() === 'api' && SUBSCRIPTION_IMAGE_PROVIDERS.has(provider)) throw new EngineNotAllowedError(provider);
}

/** Rough token count for CLIs that do not report usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function textPrice(model: string | undefined, provider: string) {
  if (model && TEXT_PRICES[model]) return TEXT_PRICES[model];
  if (model) { const family = Object.keys(TEXT_PRICES).find((key) => model.startsWith(key)); if (family) return TEXT_PRICES[family]; }
  return TEXT_PRICES[provider] ?? TEXT_PRICES.gemini;
}
const tokenCost = (price: [number, number, number], input: UsageInput) =>
  ((input.inputTokens ?? 0) * price[0] + (input.outputTokens ?? 0) * price[1] + (input.cacheReadTokens ?? 0) * price[2] + (input.cacheWriteTokens ?? 0) * price[0] * 1.25) / 1_000_000;

/** Real cost and API-equivalent cost of one usage record. */
export function priceUsage(input: UsageInput, apiTextModel = DEFAULT_API_TEXT_MODEL): { costUsd: number; apiUsd: number } {
  if (input.kind === 'render') return { costUsd: 0, apiUsd: (input.renderSeconds ?? 0) * RENDER_USD_PER_SECOND };
  if (input.kind === 'image') {
    const apiUsd = (input.images ?? 0) * IMAGE_PRICE_USD;
    return { costUsd: SUBSCRIPTION_IMAGE_PROVIDERS.has(input.provider) ? 0 : apiUsd, apiUsd };
  }
  if (input.kind === 'tts') { const cost = (input.audioSeconds ?? 0) * TTS_USD_PER_SECOND; return { costUsd: cost, apiUsd: cost }; }
  if (input.kind === 'stt') {
    const audio = (input.audioSeconds ?? 0) * AUDIO_TOKENS_PER_SECOND * AUDIO_INPUT_PRICE / 1_000_000;
    const cost = input.inputTokens || input.outputTokens ? tokenCost(textPrice(input.model, input.provider), input) : audio;
    return { costUsd: cost, apiUsd: cost };
  }
  if (SUBSCRIPTION_TEXT_PROVIDERS.has(input.provider)) return { costUsd: 0, apiUsd: tokenCost(textPrice(apiTextModel, 'anthropic'), input) };
  const cost = tokenCost(textPrice(input.model, input.provider), input);
  return { costUsd: cost, apiUsd: cost };
}

/** Append one record to the current reel's usage file. Never throws: metering must not break a reel. */
export async function recordUsage(input: UsageInput): Promise<UsageEntry | undefined> {
  const context = usageContext();
  const entry: UsageEntry = { ...input, task: input.task ?? context.task, profile: context.profile, at: new Date().toISOString(), ...priceUsage(input, context.apiTextModel) };
  if (!context.file) return entry;
  try {
    await fs.mkdir(path.dirname(context.file), { recursive: true });
    await fs.appendFile(context.file, JSON.stringify(entry) + '\n');
  } catch { /* metering is best effort */ }
  return entry;
}

export type UsageSummary = {
  costUsd: number; apiUsd: number; estimated: boolean;
  tokens: { input: number; output: number }; images: number; renderSeconds: number; audioSeconds: number;
  byTask: Record<string, { costUsd: number; apiUsd: number }>;
};
export function summarizeUsage(entries: UsageEntry[]): UsageSummary {
  const summary: UsageSummary = { costUsd: 0, apiUsd: 0, estimated: false, tokens: { input: 0, output: 0 }, images: 0, renderSeconds: 0, audioSeconds: 0, byTask: {} };
  for (const entry of entries) {
    summary.costUsd += entry.costUsd; summary.apiUsd += entry.apiUsd;
    summary.estimated ||= Boolean(entry.estimated);
    summary.tokens.input += (entry.inputTokens ?? 0) + (entry.cacheReadTokens ?? 0); summary.tokens.output += entry.outputTokens ?? 0;
    summary.images += entry.images ?? 0; summary.renderSeconds += entry.renderSeconds ?? 0; summary.audioSeconds += entry.audioSeconds ?? 0;
    const task = summary.byTask[entry.task] ??= { costUsd: 0, apiUsd: 0 };
    task.costUsd += entry.costUsd; task.apiUsd += entry.apiUsd;
  }
  const round = (value: number) => Math.round(value * 10000) / 10000;
  summary.costUsd = round(summary.costUsd); summary.apiUsd = round(summary.apiUsd);
  for (const task of Object.values(summary.byTask)) { task.costUsd = round(task.costUsd); task.apiUsd = round(task.apiUsd); }
  return summary;
}
export async function readUsage(file: string): Promise<UsageEntry[]> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as UsageEntry]; } catch { return []; } });
}
export const usageFile = (workDir: string) => path.join(workDir, 'usage.jsonl');
