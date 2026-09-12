import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { colorVideoFilter, type ColorProfile } from './color.js';

const cases: Array<[string, string, ColorProfile]> = [
  ['untagged YUV', 'format=yuv420p', { pixelFormat: 'yuv420p' }],
  ['RGB still', 'format=rgb24', { pixelFormat: 'rgb24' }],
  ['RGBA still', 'format=rgba', { pixelFormat: 'rgba' }],
  ['full range JPEG', 'format=yuvj420p', { pixelFormat: 'yuvj420p', colorRange: 'pc' }],
  ['HLG', 'format=yuv420p10le', { pixelFormat: 'yuv420p10le', colorPrimaries: 'bt2020', colorTransfer: 'arib-std-b67', colorSpace: 'bt2020nc' }],
  ['PQ', 'format=yuv420p10le', { pixelFormat: 'yuv420p10le', colorPrimaries: 'bt2020', colorTransfer: 'smpte2084', colorSpace: 'bt2020nc' }],
  ['BT.601', 'format=yuv420p', { pixelFormat: 'yuv420p', colorPrimaries: 'smpte170m', colorTransfer: 'smpte170m', colorSpace: 'smpte170m' }],
];
for (const [name, input, profile] of cases) for (const hdr of [false, true]) {
  test(`${name} to ${hdr ? 'HLG' : 'SDR'} produces a correctly tagged frame`, () => {
    const result = spawnSync(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner', '-v', 'info', '-f', 'lavfi', '-i', `testsrc2=s=64x64,${input}`, '-vf', `${colorVideoFilter(profile, hdr)},showinfo`, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(`color_trc:${hdr ? 'arib-std-b67' : 'bt709'}`));
    assert.match(result.stderr, new RegExp(`color_primaries:${hdr ? 'bt2020' : 'bt709'}`));
  });
}
