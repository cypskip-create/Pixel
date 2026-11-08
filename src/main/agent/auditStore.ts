import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry } from '../../shared/types';

/** Somewhere audit entries can be persisted. */
export interface AuditSink {
  write(entry: AuditEntry): void;
}

const MAX_SUMMARY = 200;
const MAX_DETAIL = 300;

/** Tools whose detail could contain what the user typed. Their detail is dropped. */
const INPUT_BEARING = /\b(type_text|browser_type)\b/;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted-key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]'],
  [
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)(["']?\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
    '$1$2$3[redacted]',
  ],
];

/** Strip credentials from free text and bound its length. */
export function redactAuditText(text: string, maxLength: number = MAX_DETAIL): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength - 3)}...` : out;
}

/** The form of an entry that is safe to write to disk. */
export function sanitiseAuditEntry(entry: AuditEntry): AuditEntry {
  const summary = redactAuditText(entry.summary, MAX_SUMMARY);
  const keepDetail = entry.detail !== undefined && !INPUT_BEARING.test(entry.summary);
  const { detail: _dropped, ...rest } = entry;
  return {
    ...rest,
    summary,
    ...(keepDetail ? { detail: redactAuditText(entry.detail as string) } : {}),
  };
}

export interface JsonlAuditOptions {
  /** Rotate when the active file reaches this size. */
  maxBytes?: number;
  /** How many rotated files to keep besides the active one. */
  keepFiles?: number;
}

/**
 * Append-only JSON Lines audit file.
 *
 * Writes are synchronous and wrapped so that a full disk or a locked file can
 * never crash or stall the agent: auditing is best effort at the I/O layer, but
 * every entry is sanitised before it reaches the disk.
 */
export class JsonlAuditSink implements AuditSink {
  private readonly maxBytes: number;
  private readonly keepFiles: number;

  constructor(
    private readonly filePath: string,
    options: JsonlAuditOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    this.keepFiles = options.keepFiles ?? 3;
  }

  write(entry: AuditEntry): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.filePath, `${JSON.stringify(sanitiseAuditEntry(entry))}\n`, 'utf8');
    } catch {
      /* never let auditing break the agent */
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath) || statSync(this.filePath).size < this.maxBytes) return;
    const oldest = `${this.filePath}.${this.keepFiles}`;
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = this.keepFiles - 1; i >= 1; i -= 1) {
      const from = `${this.filePath}.${i}`;
      if (existsSync(from)) renameSync(from, `${this.filePath}.${i + 1}`);
    }
    renameSync(this.filePath, `${this.filePath}.1`);
  }
}

/** Read back the most recent entries, newest first. Skips damaged lines. */
export function readAuditFile(filePath: string, limit: number = 200): AuditEntry[] {
  if (!existsSync(filePath)) return [];
  const entries: AuditEntry[] = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      /* a torn last line after a crash is expected */
    }
  }
  return entries.slice(-Math.max(1, limit)).reverse();
}