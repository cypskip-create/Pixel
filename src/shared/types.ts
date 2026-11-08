/**
 * Pixel shared contracts.
 *
 * This module is imported by BOTH the Electron main process and the renderer.
 * It must therefore contain only types, constants, and pure functions — no
 * Electron, no Node, no DOM APIs.
 *
 * Keeping the contracts here is what makes the desktop shell replaceable:
 * the same shapes would cross a Tauri IPC boundary or an HTTP/WebSocket
 * boundary unchanged.
 */

/* ------------------------------------------------------------------ *
 * Operating modes
 * ------------------------------------------------------------------ */

/** The three operating modes. Hybrid is the product default. */
export const MODES = ['guide', 'hybrid', 'agent'] as const;
export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = 'hybrid';

export interface ModeDescriptor {
  id: Mode;
  label: string;
  /** One-line explanation shown in the mode picker. */
  summary: string;
  /**
   * Whether state-changing computer control tools may run at all in this mode.
   * Changing mode must never silently grant permissions — see PermissionPolicy.
   */
  allowsStateChange: boolean;
}

export const MODE_DESCRIPTORS: readonly ModeDescriptor[] = [
  {
    id: 'guide',
    label: 'Guide',
    summary: 'Explains, teaches and annotates. Never changes anything.',
    allowsStateChange: false,
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    summary: 'Guides and may act, but asks before anything sensitive.',
    allowsStateChange: true,
  },
  {
    id: 'agent',
    label: 'Agent',
    summary: 'Acts directly on approved apps. Sensitive steps still confirmed.',
    allowsStateChange: true,
  },
] as const;

export function getModeDescriptor(mode: Mode): ModeDescriptor {
  const found = MODE_DESCRIPTORS.find((m) => m.id === mode);
  if (!found) throw new Error(`Unknown mode: ${String(mode)}`);
  return found;
}

/* ------------------------------------------------------------------ *
 * Avatar / assistant visual states
 * ------------------------------------------------------------------ */

export const ASSISTANT_STATES = [
  'idle',
  'listening',
  'thinking',
  'responding',
  'speaking',
  'pointing',
  'executing',
  'waiting_for_approval',
  'success',
  'error',
  'stopped',
  // Legacy visual states retained for persisted settings and existing callers.
  'working',
  'paused',
] as const;
export type AssistantState = (typeof ASSISTANT_STATES)[number];

/** UI surface states from the product spec (sections 6). */
export const SURFACES = ['hidden', 'idle', 'active', 'bubble', 'task'] as const;
export type Surface = (typeof SURFACES)[number];

/* ------------------------------------------------------------------ *
 * Providers and models
 * ------------------------------------------------------------------ */

export const PROVIDER_IDS = ['deepseek'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * Exactly two DeepSeek models exist. Do not add speculative names.
 * Verified against the official docs — see docs/DEEPSEEK-API.md.
 */
export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];

/** Retired names still accepted by the API; normalized to current names. */
const LEGACY_MODEL_ALIASES: Record<string, DeepSeekModel> = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
};

export function normalizeModelName(name: string): string {
  return LEGACY_MODEL_ALIASES[name] ?? name;
}

export interface ModelCapabilities {
  id: string;
  label: string;
  /** Accepts image content blocks. Verified: ONLY deepseek-flash. */
  vision: boolean;
  toolCalls: boolean;
  /** Supports thinking / reasoning mode. */
  thinking: boolean;
  contextTokens: number;
  maxOutputTokens: number;
  /** Intended role in Pixel. */
  role: 'fast' | 'reasoning';
}

export const MODEL_CAPABILITIES: readonly ModelCapabilities[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    vision: true,
    toolCalls: true,
    thinking: true,
    contextTokens: 1_000_000,
    maxOutputTokens: 393_216,
    role: 'fast',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    vision: false,
    toolCalls: true,
    thinking: true,
    contextTokens: 1_000_000,
    maxOutputTokens: 393_216,
    role: 'reasoning',
  },
] as const;

