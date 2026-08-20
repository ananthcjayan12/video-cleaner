export type Word = { id: string; text: string; start: number; end: number };
export type KeepRange = { startWordId: string; endWordId: string; reason?: string };
export type Edl = { keepRanges: KeepRange[]; notes?: string[] };
export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';
export type BrollWorkflowMode = 'cleaned-video' | 'raw-video' | 'assets-only';
export type BrollCountMode = 'auto' | 'exact' | 'per-minute';

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
  name: string;
  sourceName: string;
  createdAt: string;
  updatedAt: string;
  sourceAvailable: boolean;
  proxyUrl?: string;
  state: ProjectState;
  media: { duration: number; size: number; width?: number; height?: number; frameRate?: number; bitRate?: number; videoCodec?: string; audioCodec?: string; hdr: boolean };
};

export type SystemStatus = {
  codex: { installed: boolean; authenticated: boolean; path: string | null };
  grok: { installed: boolean; path: string | null; model: string; videoModel?: string };
  ffmpeg: { installed: boolean; path: string | null; capabilities?: { videoToolboxDecode: boolean; h264VideoToolbox: boolean; hevcVideoToolbox: boolean } };
  ffprobe: { installed: boolean; path: string | null };
  elevenLabs: { configured: boolean };
  imageProvider: ImageProvider;
  imageProviders: {
    openai: { configured: boolean; model: string };
    gemini: { configured: boolean; model: string };
    grokCli: { configured: boolean; model: string; experimental: boolean };
    codexCli: { configured: boolean; model: string; experimental: boolean };
  };
  brollVideo?: { configured: boolean; provider: string; model: string; experimental: boolean };
  projectsDir: string;
  overrides?: {
    codexBin: string; grokBin: string; ffmpegBin: string; ffprobeBin: string; projectsDir: string;
    imageProvider: string; openAiImageModel: string; geminiImageModel: string; grokModel: string; grokVideoModel?: string;
  };
};

export type ExportStatus = { state: 'idle' | 'running' | 'completed' | 'failed'; progress: number; outTime: string; speed: string; frame: number; outputPath?: string; encoder?: string; error?: string };
export type BrollPlanSettings = {
  workflowMode: BrollWorkflowMode; provider: ImageProvider; countMode: BrollCountMode; targetCount: number; imagesPerMinute: number;
  minSceneDuration: number; maxSceneDuration: number; aspectRatio: 'auto' | '9:16' | '16:9';
};
export type BrollScene = {
  id: string; title: string; startWordId: string; endWordId: string; sourceStart: number; sourceEnd: number; narration: string; visualIntent: string; shotType: string;
  imagePrompt: string; videoPrompt?: string; enabled: boolean; imageFile?: string; generatedAt?: string; provider?: ImageProvider | 'manual'; model?: string;
  videoFile?: string; videoGeneratedAt?: string; videoModel?: string;
};
export type BrollPlan = { version: 2; orientation: 'portrait' | 'landscape'; stylePreset: string; settings: BrollPlanSettings; scenes: BrollScene[]; notes: string[] };
export type ProjectSnapshot = {
  project: Project;
  transcript: { text?: string; words: Word[] } | null;
  edl: Edl | null;
  broll: BrollPlan | null;
  proxyUrl: string | null;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  status: () => request<SystemStatus>('/api/system/status'),
  settings: () => request<SystemStatus>('/api/settings'),
  saveSettings: (body: Record<string, string>) => request<SystemStatus>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  listProjects: () => request<Project[]>('/api/projects'),
  selectProject: () => request<Project>('/api/projects/select', { method: 'POST' }),
  openProject: (id: string) => request<ProjectSnapshot>(`/api/projects/${id}/open`, { method: 'POST' }),
  renameProject: (id: string, name: string) => request<Project>(`/api/projects/${id}/meta`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => request<{ deleted: boolean; id: string }>(`/api/projects/${id}`, { method: 'DELETE' }),
  relinkProject: (id: string) => request<Project>(`/api/projects/${id}/relink`, { method: 'POST' }),

  prepare: (id: string) => request<{ proxyUrl: string; proxy: { width: number; height: number; fps: number; hardware: boolean } }>(`/api/projects/${id}/prepare`, { method: 'POST' }),
  transcribe: (id: string) => request<{ transcript: { text?: string; words: Word[] }; edl: Edl }>(`/api/projects/${id}/transcribe`, { method: 'POST' }),
  clean: (id: string, intensity: string) => request<Edl>(`/api/projects/${id}/clean`, { method: 'POST', body: JSON.stringify({ intensity }) }),
  setEdl: (id: string, keepRanges: KeepRange[]) => request<Edl>(`/api/projects/${id}/edl`, { method: 'PUT', body: JSON.stringify({ keepRanges }) }),
  planBroll: (id: string, settings: Partial<BrollPlanSettings>) => request<{ plan: BrollPlan; transcript: { text?: string; words: Word[] }; edl: Edl }>(`/api/projects/${id}/broll/plan`, { method: 'POST', body: JSON.stringify({ settings }) }),
  getBroll: (id: string) => request<BrollPlan>(`/api/projects/${id}/broll`),
  updateBrollScene: (id: string, sceneId: string, patch: { title?: string; imagePrompt?: string; videoPrompt?: string; sourceStart?: number; sourceEnd?: number; enabled?: boolean }) => request<BrollScene>(`/api/projects/${id}/broll/scenes/${sceneId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteBrollScene: (id: string, sceneId: string) => request<BrollPlan>(`/api/projects/${id}/broll/scenes/${sceneId}`, { method: 'DELETE' }),
  generateBrollScene: (id: string, sceneId: string, regenerationComment?: string) => request<{ scene: BrollScene; imageUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/generate`, { method: 'POST', body: JSON.stringify({ regenerationComment }) }),
  importBrollImage: (id: string, sceneId: string) => request<{ scene: BrollScene; imageUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/manual-image`, { method: 'POST' }),
  createBrollVideoPrompt: (id: string, sceneId: string) => request<BrollScene>(`/api/projects/${id}/broll/scenes/${sceneId}/video-prompt`, { method: 'POST' }),
  createBrollVideo: (id: string, sceneId: string, regenerationComment?: string) => request<{ scene: BrollScene; videoUrl: string }>(`/api/projects/${id}/broll/scenes/${sceneId}/video`, { method: 'POST', body: JSON.stringify({ regenerationComment }) }),
  brollImageUrl: (id: string, sceneId: string, version?: string) => `/api/projects/${id}/broll/scenes/${sceneId}/image${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  brollVideoUrl: (id: string, sceneId: string, version?: string) => `/api/projects/${id}/broll/scenes/${sceneId}/video${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  exportBrollAssets: (id: string) => request<{ destination: string; sceneCount: number }>(`/api/projects/${id}/broll/export-assets`, { method: 'POST' }),
  exportBrollVideo: (id: string, mode: 'fast' | 'quality') => request<{ started: boolean; outputPath: string; encoder: string; hardware: boolean; targetBitRate: number; brollScenes: number }>(`/api/projects/${id}/broll/export-video`, { method: 'POST', body: JSON.stringify({ mode }) }),
  exportVideo: (id: string, mode: 'fast' | 'quality') => request<{ started: boolean; outputPath: string; encoder: string; hardware: boolean; targetBitRate: number }>(`/api/projects/${id}/export`, { method: 'POST', body: JSON.stringify({ mode }) }),
  exportStatus: (id: string) => request<ExportStatus>(`/api/projects/${id}/export-status`),
};
