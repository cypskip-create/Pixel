/**
 * Precise, atomic text file patching (`file_patch`).
 *
 * Supports:
 * - Multiple ordered hunks applied in-memory before a single atomic write
 * - Exact contextual match (primary)
 * - Controlled, unambiguous whitespace-normalized fuzzy match (secondary, opt-in/default)
 * - Optional expected SHA-256 verification before modifying the file
 * - Line-ending preservation (CRLF vs LF)
 * - Zero partial corruption on mismatch (all hunks validated before writing)
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PatchHunk {
  oldText: string;
  newText: string;
  /** Optional: allow controlled whitespace-trimmed line matching when exact match misses. Default true. */
  fuzzy?: boolean;
}

export interface PatchRequest {
  hunks: PatchHunk[];
  /** Optional SHA-256 hex digest of the file's current UTF-8 bytes; rejects on mismatch. */
  expectedSha256?: string;
  /** If true, computes the resulting diff/preview without modifying the file on disk. */
  dryRun?: boolean;
}

export interface PatchHunkReport {
  index: number;
  mode: 'exact' | 'fuzzy';
  lineNumber: number;
}

export interface PatchResult {
  ok: boolean;
  changed: boolean;
  beforeSha256: string;
  afterSha256: string;
  lineEnding: 'crlf' | 'lf';
  applied: PatchHunkReport[];
  preview: string;
  error?: string;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function detectLineEnding(text: string): 'crlf' | 'lf' {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? 'crlf' : 'lf';
}

function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function restoreLineEnding(text: string, ending: 'crlf' | 'lf'): string {
  return ending === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
}

function lineNumberAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  if (!needle) return indices;
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, pos);
    if (found === -1) break;
    indices.push(found);
    pos = found + Math.max(1, needle.length);
  }
  return indices;
}

/**
 * Controlled fuzzy matching: matches contiguous line windows where each line
 * matches after trimming leading/trailing horizontal whitespace. Succeeds ONLY
 * when there is a single unambiguous match in the file.
 */
function findUniqueFuzzyLineMatch(
  contentLines: string[],
  searchLines: string[],
): { startLine: number; endLine: number } | { ambiguous: number } | null {
  if (searchLines.length === 0 || searchLines.length > contentLines.length) return null;
  const normSearch = searchLines.map((line) => line.trim());
  if (normSearch.every((line) => line.length === 0)) return null;

  const matches: number[] = [];
  for (let i = 0; i <= contentLines.length - searchLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < searchLines.length; j += 1) {
      if (contentLines[i + j].trim() !== normSearch[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) return { ambiguous: matches.length };
  return { startLine: matches[0], endLine: matches[0] + searchLines.length };
}

function buildCompactDiff(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max && lines.length < 80; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`- L${i + 1}: ${a[i]}`);
    if (b[i] !== undefined) lines.push(`+ L${i + 1}: ${b[i]}`);
  }
  return lines.join('\n') || '(no textual changes)';
}