export function getModelCapabilities(modelId: string): ModelCapabilities | undefined {
  const normalized = normalizeModelName(modelId);
  return MODEL_CAPABILITIES.find((m) => m.id === normalized);
}

/**
 * Guard used before sending any image. Returns false for unknown models —
 * failing closed is correct: we never guess that a model accepts images.
 */
export function modelSupportsVision(modelId: string): boolean {
  return getModelCapabilities(modelId)?.vision === true;
}

/** Model Pixel switches to automatically when an image must be sent. */
export const VISION_MODEL: DeepSeekModel = 'deepseek-flash';

/* ------------------------------------------------------------------ *
 * Thinking mode
 * ------------------------------------------------------------------ */

export type ReasoningEffort = 'none' | 'low' | 'high' | 'max';

export interface ThinkingConfig {
  enabled: boolean;
  effort: ReasoningEffort;
}

export const DEFAULT_THINKING: ThinkingConfig = { enabled: true, effort: 'high' };

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export interface ProviderSettings {
  provider: ProviderId;
  /** Fast model: short answers, vision, tool loops. */
  primaryModel: string;
  /** Deeper reasoning model for demanding text-only requests. */
  reasoningModel: string;
  thinking: ThinkingConfig;
  temperature: number;
  maxTokens: number;
  /** Wall-clock timeout for a single request, in milliseconds. */
  requestTimeoutMs: number;
}

export interface CompanionSettings {
  mode: Mode;
  /** Remembered position of the floating avatar, in screen coordinates. */
  position: { x: number; y: number } | null;
  /** Monitor id the avatar was last on. */
  monitorId: string | null;
  /** Collapse to avatar-only automatically after a response. */
  autoCollapse: boolean;
  /** Snap to screen edges while dragging. */
  edgeSnap: boolean;
  /** Speak responses aloud by default. */
  speakReplies: boolean;
  /** Respect prefers-reduced-motion; also honored when the OS requests it. */
  reducedMotion: boolean;
  /** Compact bar for smaller displays. */
  compact: boolean;
  /**
   * How the companion is presented. This is independent of `mode` (Guide, Agent,
   * Hybrid), which controls what Pixel may do.
   *  - stationary: the orb rests near the top of the screen (default).
   *  - cursor: a small companion follows the mouse pointer.
   */
  visualMode: VisualMode;
  /** Cursor-companion follow speed multiplier, 0.25 to 3. */
  followSpeed: number;
  /** Offset of the cursor companion from the pointer, in logical pixels. */
  cursorOffset: { x: number; y: number };
  /** Animation budget. 'off' also stops the idle breathing animation. */
  animations: AnimationLevel;
  /**
   * Transient mode: the companion is hidden until the summon hotkey is pressed,
   * then fades out after the interaction. Off by default until validated.
   */
  transientMode: boolean;
  /** Quiet time, in milliseconds, before a transient companion fades out. */
  transientIdleMs: number;
}

export const VISUAL_MODES = ['stationary', 'cursor'] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const ANIMATION_LEVELS = ['full', 'reduced', 'off'] as const;
export type AnimationLevel = (typeof ANIMATION_LEVELS)[number];

export interface VoiceSettings {
  /** Push-to-talk keybinding (Electron accelerator syntax). */
  pushToTalkAccelerator: string;
  /** Selected microphone device id, or null for system default. */
  inputDeviceId: string | null;
  /** Local speech-to-text model size for faster-whisper. */
  sttModel: string;
  /** Speak replies using local TTS. */
  ttsEnabled: boolean;
  ttsVoice: string | null;
  ttsRate: number;
}

export interface PrivacySettings {
  /**
   * Screenshots are only ever captured and transmitted after explicit user
   * authorization. There is no silent-capture mode and none may be added.
   */
  screenshotRequiresApproval: true;
  /** Retain conversation history locally. */
  persistHistory: boolean;
  /** Number of days to keep history; 0 = forever. */
  historyRetentionDays: number;
}

