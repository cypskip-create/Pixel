/**
 * Runtime provider facade.
 *
 * `DeepSeekProvider` takes its API key at construction, but in Cyps the key is
 * entered at runtime (and can be replaced or cleared) without restarting the
 * app. This facade resolves the key at call time and builds a provider for that
 * one operation, so a newly saved key works immediately and a cleared key stops
 * working immediately.
 *
 * It also keeps the concrete provider file untouched and easy to test.
 */

import type { ModelCapabilities, ToolCall, TokenUsage } from '../../shared/types';
import type {
  GenerateOptions,
  GenerateResult,
  ModelProvider,
  TestConnectionOutcome,
} from './deepseek';
import { DeepSeekProvider } from './deepseek';

export class RuntimeProvider implements ModelProvider {
  readonly id = 'deepseek';
  readonly label = 'DeepSeek';

  constructor(private readonly getApiKey: () => string | null) {}

  listModels(): readonly ModelCapabilities[] {
    // Capabilities are static, so an empty key is fine for this call.
    return new DeepSeekProvider({ apiKey: '' }).listModels();
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const key = this.getApiKey();
    if (!key) {
      // Shaped like the provider's own errors so the engine's normalization
      // produces a NO_API_KEY event rather than an opaque UNKNOWN.
      throw {
        code: 'NO_API_KEY',
        message: 'Cyps needs a DeepSeek API key before it can answer.',
        retryable: false,
      };
    }
    return new DeepSeekProvider({ apiKey: key }).generate(options);
  }

  async testConnection(apiKey: string, model: string): Promise<TestConnectionOutcome> {
    return new DeepSeekProvider({ apiKey }).testConnection(apiKey, model);
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
