# Video Cleaner

Local-first, non-destructive talking-head dialogue cleaner built with React + Vite and a lightweight Node.js service.

## Why this architecture

The browser handles only the editor UI. A local Node service owns filesystem access and runs the tools already installed on the machine: `ffprobe`, `ffmpeg`, and `codex`. There is no Electron runtime and no upload/copy of the original iPhone master into the app.

Pipeline:

1. Native OS file picker returns the source path to the local Node service.
2. `ffprobe` classifies codec, resolution, size, and HDR metadata.
3. FFmpeg creates a small 16 kHz mono AAC analysis file and 720p proxy in parallel.
4. Only the analysis audio is sent to ElevenLabs Scribe v2 for word timestamps.
5. The local Codex CLI receives timestamped source words and returns a schema-constrained delete-only EDL.
6. React previews the EDL by seeking over removed regions in the proxy — no intermediate render.
7. Final export reads the untouched master and performs one FFmpeg encode.

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

HDR sources are detected. V1 attempts to keep HDR exports in 10-bit HEVC, but Dolby Vision dynamic metadata preservation is not guaranteed; validate HDR output before production use.
