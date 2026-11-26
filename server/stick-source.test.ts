import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanReelUrl, sourceBrief, sourceFromBody } from './stick-source.js';

test('reel links are recognised and tracking is stripped', () => {
  assert.deepEqual(cleanReelUrl('look https://www.instagram.com/reel/ABC123/?igsh=xyz&utm_source=ig'), { url: 'https://www.instagram.com/reel/ABC123/', platform: 'Instagram' });
  assert.equal(cleanReelUrl('https://youtube.com/shorts/abc?si=123&t=4').url, 'https://youtube.com/shorts/abc?t=4');
  assert.equal(cleanReelUrl('https://youtu.be/xyz').platform, 'YouTube');
  assert.throws(() => cleanReelUrl('https://evil.example.com/reel/1'));
  assert.throws(() => cleanReelUrl('no link here'));
});

test('the script brief forbids copying and the browser copy is trimmed', () => {
  const source = sourceFromBody({ url: 'https://youtu.be/x', platform: 'YouTube', transcript: 'x'.repeat(9000), keyPoints: ['a', 'b'], extra: 'ignored' })!;
  assert.equal(source.transcript.length, 6000); assert.ok(!('extra' in source));
  const brief = sourceBrief(source); assert.match(brief, /Never copy/); assert.match(brief, /- a/);
});
