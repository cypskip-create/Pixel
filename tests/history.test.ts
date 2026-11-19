import { describe, expect, it } from 'vitest';
import {
  HistoryStore,
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  MemoryStorage,
  deriveTitle,
} from '../src/main/history/store';
import type { ChatMessage } from '../src/shared/types';
import type { ConversationRecord as StoreRecord } from '../src/main/history/store';

function msg(content: string): ChatMessage {
  return { id: `m_${Math.random().toString(36).slice(2, 8)}`, role: 'user', content, createdAt: 0 };
}

function record(id: string, messages: ChatMessage[] = []): StoreRecord {
  return { id, title: `t-${id}`, createdAt: 0, updatedAt: 0, messages };
}

describe('deriveTitle', () => {
  it('collapses whitespace', () => {
    expect(deriveTitle('  hello   there  ')).toBe('hello there');
  });

  it('falls back for empty input', () => {
    expect(deriveTitle('   ')).toBe('New conversation');
  });

  it('truncates long input with an ellipsis', () => {
    const title = deriveTitle('a'.repeat(120));
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith('\u2026')).toBe(true);
  });
});

describe('HistoryStore', () => {
  it('starts empty', () => {
    const store = new HistoryStore(new MemoryStorage());
    expect(store.listIds()).toEqual([]);
    expect(store.loadMostRecent()).toBeNull();
  });

  it('round-trips a conversation', () => {
    const store = new HistoryStore(new MemoryStorage());
    store.save(record('a', [msg('one'), msg('two')]));

    const loaded = store.load('a');
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messages[1].content).toBe('two');
  });

  it('searches conversation titles and previews with pagination and project scope', () => {
    const store = new HistoryStore(new MemoryStorage());
    store.save({ ...record('a', [msg('an earlier hardware thread'), msg('laptop upgrades')]), title: 'Hardware notes', projectId: 'p1' });
    store.save({ ...record('b', [msg('Debian install')]), title: 'Linux setup', projectId: 'p2' });
    store.save({ ...record('c', [msg('Electric cars')]), title: 'Travel', projectId: 'p1' });

    expect(store.list({ projectId: 'p1' }).map((item) => item.id)).toEqual(['c', 'a']);
    expect(store.list({ projectId: 'p1', search: 'hardware' }).map((item) => item.id)).toEqual(['a']);
    expect(store.list({ projectId: 'p1', search: 'earlier hardware thread' }).map((item) => item.id)).toEqual(['a']);
    expect(store.list({ projectId: 'p1', search: 'electric', limit: 1, offset: 0 })[0]?.id).toBe('c');
    expect(store.list({ projectId: 'p1', search: 'electric', limit: 1, offset: 1 })).toEqual([]);
  });

  it('never writes session-only conversations to persistent storage', () => {
    const storage = new MemoryStorage();
    const store = new HistoryStore(storage);
    store.save({ ...record('session-only', [msg('private')]), persistence: 'session' });

    expect(storage.read('history.index')).toBeNull();
    expect(storage.read('history.session-only')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('stores only sanitized user-facing text and redacts credentials', () => {
    const store = new HistoryStore(new MemoryStorage());
    const secret = 'sk-0123456789abcdef';
    const unsafe: ChatMessage = {
      id: 'assistant',
      role: 'assistant',
      content: `The key is ${secret}`,
      reasoning: 'private reasoning',
      toolCalls: [{ id: 't', name: 'file_write', argumentsJson: '{"path":"secret"}' }],
      images: [{ dataUrl: 'data:image/png;base64,secret-image', mimeType: 'image/png', width: 1, height: 1, source: 'upload' }],
      createdAt: 1,
    };
    store.save(record('safe', [unsafe, { ...msg('internal'), role: 'tool' }, { ...msg('system text'), role: 'system' }]));

    const saved = store.load('safe');
    expect(saved?.messages).toHaveLength(1);
    expect(saved?.messages[0].content).not.toContain(secret);
    expect(saved?.messages[0].content).toContain('[redacted-key]');
    expect(saved?.messages[0]).not.toHaveProperty('reasoning');
    expect(saved?.messages[0]).not.toHaveProperty('toolCalls');
    expect(saved?.messages[0]).not.toHaveProperty('images');
    expect(JSON.stringify(saved)).not.toContain('secret-image');
  });

  it('lists newest saved first', () => {
    const store = new HistoryStore(new MemoryStorage());
    store.save(record('a'));
    store.save(record('b'));
    store.save(record('c'));
    expect(store.listIds()).toEqual(['c', 'b', 'a']);
  });

  it('re-saving moves a conversation to the front without duplicating it', () => {
    const store = new HistoryStore(new MemoryStorage());
    store.save(record('a'));
    store.save(record('b'));
    store.save(record('a'));
    expect(store.listIds()).toEqual(['a', 'b']);
  });

  it('deletes a conversation and its index entry', () => {
    const store = new HistoryStore(new MemoryStorage());
    store.save(record('a'));
    store.save(record('b'));
    store.delete('a');
    expect(store.listIds()).toEqual(['b']);
    expect(store.load('a')).toBeNull();
  });

  it('caps stored conversations at MAX_CONVERSATIONS', () => {
    const storage = new MemoryStorage();
    const store = new HistoryStore(storage);
    for (let i = 0; i < MAX_CONVERSATIONS + 10; i += 1) store.save(record(`c${i}`));
    expect(store.listIds()).toHaveLength(MAX_CONVERSATIONS);
    expect(store.load('c0')).toBeNull();
    expect(storage.read('history.c0')).toBe('null');
  });

  it('clears saved conversations and their index', () => {
    const storage = new MemoryStorage();
    const store = new HistoryStore(storage);
    store.save(record('a', [msg('private') ]));
    store.clear();
    expect(store.listIds()).toEqual([]);
    expect(store.load('a')).toBeNull();
    expect(storage.read('history.a')).toBe('null');
  });

  it('caps messages per conversation, keeping the newest', () => {
    const store = new HistoryStore(new MemoryStorage());
    const many = Array.from({ length: MAX_MESSAGES_PER_CONVERSATION + 20 }, (_, i) => msg(`m${i}`));
    store.save(record('big', many));

    const loaded = store.load('big');
    expect(loaded?.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(loaded?.messages[loaded.messages.length - 1].content).toBe(
      `m${MAX_MESSAGES_PER_CONVERSATION + 19}`,
    );
  });

  it('returns null for unknown ids', () => {
    const store = new HistoryStore(new MemoryStorage());
    expect(store.load('nope')).toBeNull();
  });

  it('survives a corrupt index', () => {
    const storage = new MemoryStorage();
    storage.write('history.index', '{not json');
    const store = new HistoryStore(storage);
    expect(store.listIds()).toEqual([]);
    // Saving afterwards must rebuild a valid index.
    store.save(record('a'));
    expect(store.listIds()).toEqual(['a']);
  });

  it('survives a corrupt conversation record', () => {
    const storage = new MemoryStorage();
    storage.write('history.a', '"just a string"');
    storage.write('history.index', '["a"]');
    const store = new HistoryStore(storage);
    expect(store.load('a')).toBeNull();
    // loadMostRecent should skip the bad one rather than throw.
    expect(store.loadMostRecent()).toBeNull();
  });

  it('skips corrupt records when finding the most recent', () => {
    const storage = new MemoryStorage();
    const store = new HistoryStore(storage);
    store.save(record('good', [msg('ok')]));
    storage.write('history.bad', '<<garbage>>');
    storage.write('history.index', JSON.stringify(['bad', 'good']));
    expect(store.loadMostRecent()?.id).toBe('good');
  });

  it('ignores non-string entries in the index', () => {
    const storage = new MemoryStorage();
    storage.write('history.index', '["a", 5, null, {"x":1}, "b"]');
    const store = new HistoryStore(storage);
    expect(store.listIds()).toEqual(['a', 'b']);
  });
});

describe('HistoryStore.newConversation', () => {
  it('derives a title from the first message', () => {
    const c = HistoryStore.newConversation('Explain this error');
    expect(c.title).toBe('Explain this error');
    expect(c.messages).toEqual([]);
    expect(c.id).toMatch(/^conv_/);
  });

  it('generates unique ids', () => {
    const a = HistoryStore.newConversation('x');
    const b = HistoryStore.newConversation('x');
    expect(a.id).not.toBe(b.id);
  });
});
