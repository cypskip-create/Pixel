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
  authToken?: string | null,
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
  const reqHeaders: Record<string, string> = {
    Host: 'api.github.com',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Pixel-Plugin/1.2',
  };
  if (authToken) reqHeaders.Authorization = `Bearer ${authToken}`;
  const payload = await new Promise<unknown>((resolve, reject) => {
    const req = request({
      protocol: 'https:', hostname: address.address, family: address.family, port: 443,
      servername: GITHUB_API_HOST, method: 'GET', path,
      headers: reqHeaders,
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

export interface GitHubAccountVerification {
  login: string;
  name: string | null;
  scopes: string[];
}

export interface GitHubDirEntry {
  name: string;
  path: string;
  type: string;
  size: number;
}

export interface GitHubCommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GitHubIssueDetail extends GitHubIssueSummary {
  body: string;
  author: string;
  comments: number;
  labels: string[];
}

async function githubApiRequest(
  method: 'GET' | 'POST',
  path: string,
  options: {
    body?: Record<string, unknown>;
    signal?: AbortSignal;
    resolveHost?: ResolveGitHubHost;
    authToken?: string | null;
  } = {},
): Promise<{ data: unknown; headers: Record<string, string | string[] | undefined> }> {
  const { body, signal, resolveHost = resolveGitHubHost, authToken } = options;
  if (signal?.aborted) throw new Error('Request cancelled.');
  const addresses = await resolveHost(GITHUB_API_HOST);
  if (signal?.aborted) throw new Error('Request cancelled.');
  if (addresses.length === 0 || addresses.some((entry) => (entry.family !== 4 && entry.family !== 6) || isPrivateHost(entry.address))) {
    throw new Error('GitHub API DNS returned an unsafe address; Pixel blocked the request.');
  }
  const address = addresses[0];
  const serialized = body ? JSON.stringify(body) : null;
  return new Promise((resolvePromise, rejectPromise) => {
    const headers: Record<string, string> = {
      Host: 'api.github.com',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Pixel-Plugin/1.2',
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (serialized !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(serialized, 'utf8'));
    }
    const req = request({
      protocol: 'https:',
      hostname: address.address,
      family: address.family,
      port: 443,
      servername: GITHUB_API_HOST,
      method,
      path,
      headers,
      timeout: 10_000,
    }, (response) => {
      const status = response.statusCode ?? 0;
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (part: string) => {
        raw += part;
        if (raw.length > 200_000) req.destroy(new Error('GitHub returned an unexpectedly large response.'));
      });
      response.on('end', () => {
        if (status === 401) return rejectPromise(new Error('GitHub rejected the token (401 Unauthorized). Reconnect or replace the token.'));
        if (status === 404) return rejectPromise(new Error('Requested GitHub resource was not found (or requires authentication).'));
        if (status === 403 || status === 429) return rejectPromise(new Error('GitHub rate limited or refused this request (403/429).'));
        if (status === 422) return rejectPromise(new Error(`GitHub validation failed (422): ${raw.slice(0, 240)}`));
        if (status < 200 || status >= 300) return rejectPromise(new Error(`GitHub returned HTTP ${status}.`));
        try {
          resolvePromise({ data: raw ? JSON.parse(raw) : {}, headers: response.headers });
        } catch {
          rejectPromise(new Error('GitHub returned invalid JSON.'));
        }
      });
      response.on('error', rejectPromise);
    });
    const onAbort = (): void => { req.destroy(new Error('Request cancelled.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out.')));
    req.on('error', rejectPromise);
    if (serialized !== null) req.write(serialized);
    req.end();
  });
}

/** Verifies a GitHub token against GET /user and returns non-secret account metadata + granted scopes. */
export async function verifyGitHubToken(
  token: string,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
): Promise<GitHubAccountVerification> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('A GitHub token is required.');
  const { data, headers } = await githubApiRequest('GET', '/user', { signal, resolveHost, authToken: trimmed });
  if (!data || typeof data !== 'object') throw new Error('GitHub returned an invalid user profile.');
  const rec = data as Record<string, unknown>;
  if (typeof rec.login !== 'string' || !rec.login) throw new Error('GitHub user response missing login.');
  const scopeHeader = headers['x-oauth-scopes'];
  const rawScopes = typeof scopeHeader === 'string' ? scopeHeader : Array.isArray(scopeHeader) ? scopeHeader.join(',') : '';
  const scopes = rawScopes.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    login: rec.login.slice(0, 80),
    name: typeof rec.name === 'string' ? rec.name.slice(0, 120) : null,
    scopes,
  };
}

export async function listGitHubDirectory(
  owner: unknown,
  repository: unknown,
  dirPath: unknown = '',
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubDirEntry[]> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const cleaned = typeof dirPath === 'string' ? dirPath.trim().replace(/^\/+|\/+$/g, '') : '';
  if (cleaned.includes('..') || cleaned.length > 300) throw new Error('Invalid repository directory path.');
  const encoded = cleaned ? `/${cleaned.split('/').map(encodeURIComponent).join('/')}` : '';
  const { data } = await githubApiRequest(
    'GET',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/contents${encoded}`,
    { signal, resolveHost, authToken },
  );
  if (!Array.isArray(data)) throw new Error('Requested GitHub path is a file, not a directory.');
  return data
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 60)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.slice(0, 150) : '',
      path: typeof item.path === 'string' ? item.path.slice(0, 300) : '',
      type: typeof item.type === 'string' ? item.type.slice(0, 20) : 'file',
      size: safeCount(item.size),
    }));
}

export async function listGitHubCommits(
  owner: unknown,
  repository: unknown,
  branch?: string,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubCommitSummary[]> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const shaQuery = branch && /^[A-Za-z0-9._/-]{1,120}$/.test(branch) ? `&sha=${encodeURIComponent(branch)}` : '';
  const { data } = await githubApiRequest(
    'GET',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/commits?per_page=15${shaQuery}`,
    { signal, resolveHost, authToken },
  );
  if (!Array.isArray(data)) throw new Error('GitHub returned an invalid commits payload.');
  return data
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 15)
    .map((item) => {
      const commit = (item.commit && typeof item.commit === 'object' ? item.commit : {}) as Record<string, unknown>;
      const author = (commit.author && typeof commit.author === 'object' ? commit.author : {}) as Record<string, unknown>;
      return {
        sha: typeof item.sha === 'string' ? item.sha.slice(0, 12) : '',
        message: typeof commit.message === 'string' ? commit.message.split('\n')[0].slice(0, 180) : '',
        author: typeof author.name === 'string' ? author.name.slice(0, 80) : '',
        date: typeof author.date === 'string' ? author.date.slice(0, 40) : '',
        url: typeof item.html_url === 'string' ? item.html_url.slice(0, 300) : '',
      };
    });
}

