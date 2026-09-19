# Unified creator workflow & CJCut-first editor — engineering plan

## Product goal
Make Video Cleaner a flexible video-creation workspace rather than a locked wizard. The user can upload, clean, plan B-roll, create images/videos, edit at any moment, design a thumbnail, and export from the **same saved CJCut timeline**. No step requires completing every previous step; prerequisites apply only to the specific action that needs them.

## Interaction design
1. **Projects:** resume a local project or start with one/multiple source clips.
2. **Upload:** inspect source media, add/reorder/relink clips. Original footage remains untouched.
3. **Clean:** create analysis proxy/audio (optional for raw-video planning), transcribe, suggest cuts, and manually toggle retained transcript words. Offer one-click return to editing.
4. **Story:** set workflow, count/cadence, image provider and visual plan; review semantic beats, timing, explanation and starting-frame prompts. No new image/video generated without an explicit action.
5. **Assets:** inspect available/missing image and video assets, generate missing, regenerate selected, import, and inspect scene-specific preview. Allow still-image B-roll when videos are incomplete.
6. **Live Editor:** accessible *from every stage*. Base footage, latest current B-roll assets, user-owned trims/splits/layers, and existing text are represented in a CJCut project. Export uses the saved CJCut edit, not the old B-roll plan.
7. **Thumbnail:** select/compress brand reference images, choose hook, generate/review the thumbnail independently of the final-video export.
8. **Export:** show project readiness without artificially requiring thumbnails, cleaning or complete B-roll; provide editor-first final MP4, source-only/legacy export, editable ZIP, and asset-only export. Show progress and stopping state.

## UX contracts
- **Non-linear navigation.** All stages remain visible; a missing prerequisite produces a local explanation/action and does not block unrelated work.
- **One primary next action** per step and a persistent **Open live editor** action throughout the workflow.
- **No misleading completion:** stage badges describe actual saved state; missing optional B-roll videos do not block edit or export.
- **Preserve work:** switching steps only changes the active view. The CJCut project remains a separate persisted model; newly generated assets reconcile into it without resetting manual edits. Never silently overwrite the user's timeline.
- **Stale assets:** image generation hides the prior image/video; stale videos are excluded from editor preview and MP4 export.
- **Accessible actions:** stage rail buttons have semantic labels, focus styles, status text; progress comes from existing backend job states. Design supports reduced-motion and mobile horizontal navigation where full editor width requires scrolling.

## Architecture & file ownership
- `src/workflow.ts`: pure capability/status/readiness model derived from the current project, transcript, EDL, B-roll, thumbnail and running jobs. It is a UI-only projection, not a second persistent state machine.
- `src/WorkflowNavigator.tsx`: reusable stage navigation, progress chips, current-stage framing, next-step hints and persistent quick editor control.
- `src/App.tsx`: single host state owner; render only the selected stage while keeping editor access global. No new backend generation algorithms or provider changes.
- `src/LiveEditor.tsx`: CJCut plugin host and autosaved timeline; same component can be opened full screen from any workflow stage. Final MP4 export saves active edit before starting the existing editor export endpoint.
- `server/editor-render.ts`: existing editor-driven FFmpeg render remains the MP4 source of truth.
- `src/settings.css`: isolated creator-workspace styles; retain legacy B-roll and editor classes.
- `server/*`: no new provider-specific logic or hidden re-generation.

## State & transitions
- Upload ready iff original source exists; relink surfaces a local action.
- Clean ready iff saved EDL exists; raw-video users may skip cleaning and continue to story/editor.
- Story ready iff a B-roll plan exists; scene count may be zero only if explicitly planned.
- Assets status shows actual current image/video counts; images alone are sufficient for image-based edits; video conversion is optional.
- Editor available iff source exists (or source-independent assets-only use where a valid timeline is supplied).
- Thumbnail ready iff a generated thumbnail file is present.
- Export available iff valid source and a saved or freshly constructed editor timeline can be supplied; thumbnail and B-roll are optional.

## Acceptance checklist
- Fresh upload: stage rail shows source readiness and Live Editor can open with raw source.
- Transcript/cleanup unavailable: user can choose raw B-roll or edit/export raw footage.
- Planned scenes with no generated assets: editor still shows base footage, no fabricated layers.
- Partial images/videos: editor overlays only current assets; images stand in for missing videos.
- Regenerate image during editing: old assets do not reappear; after completion new asset attaches to scene.
- Trim, split, move, disable and delete B-roll in CJCut: switching tabs does not reset work; final editor MP4 uses the edited timeline.
- Revisit an existing project: select a stage based on saved state and permit manual override at all times.
- Thumbnail and export remain independently accessible; incomplete thumbnails/B-roll do not block video export.
- CI typechecks, builds, and runs timeline-render regression tests.

## Follow-up boundaries
A perfect pixel-identical preview for every browser effect/filter is not promised by FFmpeg rendering; test real projects (landscape/portrait, multi-clip, multiple overlapping images/videos, audio and text), especially color/HDR and video codecs. Keep CJCut's core editing features in its own repository; only integration and UX orchestration belong in Video Cleaner.
