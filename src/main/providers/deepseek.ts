/**
 * DeepSeek API adapter.
 *
 * Provider-neutral surface: `ModelProvider` is the interface Cyps codes
 * against. DeepSeek is the only implementation today; adding OpenAI, Anthropic,
 * or a local Ollama provider later means adding an implementation, not
 * rewriting the agent.
 *
 * All factual claims about the API in this file were verified against the
 * official docs — see docs/DEEPSEEK-API.md. Do not add speculative fields.
 */

import type {
  ChatMessage,
  CypsError,
  CypsErrorCode,
  ModelCapabilities,
  StreamEvent,
  ThinkingConfig,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../../shared/types';
import {
  getModelCapabilities,
  modelSupportsVision,
  normalizeModelName,
  VISION_MODEL,
} from '../../shared/types';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/* ------------------------------------------------------------------ *
 * Provider interface
 * ------------------------------------------------------------------ */

export interface GenerateOptions {
  model: string;
  messages: ChatMessage[];
  thinking: ThinkingConfig;
  temperature: number;
  maxTokens: number;
  tools?: ToolDefinition[];
  signal: AbortSignal;
  timeoutMs: number;
  /** Emits incremental events to the UI. */
  onEvent: (event: StreamEvent) => void;
  requestId: string;
}

export interface GenerateResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  finishReason: string;
  aborted: boolean;
}

export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  listModels(): readonly ModelCapabilities[];
  generate(options: GenerateOptions): Promise<GenerateResult>;
  testConnection(apiKey: string, model: string): Promise<TestConnectionOutcome>;
}

export interface TestConnectionOutcome {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: CypsError;
}

/* ------------------------------------------------------------------ *
 * Error mapping
 * ------------------------------------------------------------------ */

export function makeError(
  code: CypsErrorCode,
  message: string,
  hint?: string,
  retryable = false,
): CypsError {
  return { code, message, hint, retryable };
}

/**
 * Map an HTTP status and body to a user-facing error.
 * 400 handling is special-cased for the vision restriction, which is the
 * single most likely misconfiguration given the spec's original ambiguity.
 */
export function mapHttpError(status: number, bodyText: string): CypsError {
  let apiMessage = '';
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    apiMessage = parsed.error?.message ?? '';
  } catch {
    apiMessage = bodyText.slice(0, 300);
  }

  switch (status) {
    case 400:
      if (/image|vision|modality/i.test(apiMessage)) {
        return makeError(
          'MODEL_CAPABILITY',
          `The selected model cannot process images: ${apiMessage}`,
          `Switch the primary model to "${VISION_MODEL}", which is the only DeepSeek model that accepts image input.`,
          false,
        );
      }
      return makeError('BAD_REQUEST', apiMessage || 'The request was rejected.', undefined, false);
    case 401:
      return makeError(
        'UNAUTHORIZED',
        'The DeepSeek API key was rejected.',
        'Check the key in Settings — it may be expired or mistyped.',
        false,
      );
    case 402:
      return makeError(
        'INSUFFICIENT_BALANCE',
        'The DeepSeek account has insufficient balance.',
        'Top up the account balance to continue.',
        false,
      );
    case 429:
      return makeError(
        'RATE_LIMITED',
        'Too many requests were sent to DeepSeek.',
        'Wait a moment and try again — Cyps will back off automatically.',
        true,
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return makeError(
        'SERVER',
        `DeepSeek reported a server error (${status}).`,
        'This is usually temporary. Try again shortly.',
        true,
      );
    default:
      return makeError(
        'UNKNOWN',
        apiMessage || `Unexpected response from DeepSeek (HTTP ${status}).`,
        undefined,
        status >= 500,
      );
  }
}

/* ------------------------------------------------------------------ *
 * Request building
 * ------------------------------------------------------------------ */

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

/**
 * Convert internal messages to the wire format.
 *
 * Images are only ever attached to `user` messages, because the API rejects
 * images in `system` or `assistant` messages with HTTP 400.
 */
export function toWireMessages(messages: ChatMessage[]): WireMessage[] {
  return messages.map((m) => {
    const hasImages = m.images && m.images.length > 0;

    if (hasImages && m.role === 'user') {
      const parts: ContentPart[] = [];
      if (m.content.trim()) parts.push({ type: 'text', text: m.content });
      for (const img of m.images!) {
        parts.push({
          type: 'image_url',
          // `original` preserves detail, which matters for reading UI text.
          image_url: { url: img.dataUrl, detail: 'original' },
        });
      }
      return { role: 'user', content: parts };
    }

    const wire: WireMessage = { role: m.role, content: m.content };
    if (m.role === 'tool' && m.toolCallId) wire.tool_call_id = m.toolCallId;
    if (m.role === 'assistant' && m.toolCalls?.length) {
      wire.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      }));
    }
    return wire;
  });
}

