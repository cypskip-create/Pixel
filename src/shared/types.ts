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

import type { BoardOperation, BoardSnapshot, PixelBoardDocument } from './drawingBoard';

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
  'transcribing',
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
  /** @deprecated Legacy position is used only to migrate the old monitor choice. */
  position: { x: number; y: number } | null;
  /** Selected display for the pinned top bar, persisted as Electron's display id. */
  monitorId: string | null;
  /** Distance from the selected display work area's top edge, in logical pixels. */
  topOffset: number;
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
   * @deprecated Prior mutually-exclusive presentation choice. Retained for
   * settings migration; cursor follow now has its own independent window.
   */
  visualMode: VisualMode;
  /** Show the passive, click-through cursor companion independently of the bar. */
  cursorCompanionEnabled: boolean;
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

export type VoiceSttModel = 'tiny.en' | 'base.en' | 'small.en';
export type VoiceSynthesisEngine = 'system' | 'kokoro';

export interface VoiceModelInfo {
  id: VoiceSttModel | 'kokoro-v1.0-int8';
  label: string;
  kind: 'stt' | 'tts';
  sizeBytes: number;
  downloaded: boolean;
  valid: boolean;
  license: string;
  source: string;
}

export interface VoiceModelProgress {
  id: VoiceModelInfo['id'];
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface VoiceSettings {
  /** Push-to-talk keybinding (Electron accelerator syntax). */
  pushToTalkAccelerator: string;
  /** Selected microphone device id, or null for system default. */
  inputDeviceId: string | null;
  /** Local speech-to-text model size for faster-whisper. */
  sttModel: VoiceSttModel;
  /** Speak replies using local TTS. */
  ttsEnabled: boolean;
  ttsEngine: VoiceSynthesisEngine;
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
  /** Save small, durable facts from trusted user messages into the active project. */
  automaticMemory: boolean;
  /** Number of days to keep history; 0 = forever. */
  historyRetentionDays: number;
}

export interface AppSettings {
  version: number;
  browserSearchProvider: SearchProvider;
  provider: ProviderSettings;
  companion: CompanionSettings;
  voice: VoiceSettings;
  privacy: PrivacySettings;
  /** Global shortcut to summon/hide the assistant. */
  globalAccelerator: string;
  /** Global shortcut for emergency stop. */
  emergencyStopAccelerator: string;
  /** Global shortcut that opens the maximized workspace. */
  workspaceAccelerator: string;
  /** Last workspace size and state. */
  workspaceWindow: { x: number | null; y: number | null; width: number; height: number; maximized: boolean };
  launchOnStartup: boolean;
  theme: 'system' | 'dark' | 'light';
}

export const SEARCH_PROVIDERS = ['google', 'bing', 'duckduckgo'] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  browserSearchProvider: 'google',
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
    topOffset: 12,
    autoCollapse: false,
    edgeSnap: true,
    speakReplies: false,
    reducedMotion: false,
    compact: false,
    visualMode: 'stationary',
    cursorCompanionEnabled: false,
    followSpeed: 1,
    cursorOffset: { x: 8, y: 8 },
    animations: 'full',
    transientMode: false,
    transientIdleMs: 2500,
  },
  voice: {
    pushToTalkAccelerator: 'CommandOrControl+Shift+Space',
    inputDeviceId: null,
    sttModel: 'base.en',
    ttsEnabled: false,
    ttsEngine: 'system',
    ttsVoice: null,
    ttsRate: 1,
  },
  privacy: {
    screenshotRequiresApproval: true,
    persistHistory: true,
    automaticMemory: true,
    historyRetentionDays: 0,
  },
  globalAccelerator: 'CommandOrControl+Shift+C',
  emergencyStopAccelerator: 'CommandOrControl+Shift+Escape',
  workspaceAccelerator: 'CommandOrControl+Shift+P',
  workspaceWindow: { x: null, y: null, width: 1280, height: 820, maximized: true },
  launchOnStartup: false,
  theme: 'system',
};

