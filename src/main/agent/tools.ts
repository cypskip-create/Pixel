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

import { deriveGrantScope, scopeCovers, standingGrantEligibility, sessionGrantEligibility, validateSessionGrant, validateStandingGrant, PERMISSION_POLICY_VERSION, SCREEN_SESSION_GRANT_TOOL, SCREEN_STANDING_GRANT_TOOL, isScreenSessionTool } from './scope';

export interface ToolContext {
  /** User's current mode. */
  mode: Mode;
  /** Tool grants already approved in this session. */
  grants: Map<string, PermissionGrant>;
  /** Set when the user has pressed emergency stop. */
  stopped: boolean;
  /** Arguments of the invocation being evaluated, used to check grant scope. */
  args?: Record<string, unknown>;
  onGrantUsed?: (grant: PermissionGrant) => void;
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
  const wanted = deriveGrantScope(toolName, context.args ?? {});
  for (const [key, grant] of context.grants) {
    if (grant.toolName !== toolName && !(
      (grant.toolName === SCREEN_SESSION_GRANT_TOOL || grant.toolName === SCREEN_STANDING_GRANT_TOOL) &&
      isScreenSessionTool(toolName)
    )) continue;
    if (grant.scope !== 'always' && grant.expiresAt !== undefined && Date.now() > grant.expiresAt) {
      context.grants.delete(key);
      continue;
    }
    if (!scopeCovers(grant.target, wanted)) continue;
    if (grant.scope === 'always') {
      const used = { ...grant, lastUsedAt: Date.now() };
      context.grants.set(key, used);
      context.onGrantUsed?.(used);
      return true;
    }
    return true;
  }
  return false;
}

