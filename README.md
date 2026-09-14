# Video Cleaner

Local-first talking-head video cleaner with semantic B-roll image/video generation, built with React + Vite and a lightweight Node.js service.

## Core architecture

The browser is only the editor UI. The local Node service owns filesystem access and runs `ffprobe`, `ffmpeg`, `codex`, and optionally `grok`. The original iPhone/master video stays referenced in place; it is not uploaded or copied into the project workspace.

Dialogue cleaning remains non-destructive: FFmpeg creates a tiny analysis-audio file and optional 30 fps proxy, ElevenLabs provides word timestamps, Codex returns a delete-only EDL, and final export reads the untouched master once.

## Live narration transcript preview

When a proxy and word-timestamp transcript are available, the transcript becomes a karaoke-style narration preview. The currently spoken word is highlighted from the existing ElevenLabs timestamps and the transcript auto-follows playback inside its own scroll area. Removed words remain visibly struck through and cleaned preview playback continues to skip removed EDL sections. In multi-clip projects the combined proxy and global word timestamps make highlighting continue across clip boundaries.

The preview toolbar provides play/pause, restart, 0.75×–2× speed and an auto-follow toggle. Normal clicks still keep/remove words; Cmd-click on macOS or Ctrl-click on Windows/Linux seeks playback to that word without toggling its edit state. No extra transcription or model call is required.

## Local resumable project library

Project folders are the source of truth. On startup the local Node service scans `~/VideoCleaner/projects` (or `PROJECTS_DIR`) and rebuilds the project library from `project.json` plus the files already present in each project directory. Closing the browser, stopping the Node service or rebooting the computer does not discard the project.

The home screen shows recent projects with local progress for proxy, transcript, cleaned EDL, B-roll images and B-roll videos. Opening a saved project restores the transcript, EDL, proxy URL, B-roll plan, stills and generated clips.

Project actions include:

- **Open / Resume**
- **Rename**
- **Delete project** — removes only the Video Cleaner project directory; the original master video is never deleted
- **Relink source** — if the original video was moved, choose it again; duration and dimensions are checked before relinking
- **Export editable ZIP** — packages the original talking-head clip(s), B-roll media, captions, word timestamps and portable timing metadata for manual editing in another NLE
- **Generate missing images / Create missing videos** — completed assets are reused after an interrupted generation run

B-roll title, prompt, timing and enabled-state edits debounce-save locally after about 700 ms. Core JSON project writes use temporary files plus atomic rename so a normal save does not partially overwrite the project manifest.

If a scene PNG/MP4 exists on disk but the app was closed before its metadata finished updating, project recovery reconciles the completed asset back into the B-roll plan when the project is opened again.

No cloud project database is used. Provider calls still send only the media/prompt data required by the configured external provider; the project library itself remains on the user's computer.

## Editable project ZIP export

Use **Export editable ZIP** from either the project library or an open project to create a portable manual-editing package. Before choosing the destination, an export dialog lets you check exactly which asset groups should be included. This makes it possible to create anything from a full handoff package to a tiny subtitles-only or B-roll-timing-only ZIP.

Selectable groups include talking-head source video, proxy preview, analysis audio, B-roll images, B-roll videos, B-roll timestamps/metadata, SRT/WebVTT subtitles, word-level JSON/CSV timestamps, transcript text, and cleaned edit/EDL timing. **Select all available** and **Clear all** make common selections quick. The manifest and README are always included.

If the original talking-head source has moved or is unavailable, source video is disabled in the selector while already-saved subtitles, B-roll and timing data can still be exported without relinking the source.

The ZIP contains only the selected groups:

- `talking-head/` — original source clip(s), plus the local proxy preview when available
- `audio/` — analysis audio when available
- `broll/images/` and `broll/videos/` — generated or manually imported B-roll assets
- `captions/captions.srt` and `captions/captions.vtt`
- `captions/word-level-timestamps.json` and `.csv`
- `timeline/edl.json` and `timeline/cleaned-timeline.json`
- `timeline/broll-timing.json` with scene timing, prompts, layout and provider/model metadata
- `project-manifest.json` plus a human-readable `README.txt`

All timing values are seconds on the original project source timeline. Multi-clip exports include each clip's `timelineStart` and `timelineEnd`, which makes the package straightforward to reconstruct in DaVinci Resolve, Premiere Pro, Final Cut Pro, CapCut or another editor.

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

## Image-to-video with Magnific + MiniMax

Magnific is available as a first-class video provider. The API key stays in the local Node service and is never exposed to the browser. The default model is `minimax-hailuo-2-3-768p-fast`; Video Cleaner submits the scene still as the first frame, uses the Codex motion prompt, requests a 6-second 768p Fast clip, polls the asynchronous task, downloads the completed MP4, validates it with FFmpeg, and stores it in the normal per-scene video-attempt history.

The MiniMax Hailuo 2.3 768p Fast endpoint currently uses 6-second generations; the final compositor trims/loops the generated clip to the scene window as needed.

```env
MAGNIFIC_API_KEY=your_magnific_api_key
MAGNIFIC_VIDEO_MODEL=minimax-hailuo-2-3-768p-fast
# Optional. Leave blank to use https://api.magnific.com/v1/ai/image-to-video/<model>
MAGNIFIC_VIDEO_ENDPOINT=
```

You can also enter these values in **Settings → Magnific API key**. If Magnific changes a model endpoint before the app is updated, set `MAGNIFIC_VIDEO_ENDPOINT` to the exact image-to-video endpoint from the Magnific API docs.

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
- at least one B-roll video provider: Magnific API, Google Flow, or Grok Build CLI

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
