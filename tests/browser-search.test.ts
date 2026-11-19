import { describe, expect, it, vi } from 'vitest';
import { createSearchUrl, MAX_SEARCH_QUERY_LENGTH, parseExplicitSearchCommand } from '../src/shared/browserSearch';
import { ToolExecutors } from '../src/main/agent/executors';
import { BUILTIN_TOOLS, evaluateInvocation } from '../src/main/agent/tools';
import { applyDecision, hasValidGrant } from '../src/main/agent/tools';
import type { PermissionGrant } from '../src/shared/types';

describe('default-browser search URLs', () => {
  it('encodes punctuation, spaces and Unicode for each supported provider', () => {
    for (const provider of ['google', 'bing', 'duckduckgo'] as const) {
      const url = new URL(createSearchUrl('naïve C++: 50% & cafés', provider));
      expect(url.protocol).toBe('https:');
      expect(url.searchParams.get('q')).toBe('naïve C++: 50% & cafés');
    }
    expect(new URL(createSearchUrl('test', 'google')).hostname).toBe('www.google.com');
    expect(new URL(createSearchUrl('test', 'bing')).hostname).toBe('www.bing.com');
    expect(new URL(createSearchUrl('test', 'duckduckgo')).hostname).toBe('duckduckgo.com');
  });

  it('rejects empty and oversized queries before producing a URL', () => {
    expect(() => createSearchUrl('   ', 'google')).toThrow(/enter a search query/i);
    expect(() => createSearchUrl('x'.repeat(MAX_SEARCH_QUERY_LENGTH + 1), 'google')).toThrow(/too long/i);
  });
});

describe('explicit search command routing', () => {
  it.each([
    ['Search the web for electric cars.', 'electric cars'],
    ['Pixel, search the web for NVIDIA graphics cards.', 'NVIDIA graphics cards'],
    ['search web for Debian setup', 'Debian setup'],
    ['Google how to install Debian', 'how to install Debian'],
    ['Look up Microsoft Windows documentation!', 'Microsoft Windows documentation'],
    ['Open a browser search for laptop RAM upgrades', 'laptop RAM upgrades'],
  ])('recognizes a direct search request: %s', (request, query) => {
    expect(parseExplicitSearchCommand(request)).toBe(query);
  });

  it('keeps ordinary questions and unsupported long queries in chat', () => {
    expect(parseExplicitSearchCommand('What is a search engine?')).toBeNull();
    expect(parseExplicitSearchCommand(`search for ${'x'.repeat(501)}`)).toBeNull();
  });
});

describe('approved browser search tool', () => {
  it('is a state-changing tool that requires approval and is unavailable in Guide mode', () => {
    const tool = BUILTIN_TOOLS.find((candidate) => candidate.name === 'browser_open_search');
    expect(tool).toMatchObject({ changesState: true, requiresApproval: true });
    expect(evaluateInvocation(tool, {
      mode: 'guide', grants: new Map(), stopped: false, audit: () => {}, args: { query: 'café' },
    }).allowed).toBe(false);
  });

  it('limits saved approval to the exact normalized search query', () => {
    const grant = applyDecision({ requestId: 'p', approved: true, duration: 'session' }, {
      toolName: 'browser_open_search', args: { query: '  Café   menu ' },
    }) as PermissionGrant;
    const grants = new Map([['browser_open_search', grant]]);
    const context = { mode: 'agent' as const, grants, stopped: false, audit: () => {}, args: { query: 'café menu' } };
    expect(hasValidGrant('browser_open_search', context)).toBe(true);
    expect(hasValidGrant('browser_open_search', { ...context, args: { query: 'another search' } })).toBe(false);
  });

  it('opens only the configured safe search URL and never claims to read results', async () => {
    const openExternal = vi.fn(async () => undefined);
    const executors = new ToolExecutors({
      openExternal,
      searchProvider: () => 'duckduckgo',
    });
    const result = await executors.run('browser_open_search', { query: 'weather in Nairobi' });
    expect(result.ok).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/duckduckgo\.com\//));
    expect(result.content).toMatch(/has not read the results/i);
  });

  it('reports unavailable launch and actual browser launch failures', async () => {
    const unavailable = await new ToolExecutors().run('browser_open_search', { query: 'weather' });
    expect(unavailable.ok).toBe(false);
    expect(unavailable.errorCode).toBe('UNAVAILABLE');

    const failing = await new ToolExecutors({
      openExternal: async () => { throw new Error('OS launch denied'); },
      searchProvider: () => 'google',
    }).run('browser_open_search', { query: 'weather' });
    expect(failing.ok).toBe(false);
    expect(failing.content).toContain('OS launch denied');
  });
});
