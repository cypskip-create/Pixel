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

/** Central consequence matrix. Tool declarations may add approval, never lower these floors. */
export const CONSEQUENCE_POLICY: Readonly<Record<RiskLevel, {
  approvalFloor: 'declared' | 'fresh' | 'each-call';
  sessionGrant: boolean;
  persistentGrant: boolean;
}>> = {
  safe: { approvalFloor: 'declared', sessionGrant: true, persistentGrant: true },
  low: { approvalFloor: 'declared', sessionGrant: true, persistentGrant: true },
  medium: { approvalFloor: 'declared', sessionGrant: true, persistentGrant: true },
  high: { approvalFloor: 'fresh', sessionGrant: false, persistentGrant: false },
  critical: { approvalFloor: 'each-call', sessionGrant: false, persistentGrant: false },
};

export function riskAllowsGrantDuration(risk: RiskLevel, duration: 'once' | 'session' | 'always'): boolean {
  if (duration === 'once') return true;
  return duration === 'session' ? CONSEQUENCE_POLICY[risk].sessionGrant : CONSEQUENCE_POLICY[risk].persistentGrant;
}

/**
 * Routine, bounded tools that may execute automatically in Agent mode without
 * interrupting the user for per-call approval.
 *
 * Hard invariants:
 *  - Emergency stop always overrides this list.
 *  - Guide mode still blocks any state-changing tool.
 *  - Hybrid mode still asks for approval normally.
 *  - Critical-risk operations (destructive actions, force push, uploads,
 *    form submission, credential/clipboard access) are NEVER in this set.
 */
export const AGENT_MODE_AUTONOMOUS_TOOLS: ReadonlySet<string> = new Set([
  // Public GitHub read-only inspection
  'plugin_github_repo_summary',
  'github_read_file',
  'github_list_issues',
  'github_list_prs',
  'github_repo_branches',
  'github_workflow_runs',
  'github_compare_commits',
  'github_search_repos',
  // Local Git inspection & bounded public clone
  'git_status',
  'git_diff',
  'git_log',
  'git_branches',
  'git_fetch',
  'git_clone',
  // Bounded local read-only file & document inspection
  'file_list',
  'file_read',
  'file_search',
  'file_metadata',
  'file_find_duplicates',
  'documents_search',
  'documents_list',
  'documents_read',
]);

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

  const risk = classifyInvocationRisk(tool, context.args ?? {});
  if (context.mode === 'agent' && risk !== 'critical' && AGENT_MODE_AUTONOMOUS_TOOLS.has(tool.name)) {
    return { allowed: true };
  }

  if ((tool.requiresApproval || CONSEQUENCE_POLICY[risk].approvalFloor !== 'declared') && !hasValidGrant(tool.name, context)) {
    return {
      allowed: false,
      reason: risk === 'critical'
        ? `"${tool.name}" performs a high-consequence action and needs your approval for this exact action.`
        : `"${tool.name}" needs your approval before it can run.`,
      needsApproval: true,
    };
  }

  return { allowed: true };
}

