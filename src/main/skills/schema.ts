import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SkillInputSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  description: z.string().min(1).max(500),
  required: z.boolean(),
}).strict().superRefine((input, context) => {
  if (/(password|passwd|secret|token|credential|api[_-]?key|cookie|cvv|otp)/i.test(input.name)) {
    context.addIssue({ code: 'custom', path: ['name'], message: 'Credential inputs are not supported in stored skills.' });
  }
});

export const SkillStepSchema = z.object({
  ordinal: z.number().int().min(0).max(199),
  kind: z.enum(['tool', 'browser', 'native']),
  /** Tool name, CSS/ARIA locator, or Windows AutomationId. */
  locator: z.string().min(1).max(500),
  action: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).default({}),
  expectation: z.record(z.string(), z.unknown()).default({}),
  approvalRequired: z.boolean().default(true),
}).strict().superRefine((step, context) => {
  if (step.kind !== 'tool' && /^(?:x|y|coord(?:inate)?s?)\s*[:=]/i.test(step.locator.trim())) {
    context.addIssue({ code: 'custom', message: 'Raw coordinates cannot be used as a semantic locator.' });
  }
});

export const SkillDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  projectId: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  purpose: z.string().min(1).max(2_000),
  triggers: z.array(z.string().min(1).max(300)).max(30),
  inputs: z.array(SkillInputSchema).max(30),
  requiredTools: z.array(z.string().min(1).max(120)).max(100),
  steps: z.array(SkillStepSchema).min(1).max(200),
  decisionBranches: z.array(z.string().min(1).max(1_000)).max(100),
  verificationRules: z.array(z.string().min(1).max(1_000)).min(1).max(100),
  failureHandling: z.array(z.string().min(1).max(1_000)).min(1).max(100),
  approvalRequirements: z.array(z.string().min(1).max(1_000)).max(100),
  status: z.enum(['draft', 'active']),
  version: z.number().int().min(1),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
}).strict().superRefine((skill, context) => {
  try {
    if (JSON.stringify(skill).length > 250_000) {
      context.addIssue({ code: 'custom', message: 'A skill definition must be no larger than 250 KB.' });
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'A skill definition must contain plain serializable data.' });
  }
  const inputNames = new Set(skill.inputs.map((input) => input.name));
  const ordinals = new Set<number>();
  for (const [index, step] of skill.steps.entries()) {
    if (ordinals.has(step.ordinal)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'ordinal'], message: 'Step ordinals must be unique.' });
    }
    ordinals.add(step.ordinal);
    if (containsSecretMaterial(step.params)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'params'], message: 'Credential data cannot be stored in a skill definition.' });
    }
    if (containsSecretMaterial(step.expectation)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'expectation'], message: 'Credential data cannot be stored in a skill definition.' });
    }
    if (step.kind === 'tool' && !skill.requiredTools.includes(step.locator)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'locator'], message: 'Tool steps must be listed in requiredTools.' });
    }
    if (step.kind === 'tool' && step.action !== step.locator) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'action'], message: 'A tool step action must match its registered tool name.' });
    }
    if (step.kind === 'native') {
      const requiredTool = ({
        get_foreground_window: 'get_foreground_window',
        find_ui_elements: 'find_ui_elements',
        verify_ui_state: 'verify_ui_state',
        invoke_ui_element: 'invoke_ui_element',
      } as const)[step.action as 'get_foreground_window' | 'find_ui_elements' | 'verify_ui_state' | 'invoke_ui_element'];
      if (!requiredTool) {
        context.addIssue({ code: 'custom', path: ['steps', index, 'action'], message: 'Native steps must use an available semantic UI Automation tool.' });
      } else if (!skill.requiredTools.includes(requiredTool)) {
        context.addIssue({ code: 'custom', path: ['steps', index, 'action'], message: `Native steps must list ${requiredTool} in requiredTools.` });
      }
    }
    if (step.action === 'type_text' || step.action === 'browser_type') {
      const value = step.params['text'];
      if (typeof value !== 'string' || !/^\$\{input\.[a-z][a-z0-9_]{0,39}\}$/.test(value)) {
        context.addIssue({ code: 'custom', path: ['steps', index, 'params', 'text'], message: 'Typed text must reference a declared skill input; literal text is not stored.' });
      } else {
        const inputName = value.slice('${input.'.length, -1);
        if (!inputNames.has(inputName)) {
          context.addIssue({ code: 'custom', path: ['steps', index, 'params', 'text'], message: 'Typed text references an undeclared skill input.' });
        }
      }
    }
  }
  if (containsSecretMaterial(skill)) {
    context.addIssue({ code: 'custom', message: 'Credential data cannot be stored in a skill definition.' });
  }
});

export type SkillInput = z.infer<typeof SkillInputSchema>;
export type SkillStep = z.infer<typeof SkillStepSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
export type SkillDraftInput = Omit<SkillDefinition, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;

export function skillDefinitionHash(definition: SkillDefinition): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

function containsSecretMaterial(value: unknown, key = ''): boolean {
  if (/(password|passwd|passphrase|secret|token|credential|api[_-]?key|authorization|cookie|cvv|otp)/i.test(key)) return true;
  if (typeof value === 'string') {
    return /\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bsk-[A-Za-z0-9_-]{12,}\b|\bAKIA[0-9A-Z]{16}\b|\b(password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b\s*[:=]\s*[^\s,;]+/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsSecretMaterial(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) => containsSecretMaterial(child, childKey));
  }
  return false;
}
