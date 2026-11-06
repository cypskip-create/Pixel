/**
 * Cost control, loop detection, and provider routing.
 *
 * The point of these pieces is that an autonomous agent must not be able to spend
 * money indefinitely, repeat the same failing action forever, or send a whole
 * document when one paragraph would do.
 */

import type { Mode, ModelCapabilities, StreamEvent, TokenUsage } from '../../shared/types';
import type { ModelProvider } from '../providers/deepseek';

/* ------------------------------------------------------------------ *
 * Token budgets and spend tracking
 * ------------------------------------------------------------------ */

export interface BudgetLimits {
  /** Tokens for one run, prompt plus completion. */
  maxTokensPerRun: number;
  /** Tokens allowed in a rolling 24 hours. */
  maxTokensPerDay: number;
  /** Hard stop on estimated spend for a rolling 24 hours (USD). */
  maxCostPerDay: number;
  maxSteps: number;
}

export const DEFAULT_BUDGETS: BudgetLimits = {
  maxTokensPerRun: 120_000,
  maxTokensPerDay: 2_000_000,
  maxCostPerDay: 2,
  maxSteps: 8,
};

export interface UsageEntry {
  at: number;
  model: string;
  provider: string;
  usage: TokenUsage;
  costUsd: number;
}

/**
 * Price table, per one million tokens.
 *
 * Kept explicit and conservative: an unknown model falls back to the most
 * expensive known rate, so a new model can never silently look free.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'deepseek-flash': { input: 0.28, output: 0.42 },
  'deepseek-v4-pro': { input: 0.28, output: 0.42 },
  'ollama': { input: 0, output: 0 },
};

export function estimateCost(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? PRICES['deepseek-v4-pro'] ?? { input: 0.28, output: 0.42 };
  return (
    (usage.promptTokens / 1_000_000) * price.input +
    (usage.completionTokens / 1_000_000) * price.output
  );
}

/** Tracks usage for the running process and enforces the ceilings. */
export class BudgetTracker {
  private readonly entries: UsageEntry[] = [];

  constructor(private readonly limits: BudgetLimits = DEFAULT_BUDGETS) {}

  record(model: string, provider: string, usage: TokenUsage, at = Date.now()): UsageEntry {
    const entry: UsageEntry = {
      at,
      model,
      provider,
      usage,
      costUsd: estimateCost(model, usage),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Usage inside a rolling window ending now. */
  usageInWindow(now = Date.now(), windowMs = 86_400_000): { tokens: number; costUsd: number } {
    let tokens = 0;
    let costUsd = 0;
    for (const entry of this.entries) {
      if (now - entry.at > windowMs) continue;
      tokens += entry.usage.totalTokens;
      costUsd += entry.costUsd;
    }
    return { tokens, costUsd };
  }

  /** May a run continue, given what has already been spent? */
  check(now = Date.now()): { allowed: boolean; reason?: string } {
    const day = this.usageInWindow(now);
    if (day.tokens >= this.limits.maxTokensPerDay) {
      return {
        allowed: false,
        reason: `Daily token limit reached (${String(day.tokens)} of ${String(this.limits.maxTokensPerDay)}). Raise it in Settings.`,
      };
    }
    if (day.costUsd >= this.limits.maxCostPerDay) {
      return {
        allowed: false,
        reason: `Daily spend limit reached ($${day.costUsd.toFixed(2)} of $${this.limits.maxCostPerDay.toFixed(2)}). Raise it in Settings.`,
      };
    }
    return { allowed: true };
  }

  limitsForDisplay(): BudgetLimits {
    return this.limits;
  }
}

/* ------------------------------------------------------------------ *
 * Loop detection
 * ------------------------------------------------------------------ */

/**
 * Detects an agent repeating itself.
 *
 * Two signals: the same tool call with identical arguments twice in a row, and a
 * short cycle of calls repeating. Either wastes tokens and usually means the model
 * is stuck, so the loop is stopped with an explanation rather than silently
 * burning credit.
 */
export class LoopDetector {
  private readonly history: string[] = [];

  constructor(private readonly maxRepeats = 2, private readonly windowSize = 6) {}

  /** Returns a reason when the pattern is repeating, otherwise null. */
  observe(toolName: string, args: Record<string, unknown>): string | null {
    const key = `${toolName}:${stableStringify(args)}`;
    this.history.push(key);
    if (this.history.length > this.windowSize * 3) this.history.shift();

    let consecutive = 0;
    for (let index = this.history.length - 1; index >= 0; index -= 1) {
      if (this.history[index] !== key) break;
      consecutive += 1;
    }
    if (consecutive >= this.maxRepeats) {
      return `The same "${toolName}" call with identical arguments repeated ${String(consecutive)} times.`;
    }

    // A repeating cycle such as A,B,A,B,A,B.
    for (let cycle = 2; cycle <= 3; cycle += 1) {
      if (this.history.length < cycle * 2) break;
      const tail = this.history.slice(-cycle * 2);
      const firstHalf = tail.slice(0, cycle).join('|');
      const secondHalf = tail.slice(cycle).join('|');
      if (firstHalf === secondHalf) {
        return `Tool calls repeated in a ${String(cycle)}-step cycle.`;
      }
    }

    return null;
  }

