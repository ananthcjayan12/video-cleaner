import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScriptPrompt, cleanScript, DEFAULT_STUDIO_SETTINGS, normalizeStudioSettings, trimSilence, wavBytes } from './stick-narration.js';
import { PLANNER_SCHEMA } from './stick-planner.js';

test('studio settings are clamped and unknown values fall back to defaults', () => {
  const s = normalizeStudioSettings({ voice: 'Charon; rm -rf', speed: 9, lineGapMs: -5, scriptSeconds: 3, scriptLanguage: 'klingon' as never, music: 2 });
  assert.equal(s.voice, DEFAULT_STUDIO_SETTINGS.voice);
  assert.equal(s.speed, 1.25); assert.equal(s.lineGapMs, 0); assert.equal(s.scriptSeconds, 15); assert.equal(s.scriptLanguage, 'malayalam'); assert.equal(s.music, 1);
});

test('script prompt carries length, Manglish rule, CTA and the revision request', () => {
  const prompt = buildScriptPrompt({ concept: 'Logo vs doctor face', seconds: 45, settings: { ...DEFAULT_STUDIO_SETTINGS, cta: 'Follow for day 4' }, feedback: 'shorter hook', previous: { title: 'Old', lines: ['a', 'b'] } });
  assert.match(prompt, /about 45 seconds/); assert.match(prompt, /Doctors-നും/); assert.match(prompt, /Follow for day 4/); assert.match(prompt, /shorter hook/); assert.match(prompt, /1\. a/);
});

test('cleanScript strips markdown and empty lines and needs two lines', () => {
  assert.deepEqual(cleanScript({ title: ' T ', lines: ['**ഹലോ**  doctor', '', ' രണ്ട് '] }), { title: 'T', lines: ['ഹലോ doctor', 'രണ്ട്'] });
  assert.throws(() => cleanScript({ lines: ['one'] }));
});

test('trimSilence cuts quiet edges and wavBytes writes a valid header', () => {
  const rate = 1000; const x = new Int16Array(3000); for (let i = 1000; i < 2000; i++) x[i] = 8000;
  const out = trimSilence(x, rate, 500, 0); assert.ok(out.length >= 1000 && out.length <= 1100, String(out.length));
  const wav = wavBytes(out, rate); assert.equal(wav.toString('latin1', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), rate); assert.equal(wav.length, 44 + out.length * 2);
});

test('stick planner schema is strict: every object lists all its properties as required', () => {
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.properties) assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    Object.values(node).forEach(walk);
  };
  walk(PLANNER_SCHEMA);
});

test('effort maps onto OpenAI reasoning_effort and Gemini thinkingLevel (which top out at high)', async () => {
  const { openAiEffort, geminiThinkingLevel } = await import('./text-models.js');
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map(openAiEffort), ['low', 'medium', 'high', 'high', 'high']);
  assert.deepEqual(['low', 'medium', 'max'].map(geminiThinkingLevel), ['low', 'medium', 'high']);
});

test('narration goes in one request unless the script is very long, split on whole lines', async () => {
  const { narrationChunks, pauseInstruction } = await import('./stick-narration.js');
  assert.equal(narrationChunks(['a', 'b', 'c']).length, 1);
  const long = Array.from({ length: 40 }, (_, i) => `line ${i} `.repeat(10));
  const chunks = narrationChunks(long); assert.ok(chunks.length > 1); assert.equal(chunks.join('\n'), long.join('\n'));
  assert.match(pauseInstruction(50), /barely/); assert.match(pauseInstruction(220), /short natural/); assert.match(pauseInstruction(600), /clear/);
});

test('link mode keeps the reference topic first and treats typed text as changes', () => {
  const prompt = buildScriptPrompt({ concept: 'make it for parents', settings: DEFAULT_STUDIO_SETTINGS, sourceText: 'REFERENCE REEL (instagram).\nTopic: gum bleeding' });
  assert.ok(prompt.indexOf('Topic: gum bleeding') < prompt.indexOf('make it for parents'));
  assert.match(prompt, /SAME topic as the reference reel/);
  assert.doesNotMatch(prompt, /CONCEPT FROM THE CREATOR/);
});
