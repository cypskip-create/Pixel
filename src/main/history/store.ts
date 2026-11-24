/**
 * Conversation history persistence.
 *
 * Electron-free on purpose: takes a storage adapter, so it can be unit-tested
 * with an in-memory fake and later backed by SQLite without changing callers.
 *
 * History is stored per-conversation as JSON. Messages are capped and trimmed
 * so the file cannot grow without bound.
 */

import type { ChatMessage } from '../../shared/types';
import { redactTaskText } from '../tasks/schema';

export interface StorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  projectId?: string;
  /** Session-only records are intentionally never written to disk. */
  persistence?: 'persistent' | 'session';
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
  projectId?: string;
  persistence: 'persistent' | 'session';
}

export interface HistoryQuery {
  limit?: number;
  offset?: number;
  search?: string;
  projectId?: string;
  /** When false, legacy conversations lacking a projectId are excluded (used for non-default profiles). */
  includeUnscoped?: boolean;
}

/** Keep at most this many conversations on disk. */
export const MAX_CONVERSATIONS = 50;

/** Keep at most this many messages per conversation. */
export const MAX_MESSAGES_PER_CONVERSATION = 200;

const INDEX_KEY = 'history.index';

/** In-memory adapter, used by tests and as a fallback when disk writes fail. */
export class MemoryStorage implements StorageAdapter {
  private readonly map = new Map<string, string>();

  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.map.set(key, value);
  }
}

export class HistoryStore {
  constructor(private readonly storage: StorageAdapter) {}

  /** Conversation ids, newest first. */
  listIds(): string[] {
    const raw = this.storage.read(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      // A corrupt index must not brick the app; treat it as empty and let the
      // next save rebuild it.
      return [];
    }
  }

  load(id: string): ConversationRecord | null {
    if (!isSafeId(id)) return null;
    const raw = this.storage.read(`history.${id}`);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isConversationRecord(parsed) || parsed.id !== id) return null;
      return {
        ...parsed,
        title: redactTaskText(parsed.title).replace(/\s+/g, ' ').trim().slice(0, 80) || 'New conversation',
        persistence: 'persistent',
        messages: parsed.messages.filter(isUserFacingMessage).map(sanitizeMessage),
      };
    } catch {
      return null;
    }
  }

  loadMostRecent(): ConversationRecord | null {
    for (const id of this.listIds()) {
      const record = this.load(id);
      if (record) return record;
    }
    return null;
  }

  /** Create or update a conversation, enforcing caps. */
  save(record: ConversationRecord): void {
    if (record.persistence === 'session') return;
    if (!isSafeId(record.id)) throw new Error('Invalid conversation id.');
    const trimmed: ConversationRecord = {
      ...record,
      title: redactTaskText(record.title.replace(/\s+/g, ' ').trim()).slice(0, 80) || 'New conversation',
      persistence: 'persistent',
      updatedAt: Date.now(),
      messages: record.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-MAX_MESSAGES_PER_CONVERSATION)
        .map(sanitizeMessage),
    };
    this.storage.write(`history.${record.id}`, JSON.stringify(trimmed));

    const ids = this.listIds().filter((existing) => existing !== record.id);
    ids.unshift(record.id);
    const kept = ids.slice(0, MAX_CONVERSATIONS);
    for (const evicted of ids.slice(MAX_CONVERSATIONS)) this.storage.write(`history.${evicted}`, JSON.stringify(null));
    this.storage.write(INDEX_KEY, JSON.stringify(kept));
  }

  delete(id: string): void {
    if (!isSafeId(id)) return;
    this.storage.write(`history.${id}`, JSON.stringify(null));
    this.storage.write(INDEX_KEY, JSON.stringify(this.listIds().filter((x) => x !== id)));
  }

  list(query: HistoryQuery = {}): ConversationSummary[] {
    const search = query.search?.trim().toLocaleLowerCase() ?? '';
    const limit = clampInteger(query.limit, 1, MAX_CONVERSATIONS, 30);
    const offset = clampInteger(query.offset, 0, MAX_CONVERSATIONS, 0);
    const includeUnscoped = query.includeUnscoped !== false;
    const summaries = this.listIds().flatMap((id): ConversationSummary[] => {
      const record = this.load(id);
      if (!record) return [];
      if (query.projectId) {
        if (record.projectId) {
          if (record.projectId !== query.projectId) return [];
        } else if (!includeUnscoped) {
          return [];
        }
      }
      const last = record.messages[record.messages.length - 1];
      const preview = last ? redactTaskText(last.content).replace(/\s+/g, ' ').slice(0, 160) : '';
      const searchableText = `${record.title} ${record.messages.map((message) => message.content).join(' ')}`;
      if (search && !searchableText.toLocaleLowerCase().includes(search)) return [];
      return [{
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        preview,
        ...(record.projectId ? { projectId: record.projectId } : {}),
        persistence: 'persistent',
      }];
    });
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries.slice(offset, offset + limit);
  }

  clear(): void {
    for (const id of this.listIds()) this.storage.write(`history.${id}`, JSON.stringify(null));
    this.storage.write(INDEX_KEY, JSON.stringify([]));
  }

  /**
   * Project-scoped clear: removes only conversations belonging to `projectId`
   * (plus unscoped legacy records only when `includeUnscoped` is true).
   * Returns the deleted conversation ids so callers can clean search/snapshots.
   */
  clearProject(projectId: string, includeUnscoped = false): string[] {
    const deleted: string[] = [];
    const remaining: string[] = [];
    for (const id of this.listIds()) {
      const record = this.load(id);
      if (!record) continue;
      const belongs = record.projectId
        ? record.projectId === projectId
        : includeUnscoped;
      if (belongs) {
        this.storage.write(`history.${id}`, JSON.stringify(null));
        deleted.push(id);
      } else {
        remaining.push(id);
      }
    }
    this.storage.write(INDEX_KEY, JSON.stringify(remaining));
    return deleted;
  }

  /** Start a fresh conversation, replacing the anchor id. */
  static newConversation(firstMessage: string): ConversationRecord {
    const now = Date.now();
    return {
      id: `conv_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title: deriveTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }
}

/** A short, human-readable title from the first user message. */
export function deriveTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'New conversation';
  if (collapsed.length <= 48) return collapsed;
  return `${collapsed.slice(0, 47).trimEnd()}\u2026`;
}

function isConversationRecord(value: unknown): value is ConversationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ConversationRecord>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) &&
    (candidate.projectId === undefined || typeof candidate.projectId === 'string') &&
    Array.isArray(candidate.messages)
  );
}

function isUserFacingMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ChatMessage>;
  return (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt);
}

function isSafeId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

/** Keep the user-facing transcript small and free from secrets/internal tool data. */
function sanitizeMessage(message: ChatMessage): ChatMessage {
  const safe: ChatMessage = {
    id: typeof message.id === 'string' && message.id.length <= 160 ? message.id : `message_${Date.now().toString(36)}`,
    role: message.role,
    content: redactTaskText(String(message.content ?? '')).slice(0, 40_000),
    createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
  };
  if (message.aborted === true) safe.aborted = true;
  if (typeof message.error === 'string') safe.error = redactTaskText(message.error).slice(0, 1_000);
  return safe;
}