/** Invocation policy can raise a tool's declared baseline risk based on intent. */
export function classifyInvocationRisk(tool: ToolDefinition, args: Record<string, unknown>): RiskLevel {
  if (tool.name === 'browser_type' && args.submit === true) return 'critical';
  if (tool.name === 'browser_upload') return 'critical';
  if (tool.name === 'browser_click') {
    const target = typeof args.target === 'object' && args.target !== null && !Array.isArray(args.target)
      ? args.target as Record<string, unknown>
      : null;
    // CSS selectors and unspecified targets do not reveal what action the
    // element performs. Keep them at the critical approval floor.
    if (!target || typeof target.value !== 'string' || typeof target.kind !== 'string') return 'critical';
    if (/\b(submit|send|pay|purchase|order|delete|remove|publish|post|book|confirm|transfer|withdraw|subscribe|invite|share)\b/i.test(target.value)) return 'critical';
  }
  return tool.risk;
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
    description: 'Reads CPU, memory, uptime, load, system-volume free space, primary display dimensions and available battery status, plus local network-adapter names and protocol families. Adapter IP/hardware addresses and monitor labels/bounds are not returned; unavailable probes are reported as unavailable.',
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
    name: 'delegate_to_specialist',
    description: 'Delegate one bounded research, browser, systems or knowledge subtask to a specialist. The specialist receives only its declared tools; each tool still passes Pixel’s normal permission checks. It cannot delegate again, access Pixel Code, or broaden task permissions. Use a specific objective and report the specialist result accurately.',
    category: 'system',
    risk: 'medium',
    requiresApproval: false,
    changesState: false,
    parameters: {
      type: 'object',
      properties: {
        specialist: { type: 'string', enum: ['research', 'browser', 'systems', 'knowledge'] },
        objective: { type: 'string', minLength: 8, maxLength: 2_000 },
      },
      required: ['specialist', 'objective'],
      additionalProperties: false,
    },
  },
  {
    name: 'clipboard_read',
    description: 'Reads the current text clipboard only after explicit approval. Pixel refuses common credential-like contents, returns at most 20,000 characters, and makes the conversation session-only so copied text is not retained in persistent chat history.',
    category: 'system',
    risk: 'high',
    requiresApproval: true,
    changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'clipboard_copy',
    description: 'Copies user-approved plain text to the Windows clipboard after explicit approval. The prior text clipboard is held only in memory for optional conditional restoration; content is not logged or stored in task history.',
    category: 'system',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 20_000 } },
      required: ['text'], additionalProperties: false,
    },
  },
  {
    name: 'clipboard_restore',
    description: 'Restores the prior text clipboard snapshot from a recent clipboard_copy operation only if the clipboard still contains the exact text Pixel copied. The snapshot is volatile and expires after five minutes.',
    category: 'system',
    risk: 'medium',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object', properties: { restoreToken: { type: 'string', minLength: 20, maxLength: 80 } },
      required: ['restoreToken'], additionalProperties: false,
    },
  },
  {
    name: 'clipboard_paste',
    description: 'Sets the value of one exact, verified accessible editable control to the current clipboard text using Windows UI Automation ValuePattern. This replaces that control value rather than inserting at a caret. It requires approval, exact window identity, refuses secret-like clipboard contents, and verifies the read-back. Use only when replacing the selected control value is intended.',
    category: 'input',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1, maxLength: 300 }, role: { type: 'string', maxLength: 80 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 64 },
        expectedWindowTitle: { type: 'string', minLength: 1, maxLength: 500 },
        expectedProcessId: { type: 'integer', minimum: 1 },
        expectedProcessName: { type: 'string', minLength: 1, maxLength: 260 },
      },
      required: ['selector', 'targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName'],
      additionalProperties: false,
    },
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
    name: 'browser_new_tab',
    description: 'Opens an approved HTTP or HTTPS URL in a new isolated Pixel browser tab and verifies the final URL/title. Redirects and subresources remain subject to the network guard.',
    category: 'browser', risk: 'medium', requiresApproval: true, changesState: true,
    parameters: { type: 'object', properties: { url: { type: 'string', minLength: 8, maxLength: 2_048 } }, required: ['url'], additionalProperties: false },
  },
  {
    name: 'browser_list_tabs',
    description: 'Lists the current Pixel-controlled browser tabs, their opaque tab IDs, titles, URLs and active state. It does not inspect page content.',
    category: 'browser', risk: 'low', requiresApproval: false, changesState: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browser_switch_tab',
    description: 'Selects one currently open Pixel browser tab by an ID returned by browser_list_tabs.',
    category: 'browser', risk: 'low', requiresApproval: false, changesState: false,
    parameters: { type: 'object', properties: { tabId: { type: 'string', minLength: 5, maxLength: 80 } }, required: ['tabId'], additionalProperties: false },
  },
  {
    name: 'browser_close_tab',
    description: 'Closes one specified Pixel browser tab. A blank replacement tab is kept if it was the last tab. Requires approval for that exact tab ID.',
    category: 'browser', risk: 'high', requiresApproval: true, changesState: true,
    parameters: { type: 'object', properties: { tabId: { type: 'string', minLength: 5, maxLength: 80 } }, required: ['tabId'], additionalProperties: false },
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
    description: 'Clicks one unique visible, enabled browser element. Prefer an exact accessible target such as {kind:"role",role:"button",value:"Save"} or {kind:"text",value:"Open project"}; a CSS selector is supported for pages without accessible names.',
    category: 'browser',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector. Use instead of target, not together with it.' },
        target: {
          type: 'object',
          description: 'Exact accessible locator. kind is role, label, placeholder, or text. Role targets also require role, e.g. button or link.',
          properties: {
            kind: { enum: ['role', 'label', 'placeholder', 'text'] },
            role: { type: 'string', maxLength: 80 },
            value: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['kind', 'value'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_type',
    description: 'Fills one unique visible, enabled non-password field using an exact accessible label or placeholder (preferred), textbox role, or CSS selector. The field value is read back without returning it. Submissions require explicit user intent, each-call approval, and expectedText that Pixel verifies on the resulting page.',
    category: 'browser',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector. Use instead of target, not together with it.' },
        target: {
          type: 'object',
          properties: {
            kind: { enum: ['role', 'label', 'placeholder'] },
            role: { type: 'string', maxLength: 80 },
            value: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['kind', 'value'],
          additionalProperties: false,
        },
        text: { type: 'string', minLength: 1, maxLength: 4_000 },
        submit: {
          type: 'boolean',
          description: 'Press Enter after the field value is verified. Set true only when the user explicitly asked to submit; requires expectedText and fresh each-call approval.',
        },
        expectedText: { type: 'string', minLength: 1, maxLength: 500, description: 'Exact text that must appear in the page after submission or the action is reported unverified.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_upload',
    description: 'Attaches one user-selected regular file to an exact browser file input. Requires fresh critical approval and a separate native confirmation naming the file and destination site. Pixel verifies input metadata only; inspect the page for upload progress and site acceptance.',
    category: 'browser',
    risk: 'critical',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional exact CSS selector for the file input.' },
        target: {
          type: 'object',
          description: 'Exact accessible file-input target, preferably a label.',
          properties: {
            kind: { enum: ['role', 'label', 'placeholder', 'text'] },
            role: { type: 'string', maxLength: 80 },
            value: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['kind', 'value'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_download',
    description: 'Downloads from one exact browser link or button after fresh approval, asks for a native save location, refuses overwrite and files larger than 25 MB, and verifies the saved bytes by read-back and SHA-256. Pixel never opens or executes the result.',
    category: 'browser',
    risk: 'high',
    requiresApproval: true,
    changesState: true,
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector for the download link or button.' },
        target: {
          type: 'object',
          description: 'Exact accessible target such as a link named “Download report”.',
          properties: {
            kind: { enum: ['role', 'label', 'placeholder', 'text'] },
            role: { type: 'string', maxLength: 80 },
            value: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['kind', 'value'],
          additionalProperties: false,
        },
      },
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
  private readonly isAvailable?: (toolName: string) => boolean;

  constructor(
    tools: readonly ToolDefinition[] = BUILTIN_TOOLS,
    onGrantUsed?: (grant: PermissionGrant) => void,
    isAvailable?: (toolName: string) => boolean,
  ) {
    for (const t of tools) this.tools.set(t.name, t);
    this.onGrantUsed = onGrantUsed;
    this.isAvailable = isAvailable;
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.argumentSchemas.delete(tool.name);
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.argumentSchemas.delete(name);
    for (const [id, grant] of this.grants) if (grant.toolName === name) this.grants.delete(id);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].filter((tool) => this.isToolAvailable(tool.name));
  }

  get(name: string): ToolDefinition | undefined {
    const tool = this.tools.get(name);
    return tool && this.isToolAvailable(name) ? tool : undefined;
  }

  /** Validate model supplied arguments against the tool's declared JSON schema. */
  validateArgs(name: string, args: unknown): { ok: true } | { ok: false; message: string } {
    const tool = this.get(name);
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
    if (parsed.success) {
      if (name === 'browser_click' || name === 'browser_type' || name === 'browser_upload' || name === 'browser_download') {
        const values = parsed.data as Record<string, unknown>;
        if ((typeof values.selector === 'string') === (values.target !== undefined)) {
          return { ok: false, message: 'Provide exactly one of selector or target.' };
        }
        if (name === 'browser_type' && values.submit === true && (typeof values.expectedText !== 'string' || !values.expectedText.trim())) {
          return { ok: false, message: 'A form submission requires expectedText so Pixel can verify the result.' };
        }
      }
      return { ok: true };
    }
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
    const tool = this.get(toolName);
    const risk = tool ? classifyInvocationRisk(tool, args) : 'critical';
    if (!tool || !riskAllowsGrantDuration(risk, 'always')) return { allowed: false, target: {}, reason: 'This action is sensitive and always requires fresh approval.' };
    return standingGrantEligibility(toolName, args);
  }

  canGrantSession(toolName: string, args: Record<string, unknown>): { allowed: boolean; target: ReturnType<typeof deriveGrantScope>; reason: string } {
    const tool = this.get(toolName);
    if (!tool || !riskAllowsGrantDuration(classifyInvocationRisk(tool, args), 'session')) {
      return { allowed: false, target: deriveGrantScope(toolName, args), reason: 'Sensitive actions require fresh approval every time.' };
    }
    return sessionGrantEligibility(toolName, args);
  }

  /** Add one exact grant. Persistent entries are rejected unless policy and scope match. */
  grant(grant: PermissionGrant): boolean {
    // Screen grants use dedicated synthetic names so their narrower scope can
    // never be confused with a general tool grant. They inherit the declared
    // risk from the observation tool that created them.
    const grantTool = grant.toolName === SCREEN_STANDING_GRANT_TOOL || grant.toolName === SCREEN_SESSION_GRANT_TOOL
      ? this.get('analyze_screen')
      : this.get(grant.toolName);
    const declaredRisk = grantTool?.risk;
    if (!declaredRisk) return false;
    if (grant.scope === 'always' && (
      grant.risk === 'high' || grant.risk === 'critical' || declaredRisk === 'high' ||
      grant.policyVersion !== PERMISSION_POLICY_VERSION ||
      !validateStandingGrant(grant.toolName, grant.target)
    )) return false;
    if (grant.scope === 'session' && (grant.risk === 'high' || grant.risk === 'critical' || declaredRisk === 'high')) return false;
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

  /** Clear all permission grants tied to a capability whose scope changed. */
  revokeForTool(toolName: string): number {
    let count = 0;
    for (const [id, grant] of this.grants) {
      if (grant.toolName !== toolName) continue;
      this.grants.delete(id);
      count += 1;
    }
    return count;
  }

  private isToolAvailable(toolName: string): boolean {
    try { return this.isAvailable?.(toolName) ?? true; }
    catch { return false; }
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
  return { safe: 0, low: 1, medium: 2, high: 3, critical: 4 }[risk];
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
    case 'productivity':
      return 'Notes & tasks';
    case 'code':
      return 'Code';
  }
}