export async function compareGitHubCommits(
  owner: unknown,
  repository: unknown,
  base: unknown,
  head: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<{ status: string; aheadBy: number; behindBy: number; totalCommits: number; files: Array<{ filename: string; status: string; additions: number; deletions: number }> }> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const baseRef = cleanPathSegment(base, /^[A-Za-z0-9._/-]{1,120}$/);
  const headRef = cleanPathSegment(head, /^[A-Za-z0-9._/-]{1,120}$/);
  if (!baseRef || !headRef) throw new Error('Provide valid base and head branch/commit refs.');
  const { data } = await githubApiRequest(
    'GET',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`,
    { signal, resolveHost, authToken },
  );
  if (!data || typeof data !== 'object') throw new Error('GitHub returned an invalid compare payload.');
  const rec = data as Record<string, unknown>;
  const rawFiles = Array.isArray(rec.files) ? rec.files : [];
  return {
    status: typeof rec.status === 'string' ? rec.status.slice(0, 30) : 'unknown',
    aheadBy: safeCount(rec.ahead_by),
    behindBy: safeCount(rec.behind_by),
    totalCommits: safeCount(rec.total_commits),
    files: rawFiles
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
      .slice(0, 40)
      .map((f) => ({
        filename: typeof f.filename === 'string' ? f.filename.slice(0, 260) : '',
        status: typeof f.status === 'string' ? f.status.slice(0, 20) : '',
        additions: safeCount(f.additions),
        deletions: safeCount(f.deletions),
      })),
  };
}

export async function readGitHubIssueDetail(
  owner: unknown,
  repository: unknown,
  issueNumber: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<GitHubIssueDetail> {
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const num = Number(issueNumber);
  if (!Number.isInteger(num) || num < 1) throw new Error('Provide a positive integer issue number.');
  const { data } = await githubApiRequest(
    'GET',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/issues/${num}`,
    { signal, resolveHost, authToken },
  );
  if (!data || typeof data !== 'object') throw new Error('GitHub returned an invalid issue record.');
  const rec = data as Record<string, unknown>;
  const user = (rec.user && typeof rec.user === 'object' ? rec.user : {}) as Record<string, unknown>;
  const labels = Array.isArray(rec.labels)
    ? rec.labels.map((l) => (l && typeof l === 'object' && typeof (l as Record<string, unknown>).name === 'string' ? String((l as Record<string, unknown>).name) : '')).filter(Boolean).slice(0, 15)
    : [];
  return {
    number: safeCount(rec.number),
    title: typeof rec.title === 'string' ? rec.title.slice(0, 200) : '',
    state: typeof rec.state === 'string' ? rec.state.slice(0, 20) : '',
    url: typeof rec.html_url === 'string' ? rec.html_url.slice(0, 300) : '',
    updatedAt: typeof rec.updated_at === 'string' ? rec.updated_at.slice(0, 40) : '',
    body: typeof rec.body === 'string' ? rec.body.slice(0, 8_000) : '',
    author: typeof user.login === 'string' ? user.login.slice(0, 80) : '',
    comments: safeCount(rec.comments),
    labels,
  };
}