/** Shallow-merge stored settings over defaults so new fields appear safely. */
export function mergeSettings(partial: unknown): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!partial || typeof partial !== 'object') return base;
  const p = partial as Record<string, unknown>;
  const storedCompanion = p.companion !== null && typeof p.companion === 'object'
    ? p.companion as Record<string, unknown>
    : null;
  const migrateCursorPresentation =
    storedCompanion?.visualMode === 'cursor' && storedCompanion.cursorCompanionEnabled === undefined;

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
  if (typeof base.privacy.persistHistory !== 'boolean') base.privacy.persistHistory = DEFAULT_SETTINGS.privacy.persistHistory;
  if (typeof base.privacy.automaticMemory !== 'boolean') base.privacy.automaticMemory = DEFAULT_SETTINGS.privacy.automaticMemory;
  base.workspaceWindow.width = finiteWithin(base.workspaceWindow.width, 900, 3840, DEFAULT_SETTINGS.workspaceWindow.width);
  base.workspaceWindow.height = finiteWithin(base.workspaceWindow.height, 600, 2160, DEFAULT_SETTINGS.workspaceWindow.height);
  base.workspaceWindow.x = typeof base.workspaceWindow.x === 'number' && Number.isFinite(base.workspaceWindow.x) ? Math.min(Math.max(base.workspaceWindow.x, -20_000), 20_000) : null;
  base.workspaceWindow.y = typeof base.workspaceWindow.y === 'number' && Number.isFinite(base.workspaceWindow.y) ? Math.min(Math.max(base.workspaceWindow.y, -20_000), 20_000) : null;
  base.workspaceWindow.maximized = base.workspaceWindow.maximized !== false;
  if (typeof base.workspaceAccelerator !== 'string') base.workspaceAccelerator = DEFAULT_SETTINGS.workspaceAccelerator;
  if (!SEARCH_PROVIDERS.includes(base.browserSearchProvider)) base.browserSearchProvider = 'google';
  if (!MODES.includes(base.companion.mode)) base.companion.mode = DEFAULT_MODE;
  if (migrateCursorPresentation) base.companion.cursorCompanionEnabled = true;
  sanitiseCompanion(base.companion);
  if (!['tiny.en', 'base.en', 'small.en'].includes(base.voice.sttModel)) base.voice.sttModel = DEFAULT_SETTINGS.voice.sttModel;
  if (typeof base.voice.ttsEnabled !== 'boolean') base.voice.ttsEnabled = DEFAULT_SETTINGS.voice.ttsEnabled;
  if (!['system', 'kokoro'].includes(base.voice.ttsEngine)) base.voice.ttsEngine = DEFAULT_SETTINGS.voice.ttsEngine;
  if (typeof base.voice.inputDeviceId !== 'string' || base.voice.inputDeviceId.trim().length === 0) base.voice.inputDeviceId = null;
  if (typeof base.voice.ttsVoice !== 'string' || base.voice.ttsVoice.trim().length === 0 ||
      base.voice.ttsVoice.length > 160 || /[\u0000-\u001f\u007f]/.test(base.voice.ttsVoice)) base.voice.ttsVoice = null;
  base.voice.ttsRate = finiteWithin(base.voice.ttsRate, 0.7, 1.3, DEFAULT_SETTINGS.voice.ttsRate);

  return base;
}

/**
 * Replace any invalid companion value with its default or clamp it into range.
 * Settings come from a file the user (or a bug) may have edited, and these
 * numbers feed straight into animation maths.
 */
