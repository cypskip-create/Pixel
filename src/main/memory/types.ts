/**
 * Memory domain types.
 *
 * Pixel distinguishes what it was told from what it worked out. Nothing the model
 * produced on its own is stored as verified knowledge; `confidence` records how a
 * record was obtained and is used for ranking and for what may be injected into a
 * conversation without qualification.
 */

export const MEMORY_KINDS = [
  /** Durable preferences: tone, formatting, default tools. */
  'preference',
  /** Project-specific state, e.g. a lab network configuration. */
  'project',
  /** Technical facts the user confirmed. */
  'fact',
  /** Reusable procedure hints derived from an approved workflow. */
  'workflow',
  /** What happened during an earlier task, kept for continuity. */
  'outcome',
  /** Knowledge extracted from an indexed document. */
  'document',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const CONFIDENCE_LEVELS = [
  /** The user stated it explicitly, or confirmed it. */
  'user_approved',
  /** Read from a source document; source is recorded. */
  'source_backed',
  /** Model inference. Never injected as fact without qualification. */
  'inferred',
] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const RETENTION_POLICIES = ['permanent', 'session', 'expiring'] as const;
export type Retention = (typeof RETENTION_POLICIES)[number];

export interface MemoryRecord {
  id: string;
  projectId: string;
  kind: MemoryKind;
  content: string;
  /** Where this came from: a file path, a conversation turn, a tool call. */
  source: string;
  confidence: Confidence;
  retention: Retention;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  expiresAt: number | null;
}

export interface MemoryDraft {
  projectId: string;
  kind: MemoryKind;
  content: string;
  source: string;
  confidence?: Confidence;
  retention?: Retention;
  tags?: string[];
  /** Absolute expiry, only meaningful with retention 'expiring'. */
  expiresAt?: number;
}

export interface MemorySearchQuery {
  projectId: string;
  text: string;
  kinds?: MemoryKind[];
  limit?: number;
  /** Cross-project reads are never implicit. */
  includeOtherProjects?: boolean;
}

export interface MemorySearchHit {
  memory: MemoryRecord;
  /** Higher is more relevant. Comparable only within one result set. */
  score: number;
  /** How the record matched, so the UI can be honest about it. */
  matchedOn: 'fts' | 'substring';
}

export interface MemoryStats {
  total: number;
  byKind: Record<string, number>;
  expired: number;
}

/** Ranking weights, exported so tests can assert the ordering rules. */
export const RANK = {
  confidenceUserApproved: 1.0,
  confidenceSourceBacked: 0.75,
  confidenceInferred: 0.35,
  usageWeight: 0.15,
  recencyHalfLifeDays: 30,
  /** Added when the FTS bm25 value is unavailable (substring fallback). */
  substringBase: 0.4,
} as const;