export interface AppSettings {
  version: number;
  provider: ProviderSettings;
  companion: CompanionSettings;
  voice: VoiceSettings;
  privacy: PrivacySettings;
  /** Global shortcut to summon/hide the assistant. */
  globalAccelerator: string;
  /** Global shortcut for emergency stop. */
  emergencyStopAccelerator: string;
  launchOnStartup: boolean;
  theme: 'system' | 'dark' | 'light';
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  provider: {
    provider: 'deepseek',
    primaryModel: 'deepseek-flash',
    reasoningModel: 'deepseek-v4-pro',
    thinking: { ...DEFAULT_THINKING },
    temperature: 1,
    maxTokens: 8192,
    requestTimeoutMs: 60_000,
  },
  companion: {
    mode: DEFAULT_MODE,
    position: null,
    monitorId: null,
    autoCollapse: false,
    edgeSnap: true,
    speakReplies: false,
    reducedMotion: false,
    compact: false,
    visualMode: 'stationary',
    followSpeed: 1,
    cursorOffset: { x: 22, y: 20 },
    animations: 'full',
    transientMode: false,
    transientIdleMs: 2500,
  },
  voice: {
    pushToTalkAccelerator: 'CommandOrControl+Shift+Space',
    inputDeviceId: null,
    sttModel: 'base',
    ttsEnabled: false,
    ttsVoice: null,
    ttsRate: 1,
  },
  privacy: {
    screenshotRequiresApproval: true,
    persistHistory: true,
    historyRetentionDays: 0,
  },
  globalAccelerator: 'CommandOrControl+Shift+C',
  emergencyStopAccelerator: 'CommandOrControl+Shift+Escape',
  launchOnStartup: false,
  theme: 'system',
};

/** Shallow-merge stored settings over defaults so new fields appear safely. */
export function mergeSettings(partial: unknown): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!partial || typeof partial !== 'object') return base;
  const p = partial as Record<string, unknown>;

  for (const key of Object.keys(base) as (keyof AppSettings)[]) {
    const incoming = p[key];
    if (incoming === undefined || incoming === null) continue;

    const current = base[key];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      if (typeof incoming === 'object' && !Array.isArray(incoming)) {
        Object.assign(current as object, incoming as object);
      }
    } else {
      // `base[key]` is a union of primitives here; the assertion narrows it
      // through `unknown` because the keys are not uniformly typed.
      (base as unknown as Record<string, unknown>)[key] = incoming;
    }
  }

  // Never allow the screenshot-approval invariant to be turned off.
  base.privacy.screenshotRequiresApproval = true;
  if (!MODES.includes(base.companion.mode)) base.companion.mode = DEFAULT_MODE;
  sanitiseCompanion(base.companion);

  return base;
}

/**
 * Replace any invalid companion value with its default or clamp it into range.
 * Settings come from a file the user (or a bug) may have edited, and these
 * numbers feed straight into animation maths.
 */
export function sanitiseCompanion(c: CompanionSettings): void {
  const d = DEFAULT_SETTINGS.companion;
  if (!VISUAL_MODES.includes(c.visualMode)) c.visualMode = d.visualMode;
  if (!ANIMATION_LEVELS.includes(c.animations)) c.animations = d.animations;
  c.followSpeed = finiteWithin(c.followSpeed, 0.25, 3, d.followSpeed);
  c.transientIdleMs = finiteWithin(c.transientIdleMs, 1000, 30_000, d.transientIdleMs);
  const offset = c.cursorOffset as { x?: unknown; y?: unknown } | null | undefined;
  c.cursorOffset = {
    x: finiteWithin(offset?.x, -200, 200, d.cursorOffset.x),
    y: finiteWithin(offset?.y, -200, 200, d.cursorOffset.y),
  };
  c.transientMode = c.transientMode === true;
}

function finiteWithin(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback;
}

