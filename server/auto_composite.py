"""Auto reel, final step: edited base + B-roll cutaways + glass-card captions + whooshes (called by server/auto-reel.ts).

- B-roll: each still becomes a slow 1.00->1.06 push-in clip with a light grade and grain, then a 0.12 s alpha
  dissolve in/out and a quiet whoosh (-18 dB) just before each.
- Glass card: blur the frame under the caption band and show it only where the caption layer is opaque
  (card shape), then lay the card tint, border and text on top.
Usage: python3 -I auto_composite.py <base.mp4> <broll-plan.json> <clips_dir> <captions.txt|caption.webm|-> <caption_y> <whoosh.wav|-> <out.mp4> <width> <height> [preview.mp4|-] [motion.json|-] [cover.png|-] [cover_seconds]
- preview.mp4 (optional): a 720p ~2 Mbps copy for the phone, written in the same pass.
- motion.json (optional): {"overlay": motion-layer concat .txt or null, "kicks": [t, ...], "shots": [[start, end], ...],
  "splits": [[start, end], ...], "splitBox": {"x", "y", "w", "h"}}
  Split screens: the speaker video is fitted into splitBox during each split; the motion layer draws the picture and
  frame around it (B-roll scenes with transition "split" get no full-screen cutaway).
  Camera: a slow 1.00->1.03 push-in through each shot and a quick 7% punch-in on each kick, done with a sub-pixel
  perspective warp (no jitter). Overlay: hook title / punch boxes / CTA sticker on top of everything.
- B-roll scenes may name a "transition": dissolve (default), slide (in from the right), zoom (settles from 1.25x),
  flash (from white).
- Encodes on Intel Quick Sync when available (falls back to x264 superfast).
broll-plan.json: {"scenes": [{"id", "image", "start", "end"}]} with times on the edited timeline.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

base, plan_path, clips, caption, cap_y, whoosh, out = sys.argv[1:8]
W, H = int(sys.argv[8]), int(sys.argv[9])
preview = sys.argv[10] if len(sys.argv) > 10 and sys.argv[10] != '-' else None
motion = json.load(open(sys.argv[11])) if len(sys.argv) > 11 and sys.argv[11] != '-' else {}
# Cover (Instagram thumbnail) shown as a still at the very end, so it can be picked as the cover frame when posting.
cover = sys.argv[12] if len(sys.argv) > 12 and sys.argv[12] != '-' else None
cover_s = float(sys.argv[13]) if len(sys.argv) > 13 else 1.0
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
    # 'zoom' transition: starts at 1.25x and settles in 8 frames, then the usual slow push-in.
    z = f"max(1+0.06*on/{n},1.25-0.25*on/8)" if s.get('transition') == 'zoom' else f"1+0.06*on/{n}"
    flash = ',fade=t=in:st=0:d=0.3:color=white' if s.get('transition') == 'flash' else ''
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop={W * 2}:{H * 2},"
          f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps=30,"
          f"eq=brightness=-0.03:saturation=0.94:contrast=1.03,noise=alls=5:allf=t{flash},format=yuv420p")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', s['image'], '-vf', vf, '-frames:v', str(n),
                    '-c:v', 'libx264', '-preset', 'superfast', '-crf', '18', f"{clips}/{s['id']}.mp4"], check=True)
splits = motion.get('splits') or []
plan['scenes'] = [s for s in plan['scenes'] if s.get('transition') != 'split' or not splits]  # split pictures are in the motion layer
with ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(push_in, plan['scenes']))  # list() re-raises the first failure

# ---- Camera on the speaker: push-in per shot + kicks, as one zoom expression of the frame time T.
def camera_filter():
    shots, kicks = motion.get('shots') or [], motion.get('kicks') or []
    if not shots and not kicks: return ''
    T = '(in/30)'
    terms = [f"between({T},{a:.3f},{b:.3f})*0.03*({T}-{a:.3f})/{max(0.1, b - a):.3f}" for a, b in shots]
    # Kick: in over 2 frames, back out over 0.4 s.
    terms += [f"0.07*clip(({T}-{k:.3f})/0.067,0,1)*clip(1-({T}-{k:.3f}-0.067)/0.4,0,1)" for k in kicks]
    Z = f"(1+{'+'.join(terms)})"
    cx, cy = W * 0.5, H * 0.36  # the face sits a little above centre (same focus as auto_edit.py)
    x0, x1 = f"{cx:.1f}-{cx:.1f}/{Z}", f"{cx:.1f}+{W - cx:.1f}/{Z}"
    y0, y2 = f"{cy:.1f}-{cy:.1f}/{Z}", f"{cy:.1f}+{H - cy:.1f}/{Z}"
    return (f",perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y0}':x2='{x0}':y2='{y2}':x3='{x1}':y3='{y2}'"
            ":interpolation=linear:eval=frame")

args = ['ffmpeg', '-v', 'error', '-y', '-i', base]
filters = [f'[0:v]format=yuv420p{camera_filter()}[v0]']
label = 'v0'
if splits:
    # The speaker in the split-screen window: a face-centred crop with the window's shape, scaled into place.
    box = motion['splitBox']; ch = round(W * box['h'] / box['w'] / 2) * 2; cy = int(min(max(H * 0.36 - ch / 2, 0), H - ch))
    on = '+'.join(f"between(t,{a:.3f},{b:.3f})" for a, b in splits)
    filters += ['[v0]split[vfull0][vbox0]',
                f"[vbox0]crop={W}:{ch}:0:{cy},scale={box['w']}:{box['h']},pad={W}:{H}:{box['x']}:{box['y']}:color=black[vbox]",
                f"[vfull0][vbox]overlay=0:0:enable='{on}'[vsplit]"]
    label = 'vsplit'
for i, s in enumerate(plan['scenes']):
    d = s['end'] - s['start']
    args += ['-i', f"{clips}/{s['id']}.mp4"]
    n = i + 1
    kind = s.get('transition', 'dissolve')
    fade_in = f'fade=t=in:st=0:d={FADE}:alpha=1,' if kind in ('dissolve', 'zoom') else ''  # slide and flash arrive opaque
    filters.append(f"[{n}:v]format=yuva420p,{fade_in}fade=t=out:st={d - FADE:.3f}:d={FADE}:alpha=1,"
                   f"setpts=PTS-STARTPTS+{s['start']:.3f}/TB[b{n}]")
    # Slide: in from the right over 0.22 s with an ease-out.
    x = f"'{W}*pow(1-clip((t-{s['start']:.3f})/0.22,0,1),3)'" if kind == 'slide' else '0'
    filters.append(f"[{label}][b{n}]overlay=x={x}:y=0:eof_action=pass:enable='between(t,{s['start']:.3f},{s['end']:.3f})'[v{n}]")
    label = f'v{n}'

cap_in = len(plan['scenes']) + 1
has_caption = caption != '-'
if has_caption:
    # A .txt caption is a timed list of transparent PNGs (concat demuxer); older reels used a VP9-with-alpha video.
    args += (['-f', 'concat', '-safe', '0', '-i', caption] if caption.endswith('.txt') else ['-c:v', 'libvpx-vp9', '-i', caption])
else:
    cap_in -= 1
    filters.append(f'[{label}]format=yuv420p[vcap]')
if has_caption: filters += [
    f'[{label}]split[vm][vb]',
    # Blur only the caption band (downscale-blur-upscale is cheap and very soft).
    f'[vb]crop={W}:300:0:{cap_y},scale={W // 4}:76,gblur=sigma=4,scale={W}:300:flags=bicubic,eq=brightness=-0.02,format=yuv420p[blur]',
    f'[{cap_in}:v]format=yuva420p,split[capa][capb]',
    # Card-shaped mask from the caption layer's alpha (tint is ~46% opaque; anything above ~16% counts as card).
    "[capa]alphaextract,lut=y='if(gt(val,40),255,0)'[mask]",
    '[blur][mask]alphamerge[glass]',
    f'[vm][glass]overlay=0:{cap_y}:eof_action=pass[vg]',
    f'[vg][capb]overlay=0:{cap_y}:eof_action=pass,format=yuv420p[vcap]',
]

# Motion layer (hook title, punch boxes, CTA sticker): a timed list of full-frame transparent PNGs, on top.
overlay = motion.get('overlay')
if overlay:
    cap_in += 1
    args += ['-f', 'concat', '-safe', '0', '-i', overlay]
    filters += [f'[{cap_in}:v]format=yuva420p[mo]', '[vcap][mo]overlay=0:0:eof_action=pass,format=yuv420p[vout]']
else:
    filters.append('[vcap]null[vout]')

# Whooshes: one input, split per B-roll, each delayed to 0.1 s before the cutaway. '-' = none (the app adds music
# and sound effects afterwards, see server/reel-sound.ts).
w_in = cap_in + 1
count = len(plan['scenes']) if whoosh != '-' else 0
if count: args += ['-i', whoosh]
if count: filters.append(f'[{w_in}:a]aresample=48000,volume=0.125,asplit={count}' + ''.join(f'[w{i}]' for i in range(count)))
for i, s in enumerate(plan['scenes'][:count]):
    filters.append(f"[w{i}]adelay={max(0, int((s['start'] - 0.1) * 1000))}:all=1[wd{i}]")
filters.append('[0:a]aresample=48000[voice]')
filters.append('[voice]' + ''.join(f'[wd{i}]' for i in range(count)) + f'amix=inputs={count + 1}:duration=first:normalize=0,alimiter=limit=0.95[aout]')
if cover:
    c_in = w_in + (1 if count else 0)
    args += ['-loop', '1', '-framerate', '30', '-t', f'{cover_s:.3f}', '-i', cover]
    filters += [f'[vout]setsar=1,fps=30,format=yuv420p[vbody]',
                f'[{c_in}:v]scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},setsar=1,fps=30,format=yuv420p[vcover]',
                '[vbody][vcover]concat=n=2:v=1:a=0[vend]', f'[aout]apad=pad_dur={cover_s:.3f}[aend]']
else:
    filters += ['[vout]null[vend]', '[aout]anull[aend]']

def encode(dev):
    """One pass: the full-quality reel, plus the phone preview when asked. dev = VAAPI node or None (x264)."""
    graph = list(filters)
    up = ',format=nv12,hwupload' if dev else ''
    pv_scale = 'scale=1280:-2' if W > H else 'scale=720:-2'
    if preview:
        graph.append(f'[vend]split[vf0][vp0]'); graph.append(f'[vf0]null{up}[vfull]'); graph.append(f'[vp0]{pv_scale}:flags=bicubic,format=yuv420p{up}[vprev]')
        graph.append('[aend]asplit[afull][aprev]')
    else:
        graph.append(f'[vend]null{up}[vfull]'); graph.append('[aend]anull[afull]')
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
