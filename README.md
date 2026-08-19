# Video Cleaner

Local-first, non-destructive talking-head video cleaner for large iPhone recordings.

## What this MVP does

- Opens the original video by local file path; the master is never copied or modified.
- Uses `ffprobe` to inspect codec, resolution, size, and HDR metadata.
- Creates two lightweight working files in parallel:
  - 16 kHz mono AAC analysis audio for transcription.
  - 720p H.264 proxy for interactive preview.
- Sends only the small analysis audio to ElevenLabs Scribe v2 for word-level timestamps.
- Runs the locally installed Codex CLI as a delete-only dialogue cleaning agent.
- Stores the result as an Edit Decision List (EDL) referencing original word IDs.
- Lets you restore/remove individual words in the transcript UI.
- Previews edits by seeking over removed ranges in the proxy, with no intermediate render.
- Reads the untouched master only at final export and performs one FFmpeg encode.

This app intentionally does **not** implement B-roll, captions, reframing, music, transitions, voice cloning, multi-speaker editing, auto zoom, or stock-video search. Those are intended to remain separate micro-apps.

## Architecture

```text
Original iPhone master (immutable)
        |
        +--> ffprobe --> Media profile / HDR warning
        |
        +--> tiny analysis.m4a --> ElevenLabs --> timestamped words --> Codex --> EDL.json
        |
        +--> 720p proxy.mp4 -----------------------------------------------> virtual preview
        |
        `--> Final Export + EDL --> FFmpeg --> one encoded output
```

## Requirements

- Node.js 20+
- npm
- `ffmpeg` and `ffprobe` available on `PATH`
- Codex CLI installed, authenticated, and available as `codex`
- ElevenLabs API key
- macOS is the primary MVP target. Apple VideoToolbox is used for fast proxy/final H.264 encoding when available; other platforms fall back to libx264.

### macOS prerequisites

```bash
brew install ffmpeg
npm install
```

Install/authenticate Codex using the current OpenAI Codex CLI instructions before running the app.

## Run locally

```bash
npm install
npm run dev
```

Then:

1. Choose a `.MOV`, `.MP4`, `.M4V`, or `.WEBM` source.
2. Click **Create working media**.
3. Enter the ElevenLabs API key and transcribe.
4. Choose Light / Balanced / Aggressive cleanup and run Codex.
5. Review the transcript. Removed words are struck through; click a word to toggle it.
6. Preview directly from the proxy.
7. Export with **Fast** or **Quality** mode.

## Quality model

The master file is never repeatedly transcoded. Editing changes only JSON. Previewing uses a low-resolution proxy. The original full-resolution video is decoded/encoded only once when the user exports.

Fast export uses Apple `h264_videotoolbox` on macOS. Quality export uses `libx264` with CRF 16. Both preserve the original frame dimensions because no scale filter is used in the final render.

## HDR note

The app detects HDR transfer characteristics and surfaces a warning. V1 does not guarantee preservation of Dolby Vision dynamic metadata through final export. Test HDR outputs before production use; SDR iPhone recordings are the safest MVP input.

## Security

- The renderer has no Node.js integration.
- Electron context isolation is enabled.
- FFmpeg and Codex are invoked with `spawn(..., { shell: false })`.
- Codex receives a schema-constrained, delete-only task and does not control FFmpeg commands.
- The ElevenLabs key is held only in renderer state for the current session and is not written to project files.

## Project data

Working files live under Electron's per-user application data directory:

```text
projects/<uuid>/
  analysis.m4a
  proxy.mp4
  transcript.json
  edl.schema.json
  codex-edl.json
  edl.json
```

The selected original video remains wherever the user stored it.

## Current MVP limitations

- Projects are kept in memory for the running session; reopening saved projects is not implemented yet.
- Multi-audio-track selection is not implemented; the first audio stream is used.
- HDR/Dolby Vision export metadata preservation is not guaranteed.
- Final smart rendering around GOP boundaries is not implemented; final export intentionally uses one high-quality encode for correctness at arbitrary word-level cut points.
