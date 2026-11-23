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
      messages: [{ role: 'user', content: 'Hello' }],
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
    expect(events.some((e) => e.type === 'status' && e.message.includes('Provider fallback:'))).toBe(true);
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
});
