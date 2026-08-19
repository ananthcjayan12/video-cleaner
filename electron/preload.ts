import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('videoCleaner', {
  pickProject: () => ipcRenderer.invoke('project:pick'),
  prepareProject: (id: string) => ipcRenderer.invoke('project:prepare', id),
  transcribe: (id: string, apiKey: string) => ipcRenderer.invoke('project:transcribe', id, apiKey),
  clean: (id: string, intensity: 'light' | 'balanced' | 'aggressive') => ipcRenderer.invoke('project:clean', id, intensity),
  setEdl: (id: string, keepRanges: Array<{ startWordId: string; endWordId: string; reason?: string }>) => ipcRenderer.invoke('project:set-edl', id, keepRanges),
  exportVideo: (id: string, mode: 'fast' | 'quality') => ipcRenderer.invoke('project:export', id, mode),
});