export interface BuildRequestBodyInput {
  model: string;
  messages: ChatMessage[];
  thinking: ThinkingConfig;
  temperature: number;
  maxTokens: number;
  tools?: ToolDefinition[];
  stream: boolean;
}

export interface ValidationFailure {
  ok: false;
  error: CypsError;
}

/**
 * Validate a request locally before spending a network round-trip.
 * Failing here produces a clear message instead of an opaque HTTP 400.
 */
export function validateRequest(input: BuildRequestBodyInput): ValidationFailure | { ok: true } {
  const caps = getModelCapabilities(input.model);
  if (!caps) {
    return {
      ok: false,
      error: makeError(
        'MODEL_CAPABILITY',
        `Unknown model "${input.model}".`,
        'Choose deepseek-flash or deepseek-v4-pro in Settings.',
        false,
      ),
    };
  }

  const hasImages = input.messages.some(
    (m) => m.role === 'user' && m.images && m.images.length > 0,
  );
  if (hasImages && !modelSupportsVision(input.model)) {
    return {
      ok: false,
      error: makeError(
        'MODEL_CAPABILITY',
        `${caps.label} does not accept images.`,
        `Cyps will use "${VISION_MODEL}" for screen analysis, since it is the only vision-capable DeepSeek model.`,
        false,
      ),
    };
  }

  if (hasImages) {
    for (const m of input.messages) {
      if ((m.role === 'system' || m.role === 'assistant') && m.images?.length) {
        return {
          ok: false,
          error: makeError(
            'BAD_REQUEST',
            'Images may only appear in user messages.',
            undefined,
            false,
          ),
        };
      }
    }
  }

  if (input.maxTokens < 1 || input.maxTokens > 393_216) {
    return {
      ok: false,
      error: makeError(
        'BAD_REQUEST',
        `max_tokens must be between 1 and 393216 (got ${input.maxTokens}).`,
        undefined,
        false,
      ),
    };
  }

  // tool_choice "required"/named is unsupported in thinking mode; Cyps uses
  // "auto", which is always safe, so nothing to check here. Documented so the
  // constraint is not silently forgotten when tool forces are added later.
  return { ok: true };
}

export function buildRequestBody(input: BuildRequestBodyInput): Record<string, unknown> {
  const model = normalizeModelName(input.model);

  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(input.messages),
    stream: input.stream,
    // `thinking` takes precedence over reasoning_effort when both are present.
    thinking: { type: input.thinking.enabled ? 'enabled' : 'disabled' },
    max_tokens: input.maxTokens,
  };

  // Temperature has no effect in thinking mode, so omit it there rather than
  // sending a field that is silently ignored.
  if (!input.thinking.enabled) {
    body.temperature = input.temperature;
  } else {
    body.reasoning_effort = input.thinking.effort;
  }

  if (input.stream) {
    body.stream_options = { include_usage: true };
  }

  if (input.tools?.length) {
    body.tools = input.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  return body;
}

/* ------------------------------------------------------------------ *
 * SSE parsing
 * ------------------------------------------------------------------ */

export interface ParsedChunk {
  contentDelta?: string;
  reasoningDelta?: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
}

/** Accumulator that reassembles streamed tool-call fragments. */
export class ToolCallAccumulator {
  private readonly byIndex = new Map<number, { id: string; name: string; args: string }>();

  push(deltas: Array<{ index: number; id?: string; name?: string; arguments?: string }>): void {
    for (const d of deltas) {
      const existing = this.byIndex.get(d.index) ?? { id: '', name: '', args: '' };
      if (d.id) existing.id = d.id;
      if (d.name) existing.name = d.name;
      if (d.arguments) existing.args += d.arguments;
      this.byIndex.set(d.index, existing);
    }
  }

  result(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, v]) => v.name)
      .map(([, v]) => ({
        id: v.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: v.name,
        argumentsJson: v.args || '{}',
      }));
  }

  get size(): number {
    return this.byIndex.size;
  }
}

function parseUsage(raw: Record<string, unknown>): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const details = raw.completion_tokens_details as Record<string, unknown> | undefined;
  return {
    promptTokens: num(raw.prompt_tokens),
    completionTokens: num(raw.completion_tokens),
    totalTokens: num(raw.total_tokens),
    reasoningTokens: details ? num(details.reasoning_tokens) : undefined,
    cacheHitTokens: num(raw.prompt_cache_hit_tokens),
    cacheMissTokens: num(raw.prompt_cache_miss_tokens),
  };
}

/**
 * Parse one SSE `data:` payload into deltas.
 * Returns null for `[DONE]` and unparseable noise (keep-alives, blanks).
 */
