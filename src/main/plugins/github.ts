import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isPrivateHost } from '../agent/netGuard';

export interface GitHubRepositorySummary {
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  openIssues: number;
  defaultBranch: string;
  updatedAt: string;
}

export interface GitHubAddress {
  address: string;
  family: number;
}

type ResolveGitHubHost = (hostname: string) => Promise<GitHubAddress[]>;
const GITHUB_API_HOST = 'api.github.com';
const resolveGitHubHost: ResolveGitHubHost = (hostname) => lookup(hostname, { all: true, verbatim: true });

/** Reads a fixed GitHub API host over TLS, pins a checked public DNS answer per request, and never accepts an arbitrary URL. */
export async function readPublicGitHubRepository(
  owner: unknown,
  repository: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
): Promise<GitHubRepositorySummary> {
  const ownerName = cleanPathSegment(owner, /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
  const repoName = cleanPathSegment(repository, /^[A-Za-z0-9_.-]{1,100}$/);
  if (!ownerName || !repoName) throw new Error('Provide a valid public GitHub owner and repository name.');
  if (signal?.aborted) throw new Error('Request cancelled.');

  const addresses = await resolveHost(GITHUB_API_HOST);
  // DNS itself may take longer than cancellation. Recheck before opening a TLS
  // socket so an aborted tool can never begin a provider request after lookup.
  if (signal?.aborted) throw new Error('Request cancelled.');
  if (addresses.length === 0 || addresses.some((entry) => (entry.family !== 4 && entry.family !== 6) || isPrivateHost(entry.address))) {
    throw new Error('GitHub API DNS returned an unsafe address; Pixel blocked the request.');
  }
  const address = addresses[0];
  const path = `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}`;
  const payload = await new Promise<unknown>((resolve, reject) => {
    const req = request({
      protocol: 'https:', hostname: address.address, family: address.family, port: 443,
      servername: GITHUB_API_HOST, method: 'GET', path,
      headers: { Host: 'api.github.com', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Pixel-Plugin/1.0' },
      timeout: 8_000,
    }, (response) => {
      const status = response.statusCode ?? 0;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part: string) => {
        body += part;
        if (body.length > 64_000) req.destroy(new Error('GitHub returned an unexpectedly large response.'));
      });
      response.on('end', () => {
        if (status === 404) return reject(new Error('That public repository was not found.'));
        if (status === 403 || status === 429) return reject(new Error('GitHub rate limited this request. Try again later or connect an account in a future plugin version.'));
        if (status < 200 || status >= 300) return reject(new Error(`GitHub returned HTTP ${status}.`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('GitHub returned invalid JSON.')); }
      });
      response.on('error', reject);
    });
    const onAbort = (): void => { req.destroy(new Error('Request cancelled.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out.')));
    req.on('error', reject);
    req.end();
  });

  if (!payload || typeof payload !== 'object') throw new Error('GitHub returned an invalid repository record.');
  const data = payload as Record<string, unknown>;
  if (typeof data.full_name !== 'string' || typeof data.html_url !== 'string') throw new Error('GitHub response did not contain repository identity fields.');
  return {
    fullName: data.full_name.slice(0, 150),
    description: typeof data.description === 'string' ? data.description.slice(0, 500) : null,
    url: data.html_url.slice(0, 300),
    stars: safeCount(data.stargazers_count),
    forks: safeCount(data.forks_count),
    openIssues: safeCount(data.open_issues_count),
    defaultBranch: typeof data.default_branch === 'string' ? data.default_branch.slice(0, 100) : '',
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at.slice(0, 40) : '',
  };
}

function cleanPathSegment(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) && !trimmed.includes('..') ? trimmed : null;
}

function safeCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}
