/**
 * Path-jailed live project filesystem browser & preview reader.
 *
 * Strictly enforces containment inside the authorized project root using
 * `realpathSync`, blocks traversal (`..`), blocks hidden secret files
 * (`.env*`, `*.key`, `*.pem`), and caps directory/file reads safely.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

export interface WorkspaceFsEntry {
  name: string;
  relativePath: string;
  kind: 'dir' | 'file';
  sizeBytes: number;
  modifiedAt: number;
}

export interface WorkspaceFsReadResult {
  ok: boolean;
  relativePath: string;
  content?: string;
  truncated?: boolean;
  binary?: boolean;
  sizeBytes?: number;
  error?: string;
}

const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', '.pw-browsers', '__pycache__', '.venv', 'credentials']);
const BLOCKED_SECRET_RE = /(^\.env(\.|$)|\.(pem|key|pfx|p12|crt|keystore)$|^id_(rsa|ed25519)$|^(credentials|secrets)\.json$|^\.(npmrc|netrc|pypirc)$)/i;
const MAX_ENTRIES = 200;
const MAX_READ_BYTES = 128 * 1024;

function isBlockedSecretPath(pathLike: string): boolean {
  const segments = pathLike.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.some((seg) => BLOCKED_SECRET_RE.test(seg) || seg.toLowerCase() === 'credentials');
}

export function resolveInsideRoot(rootDir: string, relPath = ''): string | null {
  try {
    const canonicalRoot = realpathSync(resolve(rootDir));
    const candidate = resolve(canonicalRoot, relPath || '.');
    if (!existsSync(candidate)) return null;
    const canonicalCandidate = realpathSync(candidate);
    const rel = relative(canonicalRoot, canonicalCandidate);
    if (rel.startsWith('..') || rel === '..' || (rel.includes(`..${sep}`))) {
      return null;
    }
    return canonicalCandidate;
  } catch {
    return null;
  }
}

export function listWorkspaceDir(
  rootDir: string,
  relativePath = '',
): { ok: boolean; entries: WorkspaceFsEntry[]; error?: string } {
  const target = resolveInsideRoot(rootDir, relativePath);
  if (!target) {
    return { ok: false, entries: [], error: 'Path is outside the authorized workspace root.' };
  }
  try {
    const canonicalRoot = realpathSync(resolve(rootDir));
    const dirents = readdirSync(target, { withFileTypes: true });
    const entries: WorkspaceFsEntry[] = [];
    for (const d of dirents) {
      if (entries.length >= MAX_ENTRIES) break;
      if (d.isDirectory() && SKIPPED_DIRS.has(d.name)) continue;
      if (!d.isDirectory() && BLOCKED_SECRET_RE.test(d.name)) continue;
      const full = join(target, d.name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(canonicalRoot, full).replace(/\\/g, '/');
      entries.push({
        name: d.name,
        relativePath: rel,
        kind: d.isDirectory() ? 'dir' : 'file',
        sizeBytes: d.isDirectory() ? 0 : st.size,
        modifiedAt: st.mtimeMs,
      });
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { ok: true, entries };
  } catch (err) {
    return {
      ok: false,
      entries: [],
      error: err instanceof Error ? err.message : 'Could not list directory.',
    };
  }
}

export function readWorkspaceFile(
  rootDir: string,
  relativePath: string,
): WorkspaceFsReadResult {
  if (isBlockedSecretPath(relativePath)) {
    return {
      ok: false,
      relativePath,
      error: 'Sensitive credential/key files cannot be previewed.',
    };
  }
  const target = resolveInsideRoot(rootDir, relativePath);
  if (!target) {
    return {
      ok: false,
      relativePath,
      error: 'Path is outside the authorized workspace root.',
    };
  }
  // Re-check canonical target basename/path to block symlinks or aliases pointing to secret files.
  if (BLOCKED_SECRET_RE.test(basename(target)) || isBlockedSecretPath(target)) {
    return {
      ok: false,
      relativePath,
      error: 'Sensitive credential/key files cannot be previewed.',
    };
  }
  try {
    const st = statSync(target);
    if (!st.isFile()) {
      return { ok: false, relativePath, error: 'Target is not a regular file.' };
    }
    const raw = readFileSync(target);
    const slice = raw.subarray(0, MAX_READ_BYTES);
    // Reject binary files containing NUL bytes.
    if (slice.includes(0)) {
      return {
        ok: false,
        relativePath,
        binary: true,
        sizeBytes: st.size,
        error: 'Binary file cannot be previewed as text.',
      };
    }
    return {
      ok: true,
      relativePath,
      content: slice.toString('utf8'),
      truncated: raw.length > MAX_READ_BYTES,
      sizeBytes: st.size,
    };
  } catch (err) {
    return {
      ok: false,
      relativePath,
      error: err instanceof Error ? err.message : 'Could not read file.',
    };
  }
}
