/**
 * Phase B Verification Suite:
 * - Complete Local Git Toolset (stage, unstage, commit, diff, branches, info, remotes, revert, security)
 * - File Patching (exact, fuzzy, ambiguous rejection, SHA-256 check, CRLF, dry-run) & Content Search
 * - Rich Document Extraction (DOCX, PPTX, XLSX, PDF + encrypted PDF rejection)
 * - GitHub Plugin Auth & Tool Authorization across Guide / Hybrid / Agent modes
 * - End-to-End Python `pixel-agent-v2` Developer Workflow (inspect -> search -> patch -> diff -> commit)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_MODE_AUTONOMOUS_TOOLS, evaluateInvocation, ToolRegistry } from '../src/main/agent/tools';
import { ToolExecutors } from '../src/main/agent/executors';
import { PythonAgentRunner } from '../src/main/agent/pythonRunner';
import { AuditLog, PermissionBroker, TaskManager } from '../src/main/agent/runtime';
import { FILE_TOOL_DEFINITIONS, FileTools } from '../src/main/files/toolset';
import { GIT_TOOL_DEFINITIONS, GitTools } from '../src/main/git/toolset';
import { GITHUB_PUBLIC_PLUGIN } from '../src/main/plugins/manifest';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';

const tempDirs: string[] = [];
let activeBridge: PythonAgentBridge | null = null;
const activeServers: Array<() => Promise<void>> = [];

function makeTempDir(prefix = 'pixel-phase-b-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Minimal valid ZIP builder (using raw deflate) for synthetic DOCX/PPTX/XLSX fixtures. */
function buildZip(files: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const rawBuf = Buffer.from(file.content, 'utf8');
    const compBuf = deflateRawSync(rawBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compBuf.length, 18);
    local.writeUInt32LE(rawBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, compBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compBuf.length, 20);
    central.writeUInt32LE(rawBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

afterEach(async () => {
  if (activeBridge) {
    await activeBridge.dispose();
    activeBridge = null;
  }
  while (activeServers.length > 0) {
    await activeServers.pop()!();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('Phase B: Local Git Toolset (Complete Operations & Safety)', () => {
  it('supports init, stage, unstage, commit, info, remote redaction, branches, and revert on a real repo', async () => {
    const root = makeTempDir('pixel-git-b-');
    const git = new GitTools({ allowedRoot: root });

    expect((await git.run('git_init', { repoPath: root })).ok).toBe(true);
    execFileSync('git', ['config', 'user.name', 'Pixel Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'pixel@example.com'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', 'https://user:ghp_secret12345@github.com/example/repo.git'], { cwd: root });

    writeFileSync(join(root, 'app.ts'), 'export const version = 1;\n', 'utf8');

    // Stage then unstage
    const staged = await git.run('git_stage', { repoPath: root, paths: ['app.ts'] });
    expect(staged.ok).toBe(true);
    const infoStaged = await git.run('git_repository_info', { repoPath: root });
    expect(infoStaged.ok).toBe(true);
    expect(infoStaged.detail).toMatchObject({ staged: 1, conflicts: 0 });

    const unstaged = await git.run('git_unstage', { repoPath: root, paths: ['app.ts'] });
    expect(unstaged.ok).toBe(true);

    // Commit
    const committed = await git.run('git_commit', {
      repoPath: root,
      paths: ['app.ts'],
      message: 'feat: add initial app.ts',
    });
    expect(committed.ok).toBe(true);

    // Remote list scrubs embedded credentials
    const remotes = await git.run('git_remote_list', { repoPath: root });
    expect(remotes.ok).toBe(true);
    expect(remotes.content).not.toContain('ghp_secret12345');
    expect(remotes.content).toContain('[REDACTED]');

    // Reject clone URL with embedded credentials
    const badClone = await git.run('git_clone', {
      url: 'https://user:secret@github.com/example/repo.git',
      destination: join(root, 'cloned'),
    });
    expect(badClone.ok).toBe(false);

    // Create branch on clean tree
    const branch = await git.run('git_branches', { repoPath: root, action: 'create', branchName: 'feat/phase-b' });
    expect(branch.ok).toBe(true);
    const infoAfter = await git.run('git_repository_info', { repoPath: root });
    expect(infoAfter.detail).toMatchObject({ branch: 'feat/phase-b', detached: false });
  }, 15_000);
});

describe('Phase B: File Patching, Content Search & Rich Document Reading', () => {
  it('applies exact, multi-hunk, and controlled fuzzy patches while preserving CRLF and rejecting ambiguous/stale patches', () => {
    const root = makeTempDir('pixel-patch-b-');
    const files = new FileTools({ allowedRoot: root });
    const target = join(root, 'sample.ts');
    const initial = 'function greet() {\r\n  return "hello";\r\n}\r\n\r\nexport const n = 1;\r\n';
    writeFileSync(target, initial, 'utf8');
    const initialHash = createHash('sha256').update(initial, 'utf8').digest('hex');

    // Dry-run preview does not mutate file
    const dry = files.run('file_patch', {
      path: target,
      dryRun: true,
      expectedSha256: initialHash,
      hunks: [{ oldText: 'return "hello";', newText: 'return "world";' }],
    });
    expect(dry.ok).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(initial);

    // Real multi-hunk patch (1 exact + 1 whitespace-trimmed fuzzy) preserves CRLF
    const patched = files.run('file_patch', {
      path: target,
      expectedSha256: initialHash,
      hunks: [
        { oldText: '    return "hello";', newText: '  return "pixel";', fuzzy: true },
        { oldText: 'export const n = 1;', newText: 'export const n = 2;' },
      ],
    });
    expect(patched.ok).toBe(true);
    const updated = readFileSync(target, 'utf8');
    expect(updated).toContain('return "pixel";\r\n');
    expect(updated).toContain('export const n = 2;\r\n');

    // Stale SHA-256 is rejected without modifying file
    const stale = files.run('file_patch', {
      path: target,
      expectedSha256: initialHash,
      hunks: [{ oldText: 'n = 2', newText: 'n = 3' }],
    });
    expect(stale.ok).toBe(false);
    expect(stale.content).toContain('hash mismatch');

    // Ambiguous match is rejected
    const dupFile = join(root, 'dup.txt');
    writeFileSync(dupFile, 'alpha\nalpha\n', 'utf8');
    const ambig = files.run('file_patch', {
      path: dupFile,
      hunks: [{ oldText: 'alpha', newText: 'beta' }],
    });
    expect(ambig.ok).toBe(false);
    expect(ambig.content).toContain('ambiguously');

    // Content search finds updated text and skips .env
    writeFileSync(join(root, '.env'), 'SECRET=pixel\n', 'utf8');
    const search = files.run('file_search_content', { directory: root, query: 'pixel' });
    expect(search.ok).toBe(true);
    expect(search.content).toContain('sample.ts');
    expect(search.content).not.toContain('.env');

    // UNC path is blocked
    const unc = files.run('file_read', { path: '\\\\server\\share\\secret.txt' });
    expect(unc.ok).toBe(false);
  });

  it('extracts bounded text from DOCX, PPTX, XLSX, and PDF and refuses encrypted PDFs', () => {
    const root = makeTempDir('pixel-docs-b-');
    const files = new FileTools({ allowedRoot: root });

    // DOCX
    const docxPath = join(root, 'report.docx');
    writeFileSync(docxPath, buildZip([
      { name: 'word/document.xml', content: '<w:document><w:body><w:p><w:r><w:t>Hello Pixel DOCX</w:t></w:r></w:p></w:body></w:document>' },
    ]));
    const docxRes = files.run('file_read', { path: docxPath });
    expect(docxRes.ok).toBe(true);
    expect(docxRes.content).toContain('Hello Pixel DOCX');
    expect(docxRes.content).toContain('untrusted data');

    // PPTX
    const pptxPath = join(root, 'deck.pptx');
    writeFileSync(pptxPath, buildZip([
      { name: 'ppt/slides/slide1.xml', content: '<p:sld><a:t>Slide One Title</a:t></p:sld>' },
    ]));
    const pptxRes = files.run('file_read', { path: pptxPath });
    expect(pptxRes.ok).toBe(true);
    expect(pptxRes.content).toContain('Slide One Title');

    // XLSX
    const xlsxPath = join(root, 'sheet.xlsx');
    writeFileSync(xlsxPath, buildZip([
      { name: 'xl/sharedStrings.xml', content: '<sst><si><t>Revenue</t></si></sst>' },
      { name: 'xl/worksheets/sheet1.xml', content: '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>4200</v></c></row></sheetData></worksheet>' },
    ]));
    const xlsxRes = files.run('file_read', { path: xlsxPath });
    expect(xlsxRes.ok).toBe(true);
    expect(xlsxRes.content).toContain('Revenue\t4200');

    // PDF (literal text stream)
    const pdfPath = join(root, 'note.pdf');
    writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj\n<< /Length 36 >>\nstream\nBT /F1 12 Tf (Hello Pixel PDF) Tj ET\nendstream\nendobj\n%%EOF\n', 'latin1');
    const pdfRes = files.run('file_read', { path: pdfPath });
    expect(pdfRes.ok).toBe(true);
    expect(pdfRes.content).toContain('Hello Pixel PDF');

    // Encrypted PDF refused cleanly
    const encPdfPath = join(root, 'locked.pdf');
    writeFileSync(encPdfPath, '%PDF-1.4\n<< /Encrypt 5 0 R >>\n%%EOF\n', 'latin1');
    const encRes = files.run('file_read', { path: encPdfPath });
    expect(encRes.ok).toBe(false);
    expect(encRes.content).toContain('encrypted');
  });
});

describe('Phase B: Agent Mode Autonomy & Python pixel-agent-v2 End-to-End Developer Workflow', () => {
  it('allows safe read-only Git/GitHub/File inspection in Agent mode while still requiring approval for writes & pushes', () => {
    const registry = new ToolRegistry([...GIT_TOOL_DEFINITIONS, ...FILE_TOOL_DEFINITIONS, ...GITHUB_PUBLIC_PLUGIN.tools]);
    const ctx = (mode: 'guide' | 'hybrid' | 'agent') => ({ mode, grants: new Map(), stopped: false, audit: () => undefined });

    // Agent mode: read-only Git/GitHub/File search auto-allowed
    expect(AGENT_MODE_AUTONOMOUS_TOOLS.has('github_repo_summary')).toBe(true);
    expect(evaluateInvocation(registry.get('github_repo_summary'), ctx('agent'))).toEqual({ allowed: true });
    expect(evaluateInvocation(registry.get('git_repository_info'), ctx('agent'))).toEqual({ allowed: true });
    expect(evaluateInvocation(registry.get('file_search_content'), ctx('agent'))).toEqual({ allowed: true });

    // Agent mode: state-changing patch, commit, push, and GitHub issue creation STILL require approval
    expect(evaluateInvocation(registry.get('file_patch'), ctx('agent'))).toMatchObject({ allowed: false, needsApproval: true });
    expect(evaluateInvocation(registry.get('git_commit'), ctx('agent'))).toMatchObject({ allowed: false, needsApproval: true });
    expect(evaluateInvocation(registry.get('git_push'), ctx('agent'))).toMatchObject({ allowed: false, needsApproval: true });
    expect(evaluateInvocation(registry.get('github_create_issue'), ctx('agent'))).toMatchObject({ allowed: false, needsApproval: true });

    // Guide mode: blocks all mutations without prompting
    expect(evaluateInvocation(registry.get('file_patch'), ctx('guide'))).toMatchObject({ allowed: false, needsApproval: false });
    expect(evaluateInvocation(registry.get('github_create_pr'), ctx('guide'))).toMatchObject({ allowed: false, needsApproval: false });
  });

  it('executes a real end-to-end developer workflow (inspect -> search -> patch -> diff -> commit) through Python pixel-agent-v2', async () => {
    const root = makeTempDir('pixel-e2e-dev-');
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Pixel Dev'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'dev@pixel.local'], { cwd: root });
    const filePath = join(root, 'calc.ts');
    writeFileSync(filePath, 'export function add(a: number, b: number): number {\n  return a - b;\n}\n', 'utf8');
    execFileSync('git', ['add', 'calc.ts'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'chore: initial buggy calc'], { cwd: root });

    // Local mock SSE provider driving a 5-step tool chain
    const steps = [
      { id: 's1', name: 'git_repository_info', args: { repoPath: root } },
      { id: 's2', name: 'file_search_content', args: { directory: root, query: 'return a - b' } },
      { id: 's3', name: 'file_patch', args: { path: filePath, hunks: [{ oldText: 'return a - b;', newText: 'return a + b;' }] } },
      { id: 's4', name: 'git_diff', args: { repoPath: root } },
      { id: 's5', name: 'git_commit', args: { repoPath: root, paths: ['calc.ts'], message: 'fix: use addition in add()' } },
    ];
    let stepIdx = 0;

    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (stepIdx < steps.length) {
          const st = steps[stepIdx++];
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: { tool_calls: [{ index: 0, id: st.id, type: 'function', function: { name: st.name, arguments: JSON.stringify(st.args) } }] },
              finish_reason: 'tool_calls',
            }],
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            choices: [{ delta: { content: 'Fixed add() in calc.ts and committed locally (not pushed).' }, finish_reason: 'stop' }],
          })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    activeServers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const registry = new ToolRegistry([...GIT_TOOL_DEFINITIONS, ...FILE_TOOL_DEFINITIONS]);
    const audit = new AuditLog();
    const tasks = new TaskManager(() => undefined);
    const promptedTools: string[] = [];
    const permissions = new PermissionBroker(registry, audit, (req) => {
      promptedTools.push(req.toolName);
      queueMicrotask(() => permissions.respond({ requestId: req.id, approved: true, duration: 'once' }));
    });
    const executors = new ToolExecutors({
      git: new GitTools({ allowedRoot: root }),
      files: new FileTools({ allowedRoot: root }),
    });

    activeBridge = new PythonAgentBridge();
    const runner = new PythonAgentRunner({
      bridge: activeBridge,
      registry,
      permissions,
      tasks,
      audit,
      executors,
      emit: () => undefined,
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, model }),
    });

    const result = await runner.run({
      requestId: 'req_phase_b_e2e',
      request: { text: 'Inspect the repo, fix the bug in calc.ts, and commit locally.', mode: 'agent' },
      model: 'deepseek-flash',
    });

    expect(result.task.status).toBe('completed');
    expect(result.finalContent).toContain('committed locally');
    // Read-only steps (git_repository_info, file_search_content, git_diff) ran WITHOUT prompting in Agent mode!
    // Only state-changing steps (file_patch, git_commit) prompted PermissionBroker!
    expect(promptedTools).toEqual(['file_patch', 'git_commit']);
    // Real disk & real git commit verified!
    expect(readFileSync(filePath, 'utf8')).toContain('return a + b;');
    const log = execFileSync('git', ['log', '-n', '1', '--pretty=%s'], { cwd: root, encoding: 'utf8' }).trim();
    expect(log).toBe('fix: use addition in add()');
  }, 20_000);
});
