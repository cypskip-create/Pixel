/**
 * OpenAI-compatible provider adapter (OpenAI, OpenRouter, Gemini OpenAI-compat,
 * xAI, Ollama, and Custom OpenAI-compatible endpoints).
 *
 * Unlike `DeepSeekProvider`, this adapter never sends DeepSeek-specific fields
 * such as `thinking: { type: 'enabled' }` to third-party endpoints.
 */

import type {
  ChatMessage,
  ModelCapabilities,
  ProviderId,
  ToolCall,
  TokenUsage,
} from '../../shared/types';
import { getProviderDescriptor } from '../../shared/types';
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
  toWireMessages,
} from './deepseek';

export interface OpenAICompatibleProviderConfig {
  providerId: ProviderId;
  apiKey?: string | null;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

function buildOpenAIEndpoint(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
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

export function buildOpenAICompatibleRequestBody(
  providerId: ProviderId,
  options: Pick<GenerateOptions, 'model' | 'messages' | 'thinking' | 'temperature' | 'maxTokens' | 'tools'>,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model.trim(),
    messages: toWireMessages(options.messages as ChatMessage[]),
    stream,
    max_tokens: options.maxTokens,
  };

  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
    body.temperature = options.temperature;
  }

  // Standard OpenAI reasoning_effort (only for providers known to accept it).
  if (
    options.thinking?.enabled &&
    options.thinking.effort !== 'none' &&
    (providerId === 'openai' || providerId === 'openrouter' || providerId === 'xai' || providerId === 'gemini')
  ) {
    body.reasoning_effort = options.thinking.effort === 'max' ? 'high' : options.thinking.effort;
  }

  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = 'auto';
  }

  return body;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    const desc = getProviderDescriptor(config.providerId);
    this.id = desc.id;
    this.label = desc.label;
  }

  listModels(): readonly ModelCapabilities[] {
    const desc = getProviderDescriptor(this.config.providerId);
    return [
      {
        id: desc.defaultModel,
        label: desc.defaultModel,
        vision: this.config.providerId === 'openai' || this.config.providerId === 'openrouter' || this.config.providerId === 'gemini',
        toolCalls: true,
        thinking: true,
        contextTokens: 128_000,
        maxOutputTokens: 16_384,
        role: 'fast',
      },
      {
        id: desc.reasoningModel,
        label: desc.reasoningModel,
        vision: false,
        toolCalls: true,
        thinking: true,
        contextTokens: 128_000,
        maxOutputTokens: 32_768,
        role: 'reasoning',
      },
    ];
  }

  private buildHeaders(apiKeyOverride?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const key = (apiKeyOverride ?? this.config.apiKey ?? '').trim();
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }
    if (this.config.providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://pixel.local';
      headers['X-Title'] = 'Pixel Desktop';
    }
    return headers;
  }

  async testConnection(apiKey: string, model: string): Promise<TestConnectionOutcome> {
    const started = Date.now();
    const doFetch = this.config.fetchImpl ?? fetch;
    const url = buildOpenAIEndpoint(this.config.baseUrl);
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          model: model.trim(),
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
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
    if (!model.trim()) {
      const err = makeError('BAD_REQUEST', 'Model identifier cannot be empty.', undefined, false);
      onEvent({ type: 'error', requestId, message: err.message, code: err.code });
      throw new ProviderError(err);
    }

    const doFetch = this.config.fetchImpl ?? fetch;
    const url = buildOpenAIEndpoint(this.config.baseUrl);
    const body = buildOpenAICompatibleRequestBody(this.config.providerId, options, true);

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs);
    const composedSignal = composeSignals(signal, timeoutController.signal);

    onEvent({ type: 'started', requestId, model: model.trim() });

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
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

    let content = '';
    let reasoning = '';
    let finishReason = 'stop';
    let usage: TokenUsage | undefined;
    const pendingTools = new Map<number, { id: string; name: string; args: string }>();

    try {
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('text/event-stream') || !response.body) {
        const json = (await response.json()) as {
          choices?: Array<{
            finish_reason?: string;
            message?: {
              content?: string;
              reasoning_content?: string;
              reasoning?: string;
              tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const msg = choice?.message;
        const r = msg?.reasoning_content ?? msg?.reasoning ?? '';
        if (r) {
          reasoning = r;
          onEvent({ type: 'reasoning', requestId, delta: r });
        }
        if (msg?.content) {
          content = msg.content;
          onEvent({ type: 'text', requestId, delta: msg.content });
        }
        for (const [idx, tc] of (msg?.tool_calls ?? []).entries()) {
          if (tc.function?.name) {
            pendingTools.set(idx, {
              id: tc.id ?? `call_${idx}`,
              name: tc.function.name,
              args: tc.function.arguments ?? '{}',
            });
          }
        }
        if (json.usage) {
          usage = {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          };
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
            if (!payload || payload === '[DONE]') continue;
            let parsed: {
              choices?: Array<{
                finish_reason?: string | null;
                delta?: {
                  content?: string;
                  reasoning_content?: string;
                  reasoning?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue;
            }
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0,
              };
            }
            const choice = parsed.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;
            const delta = choice.delta;
            if (!delta) continue;

            const r = delta.reasoning_content ?? delta.reasoning;
            if (r) {
              reasoning += r;
              onEvent({ type: 'reasoning', requestId, delta: r });
            }
            if (delta.content) {
              content += delta.content;
              onEvent({ type: 'text', requestId, delta: delta.content });
            }
            for (const tc of delta.tool_calls ?? []) {
              const idx = tc.index ?? 0;
              const slot = pendingTools.get(idx) ?? { id: `call_${idx}`, name: '', args: '' };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
              pendingTools.set(idx, slot);
            }
          }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal.aborted) {
        onEvent({ type: 'aborted', requestId, hadContent: content.length > 0 });
        return { content, reasoning, toolCalls: [], usage, finishReason: 'aborted', aborted: true };
      }
      const error = timeoutController.signal.aborted
        ? makeError('TIMEOUT', 'The stream timed out.', undefined, true)
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
