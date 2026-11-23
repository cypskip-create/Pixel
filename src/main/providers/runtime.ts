/**
 * Runtime provider facade with Hermes-inspired multi-provider routing and
 * ordered fallback chains.
 *
 * Resolves credentials and active provider settings at call time so newly saved
 * keys, custom endpoints, and fallback chains take effect immediately without
 * restarting Pixel.
 */

import type {
  AppSettings,
  ModelCapabilities,
  ProviderId,
  ToolCall,
  TokenUsage,
} from '../../shared/types';
import { DEFAULT_SETTINGS, getProviderDescriptor } from '../../shared/types';
import type {
  GenerateOptions,
  GenerateResult,
  ModelProvider,
  TestConnectionOutcome,
} from './deepseek';
import { DeepSeekProvider } from './deepseek';
import {
  formatFallbackNotice,
  isFallbackEligibleError,
  resolveProviderChain,
  type ResolvedProviderTarget,
} from './catalog';

export interface RuntimeProviderOptions {
  getSettings?: () => AppSettings;
  getProviderApiKey?: (providerId: ProviderId) => string | null;
  fetchImpl?: typeof fetch;
}

function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; error?: { code?: unknown } };
  if (typeof e.code === 'string') return e.code;
  if (e.error && typeof e.error.code === 'string') return e.error.code;
  return undefined;
}

export class RuntimeProvider implements ModelProvider {
  readonly id = 'deepseek';
  readonly label = 'DeepSeek';

  private readonly getSettings: () => AppSettings;
  private readonly getProviderApiKey: (providerId: ProviderId) => string | null;
  private readonly fetchImpl?: typeof fetch;

  constructor(
    private readonly getApiKey: () => string | null,
    options: RuntimeProviderOptions = {},
  ) {
    this.getSettings = options.getSettings ?? (() => DEFAULT_SETTINGS);
    this.getProviderApiKey =
      options.getProviderApiKey ??
      ((providerId) => (providerId === 'deepseek' ? this.getApiKey() : null));
    this.fetchImpl = options.fetchImpl;
  }

  listModels(): readonly ModelCapabilities[] {
    return new DeepSeekProvider({ apiKey: '' }).listModels();
  }

  private resolveKeyForTarget(target: ResolvedProviderTarget): string | null {
    const providerKey = this.getProviderApiKey(target.provider);
    if (providerKey) return providerKey;
    if (target.provider === 'deepseek') return this.getApiKey();
    return null;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const providerSettings = this.getSettings().provider;
    const chain = resolveProviderChain(providerSettings, options.model);
    const primary = chain[0]!;
    let lastError: unknown = null;

    for (let i = 0; i < chain.length; i += 1) {
      const target = chain[i]!;
      const hasNext = i + 1 < chain.length;
      const key = this.resolveKeyForTarget(target);

      if (target.requiresApiKey && !key) {
        const missingErr = {
          code: 'NO_API_KEY',
          message: `Pixel needs a ${getProviderDescriptor(target.provider).label} API key before it can answer.`,
          retryable: false,
        };
        lastError = missingErr;
        if (hasNext) continue;
        throw missingErr;
      }

      if (target.isFallback) {
        options.onEvent({
          type: 'status',
          requestId: options.requestId,
          phase: 'retrying',
          message: formatFallbackNotice(primary, target),
        });
      }

      const adapter = new DeepSeekProvider({
        apiKey: key ?? 'local-no-key',
        baseUrl: target.baseUrl,
        fetchImpl: this.fetchImpl,
      });

      try {
        return await adapter.generate({
          ...options,
          model: target.model,
        });
      } catch (err) {
        lastError = err;
        const code = extractErrorCode(err);
        if (hasNext && isFallbackEligibleError(code) && !options.signal.aborted) {
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? {
      code: 'NO_API_KEY',
      message: 'Pixel needs an API key before it can answer.',
      retryable: false,
    };
  }

  async testConnection(apiKey: string, model: string): Promise<TestConnectionOutcome> {
    const providerSettings = this.getSettings().provider;
    const target = resolveProviderChain(providerSettings, model)[0]!;
    return new DeepSeekProvider({
      apiKey,
      baseUrl: target.baseUrl,
      fetchImpl: this.fetchImpl,
    }).testConnection(apiKey, target.model);
  }
}

/** Empty result helper, kept for callers that need a neutral value. */
export function emptyResult(): GenerateResult {
  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const toolCalls: ToolCall[] = [];
  return {
    content: '',
    reasoning: '',
    toolCalls,
    usage,
    finishReason: 'stop',
    aborted: false,
  };
}
