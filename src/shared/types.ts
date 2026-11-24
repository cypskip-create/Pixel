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

export const PROVIDER_IDS = [
  'deepseek',
  'openai',
  'openrouter',
  'anthropic',
  'gemini',
  'xai',
  'fal',
  'ollama',
  'custom',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  defaultModel: string;
  reasoningModel: string;
}

export const PROVIDER_CATALOG: readonly ProviderDescriptor[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    requiresApiKey: true,
    defaultModel: 'deepseek-flash',
    reasoningModel: 'deepseek-v4-pro',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    defaultModel: 'gpt-4o',
    reasoningModel: 'o3-mini',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    defaultModel: 'anthropic/claude-sonnet-4',
    reasoningModel: 'deepseek/deepseek-r1',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (OpenAI-compat)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-4-20250514',
    reasoningModel: 'claude-opus-4-20250514',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresApiKey: true,
    defaultModel: 'gemini-2.5-flash',
    reasoningModel: 'gemini-2.5-pro',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    requiresApiKey: true,
    defaultModel: 'grok-3',
    reasoningModel: 'grok-3-mini',
  },
  {
    id: 'fal',
    label: 'FAL.ai (Image Generation)',
    defaultBaseUrl: 'https://fal.run',
    requiresApiKey: true,
    defaultModel: 'fal-ai/flux/schnell',
    reasoningModel: 'fal-ai/flux/schnell',
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
    defaultModel: 'llama3.2',
    reasoningModel: 'deepseek-r1:14b',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-Compatible',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    requiresApiKey: false,
    defaultModel: 'local-model',
    reasoningModel: 'local-model',
  },
] as const;

export function getProviderDescriptor(providerId: string): ProviderDescriptor {
  return PROVIDER_CATALOG.find((p) => p.id === providerId) ?? PROVIDER_CATALOG[0]!;
}

export interface ProviderModelEntry {
  provider: ProviderId;
  id: string;
  label: string;
  role: 'fast' | 'reasoning';
  vision: boolean;
  toolCalls: boolean;
  thinking: boolean;
  contextTokens: number;
  maxOutputTokens: number;
}

/**
 * Verified per-model capability catalog across all supported providers.
 * Used by ModelPickerPopover and runtime capability checks instead of guessing
 * capabilities from provider names.
 */
