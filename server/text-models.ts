import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type TextProvider = 'codex-cli' | 'agy-cli' | 'gemini' | 'openai';
export type TextModelChoice = { provider: TextProvider; model: string };
export type TextModelConfig = {
  codexBin?: string; agyBin?: string; openAiApiKey?: string; geminiApiKey?: string;
};
export type ModelOption = { id: string; label: string };

class CommandExecutionError extends Error {
  constructor(message: string, readonly stdout: string, readonly stderr: string, readonly exitCode?: number) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

async function command(bin: string, args: string[], input?: string, cwd?: string, timeoutMs = 600000) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, shell: false, windowsHide: true });
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
    child.stdin.end(input ?? '');
  });
}

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
}): Promise<unknown> {
  const { choice, config, workDir, schema, prompt } = options;
  const model = choice.model.trim();
  const jsonPrompt = prompt + '\n\nReturn ONLY a complete JSON object satisfying this JSON schema, with no markdown or commentary:\n' + JSON.stringify(schema);
  if (choice.provider === 'codex-cli') {
    if (!config.codexBin) throw new Error('Codex CLI was not found.');
    const schemaFile = path.join(workDir, options.outputName + '.schema.json');
    const outputFile = path.join(workDir, options.outputName + '.json');
    await fs.writeFile(schemaFile, JSON.stringify(schema, null, 2));
    const args = ['exec', '--ephemeral'];
    if (model) args.push('--model', model);
    args.push('--output-schema', schemaFile, '--output-last-message', outputFile, '-');
    await command(config.codexBin, args, jsonPrompt, workDir);
    return parseModelJson(await fs.readFile(outputFile, 'utf8'));
  }
  if (choice.provider === 'agy-cli') {
    if (!config.agyBin) throw new Error('AGY CLI is not installed or configured.');
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
      rawOutput = await command(config.agyBin, args, undefined, workDir);
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
  if (!model) throw new Error('Choose a model for ' + choice.provider + ' text generation.');
  if (choice.provider === 'openai') {
    if (!config.openAiApiKey) throw new Error('OpenAI API key is missing.');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + config.openAiApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: jsonPrompt }], response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(600000),
    });
    const body = await response.json() as any;
    if (!response.ok) throw new Error('OpenAI: ' + (body.error?.message || response.status));
    return parseModelJson(body.choices?.[0]?.message?.content || '');
  }
  if (!config.geminiApiKey) throw new Error('Gemini API key is missing.');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', headers: { 'x-goog-api-key': config.geminiApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: jsonPrompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
    signal: AbortSignal.timeout(600000),
  });
  const body = await response.json() as any;
  if (!response.ok) throw new Error('Gemini: ' + (body.error?.message || response.status));
  return parseModelJson((body.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text || '').join(''));
}
