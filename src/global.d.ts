export {};

type KeepRange = { startWordId: string; endWordId: string; reason?: string };

declare global {
  interface Window {
    videoCleaner: {
      pickProject(): Promise<any>;
      prepareProject(id: string): Promise<{ proxyUrl: string }>;
      transcribe(id: string, apiKey: string): Promise<any>;
      clean(id: string, intensity: 'light' | 'balanced' | 'aggressive'): Promise<any>;
      setEdl(id: string, keepRanges: KeepRange[]): Promise<any>;
      exportVideo(id: string, mode: 'fast' | 'quality'): Promise<string | null>;
    };
  }
}
