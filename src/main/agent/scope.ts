import type { GrantScope } from '../../shared/types';

/**
 * Work out what an invocation is aimed at, so an approval can be limited to it.
 *
 * Only values taken from the tool's own arguments are used. Text that came back
 * from a web page, document or earlier tool result never feeds this function, so
 * untrusted content cannot widen what the user approved.
 */
export function deriveGrantScope(toolName: string, args: Record<string, unknown>): GrantScope {
  switch (toolName) {
    case 'browser_navigate': {
      const origin = originOf(args.url);
      return origin ? { origin } : {};
    }
    case 'open_application': {
      const app = normaliseApp(args.name);
      return app ? { app } : {};
    }
    default:
      return {};
  }
}

/** True when a grant's target covers an invocation's target. */
export function scopeCovers(granted: GrantScope | undefined, wanted: GrantScope): boolean {
  if (!granted) return true;
  if (granted.origin !== undefined && granted.origin !== wanted.origin) return false;
  if (granted.app !== undefined && granted.app !== wanted.app) return false;
  return true;
}

export function originOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normaliseApp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase().replace(/\.exe$/, '');
  return cleaned.length > 0 ? cleaned : null;
}

/** Human description of a scope for the approval card. */
export function describeScope(scope: GrantScope): string {
  if (scope.origin) return `only ${scope.origin}`;
  if (scope.app) return `only ${scope.app}`;
  return 'this action anywhere';
}