  reset(): void {
    this.history.length = 0;
  }
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(sortKeys(value));
  } catch {
    return String(value);
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Context shaping
 * ------------------------------------------------------------------ */

/** Cut tool output before it enters the model context. */
export function truncateToolOutput(text: string, maxChars = 4_000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n[... ${String(text.length - head.length - tail.length)} characters omitted ...]\n\n${tail}`;
}

/**
 * Summarise old conversation turns to keep the prompt small.
 *
 * Deterministic and lossy by design: it keeps roles, truncates content, and says
 * how many turns were folded away, rather than asking a model to summarise (which
 * would cost the tokens it is meant to save).
 */
export function summariseHistory(
  messages: Array<{ role: string; content: string }>,
  keepRecent = 4,
  maxCharsPerMessage = 200,
): Array<{ role: string; content: string }> {
  if (messages.length <= keepRecent) return messages;

  const older = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(-keepRecent);
  const folded = older
    .map((message) => `${message.role}: ${message.content.slice(0, maxCharsPerMessage)}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: `Earlier conversation, condensed (${String(older.length)} turns):\n${folded}`,
    },
    ...recent,
  ];
}

/* ------------------------------------------------------------------ *
 * Provider routing
 * ------------------------------------------------------------------ */

export type TaskComplexity = 'simple' | 'standard' | 'hard';

export interface RoutingDecision {
  provider: 'deepseek' | 'ollama';
  model: string;
  reason: string;
}

export interface RoutingContext {
  /** 'deepseek' is always tried first when online. */
  offline: boolean;
  /** Models reported by each provider. */
  deepseekModels: readonly ModelCapabilities[];
  localModels: readonly string[];
  needsVision: boolean;
  needsTools: boolean;
  complexity: TaskComplexity;
  preferred?: { provider: 'deepseek' | 'ollama'; model: string };
}

/**
 * Choose a model for a turn.
 *
 * Capability wins over cost: a task that needs vision or tools cannot be routed to
 * a model that lacks them, whatever the price. Within what is capable, the cheaper
 * option is preferred for simple work.
 */
export function routeTask(context: RoutingContext): RoutingDecision {
  if (context.preferred && !context.offline) {
    return {
      provider: context.preferred.provider,
      model: context.preferred.model,
      reason: 'The user pinned this model in Settings.',
    };
  }

  if (context.offline) {
    const local = context.localModels[0];
    if (!local) {
      return {
        provider: 'ollama',
        model: '',
        reason: 'Offline and no local model is installed. Install one with: ollama pull llama3.2',
      };
    }
    return {
      provider: 'ollama',
      model: local,
      reason: 'DeepSeek is unreachable, so the request uses the local model.',
    };
  }

  const capable = context.deepseekModels.filter(
    (model) => (!context.needsVision || model.vision) && (!context.needsTools || model.toolCalls),
  );

  if (capable.length === 0) {
    return {
      provider: 'deepseek',
      model: context.deepseekModels[0]?.id ?? 'deepseek-flash',
      reason: 'No model advertises every required capability; falling back to the default.',
    };
  }

  // Prefer the fast model unless the work is genuinely hard.
  const fast = capable.find((model) => model.role === 'fast');
  const strong = capable.find((model) => model.role === 'reasoning');

  if (context.complexity === 'hard' && strong) {
    return {
      provider: 'deepseek',
      model: strong.id,
      reason: 'Complex task, so the reasoning model is used.',
    };
  }
  if (fast) {
    return {
      provider: 'deepseek',
      model: fast.id,
      reason:
        context.complexity === 'simple'
          ? 'Simple task, so the cheaper fast model is used.'
          : 'Standard task, so the fast model is used.',
    };
  }
  return {
    provider: 'deepseek',
    model: capable[0].id,
    reason: 'Only one model satisfies the requirements.',
  };
}

/** A provider that can answer either DeepSeek or Ollama, chosen per turn. */
export class RoutingProvider implements ModelProvider {
  readonly id = 'routing';
  readonly label = 'Pixel routing';

  constructor(
    private readonly providers: Record<string, ModelProvider>,
    private readonly decide: () => Promise<RoutingDecision>,
  ) {}

  listModels(): readonly ModelCapabilities[] {
    return this.providers.deepseek?.listModels() ?? [];
  }

  async generate(options: Parameters<ModelProvider['generate']>[0]) {
    const decision = await this.decide();
    const provider = this.providers[decision.provider] ?? this.providers.deepseek;
    if (!provider) throw { code: 'MODEL_CAPABILITY', message: 'No provider is available.', retryable: false };
    return provider.generate({ ...options, model: decision.model || options.model });
  }

  async testConnection(apiKey: string, model: string) {
    return this.providers.deepseek?.testConnection(apiKey, model) ?? { ok: false };
  }
}

/** Emit a stream event that explains a routing decision to the UI. */
export function routingEvent(requestId: string, decision: RoutingDecision): StreamEvent {
  return {
    type: 'started',
    requestId,
    model: `${decision.provider}:${decision.model}`,
  };
}

/** True when a mode may use a provider that cannot obey the tool policy. */
export function providerSupportsMode(_mode: Mode): boolean {
  // Local models frequently cannot call tools; the coordinator handles that by
  // withholding tools, so no mode is refused outright.
  return true;
}
