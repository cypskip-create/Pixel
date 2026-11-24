/**
 * Typed local bridge to Pixel's Python Agent Runtime (`python/agent_service.py`, protocol: pixel-agent-v2).
 *
 * Security & lifecycle invariants:
 *  - Communicates over NDJSON stdio (stdout strictly protocol frames; stderr diagnostics only).
 *  - Every `tool.request` from Python is routed to Electron main's PermissionBroker — Python
 *    never executes privileged Windows, file, Git, browser, or UIA actions directly.
 *  - Tracks backend ownership (`pid`, `startMarker`, `instanceId`, `parentPid`) with corrupt-file
 *    quarantine (`.corrupt`) and safe orphan reaping so unrelated Python/Hermes processes are never touched.
 *  - Caps stdout buffer size (4 MiB) to prevent unbounded memory growth on malformed frames.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PIXEL_AGENT_PROTOCOL_VERSION = 'pixel-agent-v2';
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface PythonAgentOwnershipEntry {
  instanceId: string;
  pid: number;
  startMarker: string;
  parentPid: number;
  parentStartMarker: string;
}

export interface PythonAgentPingResult {
  protocol: string;
  supportedProtocols?: string[];
  pid: number;
  python: string;
  timestampMs: number;
  authority: string;
}

export interface PythonAgentPlanResult {
  protocol: string;
  mode: string;
  suggestedTools: string[];
  requiresMainProcessAuthorization: true;
}

export interface PythonAgentMemoryScoreResult {
  keep: boolean;
  score: number;
  reason: string;
}

export interface PythonToolRequest {
  requestId: string;
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface PythonToolResponse {
  ok: boolean;
  content: string;
  denied?: boolean;
  image?: {
    mediaType: string;
    dataBase64: string;
    label?: string;
  };
}

export interface PythonTurnStartOptions {
  requestId: string;
  messages: Array<Record<string, unknown>>;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  provider: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string | null;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    thinking?: Record<string, unknown>;
    fallbacks?: Array<{
      provider: string;
      model: string;
      baseUrl?: string;
      apiKey?: string | null;
    }>;
  };
  budgets?: {
    maxIterations?: number;
    maxToolCalls?: number;
    maxWallMs?: number;
    maxContextTokens?: number;
    toolTimeoutMs?: number;
  };
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onStep?: (step: { id: string; title: string; status: string; toolName?: string }) => void;
  onToolRequest: (request: PythonToolRequest) => Promise<PythonToolResponse>;
}

export interface PythonTurnCompleteResult {
  ok: boolean;
  content: string;
  reasoning: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  steps: Array<{ id?: string; tool: string; status: string; detail?: string }>;
  compression?: { prunedTools: number; compressedMiddle: number; usedAuxSummary: boolean };
  error?: { code: string; message: string; retryable: boolean; detail?: string };
  crashed?: boolean;
}

interface PendingRpcCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveTurnState {
  options: PythonTurnStartOptions;
  resolve: (result: PythonTurnCompleteResult) => void;
  cancelled: boolean;
}

export function parseOwnershipFile(raw: string): { ok: true; entry: PythonAgentOwnershipEntry } | { ok: false } {
  try {
    const parsed = JSON.parse(raw) as Partial<PythonAgentOwnershipEntry>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.instanceId === 'string' &&
      parsed.instanceId.length > 0 &&
      Number.isInteger(parsed.pid) &&
      Number(parsed.pid) > 0 &&
      typeof parsed.startMarker === 'string' &&
      Number.isInteger(parsed.parentPid)
    ) {
      return { ok: true, entry: parsed as PythonAgentOwnershipEntry };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export class PythonAgentBridge {
  private readonly pythonExecutable: string;
  private readonly scriptPath: string;
  private readonly timeoutMs: number;
  private readonly ownershipPath: string | null;
  private readonly crashLogPath: string | null;
  private readonly pluginDataDir: string | null;
  private readonly gatewayDataDir: string | null;
  private readonly workspaceDataDir: string | null;
  private readonly parentStartMarker = `${process.pid}:${Date.now()}`;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private currentOwnership: PythonAgentOwnershipEntry | null = null;
  private buffer = '';
  private readonly pendingRpc = new Map<string, PendingRpcCall>();
  private readonly activeTurns = new Map<string, ActiveTurnState>();
  private lastStderrLines: string[] = [];

  constructor(options: {
    pythonExecutable?: string;
    scriptPath?: string;
    timeoutMs?: number;
    ownershipPath?: string;
    crashLogPath?: string;
    pluginDataDir?: string;
    gatewayDataDir?: string;
    workspaceDataDir?: string;
  } = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.PIXEL_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    this.scriptPath = options.scriptPath ?? join(process.cwd(), 'python', 'agent_service.py');
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.ownershipPath = options.ownershipPath ?? null;
    this.crashLogPath = options.crashLogPath ?? null;
    this.pluginDataDir = options.pluginDataDir ?? null;
    this.gatewayDataDir = options.gatewayDataDir ?? null;
    this.workspaceDataDir = options.workspaceDataDir ?? null;
  }

  getHealth(): { running: boolean; pid: number | null; instanceId: string | null; recentStderr: string[] } {
    const running = Boolean(this.proc && !this.proc.killed && this.proc.exitCode === null);
    return {
      running,
      pid: running && this.proc?.pid ? this.proc.pid : null,
      instanceId: this.currentOwnership?.instanceId ?? null,
      recentStderr: [...this.lastStderrLines],
    };
  }

  /** Inspect and quarantine any corrupt ownership record; never kills unrelated processes. */
  inspectAndCleanOwnership(): { status: 'none' | 'valid' | 'quarantined'; entry?: PythonAgentOwnershipEntry } {
    if (!this.ownershipPath || !existsSync(this.ownershipPath)) return { status: 'none' };
    try {
      const raw = readFileSync(this.ownershipPath, 'utf8');
      const parsed = parseOwnershipFile(raw);
      if (!parsed.ok) {
        const quarantinePath = `${this.ownershipPath}.corrupt`;
        try {
          renameSync(this.ownershipPath, quarantinePath);
        } catch {
          // Best-effort quarantine
        }
        return { status: 'quarantined' };
      }
      return { status: 'valid', entry: parsed.entry };
    } catch {
      return { status: 'none' };
    }
  }

  private writeOwnership(entry: PythonAgentOwnershipEntry): void {
    this.currentOwnership = entry;
    if (!this.ownershipPath) return;
    try {
      mkdirSync(dirname(this.ownershipPath), { recursive: true });
      writeFileSync(this.ownershipPath, JSON.stringify(entry, null, 2), 'utf8');
    } catch {
      // Non-fatal; runtime continues.
    }
  }

  private clearOwnership(): void {
    this.currentOwnership = null;
    if (!this.ownershipPath || !existsSync(this.ownershipPath)) return;
    try {
      unlinkSync(this.ownershipPath);
    } catch {
      // Ignore cleanup race
    }
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    if (!existsSync(this.scriptPath)) {
      throw new Error(`Python agent service script not found at ${this.scriptPath}`);
    }
    this.inspectAndCleanOwnership();

    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1' };
    if (this.crashLogPath) env.PIXEL_AGENT_CRASH_LOG = this.crashLogPath;
    if (this.pluginDataDir) env.PIXEL_PLUGIN_DATA_DIR = this.pluginDataDir;
    if (this.gatewayDataDir) env.PIXEL_GATEWAY_DATA_DIR = this.gatewayDataDir;
    if (this.workspaceDataDir) env.PIXEL_WORKSPACE_DATA_DIR = this.workspaceDataDir;

    const child = spawn(this.pythonExecutable, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });

    if (child.pid) {
      this.writeOwnership({
        instanceId: randomUUID(),
        pid: child.pid,
        startMarker: `${child.pid}:${Date.now()}`,
        parentPid: process.pid,
        parentStartMarker: this.parentStartMarker,
      });
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.buffer.length + chunk.length > MAX_BUFFER_BYTES) {
        this.buffer = '';
        return;
      }
      this.buffer += chunk;
      let idx = this.buffer.indexOf('\n');
      while (idx !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.handleLine(line);
        idx = this.buffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        this.lastStderrLines = [...this.lastStderrLines, ...lines].slice(-12);
      }
    });

    const failPendingAndActive = (reason: string, code: string) => {
      this.proc = null;
      this.clearOwnership();
      for (const [id, entry] of this.pendingRpc) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
        this.pendingRpc.delete(id);
      }
      for (const [reqId, turn] of this.activeTurns) {
        this.activeTurns.delete(reqId);
        turn.resolve({
          ok: false,
          content: '',
          reasoning: '',
          finishReason: 'crashed',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          steps: [],
          crashed: true,
          error: { code, message: reason, retryable: false },
        });
      }
    };

    child.on('error', (err) => {
      failPendingAndActive(`Failed to spawn Python agent process: ${err.message}`, 'SPAWN_ERROR');
    });

    child.on('exit', (code, signal) => {
      failPendingAndActive(
        `Python agent process exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
        'PROCESS_CRASH',
      );
    });

    this.proc = child;
    return child;
  }

  private handleLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';

    // 1. Streaming pixel-agent-v2 turn events
    if (requestId && this.activeTurns.has(requestId)) {
      const turn = this.activeTurns.get(requestId)!;
      if (type === 'turn.delta' && typeof parsed.delta === 'string') {
        if (!turn.cancelled) turn.options.onDelta?.(parsed.delta);
        return;
      }
      if (type === 'turn.reasoning' && typeof parsed.delta === 'string') {
        if (!turn.cancelled) turn.options.onReasoning?.(parsed.delta);
        return;
      }
      if (type === 'task.step' && parsed.step && typeof parsed.step === 'object') {
        if (!turn.cancelled) {
          turn.options.onStep?.(parsed.step as { id: string; title: string; status: string; toolName?: string });
        }
        return;
      }
      if (type === 'tool.request') {
        const callId = typeof parsed.callId === 'string' ? parsed.callId : '';
        const name = typeof parsed.name === 'string' ? parsed.name : '';
        const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
          ? parsed.args as Record<string, unknown>
          : {};
        if (turn.cancelled) {
          this.sendFrame({ type: 'tool.response', requestId, callId, ok: false, content: 'Turn was cancelled.' });
          return;
        }
        void turn.options.onToolRequest({ requestId, callId, name, args })
          .then((resp) => {
            if (!turn.cancelled) {
              this.sendFrame({
                type: 'tool.response',
                requestId,
                callId,
                ok: resp.ok,
                content: resp.content,
                denied: resp.denied === true,
                ...(resp.image ? { image: resp.image } : {}),
              });
            }
          })
          .catch((err) => {
            this.sendFrame({
              type: 'tool.response',
              requestId,
              callId,
              ok: false,
              content: err instanceof Error ? err.message : 'Tool execution failed in Electron.',
            });
          });
        return;
      }
      if (type === 'turn.error') {
        this.activeTurns.delete(requestId);
        const err = (parsed.error && typeof parsed.error === 'object'
          ? parsed.error
          : { code: 'UNKNOWN', message: 'Python agent turn failed.', retryable: false }) as {
            code: string; message: string; retryable: boolean; detail?: string;
          };
        turn.resolve({
          ok: false,
          content: '',
          reasoning: '',
          finishReason: 'error',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          steps: [],
          error: err,
        });
        return;
      }
      if (type === 'turn.complete') {
        this.activeTurns.delete(requestId);
        const usage = (parsed.usage && typeof parsed.usage === 'object'
          ? parsed.usage
          : { promptTokens: 0, completionTokens: 0, totalTokens: 0 }) as {
            promptTokens: number; completionTokens: number; totalTokens: number;
          };
        turn.resolve({
          ok: parsed.finishReason !== 'cancelled',
          content: typeof parsed.content === 'string' ? parsed.content : '',
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
          finishReason: typeof parsed.finishReason === 'string' ? parsed.finishReason : 'stop',
          usage,
          steps: Array.isArray(parsed.steps)
            ? parsed.steps as Array<{ id?: string; tool: string; status: string; detail?: string }>
            : [],
          compression: parsed.compression && typeof parsed.compression === 'object'
            ? parsed.compression as { prunedTools: number; compressedMiddle: number; usedAuxSummary: boolean }
            : undefined,
        });
        return;
      }
    }

    // 2. Request-response RPC frames (ping, plan_turn, score_memory, cancel, shutdown)
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    if (!id) return;
    const entry = this.pendingRpc.get(id);
    if (!entry) return;
    this.pendingRpc.delete(id);
    clearTimeout(entry.timer);
    if (parsed.ok) entry.resolve(parsed.result);
    else entry.reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'Python agent service error.'));
  }

  private sendFrame(frame: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed || this.proc.exitCode !== null) return;
    this.proc.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const child = this.ensureStarted();
    const id = randomUUID();
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        rejectPromise(new Error(`Python agent service timed out on "${method}".`));
      }, this.timeoutMs);
      this.pendingRpc.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject: rejectPromise,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  ping(): Promise<PythonAgentPingResult> {
    return this.request<PythonAgentPingResult>('ping');
  }

  planTurn(input: { prompt: string; mode: string; allowedTools: string[] }): Promise<PythonAgentPlanResult> {
    return this.request<PythonAgentPlanResult>('plan_turn', input);
  }

  scoreMemory(input: { text: string; existing?: string[] }): Promise<PythonAgentMemoryScoreResult> {
    return this.request<PythonAgentMemoryScoreResult>('score_memory', input);
  }

  voiceTranscribe(input: {
    provider: string;
    wavBase64: string;
    apiKey?: string;
    model?: string;
    language?: string;
    baseUrl?: string;
    localOnly?: boolean;
    timeoutSec?: number;
  }): Promise<{ ok: boolean; provider: string; model?: string; text: string; language?: string; noSpeech?: boolean; error?: string }> {
    return this.request('voice.transcribe', input);
  }

  voiceSynthesize(input: {
    provider: string;
    text: string;
    apiKey?: string;
    voice?: string;
    model?: string;
    speed?: number;
    baseUrl?: string;
    localOnly?: boolean;
    timeoutSec?: number;
  }): Promise<{ ok: boolean; provider: string; mediaType?: string; audioBase64?: string; bytes?: number; error?: string }> {
    return this.request('voice.synthesize', input);
  }

  voiceGptLiveSdp(input: {
    sdpOffer: string;
    apiKey: string;
    model?: string;
    voice?: string;
    instructions?: string;
    baseUrl?: string;
    localOnly?: boolean;
  }): Promise<{ ok: boolean; sdpAnswer?: string; model?: string; voice?: string; instructions?: string; error?: string }> {
    return this.request('voice.gpt_live_sdp', input);
  }

  annotateSomPng(input: {
    pngBase64: string;
    elements: Array<{ index: number; bounds?: { x: number; y: number; width: number; height: number } }>;
    windowBounds?: { x: number; y: number; width: number; height: number };
  }): Promise<{ ok: boolean; annotatedBase64?: string; width?: number; height?: number; annotatedCount?: number; error?: string }> {
    return this.request('multimodal.annotate_som', input);
  }

  generateImage(input: {
    prompt: string;
    provider?: string;
    apiKey?: string;
    outputDir?: string;
    model?: string;
    size?: string;
    baseUrl?: string;
  }): Promise<{ ok: boolean; path?: string; provider?: string; model?: string; mediaType?: string; bytes?: number; dataBase64?: string; error?: string }> {
    return this.request('multimodal.generate_image', input);
  }

  diagnostics(): Promise<{
    runtime: string;
    protocol: string;
    pid: number;
    python: string;
    activeTurnIds: string[];
    capabilities: Record<string, boolean>;
  }> {
    return this.request('runtime.diagnostics');
  }

  pluginList(): Promise<Array<Record<string, unknown>>> {
    return this.request('plugins.list');
  }

  pluginDiscover(searchDir: string): Promise<{ ok: boolean; plugins: Array<Record<string, unknown>>; error?: string }> {
    return this.request('plugins.discover', { searchDir });
  }

  pluginInstall(input: { sourceDir: string; provenance?: string; enable?: boolean }): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }> {
    return this.request('plugins.install', input);
  }

  pluginEnable(pluginId: string): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }> {
    return this.request('plugins.enable', { pluginId });
  }

  pluginDisable(pluginId: string): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }> {
    return this.request('plugins.disable', { pluginId });
  }

  pluginUpdate(pluginId: string, newSourceDir: string): Promise<{ ok: boolean; rolledBack?: boolean; plugin?: Record<string, unknown>; error?: string }> {
    return this.request('plugins.update', { pluginId, newSourceDir });
  }

  pluginUninstall(pluginId: string): Promise<{ ok: boolean; uninstalled?: string; error?: string }> {
    return this.request('plugins.uninstall', { pluginId });
  }

  pluginConfigure(pluginId: string, settings: Record<string, unknown>): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }> {
    return this.request('plugins.configure', { pluginId, settings });
  }

  pluginListTools(): Promise<Array<{
    pluginId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    risk: 'low' | 'medium' | 'high';
    requiresApproval: boolean;
    changesState: boolean;
  }>> {
    return this.request('plugins.tools');
  }

  pluginInvokeTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; content: string; detail?: Record<string, unknown> }> {
    return this.request('plugins.invoke_tool', { name, args });
  }

  pluginDispatchHook(event: string, payload: Record<string, unknown>): Promise<{ ok: boolean; event: string; dispatched: number; results: Array<Record<string, unknown>> }> {
    return this.request('plugins.dispatch_hook', { event, payload });
  }

  pluginEmergencyStop(): Promise<{ stopped: number }> {
    return this.request('plugins.emergency_stop');
  }

  toolsetsList(activeTools: string[] = []): Promise<Array<{
    id: string;
    name: string;
    category: string;
    description: string;
    enabled: boolean;
    toolCount: number;
    tools: string[];
  }>> {
    return this.request('toolsets.list', { activeTools });
  }

  toolsetsSetEnabled(toolsetId: string, enabled: boolean): Promise<{ ok: boolean; toolsets?: Array<Record<string, unknown>>; error?: string }> {
    return this.request('toolsets.set_enabled', { toolsetId, enabled });
  }

  skillsHubList(): Promise<Array<Record<string, unknown>>> {
    return this.request('skills.hub_list');
  }

  skillsHubInstall(input: { skillId: string; markdown?: string; name?: string; description?: string }): Promise<{ ok: boolean; skill?: Record<string, unknown>; error?: string }> {
    return this.request('skills.hub_install', input);
  }

  skillsHubRemove(skillId: string): Promise<{ ok: boolean; removed?: string; error?: string }> {
    return this.request('skills.hub_remove', { skillId });
  }

  gatewayStatus(): Promise<Record<string, unknown>> {
    return this.request('gateway.status');
  }

  gatewayStart(input: { host?: string; port?: number } = {}): Promise<{ ok: boolean; running: boolean; http?: { ok: boolean; host: string; port: number } }> {
    return this.request('gateway.start', input);
  }

  gatewayStop(): Promise<{ ok: boolean; running: boolean }> {
    return this.request('gateway.stop');
  }

  gatewayEmergencyStop(): Promise<{ ok: boolean; emergencyStopped: boolean }> {
    return this.request('gateway.emergency_stop');
  }

  gatewayPlatformConfigure(platform: string, config: Record<string, unknown>, connect = false): Promise<Record<string, unknown>> {
    return this.request('gateway.platform_configure', { platform, config, connect });
  }

  gatewayPlatformDisconnect(platform: string): Promise<Record<string, unknown>> {
    return this.request('gateway.platform_disconnect', { platform });
  }

  gatewayInbound(platform: string, payload: Record<string, unknown>, availableTools: string[] = []): Promise<Record<string, unknown>> {
    return this.request('gateway.inbound', { platform, payload, availableTools });
  }

  gatewayPairingApprove(input: { code: string; projectId?: string; scopes?: string[]; allowGroups?: boolean }): Promise<Record<string, unknown>> {
    return this.request('gateway.pairing_approve', input);
  }

  gatewayPairingReject(code: string): Promise<Record<string, unknown>> {
    return this.request('gateway.pairing_reject', { code });
  }

  gatewayUserRevoke(platform: string, accountId: string): Promise<Record<string, unknown>> {
    return this.request('gateway.user_revoke', { platform, accountId });
  }

  gatewayDevicePair(input: { deviceName: string; projectId?: string; scopes?: string[] }): Promise<{ ok: boolean; device?: Record<string, unknown>; token?: string }> {
    return this.request('gateway.device_pair', input);
  }

  gatewayDeviceRevoke(deviceId: string): Promise<Record<string, unknown>> {
    return this.request('gateway.device_revoke', { deviceId });
  }

  gatewayWebhookCreate(input: { name: string; projectId?: string; eventFilters?: string[]; rateLimitPerMin?: number }): Promise<{ ok: boolean; route?: Record<string, unknown>; signingSecret?: string }> {
    return this.request('gateway.webhook_create', input);
  }

  gatewayWebhookSetEnabled(routeId: string, enabled: boolean): Promise<Record<string, unknown>> {
    return this.request('gateway.webhook_set_enabled', { routeId, enabled });
  }

  gatewayWebhookDelete(routeId: string): Promise<Record<string, unknown>> {
    return this.request('gateway.webhook_delete', { routeId });
  }

  gatewayWebhookHistory(limit = 50): Promise<Array<Record<string, unknown>>> {
    return this.request('gateway.webhook_history', { limit });
  }

  gatewayConfigureAgent(input: { provider?: Record<string, unknown>; tools?: Array<Record<string, unknown>> }): Promise<{ configured: boolean; toolCount: number }> {
    return this.request('gateway.configure_agent', input);
  }

  gatewayStartPolling(intervalSec = 1.0): Promise<{ ok: boolean; polling?: boolean; error?: string }> {
    return this.request('gateway.start_polling', { intervalSec });
  }

  profilesList(): Promise<{ ok: boolean; activeProfileId: string; profiles: Array<Record<string, unknown>> }> {
    return this.request('profiles.list');
  }

  profilesCreate(input: { name: string; description?: string; instructions?: string; providerOverride?: string; modelOverride?: string }): Promise<Record<string, unknown>> {
    return this.request('profiles.create', input);
  }

  profilesSwitch(profileId: string): Promise<Record<string, unknown>> {
    return this.request('profiles.switch', { profileId });
  }

  profilesUpdate(profileId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('profiles.update', { profileId, patch });
  }

  profilesDelete(profileId: string): Promise<Record<string, unknown>> {
    return this.request('profiles.delete', { profileId });
  }

  artifactsList(input: { profileId?: string; projectId?: string; kind?: string; query?: string } = {}): Promise<Array<Record<string, unknown>>> {
    return this.request('artifacts.list', input);
  }

  artifactsRegister(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('artifacts.register', input);
  }

  artifactsDelete(artifactId: string): Promise<Record<string, unknown>> {
    return this.request('artifacts.delete', { artifactId });
  }

  starmapBuild(input: { memories: Array<Record<string, unknown>>; skills: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>>; profileId?: string; projectId?: string }): Promise<Record<string, unknown>> {
    return this.request('starmap.build', input);
  }

  sessionImportPreview(rawText: string, format = 'json'): Promise<Record<string, unknown>> {
    return this.request('session_import.preview', { rawText, format });
  }

  sessionImportCommit(rawText: string, format = 'json'): Promise<Record<string, unknown>> {
    return this.request('session_import.commit', { rawText, format });
  }

  sessionImportConfirm(digest: string): Promise<Record<string, unknown>> {
    return this.request('session_import.confirm', { digest });
  }

  drawingAdd(payload: Record<string, unknown>): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.add', payload);
  }

  drawingRemove(id: string): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.remove', { id });
  }

  drawingUndo(): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.undo', {});
  }

  drawingRedo(): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.redo', {});
  }

  drawingClear(): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.clear', {});
  }

  drawingEmergencyStop(): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.emergency_stop', {});
  }

  drawingSetInteractive(interactive: boolean): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.set_interactive', { interactive });
  }

  drawingSnapshot(): Promise<import('../../shared/types').ScreenDrawingSceneSnapshot> {
    return this.request('drawing.snapshot', {});
  }

  drawingMapCoord(input: Record<string, unknown>): Promise<{
    x: number;
    y: number;
    computerUseResolution: { width: number; height: number };
  }> {
    return this.request('drawing.map_coord', input);
  }

  runTurn(options: PythonTurnStartOptions): Promise<PythonTurnCompleteResult> {
    const child = this.ensureStarted();
    return new Promise<PythonTurnCompleteResult>((resolve) => {
      this.activeTurns.set(options.requestId, { options, resolve, cancelled: false });
      child.stdin.write(`${JSON.stringify({
        type: 'turn.start',
        protocol: PIXEL_AGENT_PROTOCOL_VERSION,
        requestId: options.requestId,
        params: {
          messages: options.messages,
          tools: options.tools,
          provider: options.provider,
          budgets: options.budgets ?? {},
        },
      })}\n`);
    });
  }

  cancelTurn(requestId: string): void {
    const turn = this.activeTurns.get(requestId);
    if (turn) turn.cancelled = true;
    this.sendFrame({ type: 'turn.cancel', requestId });
  }

  /** Test/emergency helper: forcefully terminates the running Python child process. */
  killProcess(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
  }

  async dispose(): Promise<void> {
    if (!this.proc) {
      this.clearOwnership();
      return;
    }
    try {
      await this.request('shutdown');
    } catch {
      // Fall through to hard kill if already exiting.
    } finally {
      this.proc?.kill();
      this.proc = null;
      this.clearOwnership();
    }
  }
}
