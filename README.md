# Video Cleaner

Local-first talking-head video cleaner with semantic B-roll image/video generation, built with React + Vite and a lightweight Node.js service.

## Core architecture

The browser is only the editor UI. The local Node service owns filesystem access and runs `ffprobe`, `ffmpeg`, `codex`, and optionally `grok`. The original iPhone/master video stays referenced in place; it is not uploaded or copied into the project workspace.

Dialogue cleaning remains non-destructive: FFmpeg creates a tiny analysis-audio file and optional 30 fps proxy, ElevenLabs provides word timestamps, Codex returns a delete-only EDL, and final export reads the untouched master once.

## B-roll workflows

### 1. Cleaned video -> B-roll -> final video

`raw video -> proxy/audio -> transcript -> Codex cleanup -> B-roll -> final video`

B-roll timing is anchored to source timestamps. During final rendering the B-roll media is overlaid on the original timeline before the cleaned EDL is compacted.

### 2. Raw video -> B-roll -> final video

A proxy is optional. If no transcript exists, the server extracts only lightweight analysis audio, transcribes the raw narration, lets Codex plan B-roll, and renders the selected B-roll media over the original video.

### 3. Raw video -> B-roll assets only

Generates individual B-roll assets and exports editable `broll-timing.json`. The package can include PNG stills and MP4 clips, so the timing/prompt data can be reused in another editor.

## B-roll planning

Codex CLI groups narration into semantic scenes and writes structured data containing:

- source word IDs and editable source start/end timestamps
- narration, visual intent and shot type
- editable hyper-real image prompt
- optional editable image-to-video motion prompt
- enabled/disabled state
- image/video provider metadata

Image count can be **Auto**, **Exact count**, or **Images per minute**. Min/max target scene duration and output aspect ratio (`auto`, `9:16`, `16:9`) are configurable.

## Per-scene asset controls

Every B-roll card supports:

- **Generate image** with the selected provider
- **Add/replace image manually** using a native local file picker; the selected source image is never modified or deleted
- **Delete B-roll** to remove the entire scene plus its generated project copies
- **Create video prompt** / **Rewrite video prompt** using Codex CLI
- **Create video** / **Regenerate video** using Grok Build CLI
- editable title, image prompt, video prompt, source start/end timing and enabled state

If an MP4 clip exists for a scene, final rendering automatically prefers it over the still image. Replacing/regenerating the source image invalidates the old generated clip so a new motion result can be created from the new still.

## Hyper-real visual preset

The built-in prompt language is tuned to the supplied references: premium real-camera commercial photography, authentic South-Asian / Indian subjects when contextually appropriate, natural skin/teeth/hands/anatomy, believable clinic/home/lifestyle environments, clinically plausible dental/medical details, soft natural/diffused light, restrained cinematic contrast, full-frame prime-lens perspective, shallow optical depth of field, candid editorial framing, and no text/logos/watermarks/obvious AI artifacts.

## Image providers

Choose the provider per B-roll plan in the UI.

### Gemini API

Stable provider. Defaults to `gemini-3.1-flash-image`, requests the selected aspect ratio and 2K output, then normalizes the still for the project.

```env
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
```

### Grok Build CLI

Experimental local image provider. The app auto-detects `grok` (or uses `GROK_BIN`) and invokes headless mode. The task succeeds only when the CLI writes a real usable image file.

### Codex CLI

Experimental local image provider. Codex remains the required planner/cleaner and uses the existing `codex login`. Pixel generation requires an image-generation tool/skill to be available inside that local Codex environment.

### OpenAI Images API

Optional API image provider.

```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
```

## Image-to-video with Codex + Grok CLI

The video action is intentionally separated into two responsibilities:

1. **Codex CLI** writes a scene-specific motion prompt designed to preserve the still's identity, anatomy, wardrobe, environment, clinical details and composition while adding subtle realistic movement.
2. **Grok Build CLI** runs headlessly in the local project directory and is instructed to use an available xAI/Grok Imagine image-to-video capability, preferring `grok-imagine-video-1.5`, and save a real MP4 at the exact project path.

The app validates that the MP4 exists, has a useful file size, and can be decoded by FFmpeg before accepting it. There is no silent API/provider fallback. Because Grok Build's documented headless CLI is an agent interface rather than a dedicated `grok video` subcommand, this bridge is marked **experimental** and requires the local Grok environment to have suitable image-to-video capability/authentication.

```env
GROK_BIN=
GROK_IMAGE_MODEL=
GROK_VIDEO_MODEL=grok-imagine-video-1.5
```

## Editable scene timings

Each B-roll card exposes start/end seconds. The final compositor uses those source timings. Assets-only export writes the same values to JSON.

Example package:

```text
video-cleaner-broll-abc12345/
├── scene-001.png
├── scene-001.mp4
├── scene-002.png
├── broll-timing.json
└── README.txt
```

`broll-timing.json` includes image prompt, video prompt, source timing, narration, provider/model data and generated filenames.

## Final B-roll render

FFmpeg scales/crops each enabled B-roll asset to the master frame. For a scene with a generated video clip, the clip is looped/trimmed to the configured scene window; otherwise the still is used. Cleaned mode applies B-roll before compacting the delete-only EDL; raw mode keeps the original timeline.

The existing source-aware hardware-first H.264/HEVC export path is reused, including VideoToolbox where available and live FFmpeg progress/speed reporting.

## Requirements

- Node.js 20+
- FFmpeg / ffprobe
- Codex CLI installed and authenticated (`codex login`)
- ElevenLabs API key
- at least one configured/available B-roll image provider
- Grok Build CLI for B-roll video generation

## Configuration

```bash
cp .env.example .env.local
```

Recommended Gemini image path:

```env
ELEVENLABS_API_KEY=your_elevenlabs_key
IMAGE_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
GROK_VIDEO_MODEL=grok-imagine-video-1.5
```

`CODEX_BIN`, `GROK_BIN`, `FFMPEG_BIN`, and `FFPROBE_BIN` may be left blank for PATH auto-detection.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Production-style local run:

```bash
npm run build
NODE_ENV=production npm start
```

Then open `http://127.0.0.1:3001`.

## Working files

```text
~/VideoCleaner/projects/<project-id>/
├── analysis.m4a
├── proxy.mp4
├── transcript.json
├── edl.json
├── broll-plan.json
├── broll/
│   ├── scene-001.png
│   ├── scene-001.mp4
│   └── scene-002.png
└── project.json
```

The master source and manually selected source images are never moved/deleted by the app.

## HDR note

HDR sources are detected. HEVC/Main10 and source color tags are preserved where the local encoder supports them, but Dolby Vision dynamic metadata preservation is not guaranteed; validate HDR output before production use.
