import type { StickDraft, StickRender, StickTheme } from '../server/stick-reel';
import type { NarrationJob, StickScript, StickStudioSettings } from '../server/stick-narration';
import type { ReelSource, SourceJob } from '../server/stick-source';
export type { ReelSource };
export type StickPlanState = { state: 'running' | 'failed'; error?: string } | null;
export type StickPicturesState = { state: 'running' | 'failed' | 'ready'; stage?: string; error?: string } | null;
export type StudioInfo = { settings: StickStudioSettings; voices: Array<{ id: string; label: string }>; themes: StickTheme[]; facePacks: string[]; scriptEngine: { provider: string; model: string; effort: string }; geminiReady: boolean };
export type ScriptJob = { id: string; state: 'running' | 'ready' | 'failed'; script?: StickScript; error?: string };
export type Word = { id: string; text: string; start: number; end: number };
export type EditorMediaEntry = {
  id: string; name: string; kind: 'video' | 'audio' | 'image'; duration: number;
  size: number; width?: number; height?: number; hasAudio?: boolean;
};
export async function uploadEditorMedia(id: string, file: File): Promise<EditorMediaEntry> {
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : '';
  if (!kind) throw new Error('Select a supported video, audio or picture');
  const endpoint = `/api/projects/${encodeURIComponent(id)}/editor/media?kind=${kind}&name=${encodeURIComponent(file.name)}`;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Media upload failed (${response.status})`);
  return body.media as EditorMediaEntry;
}
export type KeepRange = { startWordId: string; endWordId: string; reason?: string };
export type Edl = { keepRanges: KeepRange[]; notes?: string[]; keptSeconds?: number; sourceSeconds?: number; intensity?: CleanIntensity; targetDurationSec?: number };
export type CleanIntensity = 'light' | 'balanced' | 'aggressive';
export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli' | 'chatgpt-browser';
export type TextProvider = 'codex-cli' | 'claude-cli' | 'agy-cli' | 'gemini' | 'openai' | 'anthropic';
export type ModelOption = { id: string; label: string };
export type VideoProvider = 'grok-cli' | 'google-flow' | 'magnific';
export type StillEffect = 'hold' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';
export type BrollWorkflowMode = 'cleaned-video' | 'raw-video' | 'assets-only';
export type BrollAssetAspectRatio = 'auto' | '9:16' | '16:9';
export type BrollBeatType = 'hook' | 'problem' | 'cause' | 'anatomy' | 'progression' | 'solution' | 'prevention' | 'cta' | 'supporting';
export type BrollVisualMode = 'hyperreal-clinical' | 'educational-3d' | 'anatomy-cutaway' | 'procedure-closeup' | 'symbolic-medical' | 'clinic-support';
export type BrollAnimationPlan = { motionType: string; cameraMove: string; subjectMotion: string; revealSequence: string[]; highlightTargets: string[]; avoidMotion: string[] };
export type BrollCountMode = 'auto' | 'exact' | 'per-minute' | 'interval';
export type BrollDisplayTemplate = 'full-frame' | 'top-card' | 'split-top' | 'picture-in-picture' | 'top-card-presenter' | 'presenter-overlay' | 'stacked-cards-cutout' | 'stacked-talking-top' | 'stacked-broll-top';

export type ProjectState = {
  proxyReady: boolean;
  transcriptReady: boolean;
  cleaned: boolean;
  brollPlanned: boolean;
  brollScenes: number;
  brollImages: number;
  brollVideos: number;
  missingImages: number;
  missingVideos: number;
};

export type Project = {
  id: string;
  workspaceId?: string;
  postedAt?: string;
  reel?: ReelStatus | null;
  name: string;
  sourceName: string;
  clipCount?: number;
  clips?: Array<{ id: string; sourceName: string; duration: number; timelineStart: number; timelineEnd: number }>;
  createdAt: string;
  updatedAt: string;
  sourceAvailable: boolean;
  proxyUrl?: string;
  state: ProjectState;
  media: { duration: number; size: number; width?: number; height?: number; frameRate?: number; bitRate?: number; videoCodec?: string; audioCodec?: string; hdr: boolean };
};

export type SystemStatus = {
  codex: { installed: boolean; authenticated: boolean; path: string | null };
  claude: { installed: boolean; authenticated: boolean; path: string | null };
  grok: { installed: boolean; path: string | null; model: string; videoModel?: string };
  agy: { installed: boolean; path: string | null };
  textModels: { clean: { provider: TextProvider; model: string; effort?: string }; planning: { provider: TextProvider; model: string; effort?: string }; pictures?: { provider: 'claude' | 'codex'; model: string; effort?: string }; script?: { provider: TextProvider; model: string; effort?: string }; codexModel: string };
  gflow: { installed: boolean; authenticated: boolean; path: string | null; model: string; profile: string };
  ffmpeg: { installed: boolean; path: string | null; capabilities?: { videoToolboxDecode: boolean; h264VideoToolbox: boolean; hevcVideoToolbox: boolean } };
  ffprobe: { installed: boolean; path: string | null };
  elevenLabs: { configured: boolean };
  apiEngines?: { anthropic: { configured: boolean; model: string; effort: string }; gemini: { configured: boolean; imageModel: string }; allowedProfiles: EngineProfile[] };
  transcription?: { provider: 'gemini' | 'elevenlabs'; model: string; configured: boolean };
  imageProvider: ImageProvider;
  imageProviders: {
    openai: { configured: boolean; model: string };
    gemini: { configured: boolean; model: string };
    grokCli: { configured: boolean; model: string; experimental: boolean };
    codexCli: { configured: boolean; model: string; experimental: boolean };
  };
  videoProviders: { grokCli: { configured: boolean; model: string; experimental: boolean }; googleFlow: { configured: boolean; model: string; profile: string; experimental: boolean }; magnific: { configured: boolean; model: string; endpoint: string; experimental: boolean } };
  brollVideo?: { configured: boolean; provider: string; model: string; experimental: boolean };
  motionGraphics?: { browserPath: string | null; renderer: string };
  matting?: { configured: boolean; pythonInstalled: boolean; dependenciesInstalled: boolean; pythonPath: string | null; detail: string };
  projectsDir: string;
  overrides?: { apiTextModel?: string; apiEffort?: string; cleanEffort?: string; planningEffort?: string; picturesProvider?: string; picturesModel?: string; picturesEffort?: string; sttProvider?: string; geminiSttModel?: string;
    cleanProvider?: string; cleanModel?: string; planningProvider?: string; planningModel?: string; codexModel?: string; agyBin?: string; claudeBin?: string;
    codexBin: string; grokBin: string; gflowBin: string; ffmpegBin: string; ffprobeBin: string; projectsDir: string;
    imageProvider: string; openAiImageModel: string; geminiImageModel: string; grokModel: string; grokVideoModel?: string; gflowProfile?: string; gflowVideoModel?: string; magnificVideoModel?: string; magnificVideoEndpoint?: string;
  };
};

export type PresenterMatteStatus = { ready: boolean; stale: boolean; generatedAt?: string; analysisSource?: 'proxy' | 'generated-proxy' };
export type ProjectExportOptions = {
  talkingHeadVideo: boolean;
  proxyPreview: boolean;
  analysisAudio: boolean;
  subtitles: boolean;
  transcriptText: boolean;
  wordTimestamps: boolean;
  editTimeline: boolean;
  brollImages: boolean;
  brollVideos: boolean;
  brollTiming: boolean;
};
export type ProjectZipExportResult = { downloadUrl?: string; destination: string; archiveBytes: number; clips: number; words: number; brollImages: number; brollVideos: number; files: number };
export type ThumbnailState = {
  version: 1;
  hook?: string;
  references: Array<{ id: string; name: string; bytes: number }>;
  referencesUpdatedAt?: string;
  generatedAt?: string;
  provider?: 'gemini' | 'codex-cli';
  model?: string;
  prompt?: string;
  hasImage: boolean;
};
export type ExportStatus = { state: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'; progress: number; outTime: string; speed: string; frame: number; outputPath?: string; downloadUrl?: string; encoder?: string; error?: string; checkpointCompleted?: number; checkpointTotal?: number; resumable?: boolean; resumed?: boolean };
export type BrollPlanSettings = {
  workflowMode: BrollWorkflowMode; provider: ImageProvider; imageModel?: string; planningProvider?: TextProvider; planningModel?: string; videoPromptProvider?: TextProvider; videoPromptModel?: string; videoProvider: VideoProvider; countMode: BrollCountMode; targetCount: number; imagesPerMinute: number; intervalSeconds: number;
  minSceneDuration: number; maxSceneDuration: number; aspectRatio: 'auto' | '9:16' | '16:9'; displayTemplate?: BrollDisplayTemplate; returnVideoWithAudio: boolean;
};
export type BrollVideoAttempt = { id: string; source: 'google-flow' | 'grok-cli' | 'magnific' | 'manual' | 'flow-catalog' | 'still-effect'; status: 'submitted' | 'completed' | 'failed'; startedAt: string; completedAt?: string; model?: string; prompt?: string; localFile?: string; flowProjectId?: string; flowMediaId?: string; flowWorkflowId?: string; error?: string; errorLogFile?: string; sourceImageRevision?: number };
export type GoogleFlowProjectState = { projectId: string; title: string; profile: string; url: string; createdAt: string; lastSyncedAt?: string };
export type GoogleFlowCatalogVideo = { mediaId: string; projectId: string; prompt: string; aspect?: string; model?: string; duration?: number; createdAt?: string; localPath?: string };
export type BrollScene = {
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number; narration: string; visualIntent: string; shotType: string;
  imagePrompt: string; videoPrompt?: string; enabled: boolean; beatType?: BrollBeatType; keyPoint?: string; whyThisVisualMatters?: string; viewerTakeaway?: string; visualMode?: BrollVisualMode; animationPlan?: BrollAnimationPlan; imageFile?: string; generatedAt?: string; provider?: ImageProvider | 'manual'; model?: string; imageRevision?: number; imageStatus?: 'none' | 'generating' | 'ready' | 'failed';
  videoFile?: string; videoDuration?: number; videoGeneratedAt?: string; videoModel?: string; videoProvider?: VideoProvider | 'still-effect'; videoTreatment?: 'ai' | 'still'; stillEffect?: StillEffect; displayTemplate?: BrollDisplayTemplate; assetAspectRatio?: BrollAssetAspectRatio;
  generatedAspectRatio?: Exclude<BrollAssetAspectRatio, 'auto'>; orientationChanged?: boolean; videoAttempts?: BrollVideoAttempt[]; activeVideoAttemptId?: string; videoSourceImageRevision?: number; videoStatus?: 'none' | 'stale' | 'generating' | 'ready';
};
export type BrollPlan = { version: 2; orientation: 'portrait' | 'landscape'; stylePreset: string; settings: BrollPlanSettings; scenes: BrollScene[]; notes: string[]; googleFlow?: GoogleFlowProjectState };
export type ProjectSnapshot = {
  project: Project;
  transcript: { text?: string; words: Word[] } | null;
  edl: Edl | null;
  broll: BrollPlan | null;
  proxyUrl: string | null;
};

export type MotionGraphicType = 'lower-third' | 'stat-callout' | 'kinetic-title' | 'animated-chart' | 'process-steps' | 'comparison' | 'checklist' | 'quote-card' | 'timeline' | 'icon-diagram';
export type MotionPlacement = 'top' | 'center' | 'bottom' | 'full';
export type MotionItem = { label: string; value: string };
export type MotionSettings = {
  planningProvider: TextProvider; planningModel: string; codeProvider?: TextProvider; codeModel?: string;
  countMode: 'auto' | 'exact' | 'per-minute'; targetCount: number; perMinute: number; minDuration: number; maxDuration: number;
  accentColor: string; secondaryColor: string; styleNotes: string; defaultTemplateId?: string;
  emotionSounds: boolean; emotionDensity: EmotionDensity;
};
export type EmotionId = 'shock' | 'suspense' | 'sadness' | 'joy' | 'insight' | 'warning' | 'emphasis' | 'transition' | 'humor' | 'relief';
export type SoundIntensity = 'soft' | 'medium' | 'strong';
export type EmotionDensity = 'subtle' | 'balanced' | 'expressive';
export type Emotion = { id: EmotionId; label: string; color: string; cue: string; mixDb: number; sounds: string[] };
/** How a cue sits on the timeline: the clip is trimmed so the sound's loudest moment lands on the word. */
export type EmotionClip = { lead: number; sourceOffset: number; duration: number; volume: number; fadeIn: number; fadeOut: number; soundDuration: number; label: string };
export type EmotionCue = {
  id: string; emotion: EmotionId; soundId: string; intensity: SoundIntensity; sourceTime: number; wordId?: string;
  narration: string; reason: string; enabled: boolean; clip: EmotionClip;
};
export type EmotionCuePatch = { emotion?: EmotionId; soundId?: string; intensity?: SoundIntensity; sourceTime?: number; enabled?: boolean; reason?: string };
export type MotionTemplate = { id: string; name: string; notes: string; file: string; createdAt: string };
export type MotionSoundCue = { soundId: string; time: number; gainDb: number };
export type MotionSound = { id: string; label: string; category: string; usage: string; duration: number };
export type MotionScene = {
  soundEffects?: MotionSoundCue[];
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number; narration: string;
  graphicType: MotionGraphicType; placement: MotionPlacement; keyPoint: string; whyThisGraphicMatters: string; viewerTakeaway: string;
  content: { headline: string; subhead: string; items: MotionItem[] }; designBrief: string; enabled: boolean;
  templateId?: string; codeGeneratedAt?: string; codeModel?: string; videoFile?: string; renderedAt?: string; renderProgress?: number;
  status: 'none' | 'generating' | 'ready' | 'failed'; error?: string;
};
export type MotionPlan = { version: 1; orientation: 'portrait' | 'landscape'; settings: MotionSettings; scenes: MotionScene[]; notes: string[]; emotionCues?: EmotionCue[] };
export type MotionScenePatch = {
  soundEffects?: MotionSoundCue[];
  title?: string; enabled?: boolean; sourceStart?: number; sourceEnd?: number; graphicType?: MotionGraphicType; placement?: MotionPlacement; templateId?: string | null;
  headline?: string; subhead?: string; items?: MotionItem[]; designBrief?: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  // Logged out (session expired) on a phone: go to the login page and come back here afterwards.
  if (response.status === 401 && body.login) { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`; }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