export const PROVIDER_MODEL_CATALOG: readonly ProviderModelEntry[] = [
  { provider: 'deepseek', id: 'deepseek-flash', label: 'DeepSeek Flash', role: 'fast', vision: true, toolCalls: true, thinking: true, contextTokens: 1_000_000, maxOutputTokens: 393_216 },
  { provider: 'deepseek', id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', role: 'reasoning', vision: false, toolCalls: true, thinking: true, contextTokens: 1_000_000, maxOutputTokens: 393_216 },
  { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o', role: 'fast', vision: true, toolCalls: true, thinking: false, contextTokens: 128_000, maxOutputTokens: 16_384 },
  { provider: 'openai', id: 'o3-mini', label: 'o3-mini', role: 'reasoning', vision: false, toolCalls: true, thinking: true, contextTokens: 200_000, maxOutputTokens: 100_000 },
  { provider: 'openrouter', id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (OR)', role: 'fast', vision: true, toolCalls: true, thinking: true, contextTokens: 200_000, maxOutputTokens: 64_000 },
  { provider: 'openrouter', id: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (OR)', role: 'reasoning', vision: false, toolCalls: true, thinking: true, contextTokens: 128_000, maxOutputTokens: 32_768 },
  { provider: 'anthropic', id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', role: 'fast', vision: true, toolCalls: true, thinking: true, contextTokens: 200_000, maxOutputTokens: 64_000 },
  { provider: 'anthropic', id: 'claude-opus-4-20250514', label: 'Claude Opus 4', role: 'reasoning', vision: true, toolCalls: true, thinking: true, contextTokens: 200_000, maxOutputTokens: 32_000 },
  { provider: 'gemini', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', role: 'fast', vision: true, toolCalls: true, thinking: true, contextTokens: 1_000_000, maxOutputTokens: 65_536 },
  { provider: 'gemini', id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', role: 'reasoning', vision: true, toolCalls: true, thinking: true, contextTokens: 1_000_000, maxOutputTokens: 65_536 },
  { provider: 'xai', id: 'grok-3', label: 'Grok 3', role: 'fast', vision: false, toolCalls: true, thinking: false, contextTokens: 131_072, maxOutputTokens: 16_384 },
  { provider: 'xai', id: 'grok-3-mini', label: 'Grok 3 Mini', role: 'reasoning', vision: false, toolCalls: true, thinking: true, contextTokens: 131_072, maxOutputTokens: 16_384 },
  { provider: 'ollama', id: 'llama3.2', label: 'Llama 3.2 (Local)', role: 'fast', vision: false, toolCalls: true, thinking: false, contextTokens: 128_000, maxOutputTokens: 8_192 },
  { provider: 'ollama', id: 'deepseek-r1:14b', label: 'DeepSeek R1 14B (Local)', role: 'reasoning', vision: false, toolCalls: false, thinking: true, contextTokens: 64_000, maxOutputTokens: 8_192 },
  { provider: 'custom', id: 'local-model', label: 'Custom Endpoint Model', role: 'fast', vision: false, toolCalls: true, thinking: false, contextTokens: 128_000, maxOutputTokens: 8_192 },
] as const;

/**
 * Validate a provider base URL. Requires HTTPS for remote hosts; allows plain
 * HTTP only on loopback (localhost / 127.0.0.1 / [::1]) so credentials never
 * cross untrusted networks in plaintext.
 */
export function isSafeProviderBaseUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return Boolean(parsed.hostname);
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    }
    return false;
  } catch {
    return false;
  }
}

export interface CustomEndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

export interface FallbackProviderEntry {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  customEndpointId?: string;
  enabled: boolean;
}

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
  /** Optional explicit base URL override (required for custom endpoints). */
  baseUrl?: string;
  /** Optional explicit context window override (4,096–2,000,000). Matches Hermes `model_context_length`. */
  contextLength?: number;
  /** Named custom OpenAI-compatible endpoints (Hermes `custom_providers`). */
  customEndpoints?: CustomEndpointConfig[];
  /** Ordered fallback model chain (Hermes `fallback_providers`). */
  fallbackProviders?: FallbackProviderEntry[];
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

export type VoiceSttModel = 'tiny.en' | 'base.en' | 'small.en' | 'tiny' | 'base' | 'small' | 'large-v3-turbo';
export type VoiceSynthesisEngine = 'system' | 'kokoro';
export type VoiceSttProvider = 'local' | 'openai' | 'mistral' | 'deepgram' | 'custom';
export type VoiceTtsProvider = 'system' | 'kokoro' | 'edge' | 'openai' | 'elevenlabs' | 'xai' | 'gemini' | 'minimax' | 'mistral';
export type VoiceChatMode = 'chained' | 'gpt-live';

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
  /** Local speech-to-text model size for faster-whisper (English & multilingual). */
  sttModel: VoiceSttModel;
  /** Speak replies using TTS. */
  ttsEnabled: boolean;
  ttsEngine: VoiceSynthesisEngine;
  ttsVoice: string | null;
  ttsRate: number;
  /** Hermes Stage 6: chained (STT -> agent -> TTS) or full-duplex GPT-Live. */
  voiceChatMode?: VoiceChatMode;
  /** Speech-to-text provider (defaults to 'local'). */
  sttProvider?: VoiceSttProvider;
  /** ISO language code or 'auto' for multilingual transcription. */
  sttLanguage?: string;
  /** Text-to-speech provider (defaults to 'system'). */
  ttsProvider?: VoiceTtsProvider;
  /** Submit mode after transcription: direct or editable draft. */
  submitMode?: 'direct' | 'draft';
  /** Maximum recording length in seconds (10-300, default 120). */
  maxRecordingSec?: number;
  /** Auto-TTS scope: all replies or voice_only. */
  autoTtsMode?: 'all' | 'voice_only';
  /** RMS silence threshold (50-5000, default 200). */
  silenceThreshold?: number;
  /** Silence duration in seconds before auto-stop (0.5-10, default 3.0). */
  silenceDurationSec?: number;
  /** Allow interrupting Pixel while speaking. */
  bargeIn?: boolean;
  /** Barge-in onset grace period in seconds (0.1-3.0, default 0.5). */
  bargeInGraceSec?: number;
  /** Barge-in RMS multiplier over calibrated quiet-room floor (1.5-8.0, default 3.0). */
  bargeInThresholdMultiplier?: number;
  /** Play subtle record start/stop audio cues. */
  beepEnabled?: boolean;
  /** Audio cue volume (0.0-1.0, default 0.3). */
  beepVolume?: number;
  /** Ambient thinking audio cue during voice turns. */
  thinkingSound?: boolean;
  /** Spoken phrases that end a voice session immediately. */
  stopPhrases?: string[];
  /** Full-duplex GPT-Live model id. */
  gptLiveModel?: string;
  /** Full-duplex GPT-Live voice name. */
  gptLiveVoice?: string;
  /** Optional extra persona/tone instructions for GPT-Live. */
  gptLiveInstructions?: string;
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

export type AgentRuntimeEngine = 'typescript' | 'python';

export interface AgentRuntimeSettings {
  /** Selects the active conversation runtime; Python is Pixel's primary default runtime. */
  runtimeEngine: AgentRuntimeEngine;
  /** Upper bound for tool-calling turns per request (4–40, default 12). Matches Hermes `agent.max_turns`. */
  maxTurns: number;
  /** Maximum parallel child specialists (1–3, default 3). Matches Hermes `delegation.max_concurrent_children`. */
  maxConcurrentSpecialists: number;
  /** Per-specialist step limit override (2–30, default 12). Matches Hermes `delegation.max_iterations`. */
  delegationMaxIterations: number;
  /** Per-specialist timeout in seconds (15–600, default 180). Matches Hermes `delegation.child_timeout_seconds`. */
  delegationChildTimeoutSec: number;
  /** Provider API retry ceiling (0–5, default 2). Matches Hermes `agent.api_max_retries`. */
  apiMaxRetries: number;
  /** Frozen project memory character budget (300–4000, default 900). Matches Hermes `memory.memory_char_limit`. */
  memoryCharLimit: number;
  /** Frozen user profile character budget (200–3000, default 700). Matches Hermes `memory.user_char_limit`. */
  userProfileCharLimit: number;
  /** Auto-compression toggle for long conversations. Matches Hermes `compression.enabled`. */
  compressionEnabled: boolean;
  /** Context utilization threshold (0.40–0.95, default 0.75). Matches Hermes `compression.threshold`. */
  compressionThreshold: number;
  /** Protected tail messages never summarized (2–20, default 6). Matches Hermes `compression.protect_last_n`. */
  compressionProtectLastN: number;
  /** Default IANA timezone for schedules & prompts (empty = system timezone). Matches Hermes `timezone`. */
  defaultTimezone: string;
  /** Optional provider override for delegated specialist tasks (empty = inherit active provider). Matches Hermes `delegation.provider`. */
  delegationProvider?: ProviderId | '';
  /** Optional model override for delegated specialist tasks (empty = inherit primary model). Matches Hermes `delegation.model`. */
  delegationModel?: string;
  /** Optional reasoning effort override for delegated specialist tasks. Matches Hermes `delegation.reasoning_effort`. */
  delegationReasoningEffort?: ReasoningEffort | 'inherit';
}

export interface DisplayPreferences {
  /** Workspace UI scale percentage (85–125, default 100). Matches Hermes `appearance.uiScale`. */
  uiScale: number;
  /** Chat message text scale percentage (85–130, default 100). Matches Hermes `appearance.chatTextScale`. */
  chatTextScale: number;
  /** Sidebar & list density. Matches Hermes `appearance.sessionDensity`. */
  sessionDensity: 'comfortable' | 'compact';
  /** Collapse reasoning blocks by default. Matches Hermes `appearance.reasoningCollapsed`. */
  reasoningCollapsed: boolean;
  /** Hide inline code diffs in chat tool previews. Matches Hermes `appearance.hideCodeDiffs`. */
  hideCodeDiffs: boolean;
  /** Mute completion chimes and UI sound cues. Matches Hermes `notifications.muteSounds`. */
  muteSounds: boolean;
}

export interface BrowserAutomationSettings {
  /** Browser execution mode. Matches Hermes `browser.headless`. */
  headless: boolean;
  /** Optional explicit CDP endpoint (loopback HTTP/WS or HTTPS/WSS). Matches Hermes `browser.cdp_endpoint`. */
  cdpEndpoint: string;
  /** Idle inactivity timeout in seconds (30–3600, default 300). Matches Hermes `browser.inactivity_timeout`. */
  inactivityTimeoutSec: number;
  /** Per-command timeout in seconds (5–180, default 30). Matches Hermes `browser.command_timeout`. */
  commandTimeoutSec: number;
  /** Explicit user opt-in for snapshotting a local Chromium profile. Matches Hermes `browser.use_real_profile`. */
  realProfileConsent: boolean;
  /** Selected stable Chromium browser id when realProfileConsent is enabled. */
  selectedBrowserId: 'chrome' | 'edge' | 'brave' | '';
  /** Permit private/loopback browsing (cloud metadata endpoints remain unconditionally blocked). Matches Hermes `browser.allow_private_urls`. */
  allowPrivateNetwork: boolean;
  /** Optional website denylist. */
  blockedDomains: string[];
  /** Optional website allowlist. */
  allowedDomains: string[];
  /** Browser profile persistence mode (ephemeral, pixel_persistent_profile, profile_preferences_copy, or cdp_attach). */
  profileMode?: 'ephemeral' | 'pixel_persistent_profile' | 'profile_preferences_copy' | 'cdp_attach';
}

export interface ComputerUseSettings {
  /** Default capture mode: Set-of-Marks (`som`), plain screenshot (`vision`), or AX-only (`ax`). */
  captureMode: 'som' | 'vision' | 'ax';
  /** Prefer non-disruptive background UIA whenever supported. */
  interactionPolicy: 'background_first' | 'ask_before_foreground';
  /** Require read-back/state verification after UI interactions. */
  requireVerification: boolean;
  /** Explicitly allow Win32 foreground mouse/keyboard actions against verified target windows. */
  allowForegroundFallback?: boolean;
}

export interface AppSettings {
  version: number;
  browserSearchProvider: SearchProvider;
  provider: ProviderSettings;
  agent: AgentRuntimeSettings;
  companion: CompanionSettings;
  voice: VoiceSettings;
  privacy: PrivacySettings;
  display: DisplayPreferences;
  browser: BrowserAutomationSettings;
  computerUse: ComputerUseSettings;
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
    baseUrl: '',
    contextLength: 128_000,
    customEndpoints: [],
    fallbackProviders: [],
    thinking: { ...DEFAULT_THINKING },
    temperature: 1,
    maxTokens: 8192,
    requestTimeoutMs: 60_000,
  },
  agent: {
    runtimeEngine: 'python',
    maxTurns: 12,
    maxConcurrentSpecialists: 3,
    delegationMaxIterations: 12,
    delegationChildTimeoutSec: 180,
    apiMaxRetries: 2,
    memoryCharLimit: 900,
    userProfileCharLimit: 700,
    compressionEnabled: true,
    compressionThreshold: 0.75,
    compressionProtectLastN: 6,
    defaultTimezone: '',
    delegationProvider: '',
    delegationModel: '',
    delegationReasoningEffort: 'inherit',
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
    voiceChatMode: 'chained',
    sttProvider: 'local',
    sttLanguage: 'auto',
    ttsProvider: 'system',
    submitMode: 'direct',
    maxRecordingSec: 120,
    autoTtsMode: 'voice_only',
    silenceThreshold: 200,
    silenceDurationSec: 3.0,
    bargeIn: true,
    bargeInGraceSec: 0.5,
    bargeInThresholdMultiplier: 3.0,
    beepEnabled: true,
    beepVolume: 0.3,
    thinkingSound: true,
    stopPhrases: ['stop'],
    gptLiveModel: 'gpt-live-1',
    gptLiveVoice: 'marin',
    gptLiveInstructions: '',
  },
  privacy: {
    screenshotRequiresApproval: true,
    persistHistory: true,
    automaticMemory: true,
    historyRetentionDays: 0,
  },
  display: {
    uiScale: 100,
    chatTextScale: 100,
    sessionDensity: 'comfortable',
    reasoningCollapsed: true,
    hideCodeDiffs: false,
    muteSounds: false,
  },
  browser: {
    headless: true,
    cdpEndpoint: '',
    inactivityTimeoutSec: 300,
    commandTimeoutSec: 30,
    realProfileConsent: false,
    selectedBrowserId: '',
    allowPrivateNetwork: false,
    blockedDomains: [],
    allowedDomains: [],
  },
  computerUse: {
    captureMode: 'som',
    interactionPolicy: 'background_first',
    requireVerification: true,
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
  if (base.agent.runtimeEngine !== 'typescript' && base.agent.runtimeEngine !== 'python') {
    base.agent.runtimeEngine = DEFAULT_SETTINGS.agent.runtimeEngine;
  }
  if (!MODES.includes(base.companion.mode)) base.companion.mode = DEFAULT_MODE;
  if (migrateCursorPresentation) base.companion.cursorCompanionEnabled = true;
  sanitiseCompanion(base.companion);
  if (!['tiny.en', 'base.en', 'small.en', 'tiny', 'base', 'small', 'large-v3-turbo'].includes(base.voice.sttModel)) base.voice.sttModel = DEFAULT_SETTINGS.voice.sttModel;
  if (typeof base.voice.ttsEnabled !== 'boolean') base.voice.ttsEnabled = DEFAULT_SETTINGS.voice.ttsEnabled;
  if (!['system', 'kokoro'].includes(base.voice.ttsEngine)) base.voice.ttsEngine = DEFAULT_SETTINGS.voice.ttsEngine;
  if (typeof base.voice.inputDeviceId !== 'string' || base.voice.inputDeviceId.trim().length === 0) base.voice.inputDeviceId = null;
  if (typeof base.voice.ttsVoice !== 'string' || base.voice.ttsVoice.trim().length === 0 ||
      base.voice.ttsVoice.length > 160 || /[\u0000-\u001f\u007f]/.test(base.voice.ttsVoice)) base.voice.ttsVoice = null;
  base.voice.ttsRate = finiteWithin(base.voice.ttsRate, 0.7, 1.3, DEFAULT_SETTINGS.voice.ttsRate);
  if (base.voice.voiceChatMode !== 'chained' && base.voice.voiceChatMode !== 'gpt-live') base.voice.voiceChatMode = 'chained';
  if (!['local', 'openai', 'mistral', 'deepgram', 'custom'].includes(base.voice.sttProvider ?? '')) base.voice.sttProvider = 'local';
  if (typeof base.voice.sttLanguage !== 'string' || base.voice.sttLanguage.length > 24) base.voice.sttLanguage = 'auto';
  if (!['system', 'kokoro', 'edge', 'openai', 'elevenlabs', 'xai', 'gemini', 'minimax', 'mistral'].includes(base.voice.ttsProvider ?? '')) base.voice.ttsProvider = 'system';
  if (base.voice.submitMode !== 'direct' && base.voice.submitMode !== 'draft') base.voice.submitMode = 'direct';
  base.voice.maxRecordingSec = Math.round(finiteWithin(base.voice.maxRecordingSec, 10, 300, 120));
  if (base.voice.autoTtsMode !== 'all' && base.voice.autoTtsMode !== 'voice_only') base.voice.autoTtsMode = 'voice_only';
  base.voice.silenceThreshold = Math.round(finiteWithin(base.voice.silenceThreshold, 50, 5000, 200));
  base.voice.silenceDurationSec = Math.round(finiteWithin(base.voice.silenceDurationSec, 0.5, 10, 3.0) * 10) / 10;
  base.voice.bargeIn = base.voice.bargeIn !== false;
  base.voice.bargeInGraceSec = Math.round(finiteWithin(base.voice.bargeInGraceSec, 0.1, 3.0, 0.5) * 10) / 10;
  base.voice.bargeInThresholdMultiplier = Math.round(finiteWithin(base.voice.bargeInThresholdMultiplier, 1.5, 8.0, 3.0) * 10) / 10;
  base.voice.beepEnabled = base.voice.beepEnabled !== false;
  base.voice.beepVolume = Math.round(finiteWithin(base.voice.beepVolume, 0, 1, 0.3) * 100) / 100;
  base.voice.thinkingSound = base.voice.thinkingSound !== false;
  base.voice.stopPhrases = Array.isArray(base.voice.stopPhrases)
    ? base.voice.stopPhrases.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim().slice(0, 40)).slice(0, 10)
    : ['stop'];
  base.voice.gptLiveModel = typeof base.voice.gptLiveModel === 'string' && base.voice.gptLiveModel.trim() ? base.voice.gptLiveModel.trim().slice(0, 80) : 'gpt-live-1';
  base.voice.gptLiveVoice = typeof base.voice.gptLiveVoice === 'string' && base.voice.gptLiveVoice.trim() ? base.voice.gptLiveVoice.trim().slice(0, 40) : 'marin';
  base.voice.gptLiveInstructions = typeof base.voice.gptLiveInstructions === 'string' ? base.voice.gptLiveInstructions.slice(0, 1000) : '';
  base.agent.maxTurns = Math.round(finiteWithin(base.agent.maxTurns, 4, 40, DEFAULT_SETTINGS.agent.maxTurns));
  base.agent.maxConcurrentSpecialists = Math.round(
    finiteWithin(base.agent.maxConcurrentSpecialists, 1, 3, DEFAULT_SETTINGS.agent.maxConcurrentSpecialists),
  );
  base.agent.delegationMaxIterations = Math.round(
    finiteWithin(base.agent.delegationMaxIterations, 2, 30, DEFAULT_SETTINGS.agent.delegationMaxIterations),
  );
  base.agent.delegationChildTimeoutSec = Math.round(
    finiteWithin(base.agent.delegationChildTimeoutSec, 15, 600, DEFAULT_SETTINGS.agent.delegationChildTimeoutSec),
  );
  base.agent.apiMaxRetries = Math.round(
    finiteWithin(base.agent.apiMaxRetries, 0, 5, DEFAULT_SETTINGS.agent.apiMaxRetries),
  );
  base.agent.memoryCharLimit = Math.round(
    finiteWithin(base.agent.memoryCharLimit, 300, 4_000, DEFAULT_SETTINGS.agent.memoryCharLimit),
  );
  base.agent.userProfileCharLimit = Math.round(
    finiteWithin(base.agent.userProfileCharLimit, 200, 3_000, DEFAULT_SETTINGS.agent.userProfileCharLimit),
  );
  base.agent.compressionEnabled = base.agent.compressionEnabled !== false;
  base.agent.compressionThreshold = Math.round(
    finiteWithin(base.agent.compressionThreshold, 0.4, 0.95, DEFAULT_SETTINGS.agent.compressionThreshold) * 100,
  ) / 100;
  base.agent.compressionProtectLastN = Math.round(
    finiteWithin(base.agent.compressionProtectLastN, 2, 20, DEFAULT_SETTINGS.agent.compressionProtectLastN),
  );
  if (typeof base.agent.defaultTimezone !== 'string' || base.agent.defaultTimezone.length > 100) {
    base.agent.defaultTimezone = '';
  } else {
    base.agent.defaultTimezone = base.agent.defaultTimezone.trim();
  }
  if (!base.agent.delegationProvider || !PROVIDER_IDS.includes(base.agent.delegationProvider)) {
    base.agent.delegationProvider = '';
  }
  if (typeof base.agent.delegationModel !== 'string' || base.agent.delegationModel.length > 160) {
    base.agent.delegationModel = '';
  } else {
    base.agent.delegationModel = base.agent.delegationModel.trim();
  }
  if (
    base.agent.delegationReasoningEffort !== 'inherit' &&
    base.agent.delegationReasoningEffort !== 'none' &&
    base.agent.delegationReasoningEffort !== 'low' &&
    base.agent.delegationReasoningEffort !== 'high' &&
    base.agent.delegationReasoningEffort !== 'max'
  ) {
    base.agent.delegationReasoningEffort = 'inherit';
  }

  // Stage 2: Multi-provider validation, safe base URL enforcement, and Hermes fallback deduplication.
  if (!PROVIDER_IDS.includes(base.provider.provider)) {
    base.provider.provider = DEFAULT_SETTINGS.provider.provider;
  }
  if (typeof base.provider.baseUrl === 'string' && base.provider.baseUrl.trim()) {
    base.provider.baseUrl = isSafeProviderBaseUrl(base.provider.baseUrl)
      ? base.provider.baseUrl.trim().replace(/\/+$/, '')
      : '';
  } else {
    base.provider.baseUrl = '';
  }
  base.provider.contextLength = Math.round(
    finiteWithin(base.provider.contextLength, 4_096, 2_000_000, DEFAULT_SETTINGS.provider.contextLength ?? 128_000),
  );
  const rawEndpoints = Array.isArray(base.provider.customEndpoints) ? base.provider.customEndpoints : [];
  const seenEndpointIds = new Set<string>();
  base.provider.customEndpoints = rawEndpoints
    .filter((ep): ep is CustomEndpointConfig => Boolean(ep && typeof ep === 'object'))
    .map((ep, idx) => ({
      id: typeof ep.id === 'string' && ep.id.trim() ? ep.id.trim().slice(0, 64) : `custom-${idx + 1}`,
      name: typeof ep.name === 'string' && ep.name.trim() ? ep.name.trim().slice(0, 80) : `Custom Endpoint ${idx + 1}`,
      baseUrl: typeof ep.baseUrl === 'string' ? ep.baseUrl.trim().replace(/\/+$/, '') : '',
      model: typeof ep.model === 'string' ? ep.model.trim().slice(0, 160) : '',
      enabled: ep.enabled !== false,
    }))
    .filter((ep) => {
      if (!isSafeProviderBaseUrl(ep.baseUrl) || !ep.model) return false;
      if (seenEndpointIds.has(ep.id)) return false;
      seenEndpointIds.add(ep.id);
      return true;
    })
    .slice(0, 12);

  const rawFallbacks = Array.isArray(base.provider.fallbackProviders) ? base.provider.fallbackProviders : [];
  const seenFallbacks = new Set<string>();
  base.provider.fallbackProviders = rawFallbacks
    .filter((fb): fb is FallbackProviderEntry => Boolean(fb && typeof fb === 'object'))
    .map((fb) => {
      const provider: ProviderId = PROVIDER_IDS.includes(fb.provider) ? fb.provider : 'deepseek';
      const model = typeof fb.model === 'string' ? fb.model.trim().slice(0, 160) : '';
      const baseUrl = typeof fb.baseUrl === 'string' && isSafeProviderBaseUrl(fb.baseUrl)
        ? fb.baseUrl.trim().replace(/\/+$/, '')
        : undefined;
      const customEndpointId = typeof fb.customEndpointId === 'string' && fb.customEndpointId.trim()
        ? fb.customEndpointId.trim().slice(0, 64)
        : undefined;
      return {
        provider,
        model,
        ...(baseUrl ? { baseUrl } : {}),
        ...(customEndpointId ? { customEndpointId } : {}),
        enabled: fb.enabled !== false,
      };
    })
    .filter((fb) => {
      if (!fb.model) return false;
      const dedupeKey = `${fb.provider}|${fb.model.toLowerCase()}|${(fb.baseUrl ?? fb.customEndpointId ?? '').toLowerCase()}`;
      if (seenFallbacks.has(dedupeKey)) return false;
      seenFallbacks.add(dedupeKey);
      return true;
    })
    .slice(0, 8);

  base.display = {
    ...DEFAULT_SETTINGS.display,
    ...(typeof (partial as { display?: Partial<DisplayPreferences> } | undefined)?.display === 'object'
      && (partial as { display?: Partial<DisplayPreferences> } | undefined)?.display !== null
      ? (partial as { display?: Partial<DisplayPreferences> }).display
      : {}),
  };
  base.display.uiScale = Math.round(finiteWithin(base.display.uiScale, 85, 125, DEFAULT_SETTINGS.display.uiScale));
  base.display.chatTextScale = Math.round(finiteWithin(base.display.chatTextScale, 85, 130, DEFAULT_SETTINGS.display.chatTextScale));
  if (base.display.sessionDensity !== 'comfortable' && base.display.sessionDensity !== 'compact') {
    base.display.sessionDensity = DEFAULT_SETTINGS.display.sessionDensity;
  }
  base.display.reasoningCollapsed = base.display.reasoningCollapsed !== false;
  base.display.hideCodeDiffs = base.display.hideCodeDiffs === true;
  base.display.muteSounds = base.display.muteSounds === true;

  // Stage 5: Browser & Computer-Use settings clamping and validation.
  const rawBrowser = (partial as { browser?: Partial<BrowserAutomationSettings> } | undefined)?.browser;
  base.browser = {
    ...DEFAULT_SETTINGS.browser!,
    ...(rawBrowser && typeof rawBrowser === 'object' ? rawBrowser : {}),
  };
  base.browser.headless = base.browser.headless !== false;
  base.browser.cdpEndpoint = typeof base.browser.cdpEndpoint === 'string' ? base.browser.cdpEndpoint.trim().slice(0, 512) : '';
  base.browser.inactivityTimeoutSec = Math.round(finiteWithin(base.browser.inactivityTimeoutSec, 30, 3600, 300));
  base.browser.commandTimeoutSec = Math.round(finiteWithin(base.browser.commandTimeoutSec, 5, 180, 30));
  base.browser.realProfileConsent = base.browser.realProfileConsent === true;
  if (!['chrome', 'edge', 'brave', ''].includes(base.browser.selectedBrowserId)) {
    base.browser.selectedBrowserId = '';
  }
  base.browser.allowPrivateNetwork = base.browser.allowPrivateNetwork === true;
  base.browser.blockedDomains = Array.isArray(base.browser.blockedDomains)
    ? base.browser.blockedDomains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim().toLowerCase()).slice(0, 50)
    : [];
  base.browser.allowedDomains = Array.isArray(base.browser.allowedDomains)
    ? base.browser.allowedDomains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim().toLowerCase()).slice(0, 50)
    : [];

  const rawCu = (partial as { computerUse?: Partial<ComputerUseSettings> } | undefined)?.computerUse;
  base.computerUse = {
    ...DEFAULT_SETTINGS.computerUse!,
    ...(rawCu && typeof rawCu === 'object' ? rawCu : {}),
  };
  if (!['som', 'vision', 'ax'].includes(base.computerUse.captureMode)) {
    base.computerUse.captureMode = 'som';
  }
  if (!['background_first', 'ask_before_foreground'].includes(base.computerUse.interactionPolicy)) {
    base.computerUse.interactionPolicy = 'background_first';
  }
  base.computerUse.requireVerification = base.computerUse.requireVerification !== false;

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
  | 'queued'
  | 'planning'
  | 'running'
  | 'pause_requested'
  | 'awaiting_approval'
  | 'awaiting_user'
  | 'paused'
  | 'recovering'
  | 'blocked'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskExecutionScope = 'headless' | 'desktop_session';

export interface TaskLease {
  instanceId: string;
  pid: number;
  acquiredAt: number;
  expiresAt: number;
  lastHeartbeatAt: number;
}

export interface TaskFailureInfo {
  code: string;
  message: string;
  retryable: boolean;
  at: number;
}

export type RoutineScheduleKind = 'once' | 'interval' | 'daily' | 'weekly' | 'cron';
export type MissedRunPolicy = 'skip' | 'run_once' | 'catch_up_window' | 'notify_only';

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
  /** Parent task ID when this task is a delegated specialist child. */
  parentTaskId?: string;
  /** Specialist role assigned to this task, when delegated. */
  specialistId?: string;
  /** Linked scheduled routine ID, when triggered by the scheduler. */
  routineId?: string;
  /** Headless tasks may continue while minimized; desktop_session tasks pause on lock/session loss. */
  executionScope?: TaskExecutionScope;
  /** Durable execution lease & heartbeat metadata. */
  lease?: TaskLease;
  /** Number of execution attempts made for this task. */
  attemptCount?: number;
  /** Maximum permitted attempts under the task's retry policy. */
  maxAttempts?: number;
  /** Structured failure metadata when a task fails or stalls. */
  failure?: TaskFailureInfo;
  /** Optional idempotency key for safe crash reconciliation. */
  idempotencyKey?: string;
  /** True when startup recovery determined the task is safe to resume (read-only / idempotent). */
  safeToResume?: boolean;
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
  /** Names only; saved values stay in the main process. */
  inputNames: string[];
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

export const RISK_LEVELS = ['safe', 'low', 'medium', 'high', 'critical'] as const;
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
  | 'files'
  | 'documents'
  | 'productivity'
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
  /** Live dependency state when it can be checked without starting a service. */
  availability?: 'ready' | 'conditional' | 'unavailable' | 'not_checked';
  dependency?: string;
  availabilityReason?: string;
}

export interface ProceduralSkillView {
  id: string;
  projectId: string;
  name: string;
  version: number;
  status: 'draft' | 'active' | 'disabled';
  pinned: boolean;
  description: string;
  markdown: string;
  source: string;
  scanStatus: 'clean' | 'warning' | 'blocked';
  scanFindings: Array<{ severity: 'high' | 'medium'; rule: string; message: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface McpServerSummaryView {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string[];
  url?: string;
  trustTier: 'bundled' | 'external_untrusted';
  enabled: boolean;
  allowedProjects: string[];
  status: 'disconnected' | 'connecting' | 'connected' | 'degraded' | 'disabled' | 'auth_required' | 'error';
  protocolVersion?: string;
  toolCount: number;
  tools: string[];
  lastHealthAt?: number;
  lastError?: string;
}

export interface GoogleCalendarConnectionStatus {
  connected: boolean;
  encryptionAvailable: boolean;
  oauthClientConfigured: boolean;
  scopes?: string[];
  expiresAt?: number;
  error?: string;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  encryptionAvailable: boolean;
  login?: string;
  name?: string | null;
  scopes?: string[];
  verified?: boolean;
  error?: string;
}

export interface PluginView {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  capabilities: string[];
  permissions: string[];
  installed: boolean;
  enabled: boolean;
  connection: 'not_required' | 'disconnected' | 'connected';
  health: 'ready' | 'disabled' | 'unavailable' | 'error';
  /** Compatibility is computed against the bundled manifest, never a remote package. */
  compatibility?: 'not_installed' | 'compatible' | 'update_available' | 'unsupported_api';
  installedVersion?: string;
  updatedAt?: number;
  error?: string;
  /** Effective project-specific capability state, constrained by global enablement. */
  availableInProject?: boolean;
  /** Whether this project inherits the global setting or has a local override. */
  projectAvailability?: 'inherit' | 'enabled' | 'disabled';
  /** Reviewed non-secret settings declared by the bundled manifest. */
  settings?: PluginSettingView[];
}

export interface PluginSettingView {
  key: string;
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
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
  battery: { present: boolean | null; percent: number | null; charging: boolean | null } | null;
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
    sessions?(): Promise<Array<{
      sessionId: string;
      ownerId: string;
      mode: string;
      attachedViaCdp: boolean;
      persistentProfileDir: string | null;
      lastUsedAt: number;
    }>>;
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
    run(skillId: string, inputs: Record<string, string>): Promise<TaskRecord>;
    createDraft(draft: SkillDraftRequest): Promise<SkillRecord>;
    recordTask(taskId: string): Promise<SkillRecord>;
    activate(skillId: string): Promise<SkillRecord>;
    delete(skillId: string): Promise<boolean>;
  };
  routines: {
    list(): Promise<RoutineRecord[]>;
    create(input: { skillId: string; name: string; localTime: string; timezone: string; inputValues: Record<string, string> }): Promise<RoutineRecord>;
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
  productivity: {
    listNotes(): Promise<ProductivityNoteView[]>;
    createNote(title: string, body: string): Promise<ProductivityNoteView>;
    updateNote(id: string, patch: { title?: string; body?: string }): Promise<ProductivityNoteView | null>;
    deleteNote(id: string): Promise<boolean>;
    importMarkdown(): Promise<ProductivityNoteView | null>;
    exportMarkdown(id: string): Promise<{ ok: boolean; cancelled?: boolean; verified?: boolean }>;
    listNoteDocuments(noteId: string): Promise<ProductivityDocumentLinkView[]>;
    linkNoteDocument(noteId: string): Promise<ProductivityDocumentLinkView | null>;
    openNoteDocument(noteId: string, linkId: string): Promise<{ ok: boolean }>;
    unlinkNoteDocument(noteId: string, linkId: string): Promise<boolean>;
    listChecklists(): Promise<ProductivityChecklistView[]>;
    createChecklist(title: string): Promise<ProductivityChecklistView>;
    listTasks(): Promise<ProductivityTaskView[]>;
    createTask(title: string, description?: string, dueAt?: string, checklistId?: string): Promise<ProductivityTaskView>;
    updateTask(id: string, patch: { title?: string; description?: string; status?: ProductivityTaskView['status']; dueAt?: string | null; checklistId?: string | null }): Promise<ProductivityTaskView | null>;
  };
  documents: {
    listLibrary(): Promise<DocumentLibraryItem[]>;
    readLibraryDocument(documentId: string, startChunk?: number): Promise<DocumentLibraryRead | null>;
    openLibraryDocument(documentId: string): Promise<DocumentLibraryOpenResult>;
    openLibraryFolder(folderId: string): Promise<DocumentLibraryOpenResult>;
    indexLibraryFolder(): Promise<DocumentLibraryIndexResult>;
  };
  audit: {
    list(limit?: number): Promise<AuditEntry[]>;
  };
  tools: {
    list(): Promise<ToolCatalogEntry[]>;
  };
  plugins: {
    list(): Promise<PluginView[]>;
    install(pluginId: string): Promise<PluginView[]>;
    update(pluginId: string): Promise<PluginView[]>;
    uninstall(pluginId: string): Promise<PluginView[]>;
    setEnabled(pluginId: string, enabled: boolean): Promise<PluginView[]>;
    setProjectAvailability(pluginId: string, availability: 'inherit' | 'enabled' | 'disabled'): Promise<PluginView[]>;
    setSetting(pluginId: string, key: string, value: string): Promise<PluginView[]>;
    githubStatus?(): Promise<GitHubConnectionStatus>;
    githubConnect?(token: string): Promise<GitHubConnectionStatus>;
    githubDisconnect?(): Promise<GitHubConnectionStatus>;
    googleCalendarStatus?(): Promise<GoogleCalendarConnectionStatus>;
    googleCalendarDisconnect?(): Promise<GoogleCalendarConnectionStatus>;
  };
  mcp?: {
    list(): Promise<McpServerSummaryView[]>;
    add(input: { id: string; name: string; transport: 'stdio' | 'http'; command?: string[]; url?: string; allowedProjects?: string[] }): Promise<McpServerSummaryView>;
    enable(id: string): Promise<McpServerSummaryView>;
    disable(id: string): Promise<McpServerSummaryView>;
    setProjects(id: string, allowedProjects: string[]): Promise<McpServerSummaryView>;
    remove(id: string): Promise<boolean>;
  };
  capabilities?: {
    pluginsList(): Promise<Array<Record<string, unknown>>>;
    pluginInstall(sourceDir: string, enable?: boolean): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }>;
    pluginEnable(pluginId: string): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }>;
    pluginDisable(pluginId: string): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }>;
    pluginUninstall(pluginId: string): Promise<{ ok: boolean; uninstalled?: string; error?: string }>;
    pluginConfigure(pluginId: string, settings: Record<string, unknown>): Promise<{ ok: boolean; plugin?: Record<string, unknown>; error?: string }>;
    toolsetsList(): Promise<Array<{ id: string; name: string; category: string; description: string; enabled: boolean; toolCount: number; tools: string[] }>>;
    toolsetsSetEnabled(toolsetId: string, enabled: boolean): Promise<{ ok: boolean; toolsets?: Array<Record<string, unknown>>; error?: string }>;
    skillsHubList(): Promise<Array<Record<string, unknown>>>;
    skillsHubInstall(skillId: string): Promise<{ ok: boolean; skill?: Record<string, unknown>; error?: string }>;
    skillsHubRemove(skillId: string): Promise<{ ok: boolean; removed?: string; error?: string }>;
  };
  gateway?: {
    status(): Promise<Record<string, unknown>>;
    start(host?: string, port?: number): Promise<{ ok: boolean; running: boolean; http?: { ok: boolean; host: string; port: number } }>;
    stop(): Promise<{ ok: boolean; running: boolean }>;
    platformConfigure(platform: string, config: Record<string, unknown>, connect?: boolean): Promise<Record<string, unknown>>;
    platformDisconnect(platform: string): Promise<Record<string, unknown>>;
    pairingApprove(code: string, projectId?: string, scopes?: string[], allowGroups?: boolean): Promise<Record<string, unknown>>;
    pairingReject(code: string): Promise<Record<string, unknown>>;
    userRevoke(platform: string, accountId: string): Promise<Record<string, unknown>>;
    devicePair(deviceName: string, projectId?: string, scopes?: string[]): Promise<{ ok: boolean; device?: Record<string, unknown>; token?: string }>;
    deviceRevoke(deviceId: string): Promise<Record<string, unknown>>;
    webhookCreate(name: string, projectId?: string, eventFilters?: string[]): Promise<{ ok: boolean; route?: Record<string, unknown>; signingSecret?: string }>;
    webhookSetEnabled(routeId: string, enabled: boolean): Promise<Record<string, unknown>>;
    webhookDelete(routeId: string): Promise<Record<string, unknown>>;
    webhookHistory(limit?: number): Promise<Array<Record<string, unknown>>>;
  };
  proceduralSkills?: {
    list(): Promise<ProceduralSkillView[]>;
    createDraft(markdown: string): Promise<ProceduralSkillView>;
    activate(id: string): Promise<ProceduralSkillView>;
    disable(id: string): Promise<ProceduralSkillView>;
    setPinned(id: string, pinned: boolean): Promise<ProceduralSkillView>;
    delete(id: string): Promise<boolean>;
  };
  terminal?: {
    run(command: string, cwd?: string): Promise<{
      ok: boolean;
      session?: {
        id: string;
        command: string;
        cwd: string;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
        pid: number | null;
        exitCode: number | null;
        startedAt: number;
        endedAt: number | null;
        output: string;
      };
      error?: string;
    }>;
    openShell?(shell?: 'powershell' | 'cmd' | 'pwsh' | 'sh', cwd?: string, cols?: number, rows?: number): Promise<{
      ok: boolean;
      session?: { id: string; command: string; cwd: string; shell?: string; status: string; pid: number | null; output: string };
      error?: string;
    }>;
    write?(sessionId: string, input: string): Promise<{ ok: boolean; error?: string }>;
    resize?(sessionId: string, cols: number, rows: number): Promise<{ ok: boolean; cols?: number; rows?: number; error?: string }>;
    read?(sessionId: string, offset?: number): Promise<{ ok: boolean; output?: string; nextOffset?: number; status?: string; error?: string }>;
    close?(sessionId: string): Promise<boolean>;
    cancel(sessionId: string): Promise<boolean>;
    list(): Promise<Array<{
      id: string;
      command: string;
      cwd: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      pid: number | null;
      exitCode: number | null;
      startedAt: number;
      endedAt: number | null;
      output: string;
    }>>;
    onOutput(handler: (event: { sessionId: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void;
    onExit(handler: (event: { sessionId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; exitCode: number | null }) => void): () => void;
  };
  workspaceFs?: {
    listDir(relativePath?: string): Promise<{
      ok: boolean;
      entries: Array<{ name: string; relativePath: string; kind: 'dir' | 'file'; sizeBytes: number; modifiedAt: number }>;
      error?: string;
    }>;
    readFile(relativePath: string): Promise<{
      ok: boolean;
      relativePath: string;
      content?: string;
      truncated?: boolean;
      binary?: boolean;
      sizeBytes?: number;
      error?: string;
    }>;
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
  /** Volatile exact window identity. Used for grants confined to this Pixel run. */
  windowId?: string;
  processId?: number;
  /** Exact process and title can scope a durable screen-observation grant. */
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

export interface ProductivityNoteView { id: string; projectId: string; title: string; body: string; createdAt: number; updatedAt: number }
export interface ProductivityDocumentLinkView { id: string; noteId: string; displayName: string; byteSize: number; createdAt: number }
export interface ProductivityChecklistView { id: string; projectId: string; title: string; createdAt: number; updatedAt: number }
export interface ProductivityTaskView { id: string; projectId: string; title: string; description: string; status: 'open' | 'in_progress' | 'completed'; dueAt: number | null; checklistId: string | null; createdAt: number; updatedAt: number }
export interface DocumentLibraryItem { id: string; folderId: string; folderName: string; fileName: string; title: string; kind: string; sizeBytes: number; modifiedAt: number; indexedAt: number; chunks: number }
export interface DocumentLibraryRead { state: 'ready' | 'stale' | 'unavailable'; title: string; kind: string; startChunk: number; chunkCount: number; hasMore: boolean; passages: Array<{ ordinal: number; content: string; location: string | null }> }
export interface DocumentLibraryOpenResult { ok: boolean; content: string }
export interface DocumentLibraryIndexResult { ok: boolean; cancelled?: boolean; content: string; indexed?: number; skipped?: number; failed?: number; documents?: number; chunks?: number; cleanupSkipped?: boolean }

export interface WorkspaceWindowState {
  maximized: boolean;
  fullscreen: boolean;
}

export interface HistoryQuery {
  limit?: number;
  offset?: number;
  search?: string;
}
