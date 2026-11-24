/**
 * Stage 9 Main-Process Helpers (Electron-free, directly testable).
 *
 * 1. `commitSessionImportSafely`: atomic & concurrency-safe 2-phase session
 *    import commit that writes to canonical `HistoryStore`, rolls back all
 *    partially saved conversations if any write fails, serializes concurrent
 *    attempts on the same digest, and commits the digest ONLY after full success.
 * 2. `validateArtifactPath`: path-security guard restricting `artifacts:open`
 *    and `artifacts:reveal` to approved local roots (no traversal / arbitrary paths).
 * 3. `resolveProfileContext` & `applyProfileProviderOverride`: authoritative
 *    profile instruction & per-run provider/model override resolution without
 *    mutating global Settings.
 * 4. `isTaskOwnedByProfile` & `isConversationOwnedByProfile`: strict profile
 *    ownership checks that keep legacy unscoped records bound to Default and
 *    prevent cross-profile leakage.
 */

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import {
  PROVIDER_CATALOG,
  getProviderDescriptor,
  type ProviderId,
  type ProviderSettings,
  type TaskRecord,
} from '../../shared/types';
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

const VALID_PROVIDER_IDS = new Set<string>(PROVIDER_CATALOG.map((p) => p.id));

export function parseProviderOverride(raw: string | undefined | null): ProviderId | undefined {
  const clean = (raw ?? '').trim().toLowerCase();
  if (!clean) return undefined;
  return VALID_PROVIDER_IDS.has(clean) ? (clean as ProviderId) : undefined;
}

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
  providerOverride?: ProviderId;
  model: string;
} {
  const instructionsPrompt = profile.instructions
    ? `Active profile (${profile.name}) instructions:\n${profile.instructions}`
    : '';
  const providerOverride = parseProviderOverride(profile.providerOverride);
  const provider = providerOverride ?? (profile.providerOverride || base.provider);
  const defaultModelForProvider = providerOverride && providerOverride !== base.provider
    ? getProviderDescriptor(providerOverride).defaultModel
    : base.model;
  return {
    profileId: profile.id,
    profileName: profile.name,
    instructionsPrompt,
    provider,
    ...(providerOverride ? { providerOverride } : {}),
    model: profile.modelOverride || defaultModelForProvider,
  };
}

/**
 * Returns an effective `ProviderSettings` object for a single run without
 * mutating the user's global Settings.
 */
export function applyProfileProviderOverride(
  baseSettings: ProviderSettings,
  providerOverride?: ProviderId,
  modelOverride?: string,
): ProviderSettings {
  if (!providerOverride && !modelOverride) return baseSettings;
  const targetProvider: ProviderId = providerOverride ?? baseSettings.provider;
  const changedProvider = targetProvider !== baseSettings.provider;
  const descriptor = getProviderDescriptor(targetProvider);
  return {
    ...baseSettings,
    provider: targetProvider,
    baseUrl: changedProvider ? descriptor.defaultBaseUrl : baseSettings.baseUrl,
    primaryModel: (modelOverride && modelOverride.trim())
      ? modelOverride.trim()
      : (changedProvider ? descriptor.defaultModel : baseSettings.primaryModel),
  };
}

/**
 * Strict profile ownership for tasks:
 * - Under a non-default profile, ONLY tasks tagged with `activeProjectId` belong.
 * - Under the Default profile, tasks tagged with any OTHER profile's project ID
 *   are excluded; tasks matching `activeProjectId` or legacy unscoped tasks belong.
 */
export function isTaskOwnedByProfile(
  task: Pick<TaskRecord, 'projectId'>,
  activeProfileId: string,
  activeProjectId: string,
  nonDefaultProfileProjectIds: ReadonlySet<string>,
): boolean {
  if (activeProfileId !== 'default') {
    return task.projectId === activeProjectId;
  }
  if (!task.projectId) return true; // Legacy unscoped tasks belong explicitly to Default
  if (task.projectId === activeProjectId) return true;
  return !nonDefaultProfileProjectIds.has(task.projectId);
}

/**
 * Strict profile ownership for conversations:
 * - Under a non-default profile, ONLY conversations with `record.projectId === activeProjectId` belong.
 * - Under the Default profile, legacy unscoped conversations (`!record.projectId`) and
 *   `activeProjectId` conversations belong; other profiles' conversations never leak.
 */
export function isConversationOwnedByProfile(
  record: Pick<ConversationRecord, 'projectId'>,
  activeProfileId: string,
  activeProjectId: string,
  nonDefaultProfileProjectIds: ReadonlySet<string>,
): boolean {
  if (activeProfileId !== 'default') {
    return record.projectId === activeProjectId;
  }
  if (!record.projectId) return true;
  if (record.projectId === activeProjectId) return true;
  return !nonDefaultProfileProjectIds.has(record.projectId);
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
  history: Pick<HistoryStore, 'save' | 'delete'>;
  preview: (rawText: string, format: string) => Promise<Record<string, unknown>>;
  confirm: (digest: string) => Promise<Record<string, unknown>>;
}

/** Tracks in-flight imports by digest so concurrent requests cannot create duplicate conversations. */
const inflightImportDigests = new Set<string>();

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

  const digest = typeof preview.digest === 'string' ? preview.digest : '';
  if (digest) {
    if (inflightImportDigests.has(digest)) {
      return { ok: false, duplicate: true, error: 'This session export is already being imported.' };
    }
    inflightImportDigests.add(digest);
  }

  const savedIds: string[] = [];
  let totalMessages = 0;
  try {
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
      deps.history.save(conv);
      savedIds.push(conv.id);
    }

    if (digest) {
      const confirmed = await deps.confirm(digest);
      if (confirmed && confirmed.ok === false) {
        throw new Error(String(confirmed.error ?? 'Failed to confirm session import digest.'));
      }
    }

    return {
      ok: true,
      digest,
      imported: savedIds.length,
      messages: totalMessages,
      conversationIds: savedIds,
      sessions,
    };
  } catch (err) {
    // Atomic rollback: remove any conversations persisted before the failure so retries never duplicate.
    for (const id of savedIds) {
      try {
        deps.history.delete(id);
      } catch {
        // Best-effort cleanup during rollback
      }
    }
    throw err;
  } finally {
    if (digest) inflightImportDigests.delete(digest);
  }
}