/** True when the app is opened from another device (e.g. a phone through the Cloudflare tunnel). */
export const isRemote = () => !['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
export type UploadProgress = { name: string; sent: number; size: number };
// 8 MB slices: each finishes well inside Cloudflare's ~100 s request window even on slow mobile uploads,
// and a dropped slice costs little to resend.
const CHUNK = 8 * 1024 * 1024;

/** PUT one slice with XHR so the progress bar moves while the slice is still uploading. */
function putSlice(url: string, slice: Blob, onBytes: (loaded: number) => void, signal?: AbortSignal) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 95_000;
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => { let body: any = {}; try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ } resolve({ status: xhr.status, body }); };
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.ontimeout = () => reject(new Error('Upload slice timed out'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(slice);
  });
}

/**
 * Upload a file in slices; resumes after dropped connections by asking the server how much it already has.
 * Returns the upload id to pass as uploadIds to project/clip/image routes.
 */
export async function uploadFile(file: File, onProgress?: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<string> {
  const created = await request<{ id: string }>('/api/uploads', { method: 'POST', body: JSON.stringify({ name: file.name, size: file.size }), signal });
  let sent = 0; let failures = 0;
  while (sent < file.size) {
    if (signal?.aborted) throw new Error('Upload cancelled');
    const slice = file.slice(sent, Math.min(file.size, sent + CHUNK));
    try {
      const base = sent;
      const { status, body } = await putSlice(`/api/uploads/${created.id}?offset=${sent}`, slice, (loaded) => onProgress?.({ name: file.name, sent: base + loaded, size: file.size }), signal);
      if (status === 409 && typeof body.expected === 'number') { sent = body.expected; continue; }
      if (status === 401 && body.login) { window.location.href = '/login'; throw new Error('Please log in again'); }
      if (status < 200 || status >= 300) throw new Error(body.error || `Upload failed (${status})`);
      sent = body.received; failures = 0;
      onProgress?.({ name: file.name, sent, size: file.size });
    } catch (error) {
      if (signal?.aborted || ++failures > 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 1000 * 2 ** failures)));
      const status = await request<{ received: number }>(`/api/uploads/${created.id}`).catch(() => null);
      if (status) sent = status.received;
    }
  }
  return created.id;
}

