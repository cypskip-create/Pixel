/**
 * Memory tools exposed to the model.
 *
 * These are the only way the assistant can read or write memory. They go through
 * the same registry, permission policy and audit trail as every other tool, so a
 * model cannot quietly accumulate state: a write is a state-changing tool that the
 * user approves, and a read is scoped to the active project.
 */

import type { ToolDefinition } from '../../shared/types';
import { MEMORY_KINDS } from './types';
import type { MemoryKind } from './types';
import { MAX_MEMORY_RESULTS } from './store';
import type { MemoryStore } from './store';

export const MEMORY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'memory_save',
    description:
      'Saves a durable fact, preference or project detail so it can be recalled in later conversations. Only save what the user explicitly told you to remember.',
    category: 'memory',
    risk: 'low',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', maxLength: 4_000, description: 'The fact to remember, in one or two sentences.' },
        kind: {
          type: 'string',
          enum: [...MEMORY_KINDS],
          description: 'Category. Use "project" for project-specific state.',
        },
        tags: {
          type: 'array',
          items: { type: 'string', maxLength: 64 },
          maxItems: 8,
          description: 'Short keywords to aid later retrieval.',
        },
        confidence: {
          type: 'string',
          enum: ['user_approved', 'source_backed', 'inferred'],
          description: 'How this was obtained. Use user_approved only when the user stated it.',
        },
      },
      required: ['content', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_search',
    description:
      'Searches this project\u2019s memory for relevant records. Use before answering a question about earlier work.',
    category: 'memory',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 500 },
        kind: { type: 'string', enum: [...MEMORY_KINDS] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_MEMORY_RESULTS },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_list',
    description: 'Lists the most recent memories in this project.',
    category: 'memory',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...MEMORY_KINDS] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_MEMORY_RESULTS },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory_forget',
    description: 'Deletes a memory by id. Only use when the user asks to forget something.',
    category: 'memory',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
] as const;

export interface MemoryToolResult {
  ok: boolean;
  content: string;
  detail?: Record<string, unknown>;
  errorCode?: 'NOT_FOUND' | 'FAILED' | 'DENIED';
}

/** Executes the memory tools against a store, scoped to a project. */
export class MemoryTools {
  constructor(
    private readonly store: MemoryStore,
    private readonly resolveProject: () => string,
  ) {}

  handles(name: string): boolean {
    return MEMORY_TOOL_DEFINITIONS.some((tool) => tool.name === name);
  }

  run(name: string, args: Record<string, unknown>): MemoryToolResult {
    try {
      switch (name) {
        case 'memory_save':
          return this.save(args);
        case 'memory_search':
          return this.search(args);
        case 'memory_list':
          return this.list(args);
        case 'memory_forget':
          return this.forget(args);
        default:
          return { ok: false, content: `Unknown memory tool "${name}".`, errorCode: 'NOT_FOUND' };
      }
    } catch (error) {
      return {
        ok: false,
        content: `Memory tool failed: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private save(args: Record<string, unknown>): MemoryToolResult {
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (content.length === 0) {
      return { ok: false, content: 'There is nothing to remember.', errorCode: 'FAILED' };
    }
    if (content.length > 4_000) {
      return { ok: false, content: 'A memory must be 4,000 characters or fewer.', errorCode: 'FAILED' };
    }
    const kind = MEMORY_KINDS.includes(args.kind as MemoryKind)
      ? (args.kind as MemoryKind)
      : 'project';
    const tags = Array.isArray(args.tags)
      ? args.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8).map((tag) => tag.trim().slice(0, 64))
      : [];
    const confidence =
      args.confidence === 'source_backed' || args.confidence === 'inferred'
        ? args.confidence
        : 'user_approved';

    const projectId = this.resolveProject();
    // Prune as we go: memory should not grow without bound on a long-lived install.
    this.store.pruneExpired();

    const result = this.store.save({
      projectId,
      kind,
      content,
      source: 'conversation',
      confidence,
      tags,
    });

    return {
      ok: true,
      content: result.duplicate
        ? `Already remembered (id ${result.memory.id}); usage count increased.`
        : `Saved to memory (id ${result.memory.id}, kind ${kind}).`,
      detail: { id: result.memory.id, duplicate: result.duplicate, kind },
    };
  }

  private search(args: Record<string, unknown>): MemoryToolResult {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query.length === 0) {
      return { ok: false, content: 'A search query is required.', errorCode: 'FAILED' };
    }
    if (query.length > 500) {
      return { ok: false, content: 'A memory search query must be 500 characters or fewer.', errorCode: 'FAILED' };
    }
    const kind = MEMORY_KINDS.includes(args.kind as MemoryKind)
      ? (args.kind as MemoryKind)
      : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 5;

    const hits = this.store.search({
      projectId: this.resolveProject(),
      text: query,
      ...(kind ? { kinds: [kind] } : {}),
      limit,
    });

    if (hits.length === 0) {
      return {
        ok: true,
        content: `No stored memory matches "${query}". Do not invent an answer; tell the user it is not in memory.`,
        detail: { count: 0 },
      };
    }

    this.store.touch(hits.map((hit) => hit.memory.id));
    const lines = hits.map(
      (hit, index) =>
        `${index + 1}. [${hit.memory.kind}/${hit.memory.confidence}] ${hit.memory.content} (source: ${hit.memory.source})`,
    );
    return {
      ok: true,
      content: `Found ${hits.length} memor${hits.length === 1 ? 'y' : 'ies'}:\n${lines.join('\n')}`,
      detail: { count: hits.length, ids: hits.map((hit) => hit.memory.id) },
    };
  }

  private list(args: Record<string, unknown>): MemoryToolResult {
    const kind = MEMORY_KINDS.includes(args.kind as MemoryKind)
      ? (args.kind as MemoryKind)
      : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const projectId = this.resolveProject();
    const memories = this.store.list({ projectId, ...(kind ? { kind } : {}), limit });

    if (memories.length === 0) {
      return { ok: true, content: 'This project has no stored memories yet.', detail: { count: 0 } };
    }

    const lines = memories.map(
      (memory) => `- ${memory.id} [${memory.kind}] ${memory.content.slice(0, 160)}`,
    );
    return {
      ok: true,
      content: `${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}:\n${lines.join('\n')}`,
      detail: { count: memories.length },
    };
  }

  private forget(args: Record<string, unknown>): MemoryToolResult {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (id.length === 0) return { ok: false, content: 'A memory id is required.', errorCode: 'FAILED' };

    const existing = this.store.get(id);
    if (!existing) {
      return { ok: false, content: `No memory with id ${id}.`, errorCode: 'NOT_FOUND' };
    }
    // A memory may only be forgotten from the project that owns it.
    if (existing.projectId !== this.resolveProject()) {
      return {
        ok: false,
        content: 'That memory belongs to a different project and cannot be changed from here.',
        errorCode: 'DENIED',
      };
    }

    this.store.delete(id);
    return { ok: true, content: `Deleted memory ${id}.`, detail: { id } };
  }
}
