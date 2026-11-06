/**
 * DeepSeek adapter tests.
 *
 * These exercise the pure logic — request building, SSE parsing, error mapping,
 * capability gating and model selection — with a fake fetch so no network or
 * API key is required. They are the correctness proof for Wave 1C.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DeepSeekProvider,
  ToolCallAccumulator,
  buildRequestBody,
  estimateTokens,
  mapHttpError,
  parseSseChunk,
  selectModel,
  toWireMessages,
  trimHistory,
  validateRequest,
  iterateSse,
} from '../src/main/providers/deepseek';
import type { ChatMessage } from '../src/shared/types';
import { DEFAULT_THINKING, modelSupportsVision, normalizeModelName } from '../src/shared/types';

function userMessage(content: string): ChatMessage {
  return { id: 'm1', role: 'user', content, createdAt: 0 };
}

describe('model capabilities', () => {
  it('knows only deepseek-flash supports vision', () => {
    expect(modelSupportsVision('deepseek-flash')).toBe(true);
    expect(modelSupportsVision('deepseek-v4-pro')).toBe(false);
  });

  it('fails closed for unknown models', () => {
    expect(modelSupportsVision('gpt-9000')).toBe(false);
    expect(modelSupportsVision('')).toBe(false);
  });

  it('normalizes retired model names', () => {
    expect(normalizeModelName('deepseek-v4-flash')).toBe('deepseek-flash');
    expect(normalizeModelName('deepseek-v4-flash-vision-exp')).toBe('deepseek-flash');
    expect(normalizeModelName('deepseek-v4-pro')).toBe('deepseek-v4-pro');
  });
});

describe('validateRequest', () => {
  const base = {
    model: 'deepseek-flash',
    messages: [userMessage('hello')],
    thinking: DEFAULT_THINKING,
    temperature: 1,
    maxTokens: 1024,
    stream: true,
  };

  it('accepts a valid text request', () => {
    expect(validateRequest(base).ok).toBe(true);
  });

  it('rejects an unknown model', () => {
    const result = validateRequest({ ...base, model: 'made-up-model' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MODEL_CAPABILITY');
  });

  it('BLOCKS sending images to deepseek-v4-pro instead of making an invalid call', () => {
    const withImage: ChatMessage = {
      ...userMessage('what is this?'),
      images: [
        {
          dataUrl: 'data:image/png;base64,AAA',
          mimeType: 'image/png',
          width: 10,
          height: 10,
          source: 'screenshot',
        },
      ],
    };
    const result = validateRequest({ ...base, model: 'deepseek-v4-pro', messages: [withImage] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MODEL_CAPABILITY');
      expect(result.error.hint).toContain('deepseek-flash');
    }
  });

  it('allows images on deepseek-flash', () => {
    const withImage: ChatMessage = {
      ...userMessage('read this'),
      images: [
        {
          dataUrl: 'data:image/png;base64,AAA',
          mimeType: 'image/png',
          width: 10,
          height: 10,
          source: 'screenshot',
        },
      ],
    };
    expect(validateRequest({ ...base, messages: [withImage] }).ok).toBe(true);
  });

  it('enforces the documented max_tokens ceiling', () => {
    expect(validateRequest({ ...base, maxTokens: 393_217 }).ok).toBe(false);
    expect(validateRequest({ ...base, maxTokens: 0 }).ok).toBe(false);
    expect(validateRequest({ ...base, maxTokens: 393_216 }).ok).toBe(true);
  });
});

describe('buildRequestBody', () => {
  const base = {
    model: 'deepseek-flash',
    messages: [userMessage('hi')],
    thinking: DEFAULT_THINKING,
    temperature: 0.5,
    maxTokens: 512,
    stream: true,
  };

  it('omits temperature in thinking mode and sends reasoning_effort', () => {
    const body = buildRequestBody(base);
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBe('high');
    expect(body.thinking).toEqual({ type: 'enabled' });
  });

  it('sends temperature and disables thinking when thinking is off', () => {
    const body = buildRequestBody({
      ...base,
      thinking: { enabled: false, effort: 'high' },
    });
    expect(body.temperature).toBe(0.5);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('requests usage in the stream', () => {
    const body = buildRequestBody(base);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('maps tools into function declarations', () => {
    const body = buildRequestBody({
      ...base,
      tools: [
        {
          name: 'get_system_info',
          description: 'Reads system info',
          category: 'system',
          risk: 'safe',
          requiresApproval: false,
          changesState: false,
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect((tools[0].function as Record<string, unknown>).name).toBe('get_system_info');
  });
});

describe('toWireMessages', () => {
  it('turns an image user message into content parts', () => {
    const msg: ChatMessage = {
      ...userMessage('describe'),
      images: [
        {
          dataUrl: 'data:image/png;base64,AAA',
          mimeType: 'image/png',
          width: 4,
          height: 4,
          source: 'screenshot',
        },
      ],
    };
    const wire = toWireMessages([msg]);
    expect(Array.isArray(wire[0].content)).toBe(true);
    const parts = wire[0].content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: 'text', text: 'describe' });
    expect(parts[1].type).toBe('image_url');
  });

  it('keeps plain text messages as strings', () => {
    expect(toWireMessages([userMessage('plain')])[0].content).toBe('plain');
  });
});

describe('parseSseChunk', () => {
  it('extracts a content delta', () => {
    const chunk = parseSseChunk(
      JSON.stringify({ choices: [{ delta: { content: 'Hel' }, finish_reason: null }] }),
    );
    expect(chunk?.contentDelta).toBe('Hel');
  });

  it('extracts reasoning_content separately from content', () => {
    const chunk = parseSseChunk(
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' } }] }),
    );
    expect(chunk?.reasoningDelta).toBe('thinking...');
    expect(chunk?.contentDelta).toBeUndefined();
  });

  it('returns null for [DONE] and garbage', () => {
    expect(parseSseChunk('[DONE]')).toBeNull();
    expect(parseSseChunk('not json')).toBeNull();
    expect(parseSseChunk('')).toBeNull();
  });

  it('parses usage including cached tokens', () => {
    const chunk = parseSseChunk(
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 4,
          prompt_cache_miss_tokens: 6,
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }),
    );
    expect(chunk?.usage?.totalTokens).toBe(15);
    expect(chunk?.usage?.cacheHitTokens).toBe(4);
    expect(chunk?.usage?.reasoningTokens).toBe(2);
    expect(chunk?.finishReason).toBe('stop');
  });
});

describe('ToolCallAccumulator', () => {
  it('reassembles a tool call split across chunks', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'call_1', name: 'open_app', arguments: '{"na' }]);
    acc.push([{ index: 0, arguments: 'me":"Notepad"}' }]);
    const calls = acc.result();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('open_app');
    expect(JSON.parse(calls[0].argumentsJson)).toEqual({ name: 'Notepad' });
  });

  it('handles parallel tool calls', () => {
    const acc = new ToolCallAccumulator();
    acc.push([
      { index: 0, id: 'a', name: 'one', arguments: '{}' },
      { index: 1, id: 'b', name: 'two', arguments: '{}' },
    ]);
    expect(acc.result().map((c) => c.name)).toEqual(['one', 'two']);
  });
});

describe('iterateSse', () => {
  async function collect(text: string): Promise<string[]> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const payload of iterateSse(stream)) out.push(payload);
    return out;
  }

  it('splits multiple events', async () => {
    const payloads = await collect('data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n');
    expect(payloads).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });

  it('handles an event split across chunk boundaries', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"cho'));
        controller.enqueue(encoder.encode('ices":[]}\n\n'));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const payload of iterateSse(stream)) out.push(payload);
    expect(out).toEqual(['{"choices":[]}']);
  });
});

describe('mapHttpError', () => {
  it('maps 401 to UNAUTHORIZED', () => {
    expect(mapHttpError(401, '{}').code).toBe('UNAUTHORIZED');
  });

  it('maps 402 to INSUFFICIENT_BALANCE', () => {
    expect(mapHttpError(402, '{}').code).toBe('INSUFFICIENT_BALANCE');
  });

  it('maps 429 to a retryable RATE_LIMITED', () => {
    const err = mapHttpError(429, '{}');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it('maps a vision-related 400 to MODEL_CAPABILITY with guidance', () => {
    const err = mapHttpError(400, JSON.stringify({ error: { message: 'image not supported' } }));
    expect(err.code).toBe('MODEL_CAPABILITY');
    expect(err.hint).toContain('deepseek-flash');
  });

  it('maps 500 to a retryable SERVER error', () => {
    const err = mapHttpError(503, '{}');
    expect(err.code).toBe('SERVER');
    expect(err.retryable).toBe(true);
  });
});

describe('selectModel', () => {
  it('switches to the vision model when images are present but primary cannot see', () => {
    const result = selectModel({
      hasImages: true,
      primaryModel: 'deepseek-v4-pro',
      reasoningModel: 'deepseek-v4-pro',
      preferReasoning: true,
    });
    expect(result.model).toBe('deepseek-flash');
    expect(result.switchedForVision).toBe(true);
  });

  it('keeps the primary model when it already supports vision', () => {
    const result = selectModel({
      hasImages: true,
      primaryModel: 'deepseek-flash',
      reasoningModel: 'deepseek-v4-pro',
      preferReasoning: false,
    });
    expect(result.switchedForVision).toBe(false);
  });

  it('honors the reasoning preference for text-only turns', () => {
    const result = selectModel({
      hasImages: false,
      primaryModel: 'deepseek-flash',
      reasoningModel: 'deepseek-v4-pro',
      preferReasoning: true,
    });
    expect(result.model).toBe('deepseek-v4-pro');
  });
});

describe('provider streaming end to end', () => {
  function fakeFetch(sse: string, status = 200): typeof fetch {
    return (async () =>
      new Response(status === 200 ? sse : 'oops', {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as unknown as typeof fetch;
  }

  it('streams text, reasoning and usage into events', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const provider = new DeepSeekProvider({ apiKey: 'test', fetchImpl: fakeFetch(sse) });
    const events: unknown[] = [];
    const controller = new AbortController();

    const result = await provider.generate({
      model: 'deepseek-flash',
      messages: [userMessage('hi')],
      thinking: DEFAULT_THINKING,
      temperature: 1,
      maxTokens: 100,
      signal: controller.signal,
      timeoutMs: 5000,
      requestId: 'r1',
      onEvent: (e) => events.push(e),
    });

    expect(result.content).toBe('Hello world');
    expect(result.reasoning).toBe('hmm');
    expect(result.usage?.totalTokens).toBe(5);
    expect(events.map((e) => (e as { type: string }).type)).toContain('text');
    expect(events.map((e) => (e as { type: string }).type)).toContain('reasoning');
    expect(events.map((e) => (e as { type: string }).type)).toContain('done');
  });

  it('surfaces an HTTP error as a Cyps error event', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'bad',
      fetchImpl: fakeFetch('nope', 401),
    });
    const events: Array<{ type: string; code?: string }> = [];
    const controller = new AbortController();

    await expect(
      provider.generate({
        model: 'deepseek-flash',
        messages: [userMessage('hi')],
        thinking: DEFAULT_THINKING,
        temperature: 1,
        maxTokens: 10,
        signal: controller.signal,
        timeoutMs: 5000,
        requestId: 'r2',
        onEvent: (e) => events.push(e as { type: string; code?: string }),
      }),
    ).rejects.toThrow();

    expect(events.find((e) => e.type === 'error')?.code).toBe('UNAUTHORIZED');
  });

  it('refuses to send an image to a non-vision model, without calling fetch', async () => {
    const spy = vi.fn();
    const provider = new DeepSeekProvider({
      apiKey: 'test',
      fetchImpl: spy as unknown as typeof fetch,
    });
    const controller = new AbortController();

    await expect(
      provider.generate({
        model: 'deepseek-v4-pro',
        messages: [
          {
            ...userMessage('look'),
            images: [
              {
                dataUrl: 'data:image/png;base64,AAA',
                mimeType: 'image/png',
                width: 1,
                height: 1,
                source: 'screenshot',
              },
            ],
          },
        ],
        thinking: DEFAULT_THINKING,
        temperature: 1,
        maxTokens: 10,
        signal: controller.signal,
        timeoutMs: 5000,
        requestId: 'r3',
        onEvent: () => {},
      }),
    ).rejects.toThrow();

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('history trimming', () => {
  it('keeps the system prompt while dropping old turns', () => {
    const messages: ChatMessage[] = [
      { id: 's', role: 'system', content: 'sys', createdAt: 0 },
      { id: '1', role: 'user', content: 'a'.repeat(400), createdAt: 1 },
      { id: '2', role: 'assistant', content: 'b'.repeat(400), createdAt: 2 },
      { id: '3', role: 'user', content: 'newest', createdAt: 3 },
    ];
    const trimmed = trimHistory(messages, 120);
    expect(trimmed[0].role).toBe('system');
    expect(trimmed[trimmed.length - 1].content).toBe('newest');
    expect(trimmed.length).toBeLessThan(messages.length);
  });

  it('returns messages untouched when within budget', () => {
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }];
    expect(trimHistory(messages, 10_000)).toHaveLength(1);
  });

  it('estimates tokens from length', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });
});