export async function createGitHubIssue(
  owner: unknown,
  repository: unknown,
  title: unknown,
  body: unknown,
  labels: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<{ number: number; url: string; title: string }> {
  if (!authToken) throw new Error('Connect a GitHub account in Settings → Plugins & Connections before creating issues.');
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 250) : '';
  if (!cleanTitle) throw new Error('Issue title is required.');
  const cleanBody = typeof body === 'string' ? body.slice(0, 16_000) : '';
  const cleanLabels = Array.isArray(labels)
    ? labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim().slice(0, 50)).slice(0, 10)
    : undefined;
  const { data } = await githubApiRequest(
    'POST',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/issues`,
    {
      body: { title: cleanTitle, body: cleanBody, ...(cleanLabels?.length ? { labels: cleanLabels } : {}) },
      signal,
      resolveHost,
      authToken,
    },
  );
  const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    number: safeCount(rec.number),
    url: typeof rec.html_url === 'string' ? rec.html_url.slice(0, 300) : '',
    title: typeof rec.title === 'string' ? rec.title.slice(0, 250) : cleanTitle,
  };
}

export async function commentGitHubIssue(
  owner: unknown,
  repository: unknown,
  issueNumber: unknown,
  body: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<{ id: number; url: string }> {
  if (!authToken) throw new Error('Connect a GitHub account in Settings → Plugins & Connections before commenting on issues.');
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const num = Number(issueNumber);
  if (!Number.isInteger(num) || num < 1) throw new Error('Provide a positive integer issue/PR number.');
  const cleanBody = typeof body === 'string' ? body.trim().slice(0, 16_000) : '';
  if (!cleanBody) throw new Error('Comment body is required.');
  const { data } = await githubApiRequest(
    'POST',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/issues/${num}/comments`,
    { body: { body: cleanBody }, signal, resolveHost, authToken },
  );
  const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    id: safeCount(rec.id),
    url: typeof rec.html_url === 'string' ? rec.html_url.slice(0, 300) : '',
  };
}

export async function createGitHubPullRequest(
  owner: unknown,
  repository: unknown,
  title: unknown,
  head: unknown,
  base: unknown,
  body: unknown,
  signal?: AbortSignal,
  resolveHost: ResolveGitHubHost = resolveGitHubHost,
  authToken?: string | null,
): Promise<{ number: number; url: string; title: string }> {
  if (!authToken) throw new Error('Connect a GitHub account in Settings → Plugins & Connections before creating pull requests.');
  const { ownerName, repoName } = validateOwnerRepo(owner, repository);
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 250) : '';
  const cleanHead = cleanPathSegment(head, /^[A-Za-z0-9._:/-]{1,120}$/);
  const cleanBase = cleanPathSegment(base, /^[A-Za-z0-9._/-]{1,120}$/);
  if (!cleanTitle || !cleanHead || !cleanBase) throw new Error('Pull request title, head branch, and base branch are required.');
  const cleanBody = typeof body === 'string' ? body.slice(0, 16_000) : '';
  const { data } = await githubApiRequest(
    'POST',
    `/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/pulls`,
    { body: { title: cleanTitle, head: cleanHead, base: cleanBase, body: cleanBody }, signal, resolveHost, authToken },
  );
  const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    number: safeCount(rec.number),
    url: typeof rec.html_url === 'string' ? rec.html_url.slice(0, 300) : '',
    title: typeof rec.title === 'string' ? rec.title.slice(0, 250) : cleanTitle,
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