export type AutoStageId = 'audio' | 'transcribe' | 'clean' | 'review' | 'broll-plan' | 'broll-images' | 'edit' | 'captions' | 'compose';
export type AutoStage = { id: AutoStageId; label: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; detail?: string; seconds?: number };
export type AutoOptions = { targetDurationSec?: number; imageProvider: 'gemini' | 'chatgpt'; broll?: boolean; captions?: boolean; review?: boolean; thumbnail?: boolean; postCaption?: boolean };
export type ThumbnailBadge = { icon: string; label?: string };
export type ReelPackage = { state: 'running' | 'ready' | 'failed'; error?: string; frames: string[]; frame: number; lines: string[]; label: string; badges: ThumbnailBadge[]; caption: string; hashtags: string[]; thumbnailUrl?: string; thumbnailDownloadUrl?: string };
export type PackageEdit = Partial<Pick<ReelPackage, 'frame' | 'lines' | 'label' | 'badges' | 'caption' | 'hashtags'>>;
export type ReviewWord = { id: string; text: string; start: number; end: number };
export type AutoReview = { words: ReviewWord[]; keepRanges: KeepRange[]; keptSeconds: number; sourceSeconds: number; notes?: string; redoing?: boolean; flags?: ClaimFlag[] };
export type EngineProfile = 'in-house' | 'api';
export type UsageSummary = { costUsd: number; apiUsd: number; estimated: boolean; tokens: { input: number; output: number }; images: number; renderSeconds: number; audioSeconds: number; byTask: Record<string, { costUsd: number; apiUsd: number }> };
export type Niche = 'dental' | 'physio' | 'nutrition' | 'optometry';
export type ReelLook = { label: string; font: string; accent: string; onAccent: string; highlight: string; coverHighlight: string };
export type Workspace = { limitThisMonth?: number; extraReels?: { month: string; reels: number }; look?: ReelLook; id: string; name: string; profile: EngineProfile; niche?: Niche; effectiveProfile: EngineProfile | null; reelsPerMonth?: number; reelsThisMonth: number; createdAt: string };
export type ConsoleReel = { id: string; name: string; workspaceId: string; createdAt: string; postedAt?: string; state: AutoJob['state']; step?: string; error?: string; startedAt?: number; finishedAt?: number; seconds?: number; coverUrl?: string; previewUrl?: string; cost: UsageSummary };
export type ConsolePack = ReelLook & { id: Niche; artDirection: string; hashtags: string[] };
export type ConsoleData = { packs: ConsolePack[]; now: number; workspaces: AdminWorkspace[]; reels: ConsoleReel[]; allowedProfiles: EngineProfile[] };
export type KeyCheck = { ok: boolean; detail: string };
export type AdminWorkspace = Workspace & { members: Array<{ username: string; createdAt: string }>; costThisMonth: UsageSummary };
export type Me = { username: string; role: 'admin' | 'member'; workspace?: Workspace; workspaces?: Workspace[]; allowedProfiles: EngineProfile[] };
export type Idea = { id: string; kind: string; title: string; hook: string; points: string[]; seconds: number };
export type ClaimFlag = { from: number; to: number; match: string; title: string; fix: string };
export type ReelStatus = { state: AutoJob['state']; step?: string; queuePosition?: number; finishedAt?: number; coverUrl?: string; previewUrl?: string };
export type AutoJob = { look?: ReelLook; queuePosition?: number; resumed?: boolean; profile?: EngineProfile; cost?: UsageSummary; state: 'idle' | 'running' | 'review' | 'completed' | 'failed' | 'stopped'; review?: AutoReview; stages?: AutoStage[]; startedAt?: number; finishedAt?: number; error?: string; previewUrl?: string; downloadUrl?: string; sourceSeconds?: number; finalSeconds?: number; options?: AutoOptions; package?: ReelPackage };

