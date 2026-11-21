export interface StartedRendererServer {
  server: { close(): Promise<void> };
  port: number;
  url: string;
}

export function startRendererServer(rootDir: string, preferredPort?: number): Promise<StartedRendererServer>;
