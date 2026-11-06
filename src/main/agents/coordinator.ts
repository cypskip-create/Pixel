/**
 * Specialized subagents.
 *
 * A specialist is a named, bounded role: which tools it may use, how many steps
 * and tokens it may spend, and what shape of result it must return. The
 * coordinator - not the specialist - owns permission decisions and budgets.
 *
 * These are in-process objects, not operating-system processes. Isolation would
 * buy nothing here and would cost startup latency for every small task.
 */

import type { Mode, ToolDefinition } from '../../shared/types';
import type { ToolRegistry } from '../agent/tools';

export const SPECIALIST_IDS = [
  'research',
  'browser',
  'systems',
  'infrastructure',
  'knowledge',
  'code',
] as const;
export type SpecialistId = (typeof SPECIALIST_IDS)[number];

export interface SpecialistDefinition {
  id: SpecialistId;
  label: string;
  /** One line shown in the compact UI. */
  purpose: string;
  /** Tools this specialist may ever call. Everything else is refused. */
  allowedTools: string[];
  /** Hard ceilings, enforced by the coordinator. */
  limits: {
    maxSteps: number;
    maxTokens: number;
    timeoutMs: number;
  };
}

/** Tool names each specialist may use. Empty means "no tool access yet". */
export const SPECIALISTS: Record<SpecialistId, SpecialistDefinition> = {
  research: {
    id: 'research',
    label: 'Research',
    purpose: 'Finds and compares information on the web and reports with sources.',
    allowedTools: ['browser_navigate', 'browser_inspect', 'browser_click', 'browser_scroll', 'browser_verify', 'browser_screenshot', 'get_current_time'],
    limits: { maxSteps: 12, maxTokens: 24_000, timeoutMs: 180_000 },
  },
  browser: {
    id: 'browser',
    label: 'Browser',
    purpose: 'Drives a page: navigate, click, type, verify.',
    allowedTools: ['browser_navigate', 'browser_inspect', 'browser_click', 'browser_type', 'browser_scroll', 'browser_verify', 'browser_screenshot'],
    limits: { maxSteps: 15, maxTokens: 20_000, timeoutMs: 180_000 },
  },
  systems: {
    id: 'systems',
    label: 'Systems',
    purpose: 'Inspects this Windows machine and reads diagnostics.',
    allowedTools: ['get_system_info', 'get_current_time', 'analyze_screen'],
    limits: { maxSteps: 8, maxTokens: 12_000, timeoutMs: 120_000 },
  },
  infrastructure: {
    id: 'infrastructure',
    label: 'Infrastructure',
    purpose: 'Virtual machines, remote services and network checks.',
    // Deliberately empty: the VirtualBox and SSH adapters do not exist yet, and a
    // specialist must not be granted tools it cannot actually run.
    allowedTools: [],
    limits: { maxSteps: 10, maxTokens: 16_000, timeoutMs: 180_000 },
  },
  knowledge: {
    id: 'knowledge',
    label: 'Knowledge',
    purpose: 'Searches memory and indexed documents, answers with sources.',
    allowedTools: [
      'memory_search',
      'memory_list',
      'documents_search',
      'documents_list',
      'documents_index',
      'memory_save',
    ],
    limits: { maxSteps: 10, maxTokens: 18_000, timeoutMs: 120_000 },
  },
  code: {
    id: 'code',
    label: 'Pixel Code',
    purpose: 'Reserved for the future coding workspace. Not implemented.',
    // The interface exists so Pixel Code can be integrated later without changing
    // the coordinator; no implementation is attached in this wave.
    allowedTools: [],
    limits: { maxSteps: 0, maxTokens: 0, timeoutMs: 0 },
  },
};

export interface DelegationRequest {
  specialist: SpecialistId;
  objective: string;
  mode: Mode;
  projectId: string;
}

export interface DelegationPlan {
  specialist: SpecialistId;
  objective: string;
  tools: string[];
  limits: SpecialistDefinition['limits'];
  /** Tools requested but not granted, with the reason, for an honest report. */
  withheld: Array<{ tool: string; reason: string }>;
}

export interface DelegationResult {
  specialist: SpecialistId;
  status: 'completed' | 'failed' | 'cancelled' | 'refused';
  objective: string;
  steps: number;
  tokensUsed: number;
  findings: string[];
  failure?: string;
}

/** A specialist's single execution: bounded tool calls and a structured result. */
export interface SpecialistRunner {
  run(step: { tool: string; args: Record<string, unknown> }): Promise<{ ok: boolean; content: string }>;
}

/**
 * Decide what a subagent is allowed to do before it starts.
 *
 * Two gates: the specialist's own allowlist, and the current mode's policy. A
 * delegation cannot widen either, and a Guide-mode delegation is refused entirely
 * for anything that changes state.
 */
