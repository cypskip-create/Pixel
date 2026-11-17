import type { SearchProvider } from './types';

export const MAX_SEARCH_QUERY_LENGTH = 500;

const SEARCH_BASES: Record<SearchProvider, string> = {
  google: 'https://www.google.com/search',
  bing: 'https://www.bing.com/search',
  duckduckgo: 'https://duckduckgo.com/',
};

/** Build a URL only for a known HTTPS search provider. */
export function createSearchUrl(query: string, provider: SearchProvider): string {
  const cleaned = query.trim();
  if (!cleaned) throw new Error('Enter a search query.');
  if (cleaned.length > MAX_SEARCH_QUERY_LENGTH) throw new Error('Search query is too long.');
  const base = SEARCH_BASES[provider];
  if (!base) throw new Error('Unsupported search provider.');
  const url = new URL(base);
  url.searchParams.set('q', cleaned);
  return url.toString();
}

/** Only parse direct, explicit search commands; ordinary questions stay in chat. */
export function parseExplicitSearchCommand(text: string): string | null {
  const match = text.trim().match(/^(?:pixel[, :]\s*)?(?:search(?:\s+(?:the\s+)?web)?\s+for|open\s+(?:a\s+)?browser\s+search\s+for|look\s+up|google|bing|duckduckgo)\s+(.+?)\s*[.!?]?$/i);
  const query = match?.[1]?.trim();
  return query && query.length > 0 && query.length <= MAX_SEARCH_QUERY_LENGTH ? query : null;
}
