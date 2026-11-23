/**
 * Native Anthropic Messages API adapter (`POST /v1/messages`).
 *
 * Translates Pixel's provider-neutral `ChatMessage` + `ToolDefinition` contract
 * into Anthropic's native wire protocol:
 *  - `x-api-key` + `anthropic-version: 2023-06-01` headers
 *  - Top-level `system` prompt extracted from `role: 'system'` messages
 *  - `tool_use` / `tool_result` content blocks
 *  - Native extended thinking (`thinking: { type: 'enabled', budget_tokens }`)
 *  - Native Anthropic SSE parsing (`text_delta`, `thinking_delta`, `input_json_delta`)
 */

import type {
  ChatMessage,
  ModelCapabilities,
  ToolCall,
  TokenUsage,
} from '../../shared/types';
import type {
  GenerateOptions,
  GenerateResult,
  ModelProvider,
  TestConnectionOutcome,
} from './deepseek';
import {
  ProviderError,
  makeError,
  mapHttpError,
  toNetworkError,
} from './deepseek';

export const ANTHROPIC_API_VERSION = '2023-06-01';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function buildAnthropicMessagesUrl(baseUrl?: string): string {
  const clean = (baseUrl || DEFAULT_ANTHROPIC_BASE_URL).trim().replace(/\/+$/, '');
  if (clean.endsWith('/messages')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

export function buildAnthropicRequestBody(
  options: Pick<GenerateOptions, 'model' | 'messages' | 'thinking' | 'temperature' | 'maxTokens' | 'tools'>,
  stream: boolean,
): Record<string, unknown> {
  const systemParts: string[] = [];
  const wireMessages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

  for (const msg of options.messages as ChatMessage[]) {
    if (msg.role === 'system') {
      if (msg.content.trim()) systemParts.push(msg.content.trim());
      continue;
    }

    if (msg.role === 'tool') {
      wireMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? 'tool_call',
            content: msg.content,
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.toolCalls ?? []) {
        let parsedInput: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.argumentsJson || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedInput = parsed as Record<string, unknown>;
          }
        } catch {
          parsedInput = {};
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: parsedInput,
        });
      }
      wireMessages.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
      });
      continue;
    }

    // User message (with optional image attachments)
    if (msg.images?.length) {
      const blocks: Array<Record<string, unknown>> = [];
      for (const img of msg.images) {
        const match = /^data:([^;]+);base64,(.+)$/.exec(img.dataUrl);
        if (match) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] },
          });
        }
      }
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      wireMessages.push({ role: 'user', content: blocks });
    } else {
      wireMessages.push({ role: 'user', content: msg.content });
    }
  }

  const maxTokens = Math.max(128, Math.min(options.maxTokens, 64_000));
  const body: Record<string, unknown> = {
    model: options.model.trim(),
    max_tokens: maxTokens,
    messages: wireMessages,
    stream,
  };

  if (systemParts.length > 0) {
    body.system = systemParts.join('\n\n');
  }

  if (options.thinking?.enabled && options.thinking.effort !== 'none' && maxTokens >= 2048) {
    const budgetByEffort: Record<string, number> = {
      low: 1024,
      high: 4096,
      max: 8192,
    };
    const budget = Math.min(budgetByEffort[options.thinking.effort] ?? 2048, maxTokens - 256);
    if (budget >= 1024) {
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }
  } else if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
    body.temperature = Math.min(1, Math.max(0, options.temperature));
  }

  if (options.tools?.length) {
    body.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  return body;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic';

  constructor(private readonly config: AnthropicProviderConfig) {}

  listModels(): readonly ModelCapabilities[] {
    return [
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        vision: true,
        toolCalls: true,
        thinking: true,
        contextTokens: 200_000,
        maxOutputTokens: 64_000,
        role: 'fast',
      },
      {
        id: 'claude-opus-4-20250514',
        label: 'Claude Opus 4',
        vision: true,
        toolCalls: true,
        thinking: true,
        contextTokens: 200_000,
        maxOutputTokens: 32_000,
        role: 'reasoning',
      },
    ];
  }

  private headers(apiKeyOverride?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': (apiKeyOverride ?? this.config.apiKey).trim(),
      'anthropic-version': ANTHROPIC_API_VERSION,
    };
  }

  async testConnection(apiKey: string, model: string): Promise<TestConnectionOutcome> {
    const started = Date.now();
    const doFetch = this.config.fetchImpl ?? fetch;
    const url = buildAnthropicMessagesUrl(this.config.baseUrl);
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model: model.trim(),
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, error: mapHttpError(response.status, text) };
      }
      return { ok: true, model: model.trim(), latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: toNetworkError(err) };
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { model, onEvent, requestId, signal } = options;
    const doFetch = this.config.fetchImpl ?? fetch;
    const url = buildAnthropicMessagesUrl(this.config.baseUrl);
    const body = buildAnthropicRequestBody(options, true);

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs);
    const composedSignal = composeSignals(signal, timeoutController.signal);

    onEvent({ type: 'started', requestId, model: model.trim() });

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: composedSignal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const error = timeoutController.signal.aborted
        ? makeError('TIMEOUT', 'The Anthropic request timed out.', undefined, true)
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

    let content = '';
    let reasoning = '';
    let finishReason = 'stop';
    let promptTokens = 0;
    let completionTokens = 0;
    const pendingTools = new Map<number, { id: string; name: string; args: string }>();

    try {
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('text/event-stream') || !response.body) {
        const json = (await response.json()) as {
          stop_reason?: string;
          content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (json.stop_reason) finishReason = json.stop_reason;
        promptTokens = json.usage?.input_tokens ?? 0;
        completionTokens = json.usage?.output_tokens ?? 0;
        for (const [idx, block] of (json.content ?? []).entries()) {
          if (block.type === 'thinking' && block.thinking) {
            reasoning += block.thinking;
            onEvent({ type: 'reasoning', requestId, delta: block.thinking });
          } else if (block.type === 'text' && block.text) {
            content += block.text;
            onEvent({ type: 'text', requestId, delta: block.text });
          } else if (block.type === 'tool_use' && block.name) {
            pendingTools.set(idx, {
              id: block.id ?? `toolu_${idx}`,
              name: block.name,
              args: JSON.stringify(block.input ?? {}),
            });
          }
        }
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt: {
              type?: string;
              index?: number;
              message?: { usage?: { input_tokens?: number } };
              content_block?: { type?: string; id?: string; name?: string };
              delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
              usage?: { output_tokens?: number };
            };
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }

            if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
              promptTokens = evt.message.usage.input_tokens;
            } else if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
              const idx = evt.index ?? pendingTools.size;
              pendingTools.set(idx, {
                id: evt.content_block.id ?? `toolu_${idx}`,
                name: evt.content_block.name ?? '',
                args: '',
              });
            } else if (evt.type === 'content_block_delta' && evt.delta) {
              if (evt.delta.type === 'text_delta' && evt.delta.text) {
                content += evt.delta.text;
                onEvent({ type: 'text', requestId, delta: evt.delta.text });
              } else if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                reasoning += evt.delta.thinking;
                onEvent({ type: 'reasoning', requestId, delta: evt.delta.thinking });
              } else if (evt.delta.type === 'input_json_delta' && evt.delta.partial_json) {
                const idx = evt.index ?? 0;
                const slot = pendingTools.get(idx);
                if (slot) slot.args += evt.delta.partial_json;
              }
            } else if (evt.type === 'message_delta') {
              if (evt.delta?.stop_reason) finishReason = evt.delta.stop_reason;
              if (evt.usage?.output_tokens) completionTokens = evt.usage.output_tokens;
            }
          }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal.aborted) {
        onEvent({ type: 'aborted', requestId, hadContent: content.length > 0 });
        return { content, reasoning, toolCalls: [], finishReason: 'aborted', aborted: true };
      }
      const error = timeoutController.signal.aborted
        ? makeError('TIMEOUT', 'The Anthropic stream timed out.', undefined, true)
        : toNetworkError(err);
      onEvent({ type: 'error', requestId, message: error.message, code: error.code });
      throw new ProviderError(error);
    } finally {
      clearTimeout(timeoutId);
    }

    const toolCalls: ToolCall[] = [...pendingTools.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, slot]) => Boolean(slot.name))
      .map(([, slot]) => ({
        id: slot.id,
        name: slot.name,
        argumentsJson: slot.args || '{}',
      }));

    const usage: TokenUsage | undefined =
      promptTokens > 0 || completionTokens > 0
        ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
        : undefined;

    if (toolCalls.length > 0) {
      onEvent({ type: 'tool_calls', requestId, toolCalls });
    }
    if (usage) {
      onEvent({ type: 'usage', requestId, usage });
    }
    onEvent({ type: 'done', requestId, finishReason });

    return { content, reasoning, toolCalls, usage, finishReason, aborted: false };
  }
}
