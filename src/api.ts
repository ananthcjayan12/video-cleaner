export type Word = { id: string; text: string; start: number; end: number };
export type KeepRange = { startWordId: string; endWordId: string; reason?: string };
export type Edl = { keepRanges: KeepRange[]; notes?: string[] };
export type Project = {
  id: string;
  sourceName: string;
  media: {
    duration: number;
    size: number;
    width?: number;
    height?: number;
    frameRate?: number;
    bitRate?: number;
    videoCodec?: string;
    audioCodec?: string;
    hdr: boolean;
  };
};
export type SystemStatus = {
  codex: { installed: boolean; authenticated: boolean; path: string | null };
  ffmpeg: {
    installed: boolean;
    path: string | null;
    capabilities?: {
      videoToolboxDecode: boolean;
      h264VideoToolbox: boolean;
      hevcVideoToolbox: boolean;
    };
  };
  ffprobe: { installed: boolean; path: string | null };
  elevenLabs: { configured: boolean };
  projectsDir: string;
  overrides?: { codexBin: string; ffmpegBin: string; ffprobeBin: string; projectsDir: string };
};
export type ExportStatus = {
  state: 'idle' | 'running' | 'completed' | 'failed';
  progress: number;
  outTime: string;
  speed: string;
  frame: number;
  outputPath?: string;
  encoder?: string;
  error?: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  status: () => request<SystemStatus>('/api/system/status'),
  settings: () => request<SystemStatus>('/api/settings'),
  saveSettings: (body: Record<string, string>) => request<SystemStatus>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  selectProject: () => request<Project>('/api/projects/select', { method: 'POST' }),
  prepare: (id: string) => request<{ proxyUrl: string; proxy: { width: number; height: number; fps: number; hardware: boolean } }>(`/api/projects/${id}/prepare`, { method: 'POST' }),
  transcribe: (id: string) => request<{ transcript: { words: Word[] }; edl: Edl }>(`/api/projects/${id}/transcribe`, { method: 'POST' }),
  clean: (id: string, intensity: string) => request<Edl>(`/api/projects/${id}/clean`, { method: 'POST', body: JSON.stringify({ intensity }) }),
  setEdl: (id: string, keepRanges: KeepRange[]) => request<Edl>(`/api/projects/${id}/edl`, { method: 'PUT', body: JSON.stringify({ keepRanges }) }),
  exportVideo: (id: string, mode: 'fast' | 'quality') => request<{ started: boolean; outputPath: string; encoder: string; hardware: boolean; targetBitRate: number }>(`/api/projects/${id}/export`, { method: 'POST', body: JSON.stringify({ mode }) }),
  exportStatus: (id: string) => request<ExportStatus>(`/api/projects/${id}/export-status`),
};
