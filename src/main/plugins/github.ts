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

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  updatedAt: string;
}

export interface GitHubBranchSummary {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitHubWorkflowRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  url: string;
}

async function githubApiGet(
  path: string,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<unknown> {
  if (signal?.aborted) throw new Error('Request cancelled.');
  const addresses = await resolveHost(GITHUB_API_HOST);
  if (signal?.aborted) throw new Error('Request cancelled.');
  if (addresses.length === 0 || addresses.some((entry) => (entry.family !== 4 && entry.family !== 6) || isPrivateHost(entry.address))) {
    throw new Error('GitHub API DNS returned an unsafe address; Pixel blocked the request.');
  }
  const address = addresses[0];
  return new Promise<unknown>((resolvePromise, rejectPromise) => {
    const headers: Record<string, string> = {
      Host: 'api.github.com',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Pixel-Plugin/1.1',
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const req = request({
      protocol: 'https:', hostname: address.address, family: address.family, port: 443,
      servername: GITHUB_API_HOST, method: 'GET', path, headers, timeout: 8_000,
    }, (response) => {
      const status = response.statusCode ?? 0;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part: string) => {
        body += part;
        if (body.length > 128_000) req.destroy(new Error('GitHub returned an unexpectedly large response.'));
      });
      response.on('end', () => {
        if (status === 404) return rejectPromise(new Error('Requested GitHub resource was not found.'));
        if (status === 403 || status === 429) return rejectPromise(new Error('GitHub rate limited this request.'));
        if (status < 200 || status >= 300) return rejectPromise(new Error(`GitHub returned HTTP ${status}.`));
        try { resolvePromise(JSON.parse(body)); } catch { rejectPromise(new Error('GitHub returned invalid JSON.')); }
      });
      response.on('error', rejectPromise);
    });
    const onAbort = (): void => { req.destroy(new Error('Request cancelled.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out.')));
    req.on('error', rejectPromise);
    req.end();
  });
}

function validateOwnerRepo(owner: unknown, repository: unknown): { ownerName: string; repoName: string } {
  const ownerName = cleanPathSegment(owner, /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
  const repoName = cleanPathSegment(repository, /^[A-Za-z0-9_.-]{1,100}$/);
  if (!ownerName || !repoName) throw new Error('Provide a valid public GitHub owner and repository name.');
  return { ownerName, repoName };
}

export async function listPublicGitHubIssues(
  owner: unknown,
  repository: unknown,
  state: 'open' | 'closed' | 'all' = 'open',
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubIssueSummary[]> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const payload = await githubApiGet(
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/issues?state=${state}&per_page=20`,
    signal, resolveHost, authToken,
  );
  if (!Array.isArray(payload)) throw new Error('GitHub returned an invalid issues payload.');
  return payload
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !('pull_request' in item)))
    .slice(0, 20)
    .map((item) => ({
      number: safeCount(item.number),
      title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
      state: typeof item.state === 'string' ? item.state.slice(0, 20) : '',
      url: typeof item.html_url === 'string' ? item.html_url.slice(0, 300) : '',
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at.slice(0, 40) : '',
    }));
}

export async function listPublicGitHubPullRequests(
  owner: unknown,
  repository: unknown,
  state: 'open' | 'closed' | 'all' = 'open',
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubIssueSummary[]> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const payload = await githubApiGet(
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/pulls?state=${state}&per_page=20`,
    signal, resolveHost, authToken,
  );
  if (!Array.isArray(payload)) throw new Error('GitHub returned an invalid pull requests payload.');
  return payload
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 20)
    .map((item) => ({
      number: safeCount(item.number),
      title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
      state: typeof item.state === 'string' ? item.state.slice(0, 20) : '',
      url: typeof item.html_url === 'string' ? item.html_url.slice(0, 300) : '',
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at.slice(0, 40) : '',
    }));
}

export async function listPublicGitHubBranches(
  owner: unknown,
  repository: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubBranchSummary[]> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const payload = await githubApiGet(
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/branches?per_page=30`,
    signal, resolveHost, authToken,
  );
  if (!Array.isArray(payload)) throw new Error('GitHub returned an invalid branches payload.');
  return payload
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 30)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.slice(0, 120) : '',
      sha: typeof (item.commit as Record<string, unknown> | undefined)?.sha === 'string'
        ? String((item.commit as Record<string, unknown>).sha).slice(0, 40)
        : '',
      protected: item.protected === true,
    }));
}

export async function listPublicGitHubWorkflowRuns(
  owner: unknown,
  repository: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubWorkflowRunSummary[]> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const payload = await githubApiGet(
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/actions/runs?per_page=10`,
    signal, resolveHost, authToken,
  );
  const runs = (payload as Record<string, unknown> | null)?.workflow_runs;
  if (!Array.isArray(runs)) throw new Error('GitHub returned an invalid workflow runs payload.');
  return runs
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 10)
    .map((item) => ({
      id: safeCount(item.id),
      name: typeof item.name === 'string' ? item.name.slice(0, 120) : '',
      status: typeof item.status === 'string' ? item.status.slice(0, 40) : '',
      conclusion: typeof item.conclusion === 'string' ? item.conclusion.slice(0, 40) : null,
      branch: typeof item.head_branch === 'string' ? item.head_branch.slice(0, 120) : '',
      url: typeof item.html_url === 'string' ? item.html_url.slice(0, 300) : '',
    }));
}

export async function readPublicGitHubFile(
  owner: unknown,
  repository: unknown,
  filePath: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<{ path: string; size: number; content: string }> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const cleanedPath = typeof filePath === 'string' ? filePath.trim().replace(/^\/+/, '') : '';
  if (!cleanedPath || cleanedPath.includes('..') || cleanedPath.length > 300) {
    throw new Error('Provide a valid relative repository file path.');
  }
  const encodedPath = cleanedPath.split('/').map(encodeURIComponent).join('/');
  const payload = await githubApiGet(
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/contents/${encodedPath}`,
    signal, resolveHost, authToken,
  );
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Requested path is a directory or returned an unsupported GitHub payload.');
  }
  const data = payload as Record<string, unknown>;
  const raw = typeof data.content === 'string' ? Buffer.from(data.content, 'base64').toString('utf8') : '';
  return {
    path: typeof data.path === 'string' ? data.path.slice(0, 300) : cleanedPath,
    size: safeCount(data.size),
    content: raw.slice(0, 16_000),
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