export function parseSseChunk(data: string): ParsedChunk | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === '[DONE]') return null;

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const out: ParsedChunk = {};
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;

    if (delta) {
      if (typeof delta.content === 'string' && delta.content) out.contentDelta = delta.content;
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        out.reasoningDelta = delta.reasoning_content;
      }
      const rawToolCalls = delta.tool_calls as
        | Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>
        | undefined;
      if (Array.isArray(rawToolCalls) && rawToolCalls.length) {
        out.toolCalls = rawToolCalls.map((tc, i) => ({
          id: tc.id ?? '',
          name: tc.function?.name ?? '',
          argumentsJson: tc.function?.arguments ?? '',
          // index is carried through the id field slot below by the caller
          ...(typeof tc.index === 'number' ? {} : {}),
          ...(i >= 0 ? {} : {}),
        }));
        // Preserve index for the accumulator via a side channel property.
        (out as ParsedChunk & { toolCallIndexes?: number[] }).toolCallIndexes = rawToolCalls.map(
          (tc, i) => tc.index ?? i,
        );
      }
    }

    if (typeof choice.finish_reason === 'string') out.finishReason = choice.finish_reason;
  }

  if (json.usage) out.usage = parseUsage(json.usage as Record<string, unknown>);
  return out;
}

/* ------------------------------------------------------------------ *
 * DeepSeek provider
 * ------------------------------------------------------------------ */

export interface DeepSeekProviderConfig {
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek';
  readonly label = 'DeepSeek';

  constructor(private readonly config: DeepSeekProviderConfig) {}

  listModels(): readonly ModelCapabilities[] {
    return [
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
    ];
  }

  async testConnection(apiKey: string, model: string): Promise<TestConnectionOutcome> {
    const started = Date.now();
    const doFetch = this.config.fetchImpl ?? fetch;
    try {
      const response = await doFetch(`${this.config.baseUrl ?? DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: normalizeModelName(model),
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          thinking: { type: 'disabled' },
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, error: mapHttpError(response.status, text) };
      }
      return { ok: true, model: normalizeModelName(model), latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: toNetworkError(err) };
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { model, messages, onEvent, requestId, signal } = options;

    const validation = validateRequest({
      model,
      messages,
      thinking: options.thinking,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools: options.tools,
      stream: true,
    });
    if (!validation.ok) {
      onEvent({ type: 'error', requestId, message: validation.error.message, code: validation.error.code });
      throw new ProviderError(validation.error);
    }

    const effectiveModel = normalizeModelName(model);
    const body = buildRequestBody({ ...options, model: effectiveModel, stream: true });
    const doFetch = this.config.fetchImpl ?? fetch;

    // Compose caller cancellation with the request timeout.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs);
    const composedSignal = composeSignals(signal, timeoutController.signal);

    onEvent({ type: 'started', requestId, model: effectiveModel });

    let response: Response;
    try {
      response = await doFetch(`${this.config.baseUrl ?? DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: composedSignal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const error = timeoutController.signal.aborted
        ? makeError('TIMEOUT', 'The request timed out.', 'Try again, or raise the timeout in Settings.', true)
        : signal.aborted
          ? makeError('ABORTED', 'Generation was stopped.', undefined, false)
          : toNetworkError(err);
      onEvent({ type: 'error', requestId, message: error.message, code: error.code });
      throw new ProviderError(error);
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      const text = await response.text().catch(() => '');
      const error = mapHttpError(response.status, text);
      onEvent({ type: 'error', requestId, message: error.message, code: error.code });
      throw new ProviderError(error);
    }

    if (!response.body) {
      clearTimeout(timeoutId);
      const error = makeError('NETWORK', 'DeepSeek returned an empty response body.', undefined, true);
      onEvent({ type: 'error', requestId, message: error.message, code: error.code });
      throw new ProviderError(error);
    }

    const accumulator = new ToolCallAccumulator();
    let content = '';
    let reasoning = '';
    let usage: TokenUsage | undefined;
    let finishReason = 'stop';
    let aborted = false;

    try {
      for await (const payload of iterateSse(response.body, composedSignal)) {
        const chunk = parseSseChunk(payload);
        if (!chunk) continue;

        if (chunk.reasoningDelta) {
          reasoning += chunk.reasoningDelta;
          onEvent({ type: 'reasoning', requestId, delta: chunk.reasoningDelta });
        }
        if (chunk.contentDelta) {
          content += chunk.contentDelta;
          onEvent({ type: 'text', requestId, delta: chunk.contentDelta });
        }
        if (chunk.toolCalls?.length) {
          const indexes = (chunk as ParsedChunk & { toolCallIndexes?: number[] }).toolCallIndexes;
          accumulator.push(
            chunk.toolCalls.map((tc, i) => ({
              index: indexes?.[i] ?? i,
              id: tc.id || undefined,
              name: tc.name || undefined,
              arguments: tc.argumentsJson || undefined,
            })),
          );
        }
        if (chunk.usage) usage = chunk.usage;
        if (chunk.finishReason) finishReason = chunk.finishReason;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (isAbortError(err)) {
        aborted = true;
        onEvent({ type: 'aborted', requestId, hadContent: content.length > 0 });
        return { content, reasoning, toolCalls: accumulator.result(), usage, finishReason: 'aborted', aborted: true };
      }
      const error = toNetworkError(err);
      onEvent({ type: 'error', requestId, message: error.message, code: error.code });
      throw new ProviderError(error);
    }

    clearTimeout(timeoutId);

    const toolCalls = accumulator.result();
    if (toolCalls.length) onEvent({ type: 'tool_calls', requestId, toolCalls });
    if (usage) onEvent({ type: 'usage', requestId, usage });
    onEvent({ type: 'done', requestId, finishReason });

    return { content, reasoning, toolCalls, usage, finishReason, aborted };
  }
}

export class ProviderError extends Error {
  constructor(readonly cypsError: CypsError) {
    super(cypsError.message);
    this.name = 'ProviderError';
  }
}

export function toNetworkError(err: unknown): CypsError {
  if (isAbortError(err)) {
    return makeError('ABORTED', 'The request was cancelled.', undefined, false);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network|socket/i.test(message)) {
    return makeError(
      'NETWORK',
      'Could not reach api.deepseek.com.',
      'Check the internet connection, proxy, or firewall.',
      true,
    );
  }
  return makeError('UNKNOWN', message, undefined, true);
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || /aborted|abort/i.test(err.message))
  );
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (a.aborted || b.aborted) controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

/**
 * Turn a byte stream of SSE into individual `data:` payloads.
 * Handles chunk boundaries splitting an event, and multi-line data fields.
 */
export async function* iterateSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = extractDataPayload(rawEvent);
        if (payload !== null) yield payload;
        boundary = buffer.indexOf('\n\n');
      }
    }
    // Flush any trailing event with no terminating blank line.
    const payload = extractDataPayload(buffer);
    if (payload !== null) yield payload;
  } finally {
    reader.releaseLock();
  }
}

