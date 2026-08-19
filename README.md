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
8. Final export reads the untouched master once, applies the EDL with a single `select/aselect` timeline filter, and encodes the output once.

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

Codex does **not** require an OpenAI API key in this app. The server invokes the local `codex` binary and uses its existing CLI login.

## Configuration

Copy the sample environment file:

```bash
cp .env.example .env.local
```

Then set at least:

```bash
ELEVENLABS_API_KEY=your_key_here
```

`CODEX_BIN`, `FFMPEG_BIN`, and `FFPROBE_BIN` are optional. If blank, the server auto-detects them from `PATH`. The same overrides can be entered from the Settings panel in the UI.

Secrets are server-side only. Do not use a `VITE_` prefix for the ElevenLabs key.

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
- `project.json`

The original master is referenced by path and is not copied into the project folder.

## Scope

This micro-app is intentionally only for dialogue cleanup. B-roll, captions, reframing, music, transitions, voice cloning, multi-speaker editing, auto zoom, and stock media search belong in separate apps.

## HDR note

HDR sources are detected. V1 uses HEVC/Main10 where the local encoder supports it and carries source color tags, but Dolby Vision dynamic metadata preservation is not guaranteed; validate HDR output before production use.
