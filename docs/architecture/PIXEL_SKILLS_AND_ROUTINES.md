# Pixel skills and routines

## Reviewed skill definitions

`src/main/skills/schema.ts` defines a strict versioned Zod format for purpose, project scope, triggers, declared inputs, required tools, semantic steps, branches, verification, failure handling and approval requirements. Raw coordinate locators are rejected for browser/native steps. Typed values must be declared inputs; common credential fields and credential-like strings are rejected.

`SkillStore` in SQLite keeps project-scoped drafts and immutable versions with integrity hashes and run history. The Settings panel can author JSON drafts, review them before activation, inspect active definitions and delete unreferenced skills. Activation refuses unavailable tools and unsupported native actions. A skill never carries the approval that authorized its original task.

The standalone `replaySkill` wrapper rechecks policy for each step, honors the reviewed per-step approval flag, substitutes only declared inputs and records results. It still takes a caller-supplied `StepRunner`; it is not the runtime used by the task UI. Scheduled runs send the reviewed semantic definition to the existing agent loop with an explicit tool allowlist, so model execution and the normal approval gateway remain authoritative. This is model-mediated execution, not deterministic semantic replay.

## Recording and save-from-task

There is no browser/native interaction recorder or automatic “save this completed task” prompt. A future recorder must have explicit start/stop, a visible recording indicator, secret sanitization, semantic action extraction, edit/review, discard and safe fixture replay. Pixel must not infer a skill from every completed task.

## Local routines

`src/main/routines/index.ts` and migration 6 implement a daily local-time scheduler with an IANA timezone, durable occurrence key, one-at-a-time queue, run history, pause/resume, cancel and user-confirmed manual retry. A routine must reference an active skill in the same project and cannot require interactive skill inputs. Missed occurrences are marked and skipped; interrupted runs are marked cancelled and never replayed. Failed or denied runs pause that schedule. Work only runs while Pixel is open and not emergency-stopped.

Routine execution wraps the normal `AgentExecutor`. It respects the skill tool allowlist and permission gateway. Required approvals may still require the user when a scheduled run starts. A one-time retry tells the model to re-observe before it repeats an irreversible action. There is no cloud worker.

## Specialist coordinator boundary

`src/main/agents/coordinator.ts` provides bounded role definitions, tool allowlists and per-role step/token/time limits. It is not invoked by the live `AgentExecutor` and has no model-backed specialist loop. Research/browser/systems/knowledge roles remain definitions; infrastructure and Pixel Code are intentionally unavailable. Desktop input must remain serialized if model-backed delegation is later added.

## Future remote execution

Cloud execution would require separate design for account authentication, worker isolation, billing, remote approvals and secret handling. This repository does not deploy a cloud worker or remote credential flow.
