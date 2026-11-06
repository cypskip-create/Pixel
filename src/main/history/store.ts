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
    const raw = this.storage.read(`history.${id}`);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isConversationRecord(parsed)) return null;
      return parsed;
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
    const trimmed: ConversationRecord = {
      ...record,
      updatedAt: Date.now(),
      messages: record.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
    };
    this.storage.write(`history.${record.id}`, JSON.stringify(trimmed));

    const ids = this.listIds().filter((existing) => existing !== record.id);
    ids.unshift(record.id);
    const kept = ids.slice(0, MAX_CONVERSATIONS);
    this.storage.write(INDEX_KEY, JSON.stringify(kept));
  }

  delete(id: string): void {
    this.storage.write(`history.${id}`, JSON.stringify(null));
    this.storage.write(INDEX_KEY, JSON.stringify(this.listIds().filter((x) => x !== id)));
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
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    Array.isArray(candidate.messages)
  );
}