"""Auto reel, step 1: talking-head edit from word timings + a keep list (called by server/auto-reel.ts).

Works on one clip or several clips recorded for the same reel. Word times are on the project timeline, where
clips sit one after another (clips.json gives each clip's start/end on that timeline).

Steps: snap each cut to a quiet point in the audio (RMS), split keep ranges where one clip ends and the next
begins, cut video into short sub-segments with alternating punch-in zoom, build the speech track from the keep
ranges with 20 ms seam fades, master it (highpass, denoise, EQ, compressor, two-pass loudnorm to -15 LUFS), and
write the caption word timings on the edited timeline.

Usage: python3 -I auto_edit.py <clips.json> <words.json> <keep.json> <out_dir> <width> <height> <unused> <zoom>
clips.json: [{"path": source, "start": s, "end": e, "audio": analysis audio or "", "color": ffmpeg filter or ""}]
Memory: audio is analysed as 16 kHz mono (~3 MB per 100 s); video is never decoded into Python.
"""
import json, math, subprocess, sys
from array import array
from pathlib import Path

CLIPS, WORDS, KEEP, OUT = json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
OUT.mkdir(parents=True, exist_ok=True)
FPS = 30
W, H = int(sys.argv[5]), int(sys.argv[6])
ZOOM = float(sys.argv[8]) if len(sys.argv) > 8 else 1.07  # punch-in for every other shot
FOCUS = (0.5, 0.36)         # face sits a little above centre in this framing
MIN_SHOT = 2.2              # do not punch in/out more often than this
SEAM_FADE = 0.02

def run(args, **kw):
    return subprocess.run(args, check=True, **kw)

words = json.loads(WORDS.read_text())['words']
keep = json.loads(KEEP.read_text())['keep']  # [[firstWordIndex, lastWordIndex], ...]
TOTAL = CLIPS[-1]['end']

def clip_index(t):
    for i, c in enumerate(CLIPS):
        if t < c['end'] - 1e-6: return i
    return len(CLIPS) - 1

# ---- RMS envelope (10 ms hop, 30 ms window), each clip's audio placed at its spot on the timeline.
HOP, WIN = 160, 480
db = [-90.0] * (int(TOTAL * 100) + 2)
for c in CLIPS:
    pcm = run(['ffmpeg', '-v', 'error', '-i', c.get('audio') or c['path'], '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    samples = array('h'); samples.frombytes(pcm)
    base = int(round(c['start'] * 100))
    for k, i in enumerate(range(0, max(1, len(samples) - WIN), HOP)):
        if base + k >= len(db) or k >= int((c['end'] - c['start']) * 100) + 1: break
        chunk = samples[i:i + WIN]
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk)) or 1
        db[base + k] = 20 * math.log10(rms / 32768)
floor = sorted(db)[len(db) // 10]
QUIET = floor + 10
t2f = lambda t: max(0, min(len(db) - 1, int(round(t * 100))))
f2t = lambda f: f / 100

def snap_start(first, prev_end):
    """Latest quiet frame before the first word's onset; start 60 ms before the voice comes in."""
    lo = t2f(max(prev_end - 0.05 if prev_end is not None else first - 0.6, 0)); hi = t2f(first + 0.15)
    quiet = [f for f in range(lo, hi + 1) if db[f] < QUIET]
    if not quiet:
        return f2t(min(range(lo, hi + 1), key=lambda f: db[f]))
    f = quiet[-1]
    while f + 1 <= hi + 60 and db[f + 1] < QUIET: f += 1  # Gemini word times can be ~0.5 s early
    return max(f2t(lo), f2t(f) - 0.06)

def snap_end(last, next_start):
    """First quiet frame after the last word; keep 100 ms of natural decay."""
    lo = t2f(last - 0.15); hi = t2f(min(next_start + 0.05 if next_start is not None else last + 0.6, len(db) / 100))
    quiet = [f for f in range(lo, hi + 1) if db[f] < QUIET]
    if not quiet:
        return f2t(min(range(lo, hi + 1), key=lambda f: db[f]))
    return min(f2t(hi), f2t(quiet[0]) + 0.10)

frame = lambda t: round(t * FPS) / FPS
ranges = []
for a, b in keep:
    prev_end = words[a - 1]['end'] if a > 0 else None
    next_start = words[b + 1]['start'] if b + 1 < len(words) else None
    s, e = frame(snap_start(words[a]['start'], prev_end)), frame(snap_end(words[b]['end'], next_start))
    # A kept passage can run from one clip into the next: split it where the first clip ends.
    i = a
    while s < e - 1e-6:
        c = CLIPS[clip_index(s)]
        piece_end = min(e, frame(c['end']) if c['end'] < e else e)
        last = i
        while last + 1 <= b and words[last + 1]['start'] < piece_end: last += 1
        if i <= b and words[i]['start'] < piece_end and piece_end - s > 0.05:
            ranges.append({'words': [i, last], 'start': s, 'end': piece_end, 'clip': CLIPS.index(c)})
            i = last + 1
        if piece_end >= e or i > b: break
        s = frame(c['end'])

# ---- Shots: split long ranges at sentence ends so the zoom changes at least every few seconds.
shots = []
for r in ranges:
    cuts = [r['start']]
    for i in range(r['words'][0], r['words'][1]):
        if words[i]['text'].rstrip().endswith(('.', ',', '?')):
            t = frame((words[i]['end'] + words[i + 1]['start']) / 2)
            if t - cuts[-1] >= MIN_SHOT and r['end'] - t >= MIN_SHOT: cuts.append(t)
    cuts.append(r['end'])
    for s, e in zip(cuts, cuts[1:]): shots.append({'start': s, 'end': e, 'clip': r['clip']})

# ---- Video: one short encode per shot (fast seek into its own clip), alternating 1.00x / ZOOM punch-in.
seg_dir = OUT / 'shots'; seg_dir.mkdir(exist_ok=True)
listing = []
for n, shot in enumerate(shots):
    c = CLIPS[shot['clip']]
    color = (c.get('color') or '') + (',' if c.get('color') else '')
    z = ZOOM if n % 2 else 1.0
    cw, ch = W / z, H / z
    x = min(max(FOCUS[0] * W - cw / 2, 0), W - cw); y = min(max(FOCUS[1] * H - ch / 2, 0), H - ch)
    vf = (f'{color}scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},crop={cw:.0f}:{ch:.0f}:{x:.0f}:{y:.0f},scale={W}:{H}:flags=lanczos,'
          'eq=contrast=1.04:saturation=1.06,unsharp=5:5:0.35,setsar=1,fps=30,format=yuv420p')
    path = seg_dir / f'shot-{n:03d}.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f"{shot['start'] - c['start']:.3f}", '-t', f"{shot['end'] - shot['start']:.3f}", '-i', c['path'],
         '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-r', '30', str(path)])
    listing.append(f"file '{path}'")
