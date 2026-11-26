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
    if (name === 'HLG' && !hdr) {
      assert.match(colorVideoFilter(profile, hdr), /npl=100/);
      assert.match(colorVideoFilter(profile, hdr), /tonemap=hable:desat=0/);
    }
  });
}

test('BT.709 SDR footage skips the float round trip and looks the same as the full conversion', () => {
  const profile: ColorProfile = { pixelFormat: 'yuv420p', colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709', colorRange: 'tv' };
  const fast = colorVideoFilter(profile, false);
  assert.doesNotMatch(fast, /zscale|gbrpf32le/);
  const full = 'zscale=pin=bt709:tin=bt709:min=bt709:rin=limited:p=bt709:t=linear:m=gbr:r=full:npl=100,format=gbrpf32le,zscale=pin=bt709:tin=linear:min=gbr:rin=full:p=bt709:t=bt709:m=bt709:r=limited:npl=100,format=yuv420p';
  // Smooth, in-range picture like real footage (testsrc2's out-of-range colours get clipped by the full path).
  const src = 'gradients=s=320x240:speed=0,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709';
  const result = spawnSync(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', src, '-filter_complex', `[0:v]split[a][b];[a]${fast}[x];[b]${full}[y];[x][y]psnr`, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const psnr = Number(result.stderr.match(/average:([\d.]+|inf)/)?.[1].replace('inf', '99'));
  assert.ok(psnr >= 45, `PSNR ${psnr} dB`);
});
