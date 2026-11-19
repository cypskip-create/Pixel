import type { MemoryKind } from './types';

export interface AutomaticMemoryCandidate {
  kind: MemoryKind;
  content: string;
  tags: string[];
  /** Stable only within the active project; used to replace a directly updated preference. */
  slot?: string;
  replaceSlot?: boolean;
}

const MAX_CANDIDATE_LENGTH = 500;

/**
 * Extract a very small set of memories from trusted user-authored text.
 * No model is called here: deterministic phrasing rules, content filters and
 * project scoping make the persistence decision in the main process.
 */
export function extractAutomaticMemoryCandidates(input: string): AutomaticMemoryCandidate[] {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 2_000 || hasUnsafeMemoryContent(text)) return [];

  const correction = text.match(/^(?:pixel[, :]\s*)?(?:that(?:'s| is) wrong[,;:. ]+)?(?:change|update|correct) my (theme|response style|workflow) (?:preference|settings?) to (.+)$/i);
  if (correction?.[1] && correction[2]) {
    const fact = cleanCandidate(correction[2]);
    if (!fact) return [];
    const slot = correction[1].toLowerCase().replace(/\s+/g, '-');
    return [{
      kind: 'preference',
      content: `The user prefers ${stripTerminalPunctuation(fact)}.`,
      tags: ['automatic', 'user-confirmed', 'auto-correction', `auto-slot:${slot}`],
      slot,
      replaceSlot: true,
    }];
  }

  const explicit = text.match(/^(?:pixel[, :]\s*)?(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i)?.[1]
    ?? text.match(/^i want you to remember(?:\s+that)?\s+(.+)$/i)?.[1];
  if (explicit) {
    const fact = cleanCandidate(explicit);
    if (!fact) return [];
    const preference = /\b(prefer|like|love|want|always use|usually use)\b/i.test(fact);
    const slot = preference ? preferenceSlot(fact) : undefined;
    return [{
      kind: preference ? 'preference' : 'project',
      content: preference ? canonicalPreference(fact) : asSentence(fact),
      tags: ['automatic', 'user-requested', ...(slot ? [`auto-slot:${slot}`] : [])],
      ...(slot ? { slot, replaceSlot: true } : {}),
    }];
  }

  const preference = text.match(/^(?:for pixel,?\s+)?i\s+(prefer|like|love|want pixel to|always use|usually use)\s+(.+)$/i);
  if (preference?.[1] && preference[2]) {
    const fact = cleanCandidate(preference[2]);
    if (!fact) return [];
    const slot = preferenceSlot(fact);
    const predicate = preference[1].toLowerCase() === 'want pixel to' ? 'wants Pixel to' : 'prefers';
    return [{
      kind: 'preference',
      content: `The user ${predicate} ${stripTerminalPunctuation(fact)}.`,
      tags: ['automatic', 'user-confirmed', `auto-slot:${slot}`],
      slot,
      replaceSlot: true,
    }];
  }

  // Store only explicit, concise project assertions, not general chat or
  // instructions copied from a webpage, document, or screenshot.
  const projectFact = text.match(/^(?:the\s+)?pixel project\s+(uses|is built with|uses the architecture)\s+(.+)$/i);
  if (projectFact?.[1] && projectFact[2]) {
    const fact = cleanCandidate(`${projectFact[1].toLowerCase()} ${projectFact[2]}`);
    if (!fact) return [];
    return [{ kind: 'project', content: `The Pixel project ${stripTerminalPunctuation(fact)}.`, tags: ['automatic', 'user-confirmed', 'project-fact'] }];
  }

  return [];
}

/** A direct user command to forget one well-defined automatic preference slot. */
export function extractAutomaticMemoryForgetSlot(input: string): string | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (text.length > 500 || hasUnsafeMemoryContent(text)) return null;
  const match = text.match(/^(?:pixel[, :]\s*)?(?:please\s+)?forget (?:my |that )?(theme|response style|workflow) (?:preference|setting|memory)$/i);
  return match?.[1] ? match[1].toLowerCase().replace(/\s+/g, '-') : null;
}

export function isEligibleAutomaticMemoryText(text: string): boolean {
  return extractAutomaticMemoryCandidates(text).length > 0;
}

/**
 * A task summary is eligible only when it ended cleanly and every action that
 * still needs verification has been resolved. A model's final answer alone is
 * not evidence, and a successful substep must not turn a partially failed task
 * into a durable project outcome.
 */
export function hasVerifiedTaskOutcome(task: {
  status: string;
  steps: Array<{ status: string }>;
  pendingVerifications?: unknown[];
}): boolean {
  return task.status === 'completed'
    && task.steps.length > 0
    && task.steps.some((step) => step.status === 'verified')
    && !task.steps.some((step) => step.status === 'failed')
    && (task.pendingVerifications?.length ?? 0) === 0;
}

function hasUnsafeMemoryContent(text: string): boolean {
  return /```|<\/?(?:system|assistant|developer|tool)[^>]*>|\b(?:ignore|override|bypass)\s+(?:all\s+)?(?:previous|prior|system|safety)\s+instructions\b/i.test(text)
    || /\b(?:password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b\s*(?:=|:|\bis\b)\s*\S+/i.test(text)
    || /\bsk-[A-Za-z0-9_-]{12,}\b|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i.test(text)
    || /\b(?:webpage|website|document|screenshot|screen)\s+(?:says|said|instructs|tells pixel|contains instructions)\b/i.test(text);
}

function cleanCandidate(value: string): string | null {
  const candidate = stripTerminalPunctuation(value.trim().replace(/^['"“”]+|['"“”]+$/g, ''));
  if (!candidate || candidate.length > MAX_CANDIDATE_LENGTH || hasUnsafeMemoryContent(candidate)) return null;
  return candidate;
}

function preferenceSlot(value: string): string {
  if (/\b(theme|interface|colour|color|dark|light|monochrome|charcoal|black)\b/i.test(value)) return 'theme';
  if (/\b(format|formatting|bullet|concise|detail|tone|writing|response)\b/i.test(value)) return 'response-style';
  if (/\b(workflow|procedure|always|usually|default|prefer)\b/i.test(value)) return 'workflow';
  return `preference-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36)}`;
}

function canonicalPreference(value: string): string {
  return `The user prefers ${stripTerminalPunctuation(value)}.`;
}

function asSentence(value: string): string {
  const normalized = stripTerminalPunctuation(value);
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}.`;
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?]+$/g, '').trim();
}