export function sanitiseCompanion(c: CompanionSettings): void {
  const d = DEFAULT_SETTINGS.companion;
  if (
    c.position === null ||
    typeof c.position !== 'object' ||
    !Number.isFinite(c.position.x) ||
    !Number.isFinite(c.position.y)
  ) c.position = null;
  c.monitorId = typeof c.monitorId === 'string' && c.monitorId.trim().length > 0 ? c.monitorId : null;
  c.topOffset = finiteWithin(c.topOffset, 10, 14, d.topOffset);
  if (!VISUAL_MODES.includes(c.visualMode)) c.visualMode = d.visualMode;
  c.cursorCompanionEnabled = c.cursorCompanionEnabled === true;
  if (!ANIMATION_LEVELS.includes(c.animations)) c.animations = d.animations;
  c.followSpeed = finiteWithin(c.followSpeed, 0.25, 3, d.followSpeed);
  c.transientIdleMs = finiteWithin(c.transientIdleMs, 1000, 30_000, d.transientIdleMs);
  const offset = c.cursorOffset as { x?: unknown; y?: unknown } | null | undefined;
  const legacyDefaultOffset = offset?.x === 22 && offset?.y === 20;
  const x = finiteWithin(legacyDefaultOffset ? undefined : offset?.x, -12, 12, d.cursorOffset.x);
  const y = finiteWithin(legacyDefaultOffset ? undefined : offset?.y, -12, 12, d.cursorOffset.y);
  const magnitude = Math.hypot(x, y);
  const scale = magnitude > 12 ? 12 / magnitude : 1;
  c.cursorOffset = { x: x * scale, y: y * scale };
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

/** Opaque target identity returned by the Windows foreground/UIA observer. */
export interface ScreenWindowTarget {
  windowId: string;
  title: string;
  processName: string;
  pid: number;
}

export interface ScreenCaptureMetadata {
  captureId: string;
  capturedAt: number;
  targetType: 'window' | 'display' | 'region';
  targetWindow?: ScreenWindowTarget;
  bounds: { x: number; y: number; width: number; height: number };
  coordinateSpace: 'electron_dip';
  displayId: string;
  scaleFactor: number;
  pixelScale: { x: number; y: number };
  source: 'native_print_window' | 'electron_display_capture';
  cached: false;
  status: 'captured';
}

export type VisualGuidanceShape = 'rectangle' | 'circle' | 'arrow';

/** Screen-space geometry is Electron DIP, matching all renderer window bounds. */
export interface VisualGuidanceAnnotation {
  id: string;
  shape: VisualGuidanceShape;
  bounds: { x: number; y: number; width: number; height: number };
  label?: string;
  step?: number;
}

export interface VisualGuidanceSnapshot {
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  annotations: VisualGuidanceAnnotation[];
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
  | { type: 'started'; requestId: string; conversationId?: string; model: string }
  | { type: 'reasoning'; requestId: string; conversationId?: string; delta: string }
  | { type: 'text'; requestId: string; conversationId?: string; delta: string }
  | { type: 'tool_calls'; requestId: string; conversationId?: string; toolCalls: ToolCall[] }
  | { type: 'usage'; requestId: string; conversationId?: string; usage: TokenUsage }
  | { type: 'done'; requestId: string; conversationId?: string; finishReason: string; persistence?: 'persistent' | 'session' }
  | { type: 'aborted'; requestId: string; conversationId?: string; hadContent: boolean; persistence?: 'persistent' | 'session' }
  | { type: 'error'; requestId: string; conversationId?: string; message: string; code: CypsErrorCode; persistence?: 'persistent' | 'session' };

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
  | 'pause_requested'
  | 'awaiting_approval'
  | 'awaiting_user'
  | 'paused'
  | 'blocked'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'verified' | 'failed' | 'skipped';
  toolName?: string;
  /** Persisted task arguments are redacted before they reach the renderer or disk. */
  args?: Record<string, unknown>;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
}

export interface TaskEvidence {
  id: string;
  kind: 'observation' | 'verification' | 'recovery';
  summary: string;
  source: string;
  at: number;
}

export interface TaskBudget {
  deadlineAt: number;
  maxTurns: number;
  turnsUsed: number;
  retryCount: number;
  maxRetries: number;
  maxModelTokens: number;
  modelTokensUsed: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  createdAt: number;
  updatedAt?: number;
  endedAt?: number;
  /** Sanitised user request retained for recovery and task history. */
  request?: string;
  /** Sanitised final response retained so recovered task history has an outcome. */
  result?: string;
  projectId?: string;
  /** Optional capability ceiling used by routine and delegated tasks. */
  allowedTools?: string[];
  budget?: TaskBudget;
  approvalRefs?: string[];
  evidence?: TaskEvidence[];
  checkpoint?: { phase: 'before_model' | 'before_tool' | 'awaiting_approval'; at: number; summary: string };
  /** True while the executor is finishing the current safe operation. */
  pauseRequested?: boolean;
  /** Set after a process restart; those tasks cannot resume their old call stack. */
  recoveryNote?: string;
  /** The user-facing reason Pixel released control for a handoff. */
  handoffReason?: string;
  /** Set after a handoff; cleared only after Pixel observes the environment again. */
  reobserveRequired?: boolean;
  /** State changes with missing or uncertain outcomes that still need verification. */
  pendingVerifications?: Array<{
    stepId: string;
    toolName: string;
    /** Exact UIA postcondition captured from an approved native action. */
    expectedWindowTitle?: string;
    verificationSelector?: string;
    verificationRole?: string;
    verificationState?: 'present' | 'absent';
  }>;
}

/* ------------------------------------------------------------------ *
 * Reviewed skills and local routines
 * ------------------------------------------------------------------ */

export interface SkillInputDefinition {
  name: string;
  description: string;
  required: boolean;
}

export interface SkillStepDefinition {
  ordinal: number;
  kind: 'tool' | 'browser' | 'native';
  locator: string;
  action: string;
  params: Record<string, unknown>;
  expectation: Record<string, unknown>;
  approvalRequired: boolean;
}

export interface SkillDraftRequest {
  schemaVersion: 1;
  name: string;
  purpose: string;
  triggers: string[];
  inputs: SkillInputDefinition[];
  requiredTools: string[];
  steps: SkillStepDefinition[];
  decisionBranches: string[];
  verificationRules: string[];
  failureHandling: string[];
  approvalRequirements: string[];
}

export interface SkillRecord extends SkillDraftRequest {
  id: string;
  projectId: string;
  status: 'draft' | 'active';
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRecord {
  id: string;
  projectId: string;
  skillId: string;
  name: string;
  localTime: string;
  timezone: string;
  enabled: boolean;
  retryPolicy: 'manual';
  missedRunPolicy: 'skip';
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRunRecord {
  id: string;
  routineId: string;
  skillId: string;
  scheduledKey: string;
  startedAt: number;
  endedAt: number | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'missed' | 'denied';
  taskId: string | null;
  summary: string | null;
  failure: string | null;
}

export type PixelMemoryKind = 'preference' | 'project' | 'fact' | 'workflow' | 'outcome' | 'document';
export interface MemoryRecordView {
  id: string;
  projectId: string;
  kind: PixelMemoryKind;
  content: string;
  source: string;
  confidence: 'user_approved' | 'source_backed' | 'inferred';
  retention: 'permanent' | 'session' | 'expiring';
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  expiresAt: number | null;
}

export interface MemoryExportView {
  schemaVersion: 1;
  projectId: string;
  exportedAt: number;
  memories: MemoryRecordView[];
}

export interface MemoryRevisionView {
  content: string;
  source: string;
  confidence: 'user_approved' | 'source_backed' | 'inferred';
  updatedAt: number;
  reason: string;
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
  /** Whether the main-process capability policy allows a persistent grant. */
  allowPersistent?: boolean;
  /** Main-process policy permits a volatile, exact-target grant for this Pixel run. */
  allowSession?: boolean;
  sessionDisabledReason?: string;
  sessionScopeLabel?: string;
  scopeLabel?: string;
  /** Main-process policy result; renderer hints are revalidated before use. */
  alwaysAllowed?: boolean;
  alwaysDisabledReason?: string;
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
  | 'board'
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

export interface ToolCatalogEntry {
  name: string;
  description: string;
  category: ToolCategory;
  risk: RiskLevel;
  requiresApproval: boolean;
  changesState: boolean;
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
    onChanged(handler: (settings: AppSettings) => void): () => void;
    onApiKeyStatus(handler: (configured: boolean) => void): () => void;
  };
  window: {
    setSurface(surface: Surface): Promise<void>;
    /** Report measured companion content; the shell clamps it to the active work area. */
    setLayout(surface: Surface, size: { width: number; height: number }): Promise<void>;
    setExpanded(expanded: boolean): Promise<void>;
    hide(): Promise<void>;
    show(): Promise<void>;
    openSettings(): Promise<void>;
    closeSettings(): Promise<void>;
    openWorkspace(): Promise<void>;
    closeWorkspace(): Promise<void>;
    minimizeWorkspace(): Promise<void>;
    toggleWorkspaceMaximize(): Promise<boolean>;
    setWorkspaceFullscreen(fullscreen: boolean): Promise<void>;
    getWorkspaceState(): Promise<WorkspaceWindowState>;
    onWorkspaceState(handler: (state: WorkspaceWindowState) => void): () => void;
    setIgnoreMouseEvents(ignore: boolean): Promise<void>;
    onFocusLost(handler: () => void): () => void;
    onSummon(handler: () => void): () => void;
    onCursorMotion(handler: (reducedMotion: boolean) => void): () => void;
    onCursorPlacement(handler: (orientation: { flipX: boolean; flipY: boolean }) => void): () => void;
    /** Report the current assistant state so the passive desktop character can mirror it. */
    setCursorAssistantState(state: AssistantState): Promise<void>;
    /** Cursor window acknowledges its first completed renderer paint. */
    cursorRendererReady(): Promise<void>;
    /** Read the one appearance preference needed by the passive cursor window. */
    getCursorSettings(): Promise<{ reducedMotion: boolean }>;
    onCursorAssistantState(handler: (state: AssistantState) => void): () => void;
  };
  chat: {
    send(request: ChatRequest): Promise<{ requestId: string; persistence?: 'persistent' | 'session' }>;
    cancel(requestId: string): Promise<void>;
    onStream(handler: (event: StreamEvent) => void): () => void;
  };
  history: {
    list(query?: HistoryQuery): Promise<ConversationSummary[]>;
    open(id: string): Promise<ConversationRecordView | null>;
    create(): Promise<ConversationRecordView>;
    rename(id: string, title: string): Promise<ConversationSummary | null>;
    delete(id: string): Promise<boolean>;
    clear(): Promise<void>;
    getActive(): Promise<ConversationRecordView | null>;
    onActiveChanged(handler: (record: ConversationRecordView | null) => void): () => void;
  };
  browser: {
    openSearch(query: string, requestText: string, conversationId: string): Promise<{ query: string; provider: SearchProvider }>;
  };
  screen: {
    listDisplays(): Promise<DiagnosticsSnapshot['displays']>;
    listExternalWindows(): Promise<{ windows: ScreenWindowTarget[]; truncated: boolean }>;
    captureActiveWindow(): Promise<CaptureResult>;
    captureLastExternalWindow(): Promise<CaptureResult>;
    captureSelectedWindow(target: ScreenWindowTarget): Promise<CaptureResult>;
    captureDisplay(displayId?: string): Promise<CaptureResult>;
    captureRegion(region: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): Promise<CaptureResult>;
    onGuidanceUpdate(handler: (snapshot: VisualGuidanceSnapshot) => void): () => void;
  };
  board: {
    getState(): Promise<BoardSnapshot>;
    apply(operations: BoardOperation[], expectedRevision?: number): Promise<BoardSnapshot>;
    create(title: string, replace?: boolean, expectedRevision?: number): Promise<BoardSnapshot>;
    importLegacyDraft(document: PixelBoardDocument): Promise<BoardSnapshot>;
    undo(expectedRevision?: number): Promise<BoardSnapshot>;
    redo(expectedRevision?: number): Promise<BoardSnapshot>;
    open(): Promise<{ ok: boolean; cancelled?: boolean; snapshot?: BoardSnapshot; error?: string }>;
    save(format: 'pixelboard' | 'svg'): Promise<{ ok: boolean; cancelled?: boolean; path?: string; bytes?: number; error?: string }>;
    onChanged(handler: (snapshot: BoardSnapshot) => void): () => void;
    onFocusRequested(handler: (payload: undefined) => void): () => void;
  };
  system: {
    diagnostics(): Promise<DiagnosticsSnapshot>;
    isEmergencyStopped(): Promise<boolean>;
    /** Global emergency stop: halts tools, cancels tasks, revokes grants. */
    emergencyStop(): Promise<EmergencyStopReport>;
    emergencyClear(): Promise<void>;
    onEmergencyStop(handler: (report: EmergencyStopReport) => void): () => void;
  };
  permissions: {
    onRequest(handler: (request: PermissionRequest) => void): () => void;
    listPending(): Promise<PermissionRequest[]>;
    onResolved(handler: (requestId: string) => void): () => void;
    respond(decision: PermissionDecision): Promise<void>;
    listActiveGrants(): Promise<PermissionGrant[]>;
    revokeGrant(grantId: string): Promise<boolean>;
    clearExpired(): Promise<number>;
    revokeAll(): Promise<number>;
  };
  tasks: {
    list(): Promise<TaskRecord[]>;
    onUpdate(handler: (task: TaskRecord) => void): () => void;
    pause(taskId: string): Promise<void>;
    resume(taskId: string): Promise<void>;
    cancel(taskId: string): Promise<void>;
    continueAfterHandoff(taskId: string): Promise<boolean>;
  };
  skills: {
    list(): Promise<SkillRecord[]>;
    createDraft(draft: SkillDraftRequest): Promise<SkillRecord>;
    activate(skillId: string): Promise<SkillRecord>;
    delete(skillId: string): Promise<boolean>;
  };
  routines: {
    list(): Promise<RoutineRecord[]>;
    create(input: { skillId: string; name: string; localTime: string; timezone: string }): Promise<RoutineRecord>;
    setEnabled(routineId: string, enabled: boolean): Promise<boolean>;
    delete(routineId: string): Promise<boolean>;
    history(routineId: string, limit?: number): Promise<RoutineRunRecord[]>;
    cancel(routineId: string): Promise<boolean>;
    retry(routineId: string): Promise<boolean>;
  };
  memory: {
    list(): Promise<MemoryRecordView[]>;
    listProjects(): Promise<ProjectView[]>;
    setActiveProject(name: string): Promise<ProjectView>;
    onProjectChanged(handler: (project: ProjectView) => void): () => void;
    update(id: string, patch: { content?: string; kind?: PixelMemoryKind; tags?: string[] }): Promise<MemoryRecordView>;
    delete(id: string): Promise<boolean>;
    history(id: string): Promise<MemoryRevisionView[]>;
    export(): Promise<MemoryExportView>;
  };
  audit: {
    list(limit?: number): Promise<AuditEntry[]>;
  };
  tools: {
    list(): Promise<ToolCatalogEntry[]>;
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
  metadata?: ScreenCaptureMetadata;
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
  /** Exact folder scope for document indexing. */
  directory?: string;
  /** Exact normalized query approved for a browser search. */
  query?: string;
  /** Volatile exact window identity. Session grants only; never stored in the durable grant DB. */
  windowId?: string;
  processId?: number;
  processName?: string;
  windowTitle?: string;
}

export interface PermissionGrant {
  id: string;
  toolName: string;
  scope: 'once' | 'session' | 'always';
  grantedAt: number;
  expiresAt?: number;
  /** Narrows the grant to one origin/application. Absent = tool-wide. */
  target?: GrantScope;
  risk?: RiskLevel;
  lastUsedAt?: number | null;
  revokedAt?: number | null;
  policyVersion?: number;
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
  /** Conversation id selected through main-owned history IPC. */
  conversationId?: string;
  /** Internal trusted history supplied only by the main process. */
  history?: ChatMessage[];
  /** Prefer the reasoning model for this turn. */
  useReasoningModel?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
  projectId?: string;
  persistence: 'persistent' | 'session';
}

export interface ConversationRecordView extends ConversationSummary {
  messages: ChatMessage[];
}

export interface ProjectView {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface WorkspaceWindowState {
  maximized: boolean;
  fullscreen: boolean;
}

export interface HistoryQuery {
  limit?: number;
  offset?: number;
  search?: string;
}
