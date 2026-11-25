"""Auto reel, final step: edited base + B-roll cutaways + glass-card captions + whooshes (called by server/auto-reel.ts).

- B-roll: each still becomes a slow 1.00->1.06 push-in clip with a light grade and grain, then a 0.12 s alpha
  dissolve in/out and a quiet whoosh (-18 dB) just before each.
- Glass card: blur the frame under the caption band and show it only where the caption layer is opaque
  (card shape), then lay the card tint, border and text on top.
Usage: python3 -I auto_composite.py <base.mp4> <broll-plan.json> <clips_dir> <caption.webm|-> <caption_y> <whoosh.wav> <out.mp4> <width> <height>
broll-plan.json: {"scenes": [{"id", "image", "start", "end"}]} with times on the edited timeline.
"""
import json, os, subprocess, sys

base, plan_path, clips, caption, cap_y, whoosh, out = sys.argv[1:8]
W, H = int(sys.argv[8]), int(sys.argv[9])
cap_y = int(cap_y)
plan = json.load(open(plan_path))
FADE = 0.12

# Push-in clips from the stills (stills are scaled once to 2x so zoompan does not jitter).
os.makedirs(clips, exist_ok=True)
for s in plan['scenes']:
    n = max(2, int(round((s['end'] - s['start']) * 30)))
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop={W * 2}:{H * 2},"
          f"zoompan=z='1+0.06*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps=30,"
          "eq=brightness=-0.03:saturation=0.94:contrast=1.03,noise=alls=5:allf=t,format=yuv420p")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', s['image'], '-vf', vf, '-frames:v', str(n),
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', f"{clips}/{s['id']}.mp4"], check=True)

args = ['ffmpeg', '-v', 'error', '-y', '-i', base]
filters = ['[0:v]format=yuv420p[v0]']
label = 'v0'
for i, s in enumerate(plan['scenes']):
    d = s['end'] - s['start']
    args += ['-i', f"{clips}/{s['id']}.mp4"]
    n = i + 1
    filters.append(f"[{n}:v]format=yuva420p,fade=t=in:st=0:d={FADE}:alpha=1,fade=t=out:st={d - FADE:.3f}:d={FADE}:alpha=1,"
                   f"setpts=PTS-STARTPTS+{s['start']:.3f}/TB[b{n}]")
    filters.append(f"[{label}][b{n}]overlay=0:0:eof_action=pass:enable='between(t,{s['start']:.3f},{s['end']:.3f})'[v{n}]")
    label = f'v{n}'

cap_in = len(plan['scenes']) + 1
has_caption = caption != '-'
if has_caption:
    args += ['-c:v', 'libvpx-vp9', '-i', caption]
else:
    cap_in -= 1
    filters.append(f'[{label}]format=yuv420p[vout]')
if has_caption: filters += [
    f'[{label}]split[vm][vb]',
    # Blur only the caption band (downscale-blur-upscale is cheap and very soft).
    f'[vb]crop={W}:300:0:{cap_y},scale={W // 4}:76,gblur=sigma=4,scale={W}:300:flags=bicubic,eq=brightness=-0.02,format=yuv420p[blur]',
    f'[{cap_in}:v]format=yuva420p,split[capa][capb]',
    # Card-shaped mask from the caption layer's alpha (tint is ~46% opaque; anything above ~16% counts as card).
    "[capa]alphaextract,lut=y='if(gt(val,40),255,0)'[mask]",
    '[blur][mask]alphamerge[glass]',
    f'[vm][glass]overlay=0:{cap_y}:eof_action=pass[vg]',
    f'[vg][capb]overlay=0:{cap_y}:eof_action=pass,format=yuv420p[vout]',
]

# Whooshes: one input, split per B-roll, each delayed to 0.1 s before the cutaway.
w_in = cap_in + 1
count = len(plan['scenes'])
if count: args += ['-i', whoosh]
if count: filters.append(f'[{w_in}:a]aresample=48000,volume=0.125,asplit={count}' + ''.join(f'[w{i}]' for i in range(count)))
for i, s in enumerate(plan['scenes']):
    filters.append(f"[w{i}]adelay={max(0, int((s['start'] - 0.1) * 1000))}:all=1[wd{i}]")
filters.append('[0:a]aresample=48000[voice]')
filters.append('[voice]' + ''.join(f'[wd{i}]' for i in range(count)) + f'amix=inputs={count + 1}:duration=first:normalize=0,alimiter=limit=0.95[aout]')

args += ['-filter_complex', ';'.join(filters), '-map', '[vout]', '-map', '[aout]',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
subprocess.run(args, check=True)
print('done', out)
