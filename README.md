# Video Cleaner

Local-first talking-head video cleaner with semantic B-roll image generation, built with React + Vite and a lightweight Node.js service.

## Core architecture

The browser is only the editor UI. The local Node service owns filesystem access and runs `ffprobe`, `ffmpeg`, `codex`, and optionally `grok`. The original iPhone/master video stays referenced in place; it is not uploaded or copied into the project workspace.

Dialogue cleaning remains non-destructive: FFmpeg creates a tiny analysis-audio file and optional 30 fps proxy, ElevenLabs provides word timestamps, Codex returns a delete-only EDL, and final export reads the untouched master once.

## B-roll can run in three modes

### 1. Cleaned video -> B-roll -> final video

Use the normal flow:

`raw video -> proxy/audio -> transcript -> Codex cleanup -> B-roll plan/images -> final video`

B-roll scene timing is anchored to source timestamps. During final rendering the images are overlaid on the original timeline before the cleaned EDL is compacted, so timing stays aligned with the cleaned narration.

### 2. Raw video -> B-roll -> final video

Choose **Raw video -> B-roll -> final video**. A proxy is not required. If no transcript exists, the server extracts only lightweight analysis audio, sends that to ElevenLabs, lets Codex plan B-roll against the raw narration, generates images, and renders them over the original video.

### 3. Raw video -> B-roll assets only

Choose **Raw video -> B-roll image files + timing JSON**. The app generates individual image files and exports an editable `broll-timing.json` package. You can change timings/prompts in the UI before export or edit the JSON/files in another editor afterward.

## B-roll planning

Codex CLI is the scene planner. It groups narration into semantic visual ideas and writes structured scene data containing:

- source word IDs and source start/end timestamps
- narration covered by the scene
- visual intent and shot type
- an editable hyper-real image prompt
- enabled/disabled state
- generated provider/model metadata

Image count is configurable:

- **Auto** — Codex chooses the number of strong semantic scenes
- **Exact count** — the JSON schema requires exactly the requested number
- **Images per minute** — the app calculates an exact scene count from narration duration

Min/max target scene duration and output aspect ratio (`auto`, `9:16`, `16:9`) are also configurable.

## Hyper-real visual preset

The built-in prompt language is tuned to the supplied references: premium real-camera commercial photography, authentic South-Asian / Indian subjects when contextually appropriate, natural skin/teeth/hands/anatomy, believable clinic/home/lifestyle environments, clinically plausible dental/medical details, soft natural/diffused light, restrained cinematic contrast, full-frame prime-lens perspective, shallow optical depth of field, candid editorial framing, and no text/logos/watermarks/obvious AI artifacts.

## Image providers

Choose the provider per B-roll plan in the UI.

### Gemini API

Stable provider. Defaults to `gemini-3.1-flash-image`, requests the selected aspect ratio and 2K image output, then normalizes the still for the video workflow.

```env
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
```

### Grok Build CLI

Experimental local provider. The app auto-detects `grok` (or uses `GROK_BIN`) and invokes documented headless mode with `-p`, `--cwd`, `--always-approve`, and `--no-auto-update`. The prompt requires the CLI to create the actual image at an exact local path; the app verifies that a usable image file was written.

This depends on an image-generation capability/tool being available in your Grok Build environment. If the CLI completes without writing an image, the app returns a clear provider error instead of pretending generation succeeded.

```env
GROK_BIN=
GROK_IMAGE_MODEL=
```

### Codex CLI

Experimental local image provider. Codex remains the required planner/cleaner and uses the existing `codex login`. When selected for pixels, the app asks the local Codex environment to use any configured image-generation tool/skill and verifies the output file. This is intentionally marked experimental because Codex CLI does not expose a dedicated documented image-generation command.

### OpenAI Images API

Optional API provider retained from the first B-roll implementation.

```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
```

## Provider selection

```env
IMAGE_PROVIDER=gemini
```

Supported values:

```text
gemini
grok-cli
codex-cli
openai
```

The same provider, model, API key, and binary overrides are configurable from Settings. API secrets stay in the local Node service and are never exposed as `VITE_` variables.

## Editable scene timings

Each B-roll card exposes start/end seconds, enabled state, title and generation prompt. Save changes before generation/rendering. The final video renderer uses those edited source timings.

Assets-only export creates a folder such as:

```text
video-cleaner-broll-abc12345/
├── scene-001.png
├── scene-002.png
├── scene-003.png
├── broll-timing.json
└── README.txt
```

## Final B-roll render

Generated stills can now be composited into the final video. FFmpeg scales/crops each image to the master frame and displays it only for its configured source-time range. Cleaned mode applies B-roll before the delete-only EDL is compacted; raw mode keeps the original video/audio timeline.

The same source-aware hardware-first H.264/HEVC export path is reused, including VideoToolbox where available and live FFmpeg progress/speed reporting.

## Requirements

- Node.js 20+
- FFmpeg / ffprobe
- Codex CLI installed and authenticated (`codex login`)
- ElevenLabs API key
- at least one configured/available B-roll image provider
- optional Grok Build CLI for the `grok-cli` provider

## Configuration

```bash
cp .env.example .env.local
```

Minimum for the recommended Gemini path:

```env
ELEVENLABS_API_KEY=your_elevenlabs_key
IMAGE_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
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

By default:

```text
~/VideoCleaner/projects/<project-id>/
├── analysis.m4a
├── proxy.mp4                 # only when requested
├── transcript.json
├── edl.json
├── broll-plan.json
├── broll/
│   ├── scene-001.png
│   └── scene-002.png
└── project.json
```

The master source is not copied into this directory.

## HDR note

HDR sources are detected. HEVC/Main10 and source color tags are preserved where the local encoder supports them, but Dolby Vision dynamic metadata preservation is not guaranteed; validate HDR output before production use.
