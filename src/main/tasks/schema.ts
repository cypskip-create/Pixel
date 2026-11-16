import { z } from 'zod';

const taskStatus = z.enum([
  'planning',
  'running',
  'pause_requested',
  'awaiting_approval',
  'awaiting_user',
  'paused',
  'blocked',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
]);

export const TaskStepSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(500),
  status: z.enum(['pending', 'running', 'done', 'verified', 'failed', 'skipped']),
  toolName: z.string().max(120).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.number().finite().optional(),
  endedAt: z.number().finite().optional(),
  detail: z.string().max(2_000).optional(),
}).strict();

export const TaskRecordSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  status: taskStatus,
  steps: z.array(TaskStepSchema).max(500),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite().optional(),
  endedAt: z.number().finite().optional(),
  request: z.string().max(20_000).optional(),
  result: z.string().max(20_000).optional(),
  projectId: z.string().max(200).optional(),
  allowedTools: z.array(z.string().min(1).max(120)).max(100).optional(),
  budget: z.object({
    deadlineAt: z.number().finite(),
    maxTurns: z.number().int().nonnegative(),
    turnsUsed: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    maxRetries: z.number().int().nonnegative(),
    maxModelTokens: z.number().int().nonnegative(),
    modelTokensUsed: z.number().int().nonnegative(),
  }).strict().optional(),
  approvalRefs: z.array(z.string().max(200)).max(100).optional(),
  evidence: z.array(z.object({
    id: z.string().min(1).max(200),
    kind: z.enum(['observation', 'verification', 'recovery']),
    summary: z.string().max(2_000),
    source: z.string().max(300),
    at: z.number().finite(),
  }).strict()).max(500).optional(),
  checkpoint: z.object({
    phase: z.enum(['before_model', 'before_tool', 'awaiting_approval']),
    at: z.number().finite(),
    summary: z.string().max(500),
  }).strict().optional(),
  pauseRequested: z.boolean().optional(),
  recoveryNote: z.string().max(2_000).optional(),
  handoffReason: z.string().max(1_000).optional(),
  reobserveRequired: z.boolean().optional(),
  pendingVerifications: z.array(z.object({
    stepId: z.string().max(200),
    toolName: z.string().max(120),
    expectedWindowTitle: z.string().max(500).optional(),
    verificationSelector: z.string().max(300).optional(),
    verificationRole: z.string().max(80).optional(),
    verificationState: z.enum(['present', 'absent']).optional(),
  }).strict()).max(100).optional(),
}).strict();

/** Mask common credential forms before task data is written to the local DB. */
export function redactTaskText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[redacted-key]')
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[redacted-key]')
    .replace(/\b(password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b(?:\s+is)?(?:\s*[:=]\s*|\s+)([^\s,;]+)/gi, '$1 [redacted]')
    .slice(0, 20_000);
}