/** Apply an approval decision, producing the grant to store (if any). */
export function applyDecision(
  decision: PermissionDecision,
  request: { toolName: string; args?: Record<string, unknown>; risk?: RiskLevel },
): PermissionGrant | null {
  if (!decision.approved) return null;
  const now = Date.now();
  const target = decision.duration === 'always' && isScreenSessionTool(request.toolName)
    ? standingGrantEligibility(request.toolName, request.args ?? {}).target
    : deriveGrantScope(request.toolName, request.args ?? {});
  return {
    ...(Object.keys(target).length > 0 ? { target } : {}),
    id: `grant_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    toolName: isScreenSessionTool(request.toolName) && decision.duration === 'session'
      ? SCREEN_SESSION_GRANT_TOOL
      : isScreenSessionTool(request.toolName) && decision.duration === 'always'
        ? SCREEN_STANDING_GRANT_TOOL
        : request.toolName,
    scope: decision.duration,
    grantedAt: now,
    risk: request.risk,
    lastUsedAt: null,
    ...(decision.duration === 'always' ? { policyVersion: PERMISSION_POLICY_VERSION } : {}),
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
      'Captures a screen or exact selected window and asks a vision model to describe what is visible. For selected_window, pass the exact window ID, title, and process identity from a recent window observation. The user may authorize this exact live window for this Pixel run, or explicitly save a standing screen-observation grant limited to the exact process name and exact window title. These grants cover observation and passive guidance only; they never grant clicks or typing.',
    category: 'screen',
    risk: 'medium',
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
    risk: 'low',
    requiresApproval: false,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_last_external_foreground_window',
    description: 'Reads Pixel\'s most recently observed non-Pixel foreground window from the in-memory Windows tracker. This reads window metadata only, takes no screenshot, and marks closed or changed-process targets stale.',
    category: 'screen',
    risk: 'low',
    requiresApproval: false,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_external_windows',
    description: 'Lists current visible non-Pixel top-level windows so the user can explicitly identify a target when the application or window is ambiguous. Do not choose among multiple plausible targets without the user selecting one. This reads metadata only and takes no screenshot.',
    category: 'screen',
    risk: 'low',
    requiresApproval: false,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_ui_elements',
    description: 'Searches a foreground Windows application, or a recently observed explicitly selected window, for accessible UI elements matching a name or AutomationId. Reading a selected background window does not activate or switch to it.',
    category: 'screen',
    risk: 'medium',
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
    risk: 'medium',
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
    name: 'screen_draw_arrow',
    description: 'Finds one exact accessible control in the explicitly selected, recently observed window and draws a temporary passive arrow and optional label to it on the desktop overlay. Coordinates come only from verified UI Automation bounds. This never clicks or focuses the application.',
    category: 'screen',
    risk: 'medium',
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
        label: { type: 'string', maxLength: 100 },
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
    risk: 'medium',
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
    name: 'control_ui_element',
    description: 'Performs one bounded semantic UI Automation operation on one exact, unique, enabled control in the approved selected Windows window. Supports select, set a switch to an explicit on/off state, one small scroll increment/decrement, and expand/collapse. Pixel revalidates the selected window/process immediately before acting and reads the same UIA pattern again to verify the result. Unsupported patterns fail clearly. It never activates a window, clicks coordinates, or sends raw keyboard input.',
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
        action: { type: 'string', enum: ['select', 'toggle', 'scroll', 'expand', 'collapse'] },
        desiredToggleState: { type: 'string', enum: ['on', 'off'] },
        scrollAxis: { type: 'string', enum: ['vertical', 'horizontal'] },
        scrollDirection: { type: 'string', enum: ['increment', 'decrement'] },
      },
      required: ['selector', 'targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName', 'action'],
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
    description: 'Sets an approved value on one exact accessible editable control using Windows UI Automation ValuePattern. Requires the selected opaque window ID, exact title and process identity. Pixel refuses password and read-only controls, never focuses or switches applications, verifies the value by reading it back, and does not return or log the entered value.',
    category: 'input',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 2_000 },
        selector: { type: 'string', minLength: 1, maxLength: 300 },
        role: { type: 'string', maxLength: 80 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedWindowTitle: { type: 'string', minLength: 1, maxLength: 500 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', minLength: 1, maxLength: 260 },
      },
      required: ['text', 'selector', 'targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName'],
      additionalProperties: false,
    },
  },
] as const;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly argumentSchemas = new Map<string, ZodType>();
  private stopped = false;
  private readonly grants = new Map<string, PermissionGrant>();
  private readonly onGrantUsed?: (grant: PermissionGrant) => void;

  constructor(tools: readonly ToolDefinition[] = BUILTIN_TOOLS, onGrantUsed?: (grant: PermissionGrant) => void) {
    for (const t of tools) this.tools.set(t.name, t);
    this.onGrantUsed = onGrantUsed;
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
      onGrantUsed: this.onGrantUsed,
      audit: () => {},
    });
  }

  canGrantAlways(toolName: string, args: Record<string, unknown>): { allowed: boolean; target: ReturnType<typeof deriveGrantScope>; reason: string } {
    const tool = this.tools.get(toolName);
    if (!tool || tool.risk === 'high') return { allowed: false, target: {}, reason: 'This action is sensitive and always requires fresh approval.' };
    return standingGrantEligibility(toolName, args);
  }

  canGrantSession(toolName: string, args: Record<string, unknown>): { allowed: boolean; target: ReturnType<typeof deriveGrantScope>; reason: string } {
    return sessionGrantEligibility(toolName, args);
  }

  /** Add one exact grant. Persistent entries are rejected unless policy and scope match. */
  grant(grant: PermissionGrant): boolean {
    if (grant.scope === 'always' && (
      grant.risk === 'high' ||
      grant.policyVersion !== PERMISSION_POLICY_VERSION ||
      !validateStandingGrant(grant.toolName, grant.target)
    )) return false;
    // Keep existing tool-specific session grants working. The new shared
    // screen-observation grant is the only session capability that needs the
    // stricter multi-field target validation below.
    if (grant.scope === 'session' && grant.toolName === SCREEN_SESSION_GRANT_TOOL && !validateSessionGrant(grant.toolName, grant.target)) return false;
    this.grants.set(grant.id, { ...grant });
    return true;
  }

  /** Revoke a specific grant id, or one single-use grant for legacy callers. */
  revoke(idOrToolName: string): boolean {
    if (this.grants.delete(idOrToolName)) return true;
    const once = [...this.grants.entries()].find(([, grant]) => grant.toolName === idOrToolName && grant.scope === 'once');
    if (!once) return false;
    return this.grants.delete(once[0]);
  }

  revokeAll(): number {
    const count = this.grants.size;
    this.grants.clear();
    return count;
  }

  activeGrants(): PermissionGrant[] {
    const now = Date.now();
    return [...this.grants.values()].filter(
      (g) => !g.revokedAt && (g.scope === 'always' || g.expiresAt === undefined || g.expiresAt > now),
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
    case 'board':
      return 'Pixel Board';
    case 'files':
      return 'Files';
    case 'documents':
      return 'Documents';
    case 'code':
      return 'Code';
  }
}
