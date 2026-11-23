/**
 * Multi-provider endpoint resolution and Hermes-inspired fallback chain planner.
 *
 * Mirrors Hermes `hermes_cli/fallback_config.py`:
 *  - Deduplicates fallback entries by normalized `(provider, model, baseUrl)`.
 *  - Skips entries identical to the active primary `(provider, model, baseUrl)`.
 *  - Resolves named custom OpenAI-compatible endpoints cleanly.
 *  - Produces the canonical user-visible fallback notice when switching.
 */

import {
  getProviderDescriptor,
  isSafeProviderBaseUrl,
  type CustomEndpointConfig,
  type ProviderId,
  type ProviderSettings,
} from '../../shared/types';

export interface ResolvedProviderTarget {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  requiresApiKey: boolean;
  customEndpointId?: string;
  isFallback: boolean;
}

export function normalizeBaseUrl(raw?: string): string {
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

export function resolveProviderBaseUrl(
  provider: ProviderId,
  overrideBaseUrl?: string,
  customEndpoints?: CustomEndpointConfig[],
  customEndpointId?: string,
): string {
  if (customEndpointId && customEndpoints?.length) {
    const match = customEndpoints.find((ep) => ep.id === customEndpointId && ep.enabled);
    if (match && isSafeProviderBaseUrl(match.baseUrl)) {
      return normalizeBaseUrl(match.baseUrl);
    }
  }
  if (overrideBaseUrl && isSafeProviderBaseUrl(overrideBaseUrl)) {
    return normalizeBaseUrl(overrideBaseUrl);
  }
  return getProviderDescriptor(provider).defaultBaseUrl;
}

/**
 * Build the ordered, deduplicated execution chain:
 * `[primary, ...enabledFallbacks]` where any fallback matching the primary or
 * a previous entry on `(provider, model, baseUrl)` is skipped.
 */
export function resolveProviderChain(
  settings: ProviderSettings,
  requestedModel?: string,
): ResolvedProviderTarget[] {
  const primaryProvider = settings.provider;
  const primaryDescriptor = getProviderDescriptor(primaryProvider);
  const primaryModel = (requestedModel || settings.primaryModel || primaryDescriptor.defaultModel).trim();
  const primaryBaseUrl = resolveProviderBaseUrl(
    primaryProvider,
    settings.baseUrl,
    settings.customEndpoints,
  );

  const chain: ResolvedProviderTarget[] = [
    {
      provider: primaryProvider,
      model: primaryModel,
      baseUrl: primaryBaseUrl,
      requiresApiKey: primaryDescriptor.requiresApiKey,
      isFallback: false,
    },
  ];

  const seen = new Set<string>([
    `${primaryProvider}|${primaryModel.toLowerCase()}|${primaryBaseUrl.toLowerCase()}`,
  ]);

  for (const fb of settings.fallbackProviders ?? []) {
    if (!fb.enabled || !fb.model.trim()) continue;
    const descriptor = getProviderDescriptor(fb.provider);
    const baseUrl = resolveProviderBaseUrl(
      fb.provider,
      fb.baseUrl,
      settings.customEndpoints,
      fb.customEndpointId,
    );
    const model = fb.model.trim();
    const dedupeKey = `${fb.provider}|${model.toLowerCase()}|${baseUrl.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    chain.push({
      provider: fb.provider,
      model,
      baseUrl,
      requiresApiKey: descriptor.requiresApiKey,
      customEndpointId: fb.customEndpointId,
      isFallback: true,
    });
  }

  return chain;
}

/**
 * Determine whether a provider failure code should trigger automatic fallback
 * to the next configured provider in the chain.
 */
export function isFallbackEligibleError(code?: string): boolean {
  return (
    code === 'RATE_LIMITED' ||
    code === 'SERVER' ||
    code === 'NETWORK' ||
    code === 'TIMEOUT' ||
    code === 'INSUFFICIENT_BALANCE' ||
    code === 'NO_API_KEY'
  );
}

/** User-visible fallback switch notice (Hermes `pre_agent_fallback_notice` wording). */
export function formatFallbackNotice(
  primary: Pick<ResolvedProviderTarget, 'provider' | 'model'>,
  fallback: Pick<ResolvedProviderTarget, 'provider' | 'model'>,
): string {
  return `Provider fallback: ${primary.provider}/${primary.model} unavailable; using ${fallback.provider}/${fallback.model} for this response.`;
}
