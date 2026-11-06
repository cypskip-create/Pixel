/**
 * Tool registry and permission policy.
 *
 * The registry is the single source of truth for what Pixel can do to the
 * machine. Two rules are enforced here, in code, rather than by convention:
 *
 *  1. Guide mode can never execute a state-changing tool.
 *  2. A tool marked `requiresApproval` cannot run without a recorded decision.
 *
 * The registry contains no model-generated permissions. A model may request a
 * tool; it can never widen its own authority.
 */

import type { Mode, PermissionDecision, PermissionGrant, RiskLevel, ToolCategory, ToolDefinition } from '../../shared/types';
import { getModeDescriptor } from '../../shared/types';

export interface ToolContext {
  /** User's current mode. */
  mode: Mode;
  /** Tool grants already approved in this session. */
  grants: Map<string, PermissionGrant>;
  /** Set when the user has pressed emergency stop. */
  stopped: boolean;
  /** Records an audit line; injected so this module stays dependency-free. */
  audit: (entry: {
    kind: 'tool' | 'permission' | 'system';
    summary: string;
    detail?: string;
    outcome: 'ok' | 'denied' | 'error' | 'cancelled';
  }) => void;
}

export interface ToolInvocation {
  name: string;
  args: Record<string, unknown>;
}

export type ExecutionDecision =
  | { allowed: true }
  | { allowed: false; reason: string; needsApproval: boolean };

/**
 * Decide whether a tool may run right now.
 *
 * Order matters: emergency stop outranks everything, then mode, then approval.
 */
export function evaluateInvocation(
  tool: ToolDefinition | undefined,
  context: ToolContext,
): ExecutionDecision {
  if (!tool) {
    return { allowed: false, reason: 'Unknown tool.', needsApproval: false };
  }

  if (context.stopped) {
    return {
      allowed: false,
      reason: 'Emergency stop is active. No tools may run until it is cleared.',
      needsApproval: false,
    };
  }

  const mode = getModeDescriptor(context.mode);
  if (tool.changesState && !mode.allowsStateChange) {
    return {
      allowed: false,
      reason: `"${tool.name}" changes things on this computer, which is not allowed in ${mode.label} mode.`,
      needsApproval: false,
    };
  }

  if (tool.requiresApproval && !hasValidGrant(tool.name, context)) {
    return {
      allowed: false,
      reason: `"${tool.name}" needs your approval before it can run.`,
      needsApproval: true,
    };
  }

  return { allowed: true };
}

/** A grant is valid when it has not expired. 'always' grants never expire. */
export function hasValidGrant(toolName: string, context: ToolContext): boolean {
  const grant = context.grants.get(toolName);
  if (!grant) return false;
  if (grant.scope === 'always') return true;
  if (grant.expiresAt !== undefined && Date.now() > grant.expiresAt) {
    context.grants.delete(toolName);
    return false;
  }
  return true;
}