(OUT / 'shots.txt').write_text('\n'.join(listing) + '\n')
run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(OUT / 'shots.txt'), '-c', 'copy', str(OUT / 'video.mp4')])

# ---- Audio: keep ranges (each from its own clip) with seam micro-fades, joined, then mastered.
parts = []
for i, r in enumerate(ranges):
    d = r['end'] - r['start']; c = CLIPS[r['clip']]
    parts.append(f"[{r['clip']}:a]atrim={r['start'] - c['start']:.3f}:{r['end'] - c['start']:.3f},asetpts=PTS-STARTPTS,aresample=48000,"
                 f"aformat=channel_layouts=mono,afade=t=in:d={SEAM_FADE},afade=t=out:st={d - SEAM_FADE:.3f}:d={SEAM_FADE}[a{i}]")
graph = ';'.join(parts) + ';' + ''.join(f'[a{i}]' for i in range(len(ranges))) + f'concat=n={len(ranges)}:v=0:a=1[cut]'
inputs = [arg for c in CLIPS for arg in ('-i', c['path'])]
run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', graph, '-map', '[cut]', '-ac', '1', str(OUT / 'speech-raw.wav')])

VOICE = ('highpass=f=85,lowpass=f=12500,afftdn=nr=12:nf=-28:tn=1,equalizer=f=220:t=q:w=1.2:g=1.5,'
         'equalizer=f=3200:t=q:w=1.2:g=2.5,acompressor=threshold=-20dB:ratio=3:attack=10:release=120:makeup=2')
probe = run(['ffmpeg', '-hide_banner', '-i', str(OUT / 'speech-raw.wav'), '-af', VOICE + ',loudnorm=I=-15:TP=-1.5:LRA=8:print_format=json',
             '-f', 'null', '-'], capture_output=True, text=True).stderr
m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
second = (f"loudnorm=I=-15:TP=-1.5:LRA=8:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
          f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000")
run(['ffmpeg', '-v', 'error', '-y', '-i', str(OUT / 'speech-raw.wav'), '-af', VOICE + ',' + second, '-ac', '2', str(OUT / 'speech-master.wav')])

# ---- Edited-timeline word timings for captions.
edited, offset = [], 0.0
for r in ranges:
    for i in range(r['words'][0], r['words'][1] + 1):
        w = words[i]
        edited.append({'text': w['text'], 'start': round(offset + max(0, w['start'] - r['start']), 3), 'end': round(offset + min(r['end'], w['end']) - r['start'], 3)})
    offset += r['end'] - r['start']
(OUT / 'edited-words.json').write_text(json.dumps({'words': edited, 'duration': round(offset, 3)}, ensure_ascii=False, indent=0))
(OUT / 'edit.json').write_text(json.dumps({'ranges': ranges, 'shots': shots}, indent=1))
print(json.dumps({'cuts': len(ranges), 'shots': len(shots), 'clips': len(CLIPS), 'duration': round(offset, 3), 'sourceLoudness': m['input_i']}))
