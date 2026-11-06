/**
 * Workflow recording and replay.
 *
 * A workflow is a list of semantic steps: a locator (CSS selector, UIA element
 * id, or tool name), an action, parameters, and an expectation describing what a
 * successful replay should observe. Raw coordinates are a last resort and are
 * flagged as such, because they break the moment anything moves.
 *
 * Replay never inherits authority. Every step is re-checked against the current
 * mode and permission policy, and a step that would change state still needs
 * approval unless the user granted that tool for the session.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../data/database';
import type { Mode } from '../../shared/types';
import type { ToolRegistry } from '../agent/tools';

export const STEP_KINDS = ['browser', 'native', 'tool'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface WorkflowStep {
  ordinal: number;
  kind: StepKind;
  /** Semantic target: CSS selector, UIA automation id, or tool name. */
  locator: string;
  action: string;
  params: Record<string, unknown>;
  /** What a successful replay should observe, e.g. { textPresent: 'Saved' }. */
  expectation: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export type ReplayStatus = 'completed' | 'failed' | 'cancelled' | 'denied';

export interface StepOutcome {
  ordinal: number;
  status: 'done' | 'failed' | 'skipped';
  detail: string;
}

export interface ReplayResult {
  status: ReplayStatus;
  steps: StepOutcome[];
  failure?: string;
}

/** Runs one action and reports whether its expectation held. */
export interface StepRunner {
  run(step: WorkflowStep): Promise<{ ok: boolean; observed: string }>;
}

export class WorkflowStore {
  constructor(private readonly db: Database) {}