/** Apply an approval decision, producing the grant to store (if any). */
export function applyDecision(
  decision: PermissionDecision,
  request: { toolName: string },
): PermissionGrant | null {
  if (!decision.approved) return null;
  const now = Date.now();
  return {
    id: `grant_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    toolName: request.toolName,
    scope: decision.duration,
    grantedAt: now,
    // 'once' is consumed after a single call, 'session' lasts 8 hours, and
    // 'always' persists until the user revokes it.
    expiresAt:
      decision.duration === 'session' ? now + 8 * 60 * 60 * 1000 : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Built-in tools
 * ------------------------------------------------------------------ */

/**
 * The Wave 1D tool surface.
 *
 * Every state-changing tool requires approval. Read-only system/screen tools do
 * not, but screen capture still demands an explicit user gesture before the
 * capture call itself is made (see screen.ts) — the registry cannot make
 * capture silent.
 */
export const BUILTIN_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'get_system_info',
    description: 'Reads CPU, memory, disk and display information from this computer.',
    category: 'system',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_current_time',
    description: 'Returns the current local date and time.',
    category: 'system',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'analyze_screen',
    description:
      'Captures the screen and asks a vision model to describe or explain what is visible. Only runs after the user explicitly requests it.',
    category: 'screen',
    risk: 'low',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['active_window', 'display'],
          description: 'What to capture.',
        },
        question: { type: 'string', description: 'What to look for on screen.' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_application',
    description: 'Launches an installed application by name.',
    category: 'system',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Application name, e.g. "Notepad".' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_navigate',
    description:
      'Opens a web page in a controlled browser and returns what is on it. Only http and https URLs are allowed.',
    category: 'browser',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL, including https://' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_inspect',
    description:
      'Reads the current browser page: title, URL, visible text, links, buttons and input fields.',
    category: 'browser',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_click',
    description: 'Clicks an element on the current page, identified by a CSS selector.',
    category: 'browser',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector, e.g. "#submit" or "text=Sign in"' },
      },
      required: ['selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_type',
    description: 'Types text into a field on the current page, identified by a CSS selector.',
    category: 'browser',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: {
          type: 'boolean',
          description: 'Press Enter afterwards. Set true only when the user asked to submit.',
        },
      },
      required: ['selector', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scrolls the current page up or down by a pixel amount.',
    category: 'browser',
    risk: 'low',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Positive scrolls down, negative scrolls up.' },
      },
      required: ['amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Takes a screenshot of the current browser page.',
    category: 'browser',
    risk: 'low',
    requiresApproval: true,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_verify',
    description:
      'Checks whether the current page contains expected text. Use this to confirm an action actually worked.',
    category: 'browser',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        expected: { type: 'string', description: 'Text that should be present on the page.' },
      },
      required: ['expected'],
      additionalProperties: false,
    },
  },  {
    name: 'type_text',
    description: 'Types text into the currently focused window.',
    category: 'input',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
] as const;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private stopped = false;
  private readonly grants = new Map<string, PermissionGrant>();

  constructor(tools: readonly ToolDefinition[] = BUILTIN_TOOLS) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Tools exposed to the model, filtered by what the current mode permits. */
  availableFor(mode: Mode): ToolDefinition[] {
    const descriptor = getModeDescriptor(mode);
    return this.list().filter((t) => descriptor.allowsStateChange || !t.changesState);
  }

  /** OpenAI-style function schemas for the API request. */
  schemasFor(mode: Mode): ToolDefinition[] {
    return this.availableFor(mode);
  }

  setStopped(stopped: boolean): void {
    this.stopped = stopped;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  evaluate(name: string, mode: Mode): ExecutionDecision {
    return evaluateInvocation(this.get(name), {
      mode,
      grants: this.grants,
      stopped: this.stopped,
      audit: () => {},
    });
  }

  grant(grant: PermissionGrant): void {
    this.grants.set(grant.toolName, grant);
  }

  /** Revoke a single tool grant. Returns true when one existed. */
  revoke(toolName: string): boolean {
    return this.grants.delete(toolName);
  }

  revokeAll(): number {
    const count = this.grants.size;
    this.grants.clear();
    return count;
  }

  activeGrants(): PermissionGrant[] {
    const now = Date.now();
    return [...this.grants.values()].filter(
      (g) => g.scope === 'always' || g.expiresAt === undefined || g.expiresAt > now,
    );
  }
}

/** Risk ordering helper for sorting/coloring UI. */
export function riskWeight(risk: RiskLevel): number {
  return { safe: 0, low: 1, medium: 2, high: 3 }[risk];
}

export function toolCategoryLabel(category: ToolCategory): string {
  switch (category) {
    case 'screen':
      return 'Screen';
    case 'input':
      return 'Keyboard & mouse';
    case 'system':
      return 'System';
    case 'browser':
      return 'Browser';
    case 'memory':
      return 'Memory';
    case 'code':
      return 'Code';
  }
}
