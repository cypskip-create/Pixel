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
import { z } from 'zod';
import type { ZodType } from 'zod';

import { deriveGrantScope, scopeCovers } from './scope';

export interface ToolContext {
  /** User's current mode. */
  mode: Mode;
  /** Tool grants already approved in this session. */
  grants: Map<string, PermissionGrant>;
  /** Set when the user has pressed emergency stop. */
  stopped: boolean;
  /** Arguments of the invocation being evaluated, used to check grant scope. */
  args?: Record<string, unknown>;
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
  // A grant aimed at one origin/application never covers a different target.
  if (!scopeCovers(grant.target, deriveGrantScope(toolName, context.args ?? {}))) return false;
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
  request: { toolName: string; args?: Record<string, unknown> },
): PermissionGrant | null {
  if (!decision.approved) return null;
  const now = Date.now();
  const target = deriveGrantScope(request.toolName, request.args ?? {});
  return {
    ...(Object.keys(target).length > 0 ? { target } : {}),
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
    name: 'request_human_takeover',
    description: 'Pauses this task and releases control while the user completes a sensitive or ambiguous step.',
    category: 'system',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', minLength: 5, maxLength: 1_000 } },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_screen',
    description:
      'Captures the screen and asks a vision model to describe or explain what is visible. Only runs after the user explicitly requests it.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['active_window', 'last_external', 'selected_window', 'display'],
          description: 'What to capture.',
        },
        question: { type: 'string', description: 'What to look for on screen.' },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedWindowTitle: { type: 'string', maxLength: 500 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', maxLength: 260 },
        displayId: { type: 'string', maxLength: 64 },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_foreground_window',
    description: 'Reads the foreground Windows application title and bounds using UI Automation.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_last_external_foreground_window',
    description: 'Reads Pixel\'s most recently observed non-Pixel foreground window from the in-memory Windows tracker. This reads window metadata only, takes no screenshot, and marks closed or changed-process targets stale.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_external_windows',
    description: 'Lists current visible non-Pixel top-level windows so the user can explicitly identify a target when the application or window is ambiguous. Do not choose among multiple plausible targets without the user selecting one. This reads metadata only and takes no screenshot.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_ui_elements',
    description: 'Searches a foreground Windows application, or a recently observed explicitly selected window, for accessible UI elements matching a name or AutomationId. Reading a selected background window does not activate or switch to it.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 300 },
        roles: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 20 },
        maxResults: { type: 'integer', minimum: 1, maximum: 25 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedWindowTitle: { type: 'string', maxLength: 500 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', maxLength: 260 },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'screen_highlight_control',
    description: 'Finds one exact accessible control in a recently observed window and draws temporary, passive visual guidance around it. Requires the exact opaque window reference, title and process identity from a recent observation. It never clicks, types, activates or switches applications.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1, maxLength: 300 },
        role: { type: 'string', maxLength: 80 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedWindowTitle: { type: 'string', minLength: 1, maxLength: 500 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', minLength: 1, maxLength: 260 },
        shape: { type: 'string', enum: ['rectangle', 'circle', 'arrow'] },
        label: { type: 'string', maxLength: 100 },
        step: { type: 'integer', minimum: 1, maximum: 99 },
        durationMs: { type: 'integer', minimum: 3000, maximum: 30000 },
      },
      required: ['selector', 'targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName'],
      additionalProperties: false,
    },
  },
  {
    name: 'screen_clear_annotations',
    description: 'Clears temporary Pixel visual guidance annotations. This does not interact with the selected application.',
    category: 'screen',
    risk: 'safe',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: { selector: { type: 'string', maxLength: 300 } },
      additionalProperties: false,
    },
  },
  {
    name: 'verify_ui_state',
    description: 'Checks whether one exact visible accessible control is present or absent in the explicitly selected window. Revalidates its opaque window ID, process ID and exact title. This is a bounded read-only UI Automation postcondition check.',
    category: 'screen',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1, maxLength: 300 },
        role: { type: 'string', maxLength: 80 },
        expectedWindowTitle: { type: 'string', minLength: 1, maxLength: 500 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', minLength: 1, maxLength: 260 },
        state: { type: 'string', enum: ['present', 'absent'] },
      },
      required: ['selector', 'expectedWindowTitle', 'targetWindowId', 'expectedProcessId', 'expectedProcessName', 'state'],
      additionalProperties: false,
    },
  },
  {
    name: 'invoke_ui_element',
    description: 'Invokes an accessible button, link, or menu item by exact accessible name or AutomationId only when the selected opaque window ID, process ID and title still match after approval. The exact non-minimized target is invoked directly through UI Automation; Pixel never activates or switches applications. Requires an explicit visible UIA control postcondition.',
    category: 'input',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1, maxLength: 300 },
        role: { type: 'string', maxLength: 80 },
        expectedWindowTitle: { type: 'string', minLength: 1, maxLength: 500 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', minLength: 1, maxLength: 260 },
        expectedResult: {
          type: 'object',
          properties: {
            selector: { type: 'string', minLength: 1, maxLength: 300 },
            role: { type: 'string', maxLength: 80 },
            state: { type: 'string', enum: ['present', 'absent'] },
          },
          required: ['selector', 'state'],
          additionalProperties: false,
        },
      },
      required: ['selector', 'targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName', 'expectedResult'],
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
    name: 'browser_open_search',
    description: 'Opens an explicit web search in the configured default browser. It does not read or summarize the search results. Requires user approval.',
    category: 'browser',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 500 } },
      required: ['query'],
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
    risk: 'high',
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
    risk: 'high',
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
    risk: 'high',
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
    description: 'Types approved text only if the selected opaque window ID, exact title and process identity still match the current foreground immediately before input. Pixel never switches applications.',
    category: 'input',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 2_000 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedWindowTitle: { type: 'string', minLength: 1, maxLength: 500 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', minLength: 1, maxLength: 260 },
      },
      required: ['text', 'targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName'],
      additionalProperties: false,
    },
  },
] as const;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly argumentSchemas = new Map<string, ZodType>();
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

  /** Validate model supplied arguments against the tool's declared JSON schema. */
  validateArgs(name: string, args: unknown): { ok: true } | { ok: false; message: string } {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, message: 'The requested capability is not registered.' };
    let schema = this.argumentSchemas.get(name);
    if (!schema) {
      try {
        schema = jsonSchemaToZod(tool.parameters);
        this.argumentSchemas.set(name, schema);
      } catch {
        return { ok: false, message: 'This tool has no supported argument contract in the current build.' };
      }
    }
    const parsed = schema.safeParse(args);
    if (parsed.success) return { ok: true };
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? `${issue.path.map(String).join('.')}: ` : '';
    return { ok: false, message: `${field}${issue?.message ?? 'arguments did not match the tool contract'}` };
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

  evaluate(name: string, mode: Mode, args?: Record<string, unknown>): ExecutionDecision {
    return evaluateInvocation(this.get(name), {
      mode,
      args,
      grants: this.grants,
      stopped: this.stopped,
      audit: () => {},
    });
  }

  grant(grant: PermissionGrant): void {
    // A grant is keyed by tool name, not by arguments. For a high-risk tool such
    // as type_text, a standing grant would approve any text into any window, so
    // high-risk tools are always downgraded to single use and re-asked each time.
    const tool = this.tools.get(grant.toolName);
    const hasNarrowTarget = Object.keys(grant.target ?? {}).length > 0;
    if (grant.scope !== 'once' && (tool?.risk === 'high' || !hasNarrowTarget)) {
      this.grants.set(grant.toolName, { ...grant, scope: 'once', expiresAt: undefined });
      return;
    }
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

type JsonSchema = Record<string, unknown>;

/** Convert the JSON Schema subset used by Pixel's registered tools to Zod. */
function jsonSchemaToZod(raw: unknown, depth = 0): ZodType {
  if (depth > 12 || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Unsupported JSON schema.');
  }
  const schema = raw as JsonSchema;
  const enumValues = schema.enum;
  if (Array.isArray(enumValues)) {
    if (enumValues.length === 0 || enumValues.some((value) => typeof value !== 'string')) {
      throw new Error('Unsupported enum.');
    }
    return z.enum(enumValues as [string, ...string[]]);
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union) && union.length > 0 && union.length <= 8) {
    const options = union.map((item) => jsonSchemaToZod(item, depth + 1));
    return z.union(options as [ZodType, ZodType, ...ZodType[]]);
  }

  const type = schema.type;
  if (type === 'object' || (type === undefined && typeof schema.properties === 'object')) {
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === 'string') : []);
    const shape: Record<string, ZodType> = {};
    for (const [name, child] of Object.entries(properties)) {
      const childSchema = jsonSchemaToZod(child, depth + 1);
      shape[name] = required.has(name) ? childSchema : childSchema.optional();
    }
    return z.object(shape).strict();
  }

  if (type === 'array') {
    if (!schema.items) throw new Error('Array schema has no item contract.');
    const item = jsonSchemaToZod(schema.items, depth + 1);
    const array = z.array(item);
    return typeof schema.maxItems === 'number' ? array.max(schema.maxItems) : array;
  }
  if (type === 'string') {
    let value = z.string();
    if (typeof schema.minLength === 'number') value = value.min(schema.minLength);
    if (typeof schema.maxLength === 'number') value = value.max(schema.maxLength);
    return value;
  }
  if (type === 'integer') {
    let value = z.number().int();
    if (typeof schema.minimum === 'number') value = value.min(schema.minimum);
    if (typeof schema.maximum === 'number') value = value.max(schema.maximum);
    return value;
  }
  if (type === 'number') {
    let value = z.number();
    if (typeof schema.minimum === 'number') value = value.min(schema.minimum);
    if (typeof schema.maximum === 'number') value = value.max(schema.maximum);
    return value;
  }
  if (type === 'boolean') return z.boolean();
  if (type === 'null') return z.null();
  throw new Error(`Unsupported JSON schema type: ${String(type)}`);
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