export function planDelegation(
  request: DelegationRequest,
  registry: ToolRegistry,
): DelegationPlan {
  const definition = SPECIALISTS[request.specialist];
  const tools: string[] = [];
  const withheld: Array<{ tool: string; reason: string }> = [];

  for (const toolName of definition.allowedTools) {
    const tool: ToolDefinition | undefined = registry.get(toolName);
    if (!tool) {
      withheld.push({ tool: toolName, reason: 'not available in this build' });
      continue;
    }
    const decision = registry.evaluate(toolName, request.mode);
    if (decision.allowed) {
      tools.push(toolName);
      continue;
    }
    withheld.push({
      tool: toolName,
      reason: decision.needsApproval
        ? 'needs the user\u2019s approval before use'
        : decision.reason,
    });
  }

  return {
    specialist: request.specialist,
    objective: request.objective,
    tools,
    limits: definition.limits,
    withheld,
  };
}

export interface CoordinatorDeps {
  registry: ToolRegistry;
  /** True once the emergency stop has been pressed. */
  isStopped: () => boolean;
  /** Per-tool invocation through the normal gateway (permissions included). */
  invokeTool: (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;
  now?: () => number;
}

/**
 * Runs a delegation.
 *
 * Enforces step, token and wall-clock budgets, honours the emergency stop between
 * every step, and refuses tools outside the plan even if the model asks for them.
 */
export class SpecialistCoordinator {
  private readonly deps: CoordinatorDeps;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
  }

  async delegate(
    plan: DelegationPlan,
    work: (step: number) => { tool: string; args: Record<string, unknown> } | null,
  ): Promise<DelegationResult> {
    const startedAt = (this.deps.now ?? Date.now)();
    const findings: string[] = [];
    let steps = 0;
    let tokensUsed = 0;

    if (plan.limits.maxSteps === 0) {
      return {
        specialist: plan.specialist,
        status: 'refused',
        objective: plan.objective,
        steps: 0,
        tokensUsed: 0,
        findings: [],
        failure: 'This specialist is not implemented in this build.',
      };
    }

    for (let step = 0; step < plan.limits.maxSteps; step += 1) {
      if (this.deps.isStopped()) {
        return {
          specialist: plan.specialist,
          status: 'cancelled',
          objective: plan.objective,
          steps,
          tokensUsed,
          findings,
          failure: 'Emergency stop was pressed.',
        };
      }

      const elapsed = (this.deps.now ?? Date.now)() - startedAt;
      if (elapsed > plan.limits.timeoutMs) {
        return {
          specialist: plan.specialist,
          status: 'failed',
          objective: plan.objective,
          steps,
          tokensUsed,
          findings,
          failure: `Time limit of ${String(plan.limits.timeoutMs)} ms reached.`,
        };
      }

      if (tokensUsed >= plan.limits.maxTokens) {
        return {
          specialist: plan.specialist,
          status: 'failed',
          objective: plan.objective,
          steps,
          tokensUsed,
          findings,
          failure: 'Token budget exhausted.',
        };
      }

      const next = work(step);
      if (next === null) {
        return {
          specialist: plan.specialist,
          status: 'completed',
          objective: plan.objective,
          steps,
          tokensUsed,
          findings,
        };
      }

      // The allowlist is enforced here, so a compromised or confused model cannot
      // reach a tool the plan did not grant.
      if (!plan.tools.includes(next.tool)) {
        return {
          specialist: plan.specialist,
          status: 'refused',
          objective: plan.objective,
          steps,
          tokensUsed,
          findings,
          failure: `"${next.tool}" was not granted to the ${plan.specialist} specialist.`,
        };
      }

      const result = await this.deps.invokeTool(next.tool, next.args);
      steps += 1;
      // Rough accounting; the provider records exact usage separately.
      tokensUsed += Math.ceil((result.content.length + JSON.stringify(next.args).length) / 4);

      if (result.ok) findings.push(result.content);
      else if (result.content.includes('denied')) {
        return {
          specialist: plan.specialist,
          status: 'refused',
          objective: plan.objective,
          steps,
          tokensUsed,
          findings,
          failure: `A tool call was denied: ${result.content}`,
        };
      }
    }

    return {
      specialist: plan.specialist,
      status: 'completed',
      objective: plan.objective,
      steps,
      tokensUsed,
      findings,
    };
  }
}

/** Find the specialist that owns a tool, for routing the model's request. */
export function specialistForTool(tool: string, registry: ToolRegistry): SpecialistId | null {
  const candidates = SPECIALIST_IDS.filter((id) =>
    SPECIALISTS[id].allowedTools.includes(tool),
  );
  if (candidates.length === 0) return null;
  // Prefer the specialist whose allowlist is the tightest fit.
  candidates.sort(
    (a, b) => SPECIALISTS[a].allowedTools.length - SPECIALISTS[b].allowedTools.length,
  );
  return registry.get(tool) ? candidates[0] : null;
}