/* ------------------------------------------------------------------ *
 * Chat messages
 * ------------------------------------------------------------------ */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ImageAttachment {
  /** Base64 data URL: data:image/png;base64,.... */
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width: number;
  height: number;
  /** Origin of the image, for the audit trail. */
  source: 'screenshot' | 'upload';
  /** Human label, e.g. "Monitor 1 (2560x1440)". */
  label?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as produced by the model — validated before execution. */
  argumentsJson: string;
  /** Populated once the call has been parsed. */
  arguments?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Separate reasoning stream when thinking mode is on. */
  reasoning?: string;
  images?: ImageAttachment[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: number;
  /** Set when generation was cut short. */
  aborted?: boolean;
  error?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

/* ------------------------------------------------------------------ *
 * Streaming events (main -> renderer)
 * ------------------------------------------------------------------ */

export type StreamEvent =
  | { type: 'started'; requestId: string; model: string }
  | { type: 'reasoning'; requestId: string; delta: string }
  | { type: 'text'; requestId: string; delta: string }
  | { type: 'tool_calls'; requestId: string; toolCalls: ToolCall[] }
  | { type: 'usage'; requestId: string; usage: TokenUsage }
  | { type: 'done'; requestId: string; finishReason: string }
  | { type: 'aborted'; requestId: string; hadContent: boolean }
  | { type: 'error'; requestId: string; message: string; code: CypsErrorCode };

export type CypsErrorCode =
  | 'NO_API_KEY'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_BALANCE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'NETWORK'
  | 'MODEL_CAPABILITY'
  | 'BAD_REQUEST'
  | 'SERVER'
  | 'UNKNOWN';

export interface CypsError {
  code: CypsErrorCode;
  message: string;
  /** Actionable next step shown to the user. */
  hint?: string;
  retryable: boolean;
}

/* ------------------------------------------------------------------ *
 * Tasks / agent execution
 * ------------------------------------------------------------------ */

export type TaskStatus =
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  toolName?: string;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  createdAt: number;
  endedAt?: number;
}

/* ------------------------------------------------------------------ *
 * Permission model
 * ------------------------------------------------------------------ */

export const RISK_LEVELS = ['safe', 'low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface PermissionRequest {
  id: string;
  toolName: string;
  /** Human sentence: "Type text into Notepad". */
  action: string;
  /** What is affected: app, file, or system target. */
  target: string;
  /** Whether this mutates data on the machine. */
  changesData: boolean;
  risk: RiskLevel;
  /** How long an approval lasts. */
  duration: 'once' | 'session' | 'always';
  /** Raw arguments, shown in the expanded details view. */
  args: Record<string, unknown>;
  createdAt: number;
}

export interface PermissionDecision {
  requestId: string;
  approved: boolean;
  duration: 'once' | 'session' | 'always';
}

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

export type ToolCategory =
  | 'screen'
  | 'input'
  | 'system'
  | 'browser'
  | 'memory'
  | 'code';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  risk: RiskLevel;
  /** Requires explicit user approval before each execution. */
  requiresApproval: boolean;
  /** Changes state on the machine (blocked entirely in Guide mode). */
  changesState: boolean;
  /** JSON Schema for arguments. */
  parameters: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

export interface DiagnosticsSnapshot {
  capturedAt: number;
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  loadAverage1m: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  uptimeSeconds: number;
  /** Null when the source is unavailable in the current security context. */
  disks: Array<{ mount: string; totalBytes: number | null; freeBytes: number | null }> | null;
  battery: { present: boolean; percent: number | null; charging: boolean | null } | null;
  primaryDisplay: {
    id: string;
    width: number;
    height: number;
    scaleFactor: number;
    label: string;
  } | null;
  displays: Array<{
    id: string;
    width: number;
    height: number;
    scaleFactor: number;
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  /** Non-fatal problems encountered while gathering data. */
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Bridge contract (window.cyps)
 * ------------------------------------------------------------------ */

export interface ConnectionTestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: CypsError;
}

export interface CypsBridge {
  settings: {
    get(): Promise<AppSettings>;
    set(patch: DeepSeekSettingsPatch): Promise<AppSettings>;
    /** Stores the API key via OS-backed encryption. Never returns the key. */
    setApiKey(key: string): Promise<{ ok: boolean; error?: string }>;
    hasApiKey(): Promise<boolean>;
    clearApiKey(): Promise<void>;
    testConnection(model?: string): Promise<ConnectionTestResult>;
  };
  window: {
    setSurface(surface: Surface): Promise<void>;
    setExpanded(expanded: boolean): Promise<void>;
    setPosition(x: number, y: number): Promise<void>;
    getPosition(): Promise<{ x: number; y: number }>;
    getWorkArea(): Promise<{ x: number; y: number; width: number; height: number; scaleFactor: number }>;
    hide(): Promise<void>;
    show(): Promise<void>;
    openSettings(): Promise<void>;
    closeSettings(): Promise<void>;
    setIgnoreMouseEvents(ignore: boolean): Promise<void>;
  };
  chat: {
    send(request: ChatRequest): Promise<{ requestId: string }>;
    cancel(requestId: string): Promise<void>;
    onStream(handler: (event: StreamEvent) => void): () => void;
  };
  history: {
    list(limit?: number): Promise<ChatMessage[]>;
    clear(): Promise<void>;
  };
  screen: {
    listDisplays(): Promise<DiagnosticsSnapshot['displays']>;
    captureActiveWindow(): Promise<CaptureResult>;
    captureDisplay(displayId?: string): Promise<CaptureResult>;
    captureRegion(region: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): Promise<CaptureResult>;
  };
  system: {
    diagnostics(): Promise<DiagnosticsSnapshot>;
    /** Global emergency stop: halts tools, cancels tasks, revokes grants. */
    emergencyStop(): Promise<EmergencyStopReport>;
    onEmergencyStop(handler: (report: EmergencyStopReport) => void): () => void;
  };
  permissions: {
    onRequest(handler: (request: PermissionRequest) => void): () => void;
    respond(decision: PermissionDecision): Promise<void>;
    listActiveGrants(): Promise<PermissionGrant[]>;
    revokeAll(): Promise<number>;
  };
  tasks: {
    onUpdate(handler: (task: TaskRecord) => void): () => void;
    pause(taskId: string): Promise<void>;
    resume(taskId: string): Promise<void>;
    cancel(taskId: string): Promise<void>;
  };
  audit: {
    list(limit?: number): Promise<AuditEntry[]>;
  };
  app: {
    getVersion(): Promise<string>;
    quit(): Promise<void>;
  };
}

export type DeepSeekSettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] extends object ? Partial<AppSettings[K]> : AppSettings[K];
};

