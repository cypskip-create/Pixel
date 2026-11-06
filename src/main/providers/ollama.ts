/**
 * Ollama provider: optional local inference.
 *
 * Local models are a fallback, not the default. Everything here is capability-
 * gated: a model is only reported as able to do something when Ollama says so,
 * because most small local models cannot take images, call tools, or stream
 * structured output.
 *
 * Nothing is ever downloaded automatically. A missing model produces an accurate
 * message naming the command the user can run.
 */

import type { ModelCapabilities, TokenUsage } from '../../shared/types';
import type { GenerateOptions, GenerateResult, ModelProvider, TestConnectionOutcome } from './deepseek';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export interface OllamaModel {
  name: string;
  sizeBytes: number;
  family: string;
  parameterSize: string;
  /** Declared capabilities from /api/show, when available. */
  capabilities: { vision: boolean; tools: boolean };
}

export interface OllamaStatus {
  available: boolean;
  version?: string;
  url: string;
  reason?: string;
  models: OllamaModel[];
}

export interface OllamaOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Local context window we assume when the server does not say. */
const DEFAULT_CONTEXT = 8_192;

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama';
  readonly label = 'Ollama (local)';

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.PIXEL_OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(
      /\/$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Ask the local server what it has. Never throws. */
  async status(): Promise<OllamaStatus> {
    try {
      const response = await this.get('/api/tags');
      if (!response.ok) {
        return {
          available: false,
          url: this.baseUrl,
          reason: `Ollama answered HTTP ${String(response.status)}.`,
          models: [],
        };
      }

      const payload = (await response.json()) as {
        models?: Array<{
          name?: string;
          size?: number;
          details?: { family?: string; parameter_size?: string };
        }>;
      };

      const models: OllamaModel[] = [];
      for (const entry of payload.models ?? []) {
        const name = entry.name ?? '';
        if (name.length === 0) continue;
        models.push({
          name,
          sizeBytes: entry.size ?? 0,
          family: entry.details?.family ?? 'unknown',
          parameterSize: entry.details?.parameter_size ?? '',
          capabilities: await this.modelCapabilities(name),
        });
      }

      return { available: true, url: this.baseUrl, models };
    } catch (error) {
      return {
        available: false,
        url: this.baseUrl,
        reason:
          error instanceof Error
            ? `Ollama is not reachable at ${this.baseUrl}: ${error.message}`
            : `Ollama is not reachable at ${this.baseUrl}.`,
        models: [],
      };
    }
  }

  /** Which installed models can see images or call tools. */
  async modelCapabilities(name: string): Promise<{ vision: boolean; tools: boolean }> {
    try {
      const response = await this.post('/api/show', { name });
      if (!response.ok) return { vision: false, tools: false };
      const payload = (await response.json()) as {
        capabilities?: string[];
        model_info?: Record<string, unknown>;
      };
      const declared = new Set(payload.capabilities ?? []);
      return {
        vision: declared.has('vision') || declared.has('image'),
        tools: declared.has('tools') || declared.has('tool_calls'),
      };
    } catch {
      // Unknown capability is treated as absent: fail closed.
      return { vision: false, tools: false };
    }
  }

  listModels(): readonly ModelCapabilities[] {
    // Synchronous interface, so this reports the shapes it supports rather than
    // waiting on the server. The UI uses status() for the live list.
    return [
      {
        id: 'local',
        label: 'Local model',
        vision: false,
        toolCalls: false,
        thinking: false,
        contextTokens: DEFAULT_CONTEXT,
        maxOutputTokens: 2_048,
        role: 'fast',
      },
    ];
  }

  async testConnection(_apiKey: string, _model: string): Promise<TestConnectionOutcome> {
    const status = await this.status();
    if (!status.available) return { ok: false, error: { code: 'NETWORK', message: status.reason ?? 'Ollama is not running.', retryable: true } };
    return {
      ok: status.models.length > 0,
      latencyMs: 0,
      ...(status.models[0] ? { model: status.models[0].name } : {}),
      ...(status.models.length === 0
        ? {
            error: {
              code: 'MODEL_CAPABILITY' as const,
              message: 'Ollama is running but has no models installed. Pull one first, for example: ollama pull llama3.2',
              retryable: false,
            },
          }
        : {}),
    };
  }

  /**
   * Generate a completion. Ollama streams newline-delimited JSON; `onEvent`
   * receives the same event shapes the rest of the app uses.
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const capabilities = await this.modelCapabilities(options.model);
    const messages = options.messages
      .filter((message) => message.role !== 'tool')
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const response = await this.post('/api/chat', {
      model: options.model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
      // Tool calling is only offered when the model declares it.
      ...(capabilities.tools && options.tools && options.tools.length > 0
        ? { tools: options.tools }
        : {}),
    });

    if (!response.ok || !response.body) {
      const detail = await safeText(response);
      throw {
        code: this.codeForStatus(response.status),
        message: detail.length > 0 ? detail : `Ollama returned HTTP ${String(response.status)}.`,
        retryable: response.status >= 500,
      };
    }

    let content = '';
    let reasoning = '';
    let finishReason = 'stop';
    let usage: TokenUsage | undefined;

    options.onEvent({ type: 'started', requestId: options.requestId, model: options.model });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (options.signal.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          const frame = safeParse(line);
          const delta = typeof frame?.message?.content === 'string' ? frame.message.content : '';
          if (delta.length > 0) {
            content += delta;
            options.onEvent({ type: 'text', requestId: options.requestId, delta });
          }
          const thinking =
            typeof frame?.message?.thinking === 'string' ? frame.message.thinking : '';
          if (thinking.length > 0) {
            reasoning += thinking;
            options.onEvent({ type: 'reasoning', requestId: options.requestId, delta: thinking });
          }
          if (frame?.done === true) {
            finishReason = typeof frame.done_reason === 'string' ? frame.done_reason : 'stop';
            usage = {
              promptTokens: Number(frame.prompt_eval_count ?? 0),
              completionTokens: Number(frame.eval_count ?? 0),
              totalTokens:
                Number(frame.prompt_eval_count ?? 0) + Number(frame.eval_count ?? 0),
            };
            options.onEvent({ type: 'usage', requestId: options.requestId, usage });
          }
        }
        newline = buffer.indexOf('\n');
      }
    }

    options.onEvent({ type: 'done', requestId: options.requestId, finishReason });

    return {
      content,
      reasoning,
      toolCalls: [],
      finishReason,
      aborted: options.signal.aborted,
      ...(usage ? { usage } : {}),
    };
  }

  /* ------------------------------ helpers ----------------------------- */

  private async get(path: string): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private codeForStatus(status: number): 'NETWORK' | 'SERVER' | 'MODEL_CAPABILITY' | 'BAD_REQUEST' {
    if (status === 404) return 'MODEL_CAPABILITY';
    if (status >= 500) return 'SERVER';
    if (status >= 400) return 'BAD_REQUEST';
    return 'NETWORK';
  }
}

function safeParse(line: string): {
  message?: { content?: unknown; thinking?: unknown };
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
} | null {
  try {
    return JSON.parse(line) as ReturnType<typeof safeParse>;
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** Rough recommendation based on installed RAM, without downloading anything. */
export function recommendLocalModel(totalMemoryGb: number): { model: string; reason: string } {
  if (totalMemoryGb >= 32) {
    return { model: 'llama3.1:8b', reason: '8B parameters fits comfortably in 32 GB of RAM.' };
  }
  if (totalMemoryGb >= 16) {
    return { model: 'llama3.2:3b', reason: '3B parameters keeps memory use modest on a 16 GB machine.' };
  }
  return {
    model: 'qwen2.5:0.5b',
    reason: 'Under 16 GB of RAM, a very small model is the only sensible default.',
  };
}
