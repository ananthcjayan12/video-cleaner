import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type TextProvider = 'codex-cli' | 'agy-cli' | 'gemini' | 'openai';
export type TextModelChoice = { provider: TextProvider; model: string };
export type TextModelConfig = {
  codexBin?: string; agyBin?: string; openAiApiKey?: string; geminiApiKey?: string;
};
export type ModelOption = { id: string; label: string };

async function command(bin: string, args: string[], input?: string, cwd?: string, timeoutMs = 600000) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, shell: false, windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGTERM'); reject(new Error(path.basename(bin) + ' timed out')); } }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 8_000_000) child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { stderr += String(chunk); if (stderr.length > 200_000) child.kill('SIGTERM'); });
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) reject(new Error(path.basename(bin) + ' exited ' + code + ': ' + stderr.slice(-1500)));
      else resolve(stdout);
    });
    child.stdin.end(input ?? '');
  });
}

export function parseAgyModels(output: string): ModelOption[] {
  // agy models emits a slug, whitespace and a display name per line.
  const options: ModelOption[] = []; const seen = new Set<string>();
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-z][a-z0-9._-]+)\s{2,}(.+?)\s*$/i);
    if (!match || !/[0-9]/.test(match[1]) || seen.has(match[1])) continue;
    options.push({ id: match[1], label: match[2].trim() }); seen.add(match[1]);
  }
  return options;
}

export async function availableAgyModels(bin?: string): Promise<ModelOption[]> {
  if (!bin) return [];
  try { return parseAgyModels(await command(bin, ['models'], undefined, undefined, 12000)); }
  catch { return []; }
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/, '');
  try { return JSON.parse(trimmed); }
  catch {
    const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The selected model did not return JSON. Try another model or regenerate.');
    return JSON.parse(trimmed.slice(start, end + 1));
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
    const args = ['--output-format', 'json', '--json-schema', JSON.stringify(schema), '--print-timeout', '10m'];
    if (model) args.push('--model', model);
    args.push('-p', jsonPrompt);
    const result = JSON.parse(await command(config.agyBin, args, undefined, workDir)) as {
      status?: string; error?: string; structured_output?: unknown; response?: string;
    };
    if (result.status !== 'SUCCESS') throw new Error('AGY CLI: ' + (result.error || result.status || 'No response'));
    if (result.structured_output && typeof result.structured_output === 'object') return result.structured_output;
    return parseModelJson(result.response || '');
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
