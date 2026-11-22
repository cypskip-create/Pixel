# Pixel skills and routines

## Reviewed skill definitions

`src/main/skills/schema.ts` defines a strict versioned Zod format for purpose, project scope, triggers, declared inputs, required tools, semantic steps, branches, verification, failure handling and approval requirements. Raw coordinate locators are rejected for browser/native steps. Typed values must be declared inputs; common credential fields and credential-like strings are rejected.

`SkillStore` in SQLite keeps project-scoped drafts and immutable versions with integrity hashes and run history. The Settings panel can author JSON drafts, review them before activation, inspect active definitions and delete unreferenced skills. Activation refuses unavailable tools and unsupported native actions. A skill never carries the approval that authorized its original task.

The standalone `replaySkill` wrapper rechecks policy for each step, honors the reviewed per-step approval flag, substitutes only declared inputs and records results. It still takes a caller-supplied `StepRunner`; it is not the desktop tool adapter.

Scheduled routines now pass an ordered, reviewed tool plan to `AgentExecutor`. The model does not select or reorder those calls. Every call still goes through schema validation, current mode and risk policy, emergency stop, cancellation, scoped approval, the normal executor, task history, and postcondition checks. A successful state-changing call must be followed by a fresh observation; unresolved verification prevents later mutations and prevents completion. Plans stop immediately on a failed tool or failed declared predicate. The runner supports exact `resultContains` and structured `urlPrefix` checks plus the tool's own verification result; unknown expectation shapes fail closed. Per-step `approvalRequired` is enforced even if the built-in tool would otherwise be read-only. Scheduled skills remain tool-only, but can now use declared inputs supplied when the routine is created. The main process validates exact names, required values, length and credential-like patterns before saving them in the local routines table. The renderer receives input names only; raw values remain in main-process routine state and are redacted from task/audit output. Routine values are local configuration, not an encrypted credential vault, and must not contain credentials. The user can retry a failed routine once, subject to fresh observation and current approvals.

Active tool-only skills also have a **Run once** form for declared inputs. Inputs are checked against the active skill definition and tool schemas in the main process, credential-like values are refused, and the exact values are redacted from task/audit text. Tool permissions still use the live approval gateway. The one-time run is recorded in task history and skill-run history; the Workspace reports the actual final task status.

## Recording and save-from-task

Tasks & Activity provides explicit save-from-completed-task recording. It requires a completed, verified task, rejects unsupported and withheld values, turns string arguments into declared inputs, and saves a project-scoped draft for review. Review edits create a new immutable version; activation remains separate. Parameterized skills can run once or be scheduled after the user supplies non-credential values; the schedule stores those values locally and the renderer receives names only. Non-tool semantic steps remain unsupported by the live runner. There is no always-on browser/native recorder or automatic save prompt.

## Local routines

`src/main/routines/index.ts` and migrations 6/13 implement a daily local-time scheduler with an IANA timezone, durable occurrence key, one-at-a-time queue, run history, pause/resume, cancel and user-confirmed manual retry. A routine must reference an active skill in the same project. Declared input values are validated against the active skill at creation and each replay; unknown/missing values, credential-like content and values over 2,000 characters fail closed. Migration 13 stores these values with the routine; renderer IPC returns only input names. Task and audit history redact the exact configured values. Missed occurrences are marked and skipped; interrupted runs are marked cancelled and never replayed. Failed or denied runs pause that schedule. Work only runs while Pixel is open and not emergency-stopped.

Routine execution uses the normal `AgentExecutor` with deterministic ordered calls. It respects the skill tool allowlist and permission gateway. Required approvals may still require the user when a scheduled run starts. A one-time retry re-observes the current state before the exact reviewed sequence is attempted again. There is no cloud worker.

## Specialist coordinator boundary

`src/main/agents/coordinator.ts` provides bounded role definitions, tool allowlists and per-role step/token/time limits. The live `AgentExecutor` can invoke the research, browser, systems and knowledge specialists through the configured model, with child tools passing the normal central schema/permission gateway and desktop input lease. Recursive delegation and infrastructure/Pixel Code specialists remain unavailable.

## Future remote execution

Cloud execution would require separate design for account authentication, worker isolation, billing, remote approvals and secret handling. This repository does not deploy a cloud worker or remote credential flow.
