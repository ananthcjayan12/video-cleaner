"""Auto reel, final step: edited base + B-roll cutaways + glass-card captions + whooshes (called by server/auto-reel.ts).

- B-roll: each still becomes a slow 1.00->1.06 push-in clip with a light grade and grain, then a 0.12 s alpha
  dissolve in/out and a quiet whoosh (-18 dB) just before each.
- Glass card: blur the frame under the caption band and show it only where the caption layer is opaque
  (card shape), then lay the card tint, border and text on top.
Usage: python3 -I auto_composite.py <base.mp4> <broll-plan.json> <clips_dir> <captions.txt|caption.webm|-> <caption_y> <whoosh.wav> <out.mp4> <width> <height> [preview.mp4]
- preview.mp4 (optional): a 720p ~2 Mbps copy for the phone, written in the same pass.
- Encodes on Intel Quick Sync when available (falls back to x264 superfast).
broll-plan.json: {"scenes": [{"id", "image", "start", "end"}]} with times on the edited timeline.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

base, plan_path, clips, caption, cap_y, whoosh, out = sys.argv[1:8]
W, H = int(sys.argv[8]), int(sys.argv[9])
preview = sys.argv[10] if len(sys.argv) > 10 and sys.argv[10] != '-' else None
cap_y = int(cap_y)
plan = json.load(open(plan_path))
FADE = 0.12

# ---- Encoder: Intel Quick Sync (VAAPI) when its driver works, else x264. Probed with one tiny frame per run.
# (Duplicated in auto_edit.py / auto_composite.py: they run with python -I, so they cannot import each other.)
def hw_device():
    """The VAAPI render node if hardware H.264 encoding works here; None to use x264. VIDEO_CLEANER_NO_HW_ENCODE=1 turns it off."""
    if os.environ.get('VIDEO_CLEANER_NO_HW_ENCODE'): return None
    dev = os.environ.get('VIDEO_CLEANER_VAAPI_DEVICE', '/dev/dri/renderD128')
    if not os.path.exists(dev): return None
    probe = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-vaapi_device', dev, '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1',
                            '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-frames:v', '1', '-f', 'null', '-'], capture_output=True)
    return dev if probe.returncode == 0 else None

# Push-in clips from the stills (stills are scaled once to 2x so zoompan does not jitter).
# zoompan is single-threaded, so make up to 3 clips at once (same output, about 3x sooner on 4 cores).
os.makedirs(clips, exist_ok=True)
def push_in(s):
    n = max(2, int(round((s['end'] - s['start']) * 30)))
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop={W * 2}:{H * 2},"
          f"zoompan=z='1+0.06*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps=30,"
          "eq=brightness=-0.03:saturation=0.94:contrast=1.03,noise=alls=5:allf=t,format=yuv420p")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', s['image'], '-vf', vf, '-frames:v', str(n),
                    '-c:v', 'libx264', '-preset', 'superfast', '-crf', '18', f"{clips}/{s['id']}.mp4"], check=True)
with ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(push_in, plan['scenes']))  # list() re-raises the first failure

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
    # A .txt caption is a timed list of transparent PNGs (concat demuxer); older reels used a VP9-with-alpha video.
    args += (['-f', 'concat', '-safe', '0', '-i', caption] if caption.endswith('.txt') else ['-c:v', 'libvpx-vp9', '-i', caption])
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

def encode(dev):
    """One pass: the full-quality reel, plus the phone preview when asked. dev = VAAPI node or None (x264)."""
    graph = list(filters)
    up = ',format=nv12,hwupload' if dev else ''
    pv_scale = 'scale=1280:-2' if W > H else 'scale=720:-2'
    if preview:
        graph.append(f'[vout]split[vf0][vp0]'); graph.append(f'[vf0]null{up}[vfull]'); graph.append(f'[vp0]{pv_scale}:flags=bicubic,format=yuv420p{up}[vprev]')
        graph.append('[aout]asplit[afull][aprev]')
    else:
        graph.append(f'[vout]null{up}[vfull]'); graph.append('[aout]anull[afull]')
    full = ['-c:v', 'h264_vaapi', '-qp', '20'] if dev else ['-c:v', 'libx264', '-preset', 'superfast', '-crf', '20', '-pix_fmt', 'yuv420p']
    prev = (['-c:v', 'h264_vaapi', '-rc_mode', 'VBR', '-b:v', '1100k', '-maxrate', '2000k'] if dev
            else ['-c:v', 'libx264', '-preset', 'superfast', '-crf', '27', '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p'])
    # args = ['ffmpeg', '-v', 'error', '-y', '-i', base, ...]: with Quick Sync, the chip also decodes the base video (frames come back to memory for the filters).
    cmd = (args[:4] + (['-vaapi_device', dev, '-hwaccel', 'vaapi', '-hwaccel_device', dev] if dev else []) + args[4:] + ['-filter_complex', ';'.join(graph),
           '-map', '[vfull]', '-map', '[afull]', *full, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
    if preview: cmd += ['-map', '[vprev]', '-map', '[aprev]', *prev, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', preview]
    subprocess.run(cmd, check=True)

dev = hw_device()
try:
    encode(dev)
except subprocess.CalledProcessError:
    if not dev: raise
    print('Quick Sync encode failed; using x264', file=sys.stderr)
    encode(None)
print('done', out, 'encoder', 'quicksync' if dev else 'x264')
