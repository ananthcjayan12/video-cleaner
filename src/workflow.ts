import type { BrollPlan, Project, ThumbnailState } from './api';

export type WorkflowStage = 'upload' | 'clean' | 'story' | 'assets' | 'editor' | 'thumbnail' | 'export';
export type StageStatus = 'complete' | 'available' | 'in-progress' | 'needs-source';
export type WorkflowStep = {
  id: WorkflowStage;
  label: string;
  description: string;
  status: StageStatus;
  detail: string;
};

export const WORKFLOW_STAGES: WorkflowStage[] = ['upload', 'clean', 'story', 'assets', 'editor', 'thumbnail', 'export'];

function currentVideo(scene: NonNullable<BrollPlan>['scenes'][number]): boolean {
  if (!scene.videoFile || scene.imageStatus === 'generating' || scene.imageStatus === 'failed' || scene.videoStatus === 'stale') return false;
  const imageRevision = Math.max(0, Number(scene.imageRevision) || (scene.imageFile ? 1 : 0));
  return scene.videoSourceImageRevision === undefined || scene.videoSourceImageRevision === imageRevision;
}

export type WorkflowFacts = {
  sourceAvailable: boolean;
  clipCount: number;
  transcriptReady: boolean;
  cleaned: boolean;
  sceneCount: number;
  imagesReady: number;
  videosReady: number;
  thumbnailReady: boolean;
};

export function workflowFacts(
  project: Project,
  wordCount: number,
  cleaned: boolean,
  broll: BrollPlan | null,
  thumbnail: ThumbnailState | null,
): WorkflowFacts {
  const scenes = broll?.scenes ?? [];
  return {
    sourceAvailable: project.sourceAvailable,
    clipCount: project.clips?.length ?? project.clipCount ?? 1,
    transcriptReady: wordCount > 0 || project.state.transcriptReady,
    cleaned,
    sceneCount: scenes.length,
    imagesReady: scenes.filter((scene) => scene.imageFile && scene.imageStatus !== 'generating' && scene.imageStatus !== 'failed').length,
    videosReady: scenes.filter(currentVideo).length,
    thumbnailReady: Boolean(thumbnail?.hasImage),
  };
}

export function workflowSteps(facts: WorkflowFacts): WorkflowStep[] {
  const { sourceAvailable, clipCount, transcriptReady, cleaned, sceneCount, imagesReady, videosReady, thumbnailReady } = facts;
  const sourceBlock: StageStatus = sourceAvailable ? 'available' : 'needs-source';
  const complete = (ok: boolean): StageStatus => ok ? 'complete' : sourceBlock;
  return [
    { id: 'upload', label: 'Upload', description: 'Source video and playback order', status: sourceAvailable ? 'complete' : 'needs-source', detail: sourceAvailable ? `${clipCount} source clip${clipCount === 1 ? '' : 's'} available` : 'Relink the source video to continue editing' },
    { id: 'clean', label: 'Clean', description: 'Transcript, suggested cuts and manual word edits', status: complete(cleaned), detail: cleaned ? 'Dialogue edit saved' : transcriptReady ? 'Transcript ready · cleaning optional' : 'Transcribe or skip to raw-video editing' },
    { id: 'story', label: 'B-roll plan', description: 'Choose meaningful story beats', status: complete(sceneCount > 0), detail: sceneCount ? `${sceneCount} planned scene${sceneCount === 1 ? '' : 's'}` : 'Planning is optional · raw-video editing still works' },
    { id: 'assets', label: 'B-roll assets', description: 'Generate or import stills and video clips', status: sceneCount > 0 ? (imagesReady >= sceneCount ? 'complete' : 'in-progress') : sourceBlock, detail: sceneCount ? `${imagesReady}/${sceneCount} images · ${videosReady}/${sceneCount} videos (optional)` : 'Plan scenes first, or continue without B-roll' },
    { id: 'editor', label: 'Live editor', description: 'Preview, trim and arrange every layer', status: sourceBlock, detail: sourceAvailable ? 'Open at any stage · edits autosave' : 'Relink source to preview and render' },
    { id: 'thumbnail', label: 'Thumbnail', description: 'Optional branded cover artwork', status: thumbnailReady ? 'complete' : 'available', detail: thumbnailReady ? 'Cover image generated' : 'Optional · never blocks video export' },
    { id: 'export', label: 'Export', description: 'Render the edited timeline or export assets', status: sourceBlock, detail: sourceAvailable ? 'Available now · B-roll and thumbnail optional' : 'Final MP4 needs its source media' },
  ];
}

export function suggestedStage(facts: WorkflowFacts): WorkflowStage {
  if (!facts.sourceAvailable) return 'upload';
  if (!facts.transcriptReady && !facts.cleaned && facts.sceneCount === 0) return 'clean';
  if (facts.cleaned && !facts.sceneCount) return 'story';
  if (facts.sceneCount && facts.imagesReady < facts.sceneCount) return 'assets';
  return 'editor';
}

export function stageAfter(stage: WorkflowStage): WorkflowStage {
  const index = WORKFLOW_STAGES.indexOf(stage);
  return WORKFLOW_STAGES[Math.min(WORKFLOW_STAGES.length - 1, index + 1)];
}
