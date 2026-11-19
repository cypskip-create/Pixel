export interface VoiceRuntimeSmokeResult {
  protocol: number;
  onnxProviders: string[];
  onnxCpuProvider: boolean;
  fasterWhisper: boolean;
  kokoro: boolean;
  espeakReady: boolean;
}

export interface VoiceWorkerCapabilities {
  protocol: number;
  python: string;
  formats: string[];
  optional: Record<string, boolean>;
}

export function buildRequestFrames(): Buffer;
export function validateResponses(lines: string[]): {
  runtime: VoiceRuntimeSmokeResult;
  capabilities: VoiceWorkerCapabilities;
};
export function runWorkerProtocolSmoke(executable: string, workerArgs?: string[], timeoutMs?: number): Promise<{
  runtime: VoiceRuntimeSmokeResult;
  capabilities: VoiceWorkerCapabilities;
  frameBytes: number;
  frameHex: string;
}>;