  create(
    projectId: string,
    name: string,
    steps: WorkflowStep[],
    description?: string,
  ): Workflow {
    const id = `wf_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const normalised = normaliseSteps(steps);

    this.db.transaction(() => {
      this.db.execute(
        `INSERT INTO workflows (id, project_id, name, description, created_at, updated_at, definition_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, projectId, name, description ?? null, now, now, definitionHash(normalised)],
      );
      this.writeSteps(id, normalised);
    });

    const created = this.get(id);
    if (!created) throw new Error('The workflow could not be read back after saving.');
    return created;
  }

  get(id: string): Workflow | null {
    const row = this.db.queryOne<{
      id: string;
      project_id: string;
      name: string;
      description: string | null;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM workflows WHERE id = ?', [id]);
    if (!row) return null;

    const steps = this.db.query<{
      ordinal: number;
      kind: string;
      locator: string;
      action: string;
      params: string;
      expectation: string;
    }>('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY ordinal', [id]);

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      steps: steps.map((step) => ({
        ordinal: Number(step.ordinal),
        kind: String(step.kind) as StepKind,
        locator: String(step.locator),
        action: String(step.action),
        params: safeParse(String(step.params)),
        expectation: safeParse(String(step.expectation)),
      })),
    };
  }

  list(projectId: string): Array<{ id: string; name: string; steps: number; updatedAt: number }> {
    return this.db
      .query<{ id: string; name: string; n: number; updated_at: number }>(
        `SELECT w.id, w.name, w.updated_at,
                (SELECT COUNT(*) FROM workflow_steps s WHERE s.workflow_id = w.id) AS n
           FROM workflows w WHERE w.project_id = ? ORDER BY w.updated_at DESC`,
        [projectId],
      )
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        steps: Number(row.n),
        updatedAt: Number(row.updated_at),
      }));
  }

  rename(id: string, name: string): void {
    this.db.execute('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?', [
      name,
      Date.now(),
      id,
    ]);
  }

  replaceSteps(id: string, steps: WorkflowStep[]): void {
    const normalised = normaliseSteps(steps);
    this.db.transaction(() => {
      this.db.execute(
        'UPDATE workflows SET updated_at = ?, definition_hash = ? WHERE id = ?',
        [Date.now(), definitionHash(normalised), id],
      );
      this.db.execute('DELETE FROM workflow_steps WHERE workflow_id = ?', [id]);
      this.writeSteps(id, normalised);
    });
  }

  delete(id: string): boolean {
    return this.db.execute('DELETE FROM workflows WHERE id = ?', [id]) > 0;
  }

  /**
   * Detect that a stored definition no longer matches what was recorded, e.g. a
   * hand-edited database. Replay refuses rather than acting on an unknown script.
   */
  isIntact(workflow: Workflow): boolean {
    const row = this.db.queryOne<{ definition_hash: string }>(
      'SELECT definition_hash FROM workflows WHERE id = ?',
      [workflow.id],
    );
    return row !== null && String(row.definition_hash) === definitionHash(workflow.steps);
  }

  private writeSteps(workflowId: string, steps: WorkflowStep[]): void {
    for (const step of steps) {
      this.db.execute(
        `INSERT INTO workflow_steps (workflow_id, ordinal, kind, locator, action, params, expectation)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          workflowId,
          step.ordinal,
          step.kind,
          step.locator,
          step.action,
          JSON.stringify(step.params),
          JSON.stringify(step.expectation),
        ],
      );
    }
  }
}

export interface ReplayOptions {
  mode: Mode;
  /** Central policy: may this step run without asking? */
  authorize: (step: WorkflowStep) => { allowed: boolean; reason: string; needsApproval: boolean };
  /** Requests approval for a step that needs it. */
  requestApproval?: (step: WorkflowStep) => Promise<boolean>;
  signal?: AbortSignal;
  onStep?: (outcome: StepOutcome) => void;
}

/**
 * Replay a workflow step by step.
 *
 * Each step: permission re-check, optional approval, execution, expectation
 * verification. A failed expectation stops the run, because continuing past an
 * unexpected state is how automation corrupts things.
 */
export async function replayWorkflow(
  workflow: Workflow,
  runner: StepRunner,
  options: ReplayOptions,
): Promise<ReplayResult> {
  const outcomes: StepOutcome[] = [];

  for (const step of workflow.steps) {
    if (options.signal?.aborted) {
      return { status: 'cancelled', steps: outcomes, failure: 'Cancelled before step completed.' };
    }

    const decision = options.authorize(step);
    if (!decision.allowed && !decision.needsApproval) {
      const outcome: StepOutcome = { ordinal: step.ordinal, status: 'failed', detail: decision.reason };
      outcomes.push(outcome);
      options.onStep?.(outcome);
      return { status: 'denied', steps: outcomes, failure: decision.reason };
    }

    if (decision.needsApproval) {
      const approved = options.requestApproval ? await options.requestApproval(step) : false;
      if (!approved) {
        const outcome: StepOutcome = {
          ordinal: step.ordinal,
          status: 'skipped',
          detail: 'The user did not approve this step.',
        };
        outcomes.push(outcome);
        options.onStep?.(outcome);
        return { status: 'denied', steps: outcomes, failure: outcome.detail };
      }
    }

    const result = await runner.run(step);
    const outcome: StepOutcome = {
      ordinal: step.ordinal,
      status: result.ok ? 'done' : 'failed',
      detail: result.observed,
    };
    outcomes.push(outcome);
    options.onStep?.(outcome);

    if (!result.ok) {
      return { status: 'failed', steps: outcomes, failure: result.observed };
    }
  }

  return { status: 'completed', steps: outcomes };
}

/** Normalise ordinals and reject an empty or malformed step list. */
export function normaliseSteps(steps: WorkflowStep[]): WorkflowStep[] {
  if (steps.length === 0) throw new Error('A workflow needs at least one step.');
  if (steps.length > 200) throw new Error('A workflow may not exceed 200 steps.');
  return steps.map((step, index) => {
    if (!STEP_KINDS.includes(step.kind)) {
      throw new Error(`Step ${String(index + 1)} has an unsupported kind "${String(step.kind)}".`);
    }
    if (step.locator.trim().length === 0) {
      throw new Error(`Step ${String(index + 1)} has no locator, so it cannot be replayed safely.`);
    }
    return { ...step, ordinal: index };
  });
}

/** Tolerant JSON parse for stored parameters; corruption yields an empty object. */
function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Stable hash of the step list, used to detect a changed definition. */
export function definitionHash(steps: WorkflowStep[]): string {
  const canonical = steps.map((step) => [
    step.kind,
    step.locator,
    step.action,
    JSON.stringify(step.params),
    JSON.stringify(step.expectation),
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

/**
 * Redact sensitive values before a step is recorded.
 *
 * Passwords, tokens and anything typed into a password field never reach the
 * database. Recording is advisory here; the recorder refuses the step entirely.
 */
export function redactStep(step: WorkflowStep): WorkflowStep {
  const sensitive = /password|passwd|secret|token|api[_-]?key|auth/i;
  const keys = Object.keys(step.params);
  const touchesSecret = keys.some((key) => sensitive.test(key)) || sensitive.test(step.locator);
  if (!touchesSecret) return step;

  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step.params)) {
    params[key] = sensitive.test(key) ? '[redacted]' : value;
  }
  return { ...step, params };
}

/** True when a recorded step must not be stored at all. */
export function isForbiddenStep(step: WorkflowStep): boolean {
  const sensitive = /password|passwd|secret|token|api[_-]?key/i;
  // Typing into a password field is never recorded, even redacted: the shape of
  // the secret can still leak through length or timing.
  return (
    (step.action === 'type' || step.action === 'fill') &&
    (sensitive.test(step.locator) || sensitive.test(String(step.params.selector ?? '')))
  );
}

/** Bridge from the central tool policy to a workflow step. */
export function authorizeStep(
  registry: ToolRegistry,
  mode: Mode,
  step: WorkflowStep,
): { allowed: boolean; reason: string; needsApproval: boolean } {
  if (step.kind === 'tool') {
    const decision = registry.evaluate(step.locator, mode);
    return {
      allowed: decision.allowed,
      reason: decision.allowed ? 'allowed' : decision.reason,
      needsApproval: !decision.allowed && decision.needsApproval,
    };
  }

  // Browser and native actions map onto their own tools.
  const toolName = step.kind === 'browser' ? 'browser_click' : 'type_text';
  const decision = registry.evaluate(toolName, mode);
  return {
    allowed: decision.allowed,
    reason: decision.allowed ? 'allowed' : decision.reason,
    needsApproval: !decision.allowed && decision.needsApproval,
  };
}