export function applyPatchToText(originalRaw: string, request: PatchRequest): {
  result: PatchResult;
  nextRaw?: string;
} {
  const beforeSha256 = sha256Hex(originalRaw);
  const lineEnding = detectLineEnding(originalRaw);

  if (request.expectedSha256 && request.expectedSha256.trim().toLowerCase() !== beforeSha256) {
    return {
      result: {
        ok: false,
        changed: false,
        beforeSha256,
        afterSha256: beforeSha256,
        lineEnding,
        applied: [],
        preview: '',
        error: `File hash mismatch: expected ${request.expectedSha256.trim().toLowerCase()}, actual ${beforeSha256}. Re-read the file before patching.`,
      },
    };
  }

  if (!Array.isArray(request.hunks) || request.hunks.length === 0) {
    return {
      result: {
        ok: false,
        changed: false,
        beforeSha256,
        afterSha256: beforeSha256,
        lineEnding,
        applied: [],
        preview: '',
        error: 'At least one patch hunk is required.',
      },
    };
  }

  let working = normalizeToLf(originalRaw);
  const applied: PatchHunkReport[] = [];

  for (let idx = 0; idx < request.hunks.length; idx += 1) {
    const hunk = request.hunks[idx];
    const oldNorm = normalizeToLf(hunk.oldText ?? '');
    const newNorm = normalizeToLf(hunk.newText ?? '');
    if (!oldNorm) {
      return {
        result: {
          ok: false,
          changed: false,
          beforeSha256,
          afterSha256: beforeSha256,
          lineEnding,
          applied: [],
          preview: '',
          error: `Hunk #${idx + 1} has empty oldText.`,
        },
      };
    }

    const exactMatches = findAllOccurrences(working, oldNorm);
    if (exactMatches.length === 1) {
      const pos = exactMatches[0];
      working = working.slice(0, pos) + newNorm + working.slice(pos + oldNorm.length);
      applied.push({ index: idx, mode: 'exact', lineNumber: lineNumberAtOffset(working, pos) });
      continue;
    }

    if (exactMatches.length > 1) {
      return {
        result: {
          ok: false,
          changed: false,
          beforeSha256,
          afterSha256: beforeSha256,
          lineEnding,
          applied: [],
          preview: '',
          error: `Hunk #${idx + 1} matched ${exactMatches.length} locations ambiguously. Include more surrounding context lines.`,
        },
      };
    }

    // Controlled fuzzy fallback (line-trimmed, unambiguous only)
    const allowFuzzy = hunk.fuzzy !== false;
    if (allowFuzzy) {
      const contentLines = working.split('\n');
      const searchLines = oldNorm.split('\n');
      const fuzzy = findUniqueFuzzyLineMatch(contentLines, searchLines);
      if (fuzzy && 'ambiguous' in fuzzy) {
        return {
          result: {
            ok: false,
            changed: false,
            beforeSha256,
            afterSha256: beforeSha256,
            lineEnding,
            applied: [],
            preview: '',
            error: `Hunk #${idx + 1} fuzzy-matched ${fuzzy.ambiguous} locations ambiguously. Provide more exact context.`,
          },
        };
      }
      if (fuzzy) {
        const replacementLines = newNorm.split('\n');
        contentLines.splice(fuzzy.startLine, fuzzy.endLine - fuzzy.startLine, ...replacementLines);
        working = contentLines.join('\n');
        applied.push({ index: idx, mode: 'fuzzy', lineNumber: fuzzy.startLine + 1 });
        continue;
      }
    }

    return {
      result: {
        ok: false,
        changed: false,
        beforeSha256,
        afterSha256: beforeSha256,
        lineEnding,
        applied: [],
        preview: '',
        error: `Hunk #${idx + 1} did not match any region in the file (exact${allowFuzzy ? ' or fuzzy' : ''}). Re-read the file and provide exact context.`,
      },
    };
  }

  const nextRaw = restoreLineEnding(working, lineEnding);
  const afterSha256 = sha256Hex(nextRaw);
  const preview = buildCompactDiff(normalizeToLf(originalRaw), working);
  return {
    nextRaw,
    result: {
      ok: true,
      changed: nextRaw !== originalRaw,
      beforeSha256,
      afterSha256,
      lineEnding,
      applied,
      preview,
    },
  };
}

/**
 * Applies a validated patch atomically via a sibling temp file + rename,
 * verifying read-back SHA-256 after writing.
 */
export function patchFileAtomic(filePath: string, request: PatchRequest): PatchResult {
  const originalBuffer = readFileSync(filePath);
  if (originalBuffer.includes(0)) {
    return {
      ok: false,
      changed: false,
      beforeSha256: '',
      afterSha256: '',
      lineEnding: 'lf',
      applied: [],
      preview: '',
      error: 'Binary files cannot be patched with file_patch.',
    };
  }
  let originalRaw: string;
  try {
    originalRaw = new TextDecoder('utf-8', { fatal: true }).decode(originalBuffer);
  } catch {
    return {
      ok: false,
      changed: false,
      beforeSha256: '',
      afterSha256: '',
      lineEnding: 'lf',
      applied: [],
      preview: '',
      error: 'File is not valid UTF-8 text.',
    };
  }

  const { result, nextRaw } = applyPatchToText(originalRaw, request);
  if (!result.ok || nextRaw === undefined || request.dryRun || !result.changed) {
    return result;
  }

  const tempPath = join(dirname(filePath), `.pixel-patch-${randomUUID().slice(0, 8)}.tmp`);
  try {
    writeFileSync(tempPath, nextRaw, { encoding: 'utf8', flag: 'wx' });
    renameSync(tempPath, filePath);
  } catch (err) {
    try { unlinkSync(tempPath); } catch { /* ignore cleanup error */ }
    return {
      ...result,
      ok: false,
      error: `Atomic patch write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const verified = readFileSync(filePath, 'utf8');
  if (sha256Hex(verified) !== result.afterSha256) {
    return {
      ...result,
      ok: false,
      error: 'Post-write verification failed: file content changed concurrently.',
    };
  }
  return result;
}
