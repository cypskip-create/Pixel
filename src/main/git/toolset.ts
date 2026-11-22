/**
 * Local Git toolset for Pixel.
 *
 * Security & safety invariants:
 *  - Executes `git` via `execFile` with `shell: false` (never shell interpolation).
 *  - Restricts repository paths to `allowedRoot` (defaults to current user's home).
 *  - `git_clone` accepts only validated `https://` URLs (refuses `file://`, `ext::`, `-` flags).
 *  - `git_pull` uses `--ff-only` and refuses dirty working trees so uncommitted work is never overwritten.
 *  - `git_push` is `critical` risk, always requires explicit approval, and never allows `--force`.
 */

import { execFile } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ToolDefinition } from '../../shared/types';
import type { ToolResult } from '../agent/executors';

const MAX_OUTPUT_CHARS = 16_000;
const GIT_TIMEOUT_MS = 25_000;

export const GIT_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'git_status',
    description: 'Inspects Git repository status: current branch, staged/unstaged/untracked files, and merge conflicts.',
    category: 'code',
    risk: 'low',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: { repoPath: { type: 'string', minLength: 1, maxLength: 500 } },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_diff',
    description: 'Returns a bounded Git diff (unstaged or staged) for a local repository.',
    category: 'code',
    risk: 'low',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        staged: { type: 'boolean' },
        filePath: { type: 'string', maxLength: 300 },
      },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_log',
    description: 'Lists recent commits from a local Git repository.',
    category: 'code',
    risk: 'low',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_branches',
    description: 'Lists local Git branches, or creates/switches a branch when working tree is clean.',
    category: 'code',
    risk: 'medium',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        action: { type: 'string', enum: ['list', 'create', 'switch'] },
        branchName: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_clone',
    description: 'Clones a public HTTPS Git repository into a new validated destination folder under the user home directory.',
    category: 'code',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 12, maxLength: 400 },
        destination: { type: 'string', minLength: 1, maxLength: 500 },
        depth: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['url', 'destination'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_init',
    description: 'Initializes a new local Git repository in a validated directory.',
    category: 'code',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: { repoPath: { type: 'string', minLength: 1, maxLength: 500 } },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_fetch',
    description: 'Fetches remote refs without modifying the local working tree.',
    category: 'code',
    risk: 'low',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        remote: { type: 'string', maxLength: 80 },
      },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_pull',
    description: 'Fast-forward pulls updates when the working tree has no uncommitted changes.',
    category: 'code',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        remote: { type: 'string', maxLength: 80 },
        branch: { type: 'string', maxLength: 120 },
      },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_commit',
    description: 'Stages explicit relative paths and creates a local Git commit.',
    category: 'code',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 300 }, minItems: 1, maxItems: 50 },
        message: { type: 'string', minLength: 3, maxLength: 500 },
      },
      required: ['repoPath', 'paths', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_push',
    description: 'Pushes committed changes to a remote branch. Always requires explicit each-call approval; force pushes are prohibited.',
    category: 'code',
    risk: 'critical',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        remote: { type: 'string', maxLength: 80 },
        branch: { type: 'string', maxLength: 120 },
      },
      required: ['repoPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_revert',
    description: 'Creates a new revert commit for one validated commit SHA without rewriting history.',
    category: 'code',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', minLength: 1, maxLength: 500 },
        commit: { type: 'string', minLength: 7, maxLength: 40 },
      },
      required: ['repoPath', 'commit'],
      additionalProperties: false,
    },
  },
];

export type GitRunner = (args: string[], cwd: string, signal?: AbortSignal) => Promise<{ stdout: string; stderr: string }>;