function extractDataPayload(rawEvent: string): string | null {
  const lines = rawEvent.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  return dataLines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Model selection
 * ------------------------------------------------------------------ */

/**
 * Pick the model for a request. Screen analysis must go to a vision-capable
 * model, and that requirement outranks the user's reasoning-model preference.
 */
export function selectModel(input: {
  hasImages: boolean;
  primaryModel: string;
  reasoningModel: string;
  preferReasoning: boolean;
}): { model: string; switchedForVision: boolean } {
  if (input.hasImages) {
    if (modelSupportsVision(input.primaryModel)) {
      return { model: normalizeModelName(input.primaryModel), switchedForVision: false };
    }
    return { model: VISION_MODEL, switchedForVision: true };
  }

  const chosen = input.preferReasoning ? input.reasoningModel : input.primaryModel;
  return { model: normalizeModelName(chosen), switchedForVision: false };
}

/** Rough token estimate used only for context-budget warnings, never billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Per-message context cost. Images are billed as a flat ~1024 tokens each. */
function messageCost(m: ChatMessage): number {
  return estimateTokens(m.content) + (m.images?.length ? 1024 * m.images.length : 0);
}

/**
 * Trim history to fit the context window.
 *
 * Invariants:
 *  - the system prompt is always retained;
 *  - the newest non-system turn is always retained, even if it alone exceeds
 *    the budget (dropping the turn the user just typed would be worse than
 *    sending an over-budget request, and the API's real limit is 1M tokens);
 *  - trimming works backwards, so recent context wins over old context.
 */
export function trimHistory(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (messages.length === 0) return messages;

  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  if (rest.length === 0) return messages;

  const systemCost = system.reduce((sum, m) => sum + messageCost(m), 0);
  const total = systemCost + rest.reduce((sum, m) => sum + messageCost(m), 0);
  if (total <= maxTokens) return messages;

  const budget = Math.max(0, maxTokens - systemCost);

  // Always keep the newest turn, then add older turns while they fit.
  const newest = rest[rest.length - 1];
  const kept: ChatMessage[] = [newest];
  let used = messageCost(newest);

  for (let i = rest.length - 2; i >= 0; i--) {
    const cost = messageCost(rest[i]);
    // `continue` rather than `break`: one oversized old turn should not
    // discard every older-but-smaller turn behind it.
    if (used + cost > budget) continue;
    used += cost;
    kept.unshift(rest[i]);
  }

  return [...system, ...kept];
}