export const api = {
  me: () => request<Me>('/api/me'),
  ideas: () => request<{ niche: Niche; label: string; week: Idea[]; all: Idea[] }>('/api/ideas'),
  markPosted: (id: string, posted: boolean) => request<{ postedAt: string | null }>(`/api/projects/${id}/posted`, { method: 'POST', body: JSON.stringify({ posted }) }),
  pushKey: () => request<{ publicKey: string }>('/api/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request<{ ok: true }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  console: () => request<ConsoleData>('/api/admin/console'),
  addExtraReels: (id: string, reels = 5) => request<Workspace>(`/api/admin/workspaces/${encodeURIComponent(id)}/extra-reels`, { method: 'POST', body: JSON.stringify({ reels }) }),
  nudge: (id: string) => request<{ sent: number }>(`/api/admin/workspaces/${encodeURIComponent(id)}/nudge`, { method: 'POST' }),
  testEngines: () => request<{ anthropic: KeyCheck; gemini: KeyCheck }>('/api/admin/engines/test', { method: 'POST' }),
  adminWorkspaces: () => request<{ allowedProfiles: EngineProfile[]; workspaces: AdminWorkspace[] }>('/api/admin/workspaces'),
  createWorkspace: (body: { name: string; profile: EngineProfile; niche?: Niche; reelsPerMonth?: number }) => request<Workspace>('/api/admin/workspaces', { method: 'POST', body: JSON.stringify(body) }),
  updateWorkspace: (id: string, body: { name?: string; profile?: EngineProfile; niche?: Niche; reelsPerMonth?: number }) => request<Workspace>(`/api/admin/workspaces/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  addMember: (workspaceId: string, username: string, password: string) => request<{ username: string }>(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  removeMember: (username: string) => request<{ ok: true }>(`/api/admin/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  createStick: (uploadId: string) => request<Project>('/api/projects/select', { method: 'POST', body: JSON.stringify({ uploadIds: [uploadId], stick: true }) }),
  stick: (id: string) => request<{ draft: StickDraft; render: StickRender | null; duration: number; audioUrl: string; customMusic: boolean; facePacks: string[]; themes: StickTheme[]; planned?: boolean; plan: StickPlanState; pictures: StickPicturesState; assetBase: string }>(`/api/projects/${id}/stick`),
  makeStickPictures: (id: string) => request<{ pictures: StickPicturesState }>(`/api/projects/${id}/stick/pictures`, { method: 'POST' }),
  stickMusic: (id: string, uploadId?: string) => request<{ customMusic: boolean }>(`/api/projects/${id}/stick/music`, uploadId
    ? { method: 'PUT', body: JSON.stringify({ uploadId }) } : { method: 'DELETE' }),
  saveStick: (id: string, draft: StickDraft) => request<{ draft: StickDraft }>(`/api/projects/${id}/stick`, { method: 'PUT', body: JSON.stringify(draft) }),
  transcribeStick: (id: string) => request<{ draft: StickDraft }>(`/api/projects/${id}/stick/transcribe`, { method: 'POST' }),
  planStick: (id: string, body?: { brief?: string; themeId?: string }) => request<{ plan: StickPlanState }>(`/api/projects/${id}/stick/plan`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  studio: () => request<StudioInfo>('/api/stick/studio'),
  saveStudio: (settings: Partial<StickStudioSettings>) => request<{ settings: StickStudioSettings }>('/api/stick/studio', { method: 'PUT', body: JSON.stringify(settings) }),
  cancelStudioJob: (kind: 'source' | 'script' | 'narrate', jobId: string) => request<{ stopped: boolean }>(`/api/stick/${kind}/${jobId}/cancel`, { method: 'POST' }),
  cancelStick: (projectId: string) => request<{ stopped: boolean }>(`/api/projects/${projectId}/stick/cancel`, { method: 'POST' }),
  stickReels: () => request<{ reels: Array<{ id: string; name: string; updatedAt: string; duration: number; state: 'planning' | 'pictures' | 'rendering' | 'ready' | 'failed' | 'draft'; url?: string }> }>('/api/stick/reels'),
  fetchSource: (url: string) => request<{ job: SourceJob }>('/api/stick/source', { method: 'POST', body: JSON.stringify({ url }) }),
  sourceJob: (jobId: string) => request<{ job: SourceJob }>(`/api/stick/source/${jobId}`),
  writeScript: (body: { concept: string; seconds?: number; feedback?: string; previous?: StickScript; source?: ReelSource }) => request<{ job: ScriptJob }>('/api/stick/script', { method: 'POST', body: JSON.stringify(body) }),
  scriptJob: (jobId: string) => request<{ job: ScriptJob }>(`/api/stick/script/${jobId}`),
  previewVoice: (body: { voice?: string; voiceStyle?: string; line?: string }) => request<{ url: string }>('/api/stick/voice-preview', { method: 'POST', body: JSON.stringify(body) }),
  narrate: (script: StickScript) => request<{ job: NarrationJob }>('/api/stick/narrate', { method: 'POST', body: JSON.stringify({ script }) }),
  stickVoices: () => request<{ voices: Array<{ id: string; script: StickScript; at: number }> }>('/api/stick/voices'),
  narration: (jobId: string) => request<{ job: NarrationJob; url?: string }>(`/api/stick/narrate/${jobId}`),
  renderStick: (id: string, draft: StickDraft) => request<{ render: StickRender }>(`/api/projects/${id}/stick/render`, { method: 'POST', body: JSON.stringify(draft) }),
  startAuto: (id: string, options: AutoOptions) => request<AutoJob>(`/api/projects/${id}/auto`, { method: 'POST', body: JSON.stringify(options) }),
  autoStatus: (id: string) => request<AutoJob>(`/api/projects/${id}/auto`),
  reviewAuto: (id: string, body: { action: 'continue' | 'redo'; keepRanges?: KeepRange[]; notes?: string }) => request<{ ok: boolean }>(`/api/projects/${id}/auto/review`, { method: 'POST', body: JSON.stringify(body) }),
  remakePackage: (id: string, notes?: string) => request<AutoJob>(`/api/projects/${id}/auto/package`, { method: 'POST', body: JSON.stringify({ notes }) }),
  editPackage: (id: string, edit: PackageEdit) => request<AutoJob>(`/api/projects/${id}/auto/package`, { method: 'PUT', body: JSON.stringify(edit) }),
  stopAuto: (id: string) => request<AutoJob>(`/api/projects/${id}/auto/stop`, { method: 'POST' }),
  status: () => request<SystemStatus>('/api/system/status'),
  settings: () => request<SystemStatus>('/api/settings'),
  agyModels: () => request<{ models: ModelOption[] }>('/api/models/agy'),
  codexModels: () => request<{ models: ModelOption[] }>('/api/models/codex'),
  saveSettings: (body: Record<string, string>) => request<SystemStatus>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  listProjects: () => request<Project[]>('/api/projects'),
  selectProject: (uploadIds?: string[], auto?: boolean, workspaceId?: string) => request<Project>('/api/projects/select', { method: 'POST', body: JSON.stringify({ uploadIds, auto, workspaceId }) }),
  openProject: (id: string) => request<ProjectSnapshot>(`/api/projects/${id}/open`, { method: 'POST' }),
  renameProject: (id: string, name: string) => request<Project>(`/api/projects/${id}/meta`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => request<{ deleted: boolean; id: string }>(`/api/projects/${id}`, { method: 'DELETE' }),
  relinkProject: (id: string, uploadIds?: string[]) => request<Project>(`/api/projects/${id}/relink`, { method: 'POST', body: JSON.stringify({ uploadIds }) }),
  addProjectClips: (id: string, uploadIds?: string[]) => request<Project>(`/api/projects/${id}/clips`, { method: 'POST', body: JSON.stringify({ uploadIds }) }),
  reorderProjectClips: (id: string, clipIds: string[]) => request<Project>(`/api/projects/${id}/clips/order`, { method: 'PUT', body: JSON.stringify({ clipIds }) }),
  removeProjectClip: (id: string, clipId: string) => request<Project>(`/api/projects/${id}/clips/${clipId}`, { method: 'DELETE' }),

  prepare: (id: string) => request<{ proxyUrl: string; proxy: { width: number; height: number; fps: number; hardware: boolean } }>(`/api/projects/${id}/prepare`, { method: 'POST' }),
  transcribe: (id: string) => request<{ transcript: { text?: string; words: Word[] }; edl: Edl }>(`/api/projects/${id}/transcribe`, { method: 'POST' }),
  clean: (id: string, intensity: CleanIntensity, targetDurationSec?: number) => request<Edl>(`/api/projects/${id}/clean`, { method: 'POST', body: JSON.stringify({ intensity, targetDurationSec }) }),
  setEdl: (id: string, keepRanges: KeepRange[]) => request<Edl>(`/api/projects/${id}/edl`, { method: 'PUT', body: JSON.stringify({ keepRanges }) }),
  planBroll: (id: string, settings: Partial<BrollPlanSettings>) => request<{ plan: BrollPlan; transcript: { text?: string; words: Word[] }; edl: Edl }>(`/api/projects/${id}/broll/plan`, { method: 'POST', body: JSON.stringify({ settings: { ...settings, displayTemplate: undefined } }) }),
  getBroll: (id: string) => request<BrollPlan>(`/api/projects/${id}/broll`),
  motionSounds: () => request<{ sounds: MotionSound[]; emotions: Emotion[] }>('/api/motion-sounds'),
  motionSoundUrl: (id: string) => `/api/motion-sounds/${encodeURIComponent(id)}/audio`,
  motionTemplates: () => request<{ templates: MotionTemplate[] }>('/api/motion-templates'),
  uploadMotionTemplate: async (file: File, name: string, notes: string): Promise<MotionTemplate> => {
    const response = await fetch(`/api/motion-templates?fileName=${encodeURIComponent(file.name)}&name=${encodeURIComponent(name)}&notes=${encodeURIComponent(notes)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Template upload failed (${response.status})`);
    return body as MotionTemplate;
  },
  updateMotionTemplate: (id: string, patch: { name?: string; notes?: string }) => request<MotionTemplate>(`/api/motion-templates/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteMotionTemplate: (id: string) => request<{ deleted: boolean }>(`/api/motion-templates/${id}`, { method: 'DELETE' }),
  motionTemplateImageUrl: (id: string) => `/api/motion-templates/${id}/image`,
  getMotion: async (id: string): Promise<MotionPlan | null> => {
    const response = await fetch(`/api/projects/${id}/motion`);
    if (response.status === 404) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body as MotionPlan;
  },
  planMotion: (id: string, settings: Partial<MotionSettings>) => request<MotionPlan>(`/api/projects/${id}/motion/plan`, { method: 'POST', body: JSON.stringify({ settings }) }),
  planEmotionSounds: (id: string, settings: Partial<MotionSettings>) => request<MotionPlan>(`/api/projects/${id}/motion/sfx/plan`, { method: 'POST', body: JSON.stringify({ settings }) }),
  addEmotionCue: (id: string, cue: { emotion: EmotionId; soundId?: string; intensity?: SoundIntensity; sourceTime: number }) => request<EmotionCue>(`/api/projects/${id}/motion/sfx`, { method: 'POST', body: JSON.stringify(cue) }),
  updateEmotionCue: (id: string, cueId: string, patch: EmotionCuePatch) => request<EmotionCue>(`/api/projects/${id}/motion/sfx/${cueId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteEmotionCue: (id: string, cueId: string) => request<MotionPlan>(`/api/projects/${id}/motion/sfx/${cueId}`, { method: 'DELETE' }),
  updateMotionSettings: (id: string, patch: Partial<MotionSettings>) => request<MotionPlan>(`/api/projects/${id}/motion/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  updateMotionScene: (id: string, sceneId: string, patch: MotionScenePatch) => request<MotionScene>(`/api/projects/${id}/motion/scenes/${sceneId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteMotionScene: (id: string, sceneId: string) => request<MotionPlan>(`/api/projects/${id}/motion/scenes/${sceneId}`, { method: 'DELETE' }),
  generateMotionScene: (id: string, sceneId: string, options: { regenerateCode?: boolean; comment?: string } = {}) => request<MotionScene>(`/api/projects/${id}/motion/scenes/${sceneId}/generate`, { method: 'POST', body: JSON.stringify(options) }),
  stopMotionRender: (id: string, sceneId?: string) => request<{ stopped: number }>(`/api/projects/${id}/motion/stop`, { method: 'POST', body: JSON.stringify({ sceneId }) }),
  motionVideoUrl: (id: string, sceneId: string, version?: string) => `/api/projects/${id}/motion/scenes/${sceneId}/video${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  getEditorProject: <T = unknown>(id: string) => request<{ project: T | null }>(`/api/projects/${id}/editor-project`),
  editorMedia: (id: string) => request<{ media: EditorMediaEntry[] }>(`/api/projects/${id}/editor/media`),
  editorMediaUrl: (id: string, mediaId: string) => `/api/projects/${encodeURIComponent(id)}/editor/media/${encodeURIComponent(mediaId)}`,
  saveEditorProject: <T = unknown>(id: string, project: T) => request<{ project: T; savedAt: string }>(`/api/projects/${id}/editor-project`, { method: 'PUT', body: JSON.stringify({ project }) }),
  editorBaseVideoUrl: (id: string, version?: string) => `/api/projects/${id}/editor/base-video${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  editorBaseClipUrl: (id: string, clipId: string, version?: string) => `/api/projects/${id}/editor/base-clips/${encodeURIComponent(clipId)}${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  getThumbnail: (id: string) => request<ThumbnailState>(`/api/projects/${id}/thumbnail`),
  selectThumbnailReferences: (id: string, uploadIds?: string[]) => request<ThumbnailState>(`/api/projects/${id}/thumbnail/references`, { method: 'POST', body: JSON.stringify({ uploadIds }) }),
  generateThumbnail: (id: string, hook?: string) => request<ThumbnailState>(`/api/projects/${id}/thumbnail/generate`, { method: 'POST', body: JSON.stringify({ hook }) }),
  thumbnailImageUrl: (id: string, version?: string) => `/api/projects/${id}/thumbnail/image${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  thumbnailReferenceUrl: (id: string, referenceId: string, version?: string) => `/api/projects/${id}/thumbnail/references/${encodeURIComponent(referenceId)}${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  updateBrollSettings: (id: string, patch: { provider?: ImageProvider; imageModel?: string; planningProvider?: TextProvider; planningModel?: string; videoPromptProvider?: TextProvider | ''; videoPromptModel?: string; videoProvider?: VideoProvider; returnVideoWithAudio?: boolean }) => request<BrollPlan>(`/api/projects/${id}/broll/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  updateBrollScene: (id: string, sceneId: string, patch: { title?: string; imagePrompt?: string; videoPrompt?: string; sourceStart?: number; sourceEnd?: number; enabled?: boolean; displayTemplate?: BrollDisplayTemplate | 'default'; assetAspectRatio?: BrollAssetAspectRatio }) => request<BrollScene>(`/api/projects/${id}/broll/scenes/${sceneId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteBrollScene: (id: string, sceneId: string) => request<BrollPlan>(`/api/projects/${id}/broll/scenes/${sceneId}`, { method: 'DELETE' }),
  generateBrollScene: (id: string, sceneId: string, regenerationComment?: string) => request<{ scene: BrollScene; imageUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/generate`, { method: 'POST', body: JSON.stringify({ regenerationComment }) }),
  importBrollImage: (id: string, sceneId: string, uploadIds?: string[]) => request<{ scene: BrollScene; imageUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/manual-image`, { method: 'POST', body: JSON.stringify({ uploadIds }) }),
  importBrollVideo: (id: string, sceneId: string, uploadIds?: string[]) => request<{ scene: BrollScene; videoUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/manual-video`, { method: 'POST', body: JSON.stringify({ uploadIds }) }),
  fixBrollSceneForMeta: (id: string, sceneId: string) => request<BrollScene>(`/api/projects/${id}/broll/scenes/${sceneId}/fix-meta`, { method: 'POST' }),
  createBrollVideoPrompt: (id: string, sceneId: string) => request<BrollScene>(`/api/projects/${id}/broll/scenes/${sceneId}/video-prompt`, { method: 'POST' }),
  setBrollStillEffect: (id: string, sceneId: string, effect: StillEffect | 'ai') => request<BrollScene>(`/api/projects/${id}/broll/scenes/${sceneId}/still-effect`, { method: 'POST', body: JSON.stringify({ effect }) }),
  createBrollVideo: (id: string, sceneId: string, regenerationComment?: string) => request<{ scene: BrollScene; videoUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/video`, { method: 'POST', body: JSON.stringify({ regenerationComment }) }),
  syncGoogleFlow: (id: string) => request<{ plan: BrollPlan; unmatched: GoogleFlowCatalogVideo[] }>(`/api/projects/${id}/broll/google-flow/sync`, { method: 'POST' }),
  assignGoogleFlowVideo: (id: string, sceneId: string, mediaId: string) => request<{ scene: BrollScene; videoUrl: string }>(`/api/projects/${id}/broll/google-flow/assign`, { method: 'POST', body: JSON.stringify({ sceneId, mediaId }) }),
  previewBrollScene: (id: string, sceneId: string) => request<{ previewUrl: string; duration: number; cached: boolean }>(`/api/projects/${id}/broll/scenes/${sceneId}/preview`, { method: 'POST' }),
  brollImageUrl: (id: string, sceneId: string, version?: string) => `/api/projects/${id}/broll/scenes/${sceneId}/image${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  brollVideoUrl: (id: string, sceneId: string, version?: string) => `/api/projects/${id}/broll/scenes/${sceneId}/video${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  presenterMatteStatus: (id: string) => request<PresenterMatteStatus>(`/api/projects/${id}/presenter-matte`),
  preparePresenterMatte: (id: string) => request<PresenterMatteStatus>(`/api/projects/${id}/presenter-matte`, { method: 'POST' }),
  exportBrollAssets: (id: string) => request<{ destination: string; sceneCount: number }>(`/api/projects/${id}/broll/export-assets`, { method: 'POST' }),
  exportProjectZip: (id: string, options: ProjectExportOptions) => request<ProjectZipExportResult>(`/api/projects/${id}/export-project-zip`, { method: 'POST', body: JSON.stringify({ options }) }),
  exportEditorVideo: (id: string, mode: 'fast' | 'quality') => request<{ started: boolean; outputPath: string; encoder: string; hardware: boolean; editorTimeline: boolean }>(`/api/projects/${id}/editor/export-video`, { method: 'POST', body: JSON.stringify({ mode }) }),
  exportBrollVideo: (id: string, mode: 'fast' | 'quality') => request<{ started: boolean; outputPath: string; encoder: string; hardware: boolean; targetBitRate: number; brollScenes: number; presenterMatte?: boolean; checkpoints?: number }>(`/api/projects/${id}/broll/export-video`, { method: 'POST', body: JSON.stringify({ mode }) }),
  exportVideo: (id: string, mode: 'fast' | 'quality') => request<{ started: boolean; outputPath: string; encoder: string; hardware: boolean; targetBitRate: number }>(`/api/projects/${id}/export`, { method: 'POST', body: JSON.stringify({ mode }) }),
  exportStatus: (id: string) => request<ExportStatus>(`/api/projects/${id}/export-status`),
  stopExport: (id: string) => request<{ stopping: boolean; resumable: boolean }>(`/api/projects/${id}/export-stop`, { method: 'POST' }),
};
