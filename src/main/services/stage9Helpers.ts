/**
 * Stage 9 Main-Process Helpers (Electron-free, directly testable).
 *
 * 1. `commitSessionImportSafely`: 2-phase session import commit that writes to
 *    canonical `HistoryStore` BEFORE committing the duplicate-detection digest
 *    in Python `WorkspaceServices`, so failed writes can always be retried.
 * 2. `validateArtifactPath`: path-security guard restricting `artifacts:open`
 *    and `artifacts:reveal` to approved local roots (no traversal / arbitrary paths).
 * 3. `resolveProfileContext`: authoritative profile instruction & model override
 *    resolution for local and remote gateway turns.
 */

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import type { ConversationRecord, HistoryStore } from '../history/store';
import { HistoryStore as HistoryStoreClass } from '../history/store';

export interface ActiveProfileState {
  id: string;
  name: string;
  instructions: string;
  providerOverride: string;
  modelOverride: string;
}

export const DEFAULT_ACTIVE_PROFILE: ActiveProfileState = {
  id: 'default',
  name: 'Default',
  instructions: '',
  providerOverride: '',
  modelOverride: '',
};

export function normalizeProfileState(raw: Record<string, unknown> | undefined | null): ActiveProfileState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ACTIVE_PROFILE };
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'default';
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
    instructions: typeof raw.instructions === 'string' ? raw.instructions.trim() : '',
    providerOverride: typeof raw.providerOverride === 'string' ? raw.providerOverride.trim() : '',
    modelOverride: typeof raw.modelOverride === 'string' ? raw.modelOverride.trim() : '',
  };
}

export function resolveProfileContext(
  profile: ActiveProfileState,
  base: { provider: string; model: string },
): {
  profileId: string;
  profileName: string;
  instructionsPrompt: string;
  provider: string;
  model: string;
} {
  const instructionsPrompt = profile.instructions
    ? `Active profile (${profile.name}) instructions:\n${profile.instructions}`
    : '';
  return {
    profileId: profile.id,
    profileName: profile.name,
    instructionsPrompt,
    provider: profile.providerOverride || base.provider,
    model: profile.modelOverride || base.model,
  };
}

export function validateArtifactPath(
  filePath: string,
  allowedRoots: string[],
): { ok: true; resolvedPath: string } | { ok: false; error: string } {
  const trimmed = (filePath || '').trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    return { ok: false, error: 'Artifact does not have a valid local file path.' };
  }
  if (!existsSync(trimmed)) {
    return { ok: false, error: 'Artifact file no longer exists on disk.' };
  }
  let targetReal: string;
  try {
    targetReal = normalize(realpathSync(trimmed));
  } catch {
    return { ok: false, error: 'Could not resolve artifact path safely.' };
  }

  for (const root of allowedRoots) {
    if (!root || !root.trim()) continue;
    let rootReal: string;
    try {
      rootReal = existsSync(root) ? normalize(realpathSync(root)) : normalize(resolve(root));
    } catch {
      rootReal = normalize(resolve(root));
    }
    const rel = relative(rootReal, targetReal);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return { ok: true, resolvedPath: targetReal };
    }
  }
  return { ok: false, error: 'Artifact path is outside Pixel approved directories.' };
}

export interface SafeSessionImportDeps {
  rawText: string;
  format: string;
  projectId: string;
  history: Pick<HistoryStore, 'save'>;
  preview: (rawText: string, format: string) => Promise<Record<string, unknown>>;
  confirm: (digest: string) => Promise<Record<string, unknown>>;
}

export async function commitSessionImportSafely(
  deps: SafeSessionImportDeps,
): Promise<Record<string, unknown>> {
  const preview = await deps.preview(deps.rawText, deps.format);
  if (!preview.ok) return preview;
  if (preview.duplicate) {
    return { ok: false, duplicate: true, error: 'This session export was already imported.' };
  }
  const sessions = Array.isArray(preview.sessions)
    ? (preview.sessions as Array<{ title?: string; messages?: Array<{ role?: string; content?: string }> }>)
    : [];
  if (sessions.length === 0) {
    return { ok: false, error: 'No valid conversation messages found in import payload.' };
  }

  const savedIds: string[] = [];
  let totalMessages = 0;
  for (const s of sessions) {
    const conv: ConversationRecord = HistoryStoreClass.newConversation(s.title || 'Imported session');
    conv.projectId = deps.projectId;
    const baseTime = Date.now();
    conv.messages = (Array.isArray(s.messages) ? s.messages : []).map((m, idx) => ({
      id: `imp-${baseTime}-${idx}`,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
      createdAt: baseTime + idx,
    }));
    totalMessages += conv.messages.length;
    // Throws BEFORE digest confirmation if HistoryStore persistence fails,
    // allowing safe retry without false duplicate rejection.
    deps.history.save(conv);
    savedIds.push(conv.id);
  }

  const digest = typeof preview.digest === 'string' ? preview.digest : '';
  if (digest) {
    await deps.confirm(digest);
  }

  return {
    ok: true,
    digest,
    imported: savedIds.length,
    messages: totalMessages,
    conversationIds: savedIds,
    sessions,
  };
}
