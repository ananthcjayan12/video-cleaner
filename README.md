# Video Cleaner

Local-first talking-head video cleaner with semantic B-roll image/video generation, built with React + Vite and a lightweight Node.js service.

## Core architecture

The browser is only the editor UI. The local Node service owns filesystem access and runs `ffprobe`, `ffmpeg`, the selected text CLI (`codex`, `claude`, or `agy`), and optionally `grok`. The original iPhone/master video stays referenced in place; it is not uploaded or copied into the project workspace.

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

Selectable groups include talking-head source video, proxy preview, analysis audio, B-roll images, B-roll videos, B-roll timestamps/metadata, SRT/WebVTT subtitles, word-level JSON/CSV timestamps, transcript text, and cleaned edit/EDL timing. **Select all** and **Clear all** make common selections quick. The manifest and README are always included.

Missing items stay selectable instead of disabling the export. If a selected file is unavailable—for example a moved talking-head clip or only some B-roll assets have been generated—Video Cleaner skips the missing file, exports everything else that exists, and records the skipped items in `project-manifest.json`.

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

## Motion graphics (Remotion)

The **B-roll plan** stage has a second section, **Motion graphics**, for professional animated overlays: lower thirds, stat callouts, kinetic titles, animated charts, process steps, comparisons, checklists, quote cards, timelines and icon diagrams.

1. **Plan** — the selected text CLI (Claude, Codex or AGY) reads the narration and picks moments where a number, list, sequence or key phrase deserves a graphic. It is given the planned B-roll windows and must stay clear of them (0.25 s margin) and of other graphics (2 s gap). Every graphic is one continuous spoken passage of 1.5–15 s. On-screen text is checked against the Meta ad rules.
2. **Design** — per graphic, the same CLI writes a self-contained Remotion (React) component using your accent/card colours. Generated code is statically checked before it runs: only `react`, `remotion` and a few `@remotion/*` helpers may be imported, and network, filesystem, `eval`, `Math.random` and `Date` are rejected.
3. **Render** — Remotion renders it to a transparent VP9 WebM (`motion/motion-NNN.webm` in the project folder). If the code fails to bundle or render, the error is sent back to the model for up to three attempts.
4. **Edit** — headline, subhead, items and timing are editable; text and timing edits re-render the stored code without another AI call. Changing type, placement or the design brief (or using *Redesign with AI* / an “ask for a change” note) asks the model for new code.

**Reference templates:** upload a brand design (PNG/JPG/WebP, e.g. a contact sheet of short-form layouts) in the Motion graphics panel. The AI looks at it when writing each component and rebuilds its palette, card shapes, typography and icon style as animated vector graphics (photos and logos are not embedded). Choose a project default or a template per graphic; changing it triggers a redesign. Templates live in `~/.video-cleaner/motion-templates` (or `MOTION_TEMPLATES_DIR`) and are shared across projects. Supported with Claude, Codex, Gemini and OpenAI; AGY cannot receive images.

