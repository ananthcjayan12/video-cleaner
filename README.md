# Video Cleaner

Local-first, non-destructive talking-head dialogue cleaner built with React + Vite and a lightweight Node.js service.

## Why this architecture

The browser handles only the editor UI. A local Node service owns filesystem access and runs the tools already installed on the machine: `ffprobe`, `ffmpeg`, and `codex`. There is no Electron runtime and no upload/copy of the original iPhone master into the app.

Pipeline:

1. Native OS file picker returns the source path to the local Node service.
2. `ffprobe` captures codec, resolution, frame rate, source bitrate, size, and HDR metadata.
3. FFmpeg reads the large iPhone source once and emits both a lightweight browser proxy and a 16 kHz mono analysis-audio file from the same pass.
4. The proxy is capped at a 720 px long edge and 30 fps. On supported macOS FFmpeg builds, VideoToolbox decode + H.264 VideoToolbox encoding are used automatically.
5. Only the small analysis audio is sent to ElevenLabs Scribe v2 for word timestamps.
6. The local Codex CLI receives timestamped source words and returns a schema-constrained delete-only EDL.
7. React previews the EDL by seeking over removed regions in the proxy — no intermediate render.
8. Codex can group the cleaned narration into semantic B-roll scenes and write production-ready image prompts for each scene.
9. Approved prompts can generate high-quality B-roll stills through the OpenAI Images API and save them inside the local project.
10. Final dialogue-only export reads the untouched master once, applies the EDL with a single `select/aselect` timeline filter, and encodes the output once.

## Hyper-realistic B-roll images

After dialogue cleanup, click **Plan B-roll scenes**. Codex reads only the kept transcript, groups it into major visual ideas, assigns source word/timestamp ranges, and writes an editable prompt for each scene.

The built-in visual preset is tuned to the supplied references:

- premium hyper-real commercial photography rather than illustration or CGI
- authentic South-Asian / Indian subjects and environments when contextually appropriate
- natural skin texture, teeth, hands, food, fabrics, dental/medical tools, and believable anatomy
- clinically plausible healthcare scenes with appropriate PPE, instruments, and patient positioning
- soft natural or diffused practical lighting and restrained cinematic contrast
- full-frame 35 mm / 50 mm / 85 mm prime-lens aesthetic with believable shallow depth of field
- candid editorial compositions instead of generic posed stock photography
- clean clinic, home, nutrition, and lifestyle production design
- central safe composition for social-video crops
- no text, logos, watermarks, UI, malformed anatomy, duplicated tools, plastic skin, or obvious AI artifacts

Prompts are editable before generation and each scene can be generated or regenerated independently. **Generate all** runs scenes sequentially and asks for confirmation before using API credits.

Codex CLI handles scene planning using the existing `codex login`. Image pixels are generated separately by the OpenAI Images API, so this feature needs `OPENAI_API_KEY`. `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2`.

Portrait projects request a portrait image and normalize it to a 1080×1920 9:16 still. Landscape projects normalize to 1920×1080 16:9. Generated files are stored under `broll/` in the local project.

This version creates and reviews B-roll **assets only**. Automatically placing/animating those images in the final video is intentionally left for the next feature so the image quality and scene selection can be validated independently.

## Fast final export

The normal High Quality export is hardware-first rather than CPU `slow`-preset-first:

- source HEVC/H.265 -> HEVC VideoToolbox when available
- source H.264 -> H.264 VideoToolbox when available
- VideoToolbox decode is enabled when the installed FFmpeg build exposes it
- source resolution and frame rate are preserved
- output bitrate is derived from source bitrate/resolution/fps and biased toward quality rather than small files
- Fast mode adds VideoToolbox speed priority; High Quality mode keeps the hardware encoder without the extra speed-priority flag
- software fallbacks use usable `veryfast`/`fast` presets instead of the old `slow` presets

FFmpeg export runs asynchronously. The editor polls live export state and shows percent complete, encoder, processing speed (`x` realtime), and rendered frame count.

## Requirements

- Node.js 20+
- FFmpeg / ffprobe installed locally
- Codex CLI installed and authenticated (`codex login`)
- ElevenLabs API key
- OpenAI API key only when generating B-roll images

Codex does **not** require an OpenAI API key for cleanup or B-roll planning in this app. The server invokes the local `codex` binary and uses its existing CLI login. The separate API key is used only for image generation.

## Configuration

Copy the sample environment file:

```bash
cp .env.example .env.local
```

Then configure:

```bash
ELEVENLABS_API_KEY=your_elevenlabs_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_IMAGE_MODEL=gpt-image-2
```

`OPENAI_API_KEY` is optional until you click Generate on a B-roll image. `CODEX_BIN`, `FFMPEG_BIN`, and `FFPROBE_BIN` are also optional; if blank, the server auto-detects them from `PATH`. The same secrets and binary overrides can be entered from the Settings panel in the UI.

Secrets are server-side only. Do not use a `VITE_` prefix for either API key.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the local Node service on `127.0.0.1:3001`.

For a production-style local run:

```bash
npm run build
NODE_ENV=production npm start
```

Then open `http://127.0.0.1:3001`.

## Working files

By default, working files go under `~/VideoCleaner/projects/<project-id>/`:

- `analysis.m4a`
- `proxy.mp4`
- `transcript.json`
- `edl.json`
- `broll-plan.json`
- `broll/scene-001.png`
- `broll/scene-002.png`
- `project.json`

The original master is referenced by path and is not copied into the project folder.

## Scope

This app currently covers dialogue cleanup plus semantic B-roll still planning/generation. B-roll motion/compositing, captions, reframing, music, transitions, voice cloning, multi-speaker editing, auto zoom, and stock media search are not part of this version.

## HDR note

HDR sources are detected. V1 uses HEVC/Main10 where the local encoder supports it and carries source color tags, but Dolby Vision dynamic metadata preservation is not guaranteed; validate HDR output before production use.