function defaultGitRunner(args: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('git', args, {
      cwd,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1_024 * 1_024,
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr?.trim() || error.message));
        return;
      }
      resolvePromise({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function isValidRefName(value: string): boolean {
  return /^[A-Za-z0-9._/-]{1,120}$/.test(value)
    && !value.startsWith('-')
    && !value.includes('..')
    && !value.endsWith('.lock')
    && !value.startsWith('/')
    && !value.endsWith('/');
}

function isValidHttpsGitUrl(raw: string): boolean {
  if (raw.startsWith('-')) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated ${text.length - MAX_OUTPUT_CHARS} chars)`;
}

const GIT_TOOL_NAMES = new Set(GIT_TOOL_DEFINITIONS.map((tool) => tool.name));

export class GitTools {
  private readonly allowedRoot: string;
  private readonly runGit: GitRunner;

  constructor(options: { allowedRoot?: string; runGit?: GitRunner } = {}) {
    this.allowedRoot = resolve(options.allowedRoot ?? homedir());
    this.runGit = options.runGit ?? defaultGitRunner;
  }

  handles(name: string): boolean {
    return GIT_TOOL_NAMES.has(name);
  }

  private assertAllowedPath(targetPath: string, mustExist: boolean): string {
    if (!targetPath || !isAbsolute(targetPath)) {
      throw new Error('Provide an absolute path inside the allowed workspace/home directory.');
    }
    const resolved = resolve(targetPath);
    const rootNorm = process.platform === 'win32' ? this.allowedRoot.toLowerCase() : this.allowedRoot;
    const targetNorm = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (targetNorm !== rootNorm && !targetNorm.startsWith(`${rootNorm}${sep}`)) {
      throw new Error('Path is outside the allowed user home/workspace boundary.');
    }
    if (mustExist) {
      if (!existsSync(resolved)) throw new Error('Target directory does not exist.');
      const real = realpathSync(resolved);
      const realNorm = process.platform === 'win32' ? real.toLowerCase() : real;
      if (realNorm !== rootNorm && !realNorm.startsWith(`${rootNorm}${sep}`)) {
        throw new Error('Resolved symlink escapes the allowed boundary.');
      }
      if (!lstatSync(resolved).isDirectory()) throw new Error('Target path must be a directory.');
    } else {
      if (existsSync(resolved)) throw new Error('Destination already exists; Pixel refuses to overwrite existing directories.');
      const parent = dirname(resolved);
      if (!existsSync(parent)) throw new Error('Parent directory does not exist.');
    }
    return resolved;
  }

  private sanitizeRelativePaths(paths: unknown): string[] {
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('Provide at least one relative file path.');
    const cleaned: string[] = [];
    for (const item of paths) {
      if (typeof item !== 'string' || !item.trim()) throw new Error('Invalid file path in paths list.');
      const trimmed = item.trim();
      if (trimmed.startsWith('-') || isAbsolute(trimmed)) throw new Error(`Refused unsafe path argument "${trimmed}".`);
      const rel = relative(this.allowedRoot, resolve(this.allowedRoot, trimmed));
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path "${trimmed}" escapes repository root.`);
      cleaned.push(trimmed);
    }
    return cleaned;
  }

  async run(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    try {
      switch (name) {
        case 'git_status': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const { stdout } = await this.runGit(['status', '--porcelain=v1', '--branch'], repo, signal);
          const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
          const conflicts = lines.filter((line) => /^(?:UU|AA|DD|AU|UA|DU|UD)\s/.test(line));
          return {
            ok: true,
            content: truncate(stdout.trim() || 'Working tree clean.'),
            verification: {
              summary: conflicts.length > 0
                ? `Git status reported ${conflicts.length} merge conflict(s).`
                : 'Git status read from local repository.',
              source: 'git status --porcelain=v1 --branch',
            },
          };
        }

        case 'git_diff': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const gitArgs = ['diff'];
          if (args.staged === true) gitArgs.push('--cached');
          if (typeof args.filePath === 'string' && args.filePath.trim()) {
            const [safePath] = this.sanitizeRelativePaths([args.filePath]);
            gitArgs.push('--', safePath);
          }
          const { stdout } = await this.runGit(gitArgs, repo, signal);
          return {
            ok: true,
            content: truncate(stdout.trim() || 'No differences.'),
            verification: { summary: 'Bounded Git diff inspected.', source: 'git diff' },
          };
        }

        case 'git_log': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const limit = Math.max(1, Math.min(50, Number(args.limit ?? 15) || 15));
          const { stdout } = await this.runGit(['log', `-n`, String(limit), '--oneline', '--decorate'], repo, signal);
          return {
            ok: true,
            content: truncate(stdout.trim() || 'No commits yet.'),
            verification: { summary: `Inspected up to ${limit} commits.`, source: 'git log' },
          };
        }

        case 'git_branches': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const action = String(args.action ?? 'list');
          if (action === 'list') {
            const { stdout } = await this.runGit(['branch', '--list', '-v'], repo, signal);
            return { ok: true, content: truncate(stdout.trim() || 'No branches yet.') };
          }
          const branch = String(args.branchName ?? '').trim();
          if (!isValidRefName(branch)) return { ok: false, content: 'Invalid Git branch name.' };
          const status = await this.runGit(['status', '--porcelain=v1'], repo, signal);
          if (status.stdout.trim()) {
            return { ok: false, content: 'Working tree has uncommitted changes. Commit or stash them before switching branches.' };
          }
          const cmd = action === 'create' ? ['checkout', '-b', branch] : ['checkout', branch];
          const { stdout, stderr } = await this.runGit(cmd, repo, signal);
          return {
            ok: true,
            content: truncate((stdout || stderr).trim() || `Switched to branch ${branch}.`),
            verification: { summary: `Branch operation (${action} ${branch}) verified.`, source: 'git checkout' },
          };
        }

        case 'git_clone': {
          const url = String(args.url ?? '').trim();
          if (!isValidHttpsGitUrl(url)) {
            return { ok: false, content: 'Only valid public https:// Git URLs are allowed for git_clone.' };
          }
          const dest = this.assertAllowedPath(String(args.destination ?? ''), false);
          const gitArgs = ['clone'];
          if (typeof args.depth === 'number' && args.depth >= 1 && args.depth <= 50) {
            gitArgs.push('--depth', String(Math.floor(args.depth)));
          }
          gitArgs.push('--', url, dest);
          await this.runGit(gitArgs, dirname(dest), signal);
          if (!existsSync(resolve(dest, '.git'))) {
            return { ok: false, content: 'Clone finished without creating a .git directory.' };
          }
          return {
            ok: true,
            content: `Cloned ${url} into ${dest}.`,
            verification: { summary: 'Verified .git directory in cloned destination.', source: 'git clone' },
          };
        }

        case 'git_init': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const { stdout } = await this.runGit(['init'], repo, signal);
          return {
            ok: true,
            content: truncate(stdout.trim() || `Initialized Git repository in ${repo}.`),
            verification: { summary: 'Initialized local Git repository.', source: 'git init' },
          };
        }

        case 'git_fetch': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const remote = typeof args.remote === 'string' && args.remote.trim() ? args.remote.trim() : 'origin';
          if (!isValidRefName(remote)) return { ok: false, content: 'Invalid remote name.' };
          const { stdout, stderr } = await this.runGit(['fetch', '--', remote], repo, signal);
          return { ok: true, content: truncate((stdout || stderr).trim() || `Fetched from ${remote}.`) };
        }

        case 'git_pull': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const status = await this.runGit(['status', '--porcelain=v1'], repo, signal);
          if (status.stdout.trim()) {
            return { ok: false, content: 'Refused git_pull because the working tree has uncommitted changes.' };
          }
          const remote = typeof args.remote === 'string' && args.remote.trim() ? args.remote.trim() : 'origin';
          if (!isValidRefName(remote)) return { ok: false, content: 'Invalid remote name.' };
          const pullArgs = ['pull', '--ff-only', '--', remote];
          if (typeof args.branch === 'string' && args.branch.trim()) {
            if (!isValidRefName(args.branch.trim())) return { ok: false, content: 'Invalid branch name.' };
            pullArgs.push(args.branch.trim());
          }
          const { stdout, stderr } = await this.runGit(pullArgs, repo, signal);
          return {
            ok: true,
            content: truncate((stdout || stderr).trim() || 'Fast-forward pull completed.'),
            verification: { summary: 'Fast-forward pull verified.', source: 'git pull --ff-only' },
          };
        }

        case 'git_commit': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const paths = this.sanitizeRelativePaths(args.paths);
          const message = String(args.message ?? '').trim();
          if (message.length < 3 || message.length > 500) {
            return { ok: false, content: 'Commit message must be between 3 and 500 characters.' };
          }
          await this.runGit(['add', '--', ...paths], repo, signal);
          const { stdout } = await this.runGit(['commit', '-m', message], repo, signal);
          return {
            ok: true,
            content: truncate(stdout.trim() || 'Commit created.'),
            verification: { summary: `Committed ${paths.length} path(s).`, source: 'git commit' },
          };
        }

        case 'git_push': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const remote = typeof args.remote === 'string' && args.remote.trim() ? args.remote.trim() : 'origin';
          if (!isValidRefName(remote)) return { ok: false, content: 'Invalid remote name.' };
          const pushArgs = ['push', '--', remote];
          if (typeof args.branch === 'string' && args.branch.trim()) {
            if (!isValidRefName(args.branch.trim())) return { ok: false, content: 'Invalid branch name.' };
            pushArgs.push(args.branch.trim());
          }
          const { stdout, stderr } = await this.runGit(pushArgs, repo, signal);
          return {
            ok: true,
            content: truncate((stdout || stderr).trim() || `Pushed to ${remote}.`),
            verification: { summary: `Pushed commits to ${remote}.`, source: 'git push' },
          };
        }

        case 'git_revert': {
          const repo = this.assertAllowedPath(String(args.repoPath ?? ''), true);
          const commit = String(args.commit ?? '').trim();
          if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
            return { ok: false, content: 'Provide a valid 7–40 character hexadecimal commit SHA.' };
          }
          const status = await this.runGit(['status', '--porcelain=v1'], repo, signal);
          if (status.stdout.trim()) {
            return { ok: false, content: 'Refused git_revert because the working tree has uncommitted changes.' };
          }
          const { stdout } = await this.runGit(['revert', '--no-edit', commit], repo, signal);
          return {
            ok: true,
            content: truncate(stdout.trim() || `Reverted commit ${commit}.`),
            verification: { summary: `Created revert commit for ${commit}.`, source: 'git revert --no-edit' },
          };
        }

        default:
          return { ok: false, content: `Unknown git tool "${name}".` };
      }
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : 'Git operation failed.' };
    }
  }
}
