import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PROVIDER_CATALOG,
  isSafeProviderBaseUrl,
  mergeSettings,
  type StreamEvent,
} from '@shared/types';
import {
  formatFallbackNotice,
  isFallbackEligibleError,
  resolveProviderChain,
} from '../src/main/providers/catalog';
import { AnthropicProvider, buildAnthropicRequestBody } from '../src/main/providers/anthropic';
import { buildOpenAICompatibleRequestBody } from '../src/main/providers/openaiCompat';
import { RuntimeProvider } from '../src/main/providers/runtime';

describe('Hermes Stage 2: Multi-Provider Architecture, Custom Endpoints & Fallback Chains', () => {
  it('validates provider catalog, safe base URLs, contextLength clamping, and fallback deduplication', () => {
    expect(PROVIDER_CATALOG.map((p) => p.id)).toEqual([
      'deepseek',
      'openai',
      'openrouter',
      'anthropic',
      'gemini',
      'xai',
      'ollama',
      'custom',
    ]);

    expect(isSafeProviderBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isSafeProviderBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isSafeProviderBaseUrl('http://localhost:8080/v1')).toBe(true);
    expect(isSafeProviderBaseUrl('http://evil.example.com/v1')).toBe(false);
    expect(isSafeProviderBaseUrl('file:///etc/passwd')).toBe(false);

    const merged = mergeSettings({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        provider: 'openrouter',
        primaryModel: 'anthropic/claude-sonnet-4',
        baseUrl: 'http://remote-insecure.example.com/v1',
        contextLength: 99_999_999,
        customEndpoints: [
          { id: 'local-vllm', name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1/', model: 'qwen-32b', enabled: true },
          { id: 'unsafe', name: 'Unsafe', baseUrl: 'http://remote.example.com/v1', model: 'bad', enabled: true },
        ],
        fallbackProviders: [
          { provider: 'openai', model: 'gpt-4o', enabled: true },
          { provider: 'openai', model: 'gpt-4o', enabled: true }, // duplicate
          { provider: 'ollama', model: 'llama3.2', enabled: true },
        ],
      },
      agent: {
        ...DEFAULT_SETTINGS.agent,
        delegationProvider: 'anthropic',
        delegationModel: 'claude-sonnet-4-20250514',
        delegationReasoningEffort: 'low',
      },
    });

    expect(merged.provider.provider).toBe('openrouter');
    expect(merged.provider.baseUrl).toBe(''); // insecure remote HTTP rejected
    expect(merged.provider.contextLength).toBe(2_000_000);
    expect(merged.provider.customEndpoints).toHaveLength(1);
    expect(merged.provider.customEndpoints?.[0]?.baseUrl).toBe('http://127.0.0.1:8000/v1');
    expect(merged.provider.fallbackProviders).toHaveLength(2);
    expect(merged.agent.delegationProvider).toBe('anthropic');
    expect(merged.agent.delegationModel).toBe('claude-sonnet-4-20250514');
    expect(merged.agent.delegationReasoningEffort).toBe('low');

    // Persistence round-trip.
    const reloaded = mergeSettings(JSON.parse(JSON.stringify(merged)));
    expect(reloaded.provider).toEqual(merged.provider);
    expect(reloaded.agent).toEqual(merged.agent);
  });

  it('deduplicates resolveProviderChain against the active primary and resolves named custom endpoints', () => {
    const settings = mergeSettings({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        provider: 'deepseek',
        primaryModel: 'deepseek-flash',
        customEndpoints: [
          { id: 'local-vllm', name: 'Local vLLM', baseUrl: 'http://127.0.0.1:8000/v1', model: 'qwen', enabled: true },
        ],
        fallbackProviders: [
          { provider: 'deepseek', model: 'deepseek-flash', enabled: true }, // same as primary -> skip
          { provider: 'openai', model: 'gpt-4o', enabled: false }, // disabled -> skip
          { provider: 'custom', model: 'qwen', customEndpointId: 'local-vllm', enabled: true },
        ],
      },
    });

    const chain = resolveProviderChain(settings.provider);
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', isFallback: false });
    expect(chain[1]).toMatchObject({
      provider: 'custom',
      model: 'qwen',
      baseUrl: 'http://127.0.0.1:8000/v1',
      isFallback: true,
    });
    expect(isFallbackEligibleError('RATE_LIMITED')).toBe(true);
    expect(isFallbackEligibleError('BAD_REQUEST')).toBe(false);
    expect(formatFallbackNotice(chain[0]!, chain[1]!)).toContain('deepseek/deepseek-flash');
  });

  it('automatically switches to a fallback provider in RuntimeProvider on 429 RATE_LIMITED', async () => {
    const settings = mergeSettings({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        provider: 'deepseek',
        primaryModel: 'deepseek-flash',
        fallbackProviders: [
          { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434/v1', enabled: true },
        ],
      },
    });

    const calledUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calledUrls.push(url);
      if (url.includes('api.deepseek.com')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const sse = [
        'data: {"choices":[{"delta":{"content":"Fallback OK"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join('\n\n') + '\n\n';
      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const runtime = new RuntimeProvider(() => 'sk-test-primary', {
      getSettings: () => settings,
      fetchImpl: mockFetch,
    });

    const events: StreamEvent[] = [];
    const result = await runtime.generate({
      model: 'deepseek-flash',
      messages: [{ id: 'msg-1', role: 'user', content: 'Hello', createdAt: Date.now() }],
      thinking: { enabled: false, effort: 'none' },
      temperature: 0.7,
      maxTokens: 256,
      signal: new AbortController().signal,
      timeoutMs: 5000,
      onEvent: (event) => events.push(event),
      requestId: 'req-fallback-1',
    });

    expect(result.content).toBe('Fallback OK');
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toContain('api.deepseek.com');
    expect(calledUrls[1]).toContain('127.0.0.1:11434');
    expect(events.some((e) => e.type === 'reasoning' && e.delta.includes('Provider fallback:'))).toBe(true);
  });

  it('executes deduplicated fallback chains in Python pixel_agent.providers.stream_with_fallback', () => {
    const script = `
import json, threading
from pixel_agent.providers import ProviderConfig, ProviderTurnResult, build_fallback_chain, stream_with_fallback
from pixel_agent.errors import AgentError

p1 = ProviderConfig(provider="deepseek", model="deepseek-flash", api_key="k1")
p1_dup = ProviderConfig(provider="deepseek", model="deepseek-flash", api_key="k1")
p2 = ProviderConfig(provider="openrouter", model="anthropic/claude-sonnet-4", api_key="k2")
chain = build_fallback_chain(p1, [p1_dup, p2])
assert len(chain) == 2

switched = []
def fake_stream(cfg, messages, tools, *, cancel_event, on_delta, on_reasoning):
    if cfg.provider == "deepseek":
        raise AgentError("RATE_LIMITED", "429", retryable=True)
    on_delta("from-openrouter")
    return ProviderTurnResult(content="from-openrouter", finish_reason="stop")

res, winner = stream_with_fallback(
    p1, [p1_dup, p2], [{"role": "user", "content": "hi"}], [],
    cancel_event=threading.Event(),
    on_delta=lambda _t: None,
    on_reasoning=lambda _r: None,
    on_fallback=lambda a, b, err: switched.append((a.provider, b.provider, err.code)),
    stream_fn=fake_stream,
)
print(json.dumps({"content": res.content, "winner": winner.provider, "switched": switched}))
`;
    const out = execFileSync('python', ['-c', script], {
      cwd: `${process.cwd()}/python`,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out.trim());
    expect(parsed.content).toBe('from-openrouter');
    expect(parsed.winner).toBe('openrouter');
    expect(parsed.switched).toEqual([['deepseek', 'openrouter', 'RATE_LIMITED']]);
  });

  it('builds protocol-accurate OpenAI-compatible and native Anthropic requests and streams Anthropic SSE', async () => {
    const messages = [
      { id: 's1', role: 'system' as const, content: 'Be precise.', createdAt: 1 },
      { id: 'u1', role: 'user' as const, content: 'Inspect repo', createdAt: 2 },
    ];
    const tools = [
      {
        name: 'list_dir',
        description: 'List files',
        category: 'files' as const,
        risk: 'low' as const,
        requiresApproval: false,
        changesState: false,
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];

    // OpenAI-compatible body must NEVER include DeepSeek-only `thinking: { type: 'enabled' }`.
    const openaiBody = buildOpenAICompatibleRequestBody('openai', {
      model: 'gpt-4o',
      messages,
      thinking: { enabled: true, effort: 'high' },
      temperature: 0.5,
      maxTokens: 1024,
      tools,
    }, true);
    expect(openaiBody.thinking).toBeUndefined();
    expect(openaiBody.reasoning_effort).toBe('high');
    expect(Array.isArray(openaiBody.tools)).toBe(true);

    // Anthropic body must extract system prompt and use input_schema + native thinking budget.
    const anthropicBody = buildAnthropicRequestBody({
      model: 'claude-sonnet-4-20250514',
      messages,
      thinking: { enabled: true, effort: 'low' },
      temperature: 0.7,
      maxTokens: 4096,
      tools,
    }, true);
    expect(anthropicBody.system).toBe('Be precise.');
    expect(anthropicBody.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect((anthropicBody.tools as Array<{ input_schema?: unknown }>)[0]?.input_schema).toBeDefined();

    // Native Anthropic SSE streaming + headers verification.
    let capturedHeaders: Record<string, string> = {};
    let capturedUrl = '';
    const anthropic = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      fetchImpl: async (input, init) => {
        capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        const sse = [
          'data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Checking..."}}',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Anthropic native OK"}}',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}',
          'data: {"type":"message_stop"}',
        ].join('\n\n') + '\n\n';
        return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });

    const events: StreamEvent[] = [];
    const res = await anthropic.generate({
      model: 'claude-sonnet-4-20250514',
      messages,
      thinking: { enabled: true, effort: 'low' },
      temperature: 0.7,
      maxTokens: 4096,
      signal: new AbortController().signal,
      timeoutMs: 5000,
      onEvent: (e) => events.push(e),
      requestId: 'req-ant-1',
    });

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedHeaders['x-api-key']).toBe('sk-ant-test');
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01');
    expect(res.content).toBe('Anthropic native OK');
    expect(res.reasoning).toBe('Checking...');
    expect(res.usage).toEqual({ promptTokens: 42, completionTokens: 12, totalTokens: 54 });
  });

  it('does not fall back on non-retryable 400 BAD_REQUEST and executes fallback inside real Python run_agent_turn', async () => {
    const settings = mergeSettings({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        provider: 'openai',
        primaryModel: 'gpt-4o',
        fallbackProviders: [
          { provider: 'ollama', model: 'llama3.2', enabled: true },
        ],
      },
    });
    let calls = 0;
    const runtime = new RuntimeProvider(() => null, {
      getSettings: () => settings,
      getProviderApiKey: (id) => (id === 'openai' ? 'sk-openai-test' : null),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: 'Invalid schema' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    await expect(runtime.generate({
      model: 'gpt-4o',
      messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 1 }],
      thinking: { enabled: false, effort: 'none' },
      temperature: 0.7,
      maxTokens: 256,
      signal: new AbortController().signal,
      timeoutMs: 5000,
      onEvent: () => undefined,
      requestId: 'req-no-fb',
    })).rejects.toThrow();
    expect(calls).toBe(1);

    // Real Python run_agent_turn with fallback_configs.
    const pyScript = `
import json, threading
from pixel_agent.budgets import IterationBudget
from pixel_agent.errors import AgentError
from pixel_agent.loop import run_agent_turn
from pixel_agent.providers import ProviderConfig, ProviderTurnResult

events = []
def stub_call(cfg, msgs, tools, cancel_event, on_delta, on_reasoning):
    if cfg.provider == "openai":
        raise AgentError("RATE_LIMITED", "429", retryable=True)
    on_delta("turn-fallback-ok")
    return ProviderTurnResult(content="turn-fallback-ok", finish_reason="stop")

res = run_agent_turn(
    request_id="req-py-turn",
    messages=[{"role": "user", "content": "hello"}],
    tools=[],
    provider_config=ProviderConfig(provider="openai", model="gpt-4o", api_key="k1"),
    fallback_configs=[ProviderConfig(provider="anthropic", model="claude-sonnet-4-20250514", api_key="k2")],
    budget=IterationBudget(max_iterations=3),
    cancel_event=threading.Event(),
    emit=events.append,
    request_tool_execution=lambda *_a: {"ok": True, "content": ""},
    provider_call=stub_call,
)
print(json.dumps({
    "ok": res["ok"],
    "content": res["content"],
    "hasFallbackNotice": any(e.get("type") == "turn.reasoning" and "Provider fallback:" in e.get("delta", "") for e in events),
}))
`;
    const pyOut = execFileSync('python', ['-c', pyScript], {
      cwd: `${process.cwd()}/python`,
      encoding: 'utf8',
    });
    expect(JSON.parse(pyOut.trim())).toEqual({
      ok: true,
      content: 'turn-fallback-ok',
      hasFallbackNotice: true,
    });
  });
});
