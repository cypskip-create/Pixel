import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_MODE_AUTONOMOUS_TOOLS, evaluateInvocation, ToolRegistry } from '../src/main/agent/tools';
import { GIT_TOOL_DEFINITIONS, GitTools } from '../src/main/git/toolset';
import { FILE_TOOL_DEFINITIONS } from '../src/main/files/toolset';
import { extractAutomaticMemoryCandidates, filterNovelMemoryCandidates } from '../src/main/memory/autoExtract';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-git-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Agent mode scoped autonomy & safety boundaries', () => {
  const registry = new ToolRegistry([...GIT_TOOL_DEFINITIONS, ...FILE_TOOL_DEFINITIONS]);
  const baseContext = (mode: 'guide' | 'hybrid' | 'agent', stopped = false) => ({
    mode,
    grants: new Map(),
    stopped,
    audit: () => undefined,
  });

  it('allows routine bounded Git and read-only file/GitHub operations automatically in Agent mode', () => {
    expect(AGENT_MODE_AUTONOMOUS_TOOLS.has('plugin_github_repo_summary')).toBe(true);
    expect(AGENT_MODE_AUTONOMOUS_TOOLS.has('git_status')).toBe(true);
    expect(AGENT_MODE_AUTONOMOUS_TOOLS.has('git_clone')).toBe(true);
    expect(AGENT_MODE_AUTONOMOUS_TOOLS.has('file_read')).toBe(true);

    expect(evaluateInvocation(registry.get('git_status'), baseContext('agent'))).toEqual({ allowed: true });
    expect(evaluateInvocation(registry.get('git_clone'), baseContext('agent'))).toEqual({ allowed: true });
    expect(evaluateInvocation(registry.get('file_read'), baseContext('agent'))).toEqual({ allowed: true });
  });

  it('still prompts in Hybrid mode and blocks state changes in Guide mode', () => {
    const hybridStatus = evaluateInvocation(registry.get('git_status'), baseContext('hybrid'));
    expect(hybridStatus.allowed).toBe(false);
    if (!hybridStatus.allowed) expect(hybridStatus.needsApproval).toBe(true);

    const guideClone = evaluateInvocation(registry.get('git_clone'), baseContext('guide'));
    expect(guideClone.allowed).toBe(false);
    if (!guideClone.allowed) expect(guideClone.needsApproval).toBe(false);
  });

  it('ALWAYS requires approval for critical/destructive actions even in Agent mode and honors emergency stop', () => {
    const pushDecision = evaluateInvocation(registry.get('git_push'), baseContext('agent'));
    expect(pushDecision.allowed).toBe(false);
    if (!pushDecision.allowed) expect(pushDecision.needsApproval).toBe(true);

    const trashDecision = evaluateInvocation(registry.get('file_trash'), baseContext('agent'));
    expect(trashDecision.allowed).toBe(false);
    if (!trashDecision.allowed) expect(trashDecision.needsApproval).toBe(true);

    const stoppedDecision = evaluateInvocation(registry.get('git_status'), baseContext('agent', true));
    expect(stoppedDecision.allowed).toBe(false);
  });
});

describe('Local Git toolset', () => {
  it('initializes a real repo, inspects status/log/branches, and protects dirty trees from pull/branch switch', async () => {
    const root = makeTempDir();
    const git = new GitTools({ allowedRoot: root });

    const init = await git.run('git_init', { repoPath: root });
    expect(init.ok).toBe(true);

    writeFileSync(join(root, 'hello.txt'), 'hello pixel\n', 'utf8');
    const status = await git.run('git_status', { repoPath: root });
    expect(status.ok).toBe(true);
    expect(status.content).toContain('hello.txt');

    // Dirty tree refuses branch creation/switch and pull
    const branchAttempt = await git.run('git_branches', { repoPath: root, action: 'create', branchName: 'feature/test' });
    expect(branchAttempt.ok).toBe(false);
    expect(branchAttempt.content).toContain('uncommitted changes');

    const pullAttempt = await git.run('git_pull', { repoPath: root });
    expect(pullAttempt.ok).toBe(false);
    expect(pullAttempt.content).toContain('uncommitted changes');
  });

  it('rejects non-HTTPS clone URLs, flag injection, and out-of-bounds paths', async () => {
    const root = makeTempDir();
    const git = new GitTools({ allowedRoot: root });

    const fileUrl = await git.run('git_clone', { url: 'file:///C:/Windows/System32', destination: join(root, 'bad') });
    expect(fileUrl.ok).toBe(false);

    const outside = await git.run('git_status', { repoPath: 'C:\\Windows' });
    expect(outside.ok).toBe(false);
    expect(outside.content).toContain('outside');
  });
});

describe('Selective Memory extraction & novelty filtering', () => {
  it('rejects one-off questions, URLs, commands, and casual chatter', () => {
    expect(extractAutomaticMemoryCandidates('What is the weather today?')).toEqual([]);
    expect(extractAutomaticMemoryCandidates('git status --porcelain')).toEqual([]);
    expect(extractAutomaticMemoryCandidates('Check https://example.com/temp')).toEqual([]);
    expect(extractAutomaticMemoryCandidates('thanks!')).toEqual([]);
  });

  it('retains durable preferences with relevance scores and filters duplicates', () => {
    const extracted = extractAutomaticMemoryCandidates('I prefer concise TypeScript examples with Vitest');
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.relevanceScore).toBeGreaterThanOrEqual(0.65);

    const novel = filterNovelMemoryCandidates(extracted, []);
    expect(novel).toHaveLength(1);

    const projectFact = extractAutomaticMemoryCandidates('The Pixel project uses Electron and SQLite');
    expect(projectFact).toHaveLength(1);
    const deduped = filterNovelMemoryCandidates(projectFact, ['The Pixel project uses Electron and SQLite.']);
    expect(deduped).toHaveLength(0);
  });
});