export interface CaptureResult {
  ok: boolean;
  image?: ImageAttachment;
  error?: CypsError;
  /** Window title for active-window captures. */
  windowTitle?: string;
  displayLabel?: string;
}

export interface EmergencyStopReport {
  at: number;
  /** Tool calls that were refused because they had not started. */
  cancelledPending: number;
  /** Names of tools that had already completed before the stop. */
  completedActions: string[];
  /** Authorizations that were revoked. */
  revokedGrants: number;
  /** Whether an in-flight model stream was aborted. */
  abortedStream: boolean;
}

/**
 * What a grant is limited to, beyond the tool name. A grant for
 * `browser_navigate` to https://a.example must not also cover https://b.example,
 * and a grant to open Notepad must not cover launching PowerShell.
 * An empty or absent scope means "this tool, anywhere" (the old behaviour).
 */
export interface GrantScope {
  /** Web origin (scheme + host + port), e.g. "https://example.com". */
  origin?: string;
  /** Normalised application name, e.g. "notepad". */
  app?: string;
}

export interface PermissionGrant {
  id: string;
  toolName: string;
  scope: 'once' | 'session' | 'always';
  grantedAt: number;
  expiresAt?: number;
  /** Narrows the grant to one origin/application. Absent = tool-wide. */
  target?: GrantScope;
}

export interface AuditEntry {
  id: string;
  at: number;
  kind: 'tool' | 'permission' | 'model' | 'system';
  summary: string;
  detail?: string;
  outcome: 'ok' | 'denied' | 'error' | 'cancelled';
}

export interface ChatRequest {
  text: string;
  images?: ImageAttachment[];
  mode: Mode;
  /** Continue the persisted conversation. */
  history?: ChatMessage[];
  /** Prefer the reasoning model for this turn. */
  useReasoningModel?: boolean;
}