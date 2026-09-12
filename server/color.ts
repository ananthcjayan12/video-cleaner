export type ColorProfile = { pixelFormat?: string; colorPrimaries?: string; colorTransfer?: string; colorSpace?: string; colorRange?: string };

function tag(value: string | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase();
  return !normalized || ['unknown', 'unspecified', 'reserved'].includes(normalized) ? fallback : normalized === 'bt2020ncl' ? 'bt2020nc' : normalized;
}

// Untagged generated YUV video is treated as limited-range BT.709; RGB stills
// are treated as full-range sRGB. Explicit metadata always takes precedence.
export function colorVideoFilter(media: ColorProfile = {}, hdr = false) {
  const rgb = /^(rgb|bgr|gbr|rgba|bgra|argb|abgr|pal8)/.test(media.pixelFormat || '');
  const transfer = tag(media.colorTransfer, rgb ? 'iec61966-2-1' : 'bt709');
  const inputHdr = ['arib-std-b67', 'smpte2084'].includes(transfer);
  const primaries = tag(media.colorPrimaries, inputHdr ? 'bt2020' : 'bt709');
  const matrix = rgb ? 'gbr' : tag(media.colorSpace, inputHdr ? 'bt2020nc' : 'bt709');
  const range = tag(media.colorRange, rgb || media.pixelFormat?.startsWith('yuvj') ? 'full' : 'limited');
  const targetP = hdr ? 'bt2020' : 'bt709';
  const targetT = hdr ? 'arib-std-b67' : 'bt709';
  const targetM = hdr ? 'bt2020nc' : 'bt709';
  const filters = rgb ? ['format=gbrpf32le'] : [];
  filters.push(`zscale=pin=${primaries}:tin=${transfer}:min=${matrix}:rin=${range}:p=${targetP}:t=linear:m=gbr:r=full:npl=${inputHdr ? 203 : 100}`, 'format=gbrpf32le');
  if (inputHdr && !hdr) filters.push('tonemap=mobius:desat=0');
  filters.push(`zscale=pin=${targetP}:tin=linear:min=gbr:rin=full:p=${targetP}:t=${targetT}:m=${targetM}:r=limited:npl=${hdr ? 203 : 100}`, `format=${hdr ? 'yuv420p10le' : 'yuv420p'}`, `setparams=range=limited:color_primaries=${targetP}:color_trc=${targetT}:colorspace=${targetM}`);
  return filters.join(',');
}