Rendered graphics appear in the Live Editor on their own top-most tracks, above B-roll and the talking head, and are composited into **Export edited MP4**. Because the overlay carries an alpha channel, the final render decodes it with `libvpx-vp9` (your FFmpeg needs that decoder; Homebrew's has it).

Rendering uses an installed Chrome/Chromium/Brave/Edge automatically (or `CHROME_BIN`); otherwise Remotion downloads a headless browser on first use. A 3-second 1080×1920 graphic takes roughly 40 s to bundle and render.

**Licence note:** Remotion is free for individuals and small teams, but companies above its size threshold need a paid Remotion licence. Check https://www.remotion.dev/license before commercial use.

Motion graphics are not yet part of the editable project ZIP or the legacy B-roll-only export; they are used by the Live Editor / edited-MP4 export.

## B-roll planning

The selected text CLI groups narration into semantic scenes and writes structured data containing:

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
- **Create video prompt** / **Rewrite video prompt** using the selected planning text provider
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

Experimental local image provider. Codex uses the existing `codex login`. Pixel generation requires an image-generation tool/skill to be available inside that local Codex environment.

### Claude Code CLI for text tasks

Claude Code can clean dialogue, plan B-roll scenes and visuals, and write motion prompts. Install and sign in with `claude auth login`, then choose Claude Code CLI in the cleaning or planning model picker. The model selector includes Claude Code's documented aliases (`best`, `fable`, `opus`, `sonnet`, `haiku`, and the 1M context variants) and current pinned model IDs from Anthropic's model overview. A custom model ID can also be entered. Leave the model on CLI default to use your existing Claude Code setting. Claude Code is not an image or video generation provider in this app.

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

1. **The selected planning text provider** writes a scene-specific motion prompt designed to preserve the still's identity, anatomy, wardrobe, environment, clinical details and composition while adding subtle realistic movement.
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
- A signed-in text provider: Codex CLI (`codex login`), Claude Code CLI (`claude auth login`), AGY CLI, or a configured Gemini/OpenAI API key
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

## Meta ads compliance guidelines

All content is meant to be posted and boosted on Facebook/Instagram, so Meta's ad standards are built in. The rules live in one place, [server/meta-guidelines.ts](server/meta-guidelines.ts) (with a `META_GUIDELINES_REVIEWED` date); update that file when Meta's policy changes.

They are applied at every stage:

- **Cleaning** — the model is told the policy and may drop a clearly non-compliant sentence (delete-only); the kept narration is also scanned and warnings are added to the EDL notes as `Meta policy: …`.
- **B-roll story and visual planning** — policy is part of both prompts; image prompts containing hard-blocked patterns (before/after, graphic/gory, nudity, on-image text/logos, celebrities) are rejected and repaired; narration warnings are added to the plan notes.
- **Image and video generation** — the policy is appended to every image prompt and video-prompt request, and prompts (including your manual edits and regeneration comments) that hit a hard-block pattern are refused with an explanation before any provider is called.
- **Thumbnails** — the same visual policy is added to the thumbnail prompt.

The scan is a keyword safety net, not a guarantee of approval. Enable Meta's AI-generated label for posts that use generated B-roll.

### Motion graphic sound effects

New motion plans select 1–3 effects from the supplied VideoEditingSFX Free Pack
for each graphic. The planner uses UI sounds for text and cards, whooshes for
movement, impacts for emphasis, camera FX for photo moments, and risers,
buildups, reverse and cinematic sounds where the edit calls for them. It chooses
scene-relative cue times and restrained volume; the animation generator receives
those times to align the visual reveals.
Open **Sound effects** on a graphic to preview, replace, add or remove cues and
adjust timing/volume. Save and render again to apply changes. Remove every cue
for a silent graphic. Existing plans remain unchanged; add cues manually or
re-plan to get automatic selections.

Audio is embedded in the transparent WebM and included in editor playback and
MP4 export. Moving, trimming, changing speed or muting the graphic affects its
sound too. The default gain is -16 dB, bounded to -30…-6 dB, with at most three
cues per graphic. No runtime download or sound-service account is required.

Assets come from the supplied `VideoEditingSFX - Free Pack.zip`. The original
MP3/WAV files are preserved under `assets/motion-sfx/` and grouped as Whoosh &
Transitions, Camera FX, Impacts, Risers, Reverse FX, UI, Buildups and Cinematic.
The manifest records duration, sample rate and SHA-256 for each file, plus
peak time, peak level, loudness and brightness measured by
`node scripts/analyze-motion-sfx.mjs` (needs `ffmpeg`; re-run it if you add
files). Keep `assets/` beside `dist-server/` when packaging the server; the
runtime reads the local manifest.

### Emotion sound design

Sound effects are not limited to graphics. The **Emotion sound design** section
of the Motion graphics panel asks the planning model to read the narration like
an editor and put an effect on the exact word that carries each feeling:

| Feeling | What the AI listens for | Typical sounds |
| --- | --- | --- |
| Shock | jaw-drop fact, twist, myth-buster | sharp impacts, glass hit, boom |
| Suspense | "but here is the catch", a reveal being set up | build-ups, risers, reverse swells |
| Sadness | pain, loss, regret | low deep hits, falling tones, dark swells |
| Joy | good news, a win, transformation | success chimes, achievement whoosh |
| Insight | the "aha", the key tip | chime, notification, camera flash |
| Warning | danger, a costly mistake | heavy hits, ominous thump |
| Emphasis | a number or punchline | short hits, pops, sharp swooshes |
| Transition | "now", "next", a new step | whooshes, swipes |
| Humor | a light or awkward beat | pops and boops |
| Relief | "the good news is", reassurance | soft, settling tones |

How it stays professional rather than noisy:

- **Restraint.** The *How many* setting caps the beats (Subtle ≈ 2–3 a minute,
  Balanced ≈ 5, Expressive ≈ 9). Cues need 2 s of room, never repeat the same
  sound back to back, and only the strongest survive if the model over-marks.
- **On the word.** Each cue is anchored to one spoken word. Every sound is
  trimmed around its measured loudest moment so that peak lands on the word:
  impacts start on it, whooshes just before it, build-ups run up to it (a
  sound that builds needs room before the word; if the word is at the very
  start, the head of the sound is trimmed instead).
- **Stingers.** For the biggest twist the model may pair one build-up with one
  hit on the same word.
- **Leveled.** The pack varies by about 35 dB in loudness, so each sound is
  scaled to a target level for its feeling, then nudged by *Strength*
  (soft −5 dB, medium, strong +4 dB). Fine-tune volume per clip in the editor.
- **No clashes.** Cues are kept out of motion graphics, which carry their own
  sound. Re-planning graphics keeps your sound cues (any that now fall inside a
  new graphic are removed, with a note).
- **Palettes.** A cue can only use sounds from its feeling's palette when the AI
  plans it (defined in `server/emotion-sfx.ts`). The pack has no dedicated
  crying, laughter or applause sounds, so the palettes were curated from file
  names plus measured brightness and pitch movement rather than by ear — audition
  them with the preview player and swap any sound. When you pick a sound by hand
  the whole library is available.

**Plan emotion sounds** works before any graphic exists and never touches
graphics or their renders. Planning graphics also plans sounds the first time
(untick *Also plan emotion sounds when planning graphics* to skip that). Each cue can be changed (feeling, sound,
strength, time), switched off, deleted, or added by hand at any time in the
video.

Each cue becomes its own audio track (`SFX · Shock · Impact Hit`) below the
talking head in the Live editor, so it can be moved, trimmed, muted or deleted
there, and it is mixed into the MP4 export. Changing a cue in the panel
replaces that clip's position and volume; otherwise your timeline edits are
kept. No rendering is needed.
