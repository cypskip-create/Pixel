import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Shield, Trash2 } from 'lucide-react';
import type { PermissionGrant } from '@shared/types';
import { readBridge } from '@/lib/bridge';

export function PermissionsPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  const bridge = readBridge();
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    setGrants(await bridge.bridge.permissions.listActiveGrants());
  }, [bridge]);

  useEffect(() => { void refresh().catch(() => setError('Saved permissions are unavailable.')); }, [refresh]);

  const revoke = async (grant: PermissionGrant): Promise<void> => {
    if (bridge.kind !== 'ready') { setError('The native permissions bridge is unavailable.'); return; }
    setBusyId(grant.id); setError(null); setNotice(null);
    try {
      if (!await bridge.bridge.permissions.revokeGrant(grant.id)) throw new Error('That permission was already revoked or expired.');
      setGrants((current) => current.filter((item) => item.id !== grant.id));
      setNotice('Permission revoked. Pixel will ask again before using this action.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not revoke that permission.'); }
    finally { setBusyId(null); }
  };

  const clearExpired = async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    setBusyId('expired'); setError(null); setNotice(null);
    try { const count = await bridge.bridge.permissions.clearExpired(); setNotice(`Cleared ${count} expired permission${count === 1 ? '' : 's'}.`); await refresh(); }
    catch { setError('Could not clear expired permissions.'); }
    finally { setBusyId(null); }
  };

  const revokeAll = async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    setBusyId('all'); setError(null); setNotice(null);
    try { const count = await bridge.bridge.permissions.revokeAll(); setGrants([]); setConfirmAll(false); setNotice(`Revoked ${count} active permission${count === 1 ? '' : 's'}.`); }
    catch { setError('Could not revoke all permissions.'); }
    finally { setBusyId(null); }
  };

  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
    <button type="button" onClick={onBack} className="no-drag mb-2 flex w-fit items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-[var(--color-ink-soft)] hover:bg-white/8"><ArrowLeft size={12} aria-hidden="true" /> Back to settings</button>
    <div className="mb-2 flex items-start gap-2">
      <p className="flex-1 text-[10.5px] leading-snug text-[var(--color-ink-dim)]">Persistent grants and current Pixel-run window approvals are listed here and can be revoked. Emergency Stop revokes all active grants.</p>
      <button type="button" disabled={busyId !== null} onClick={() => void clearExpired()} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[9.5px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">Clear expired</button>
    </div>
    {error ? <p role="alert" className="mb-2 rounded-lg border border-neutral-400/35 bg-neutral-500/12 px-2 py-1.5 text-[10.5px] text-neutral-100">{error}</p> : null}
    {notice ? <p role="status" className="mb-2 text-[10px] text-neutral-200">{notice}</p> : null}
    {grants.length === 0 ? <p className="rounded-xl border border-white/8 bg-white/4 px-2.5 py-3 text-[10.5px] text-[var(--color-ink-dim)]">No active permissions.</p> : grants.map((grant) => <article key={grant.id} className="mb-1.5 rounded-xl border border-[var(--color-border)] bg-white/4 p-2">
      <div className="flex items-start gap-2">
        <Shield size={13} className="mt-0.5 shrink-0 text-neutral-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10.5px] font-semibold text-[var(--color-ink)]">{grant.toolName === 'screen_observation_session' ? 'Screen observation & passive guidance' : grant.toolName}</p>
          <p className="break-all text-[10px] text-[var(--color-ink-dim)]">{scopeText(grant)}</p>
          <p className="mt-0.5 text-[9px] text-[var(--color-ink-dim)]">{grant.scope === 'session' ? 'This Pixel run' : grant.scope === 'always' ? 'Always Allow' : 'Allow Once'} · Approved {dateText(grant.grantedAt)}{grant.expiresAt ? ` · Expires ${dateText(grant.expiresAt)}` : ''}</p>
        </div>
        <button type="button" disabled={busyId !== null} onClick={() => void revoke(grant)} aria-label={`Revoke ${grant.toolName} permission`} className="no-drag flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[9.5px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50"><Trash2 size={10} /> Revoke</button>
      </div>
    </article>)}
    {grants.length > 0 ? <div className="mt-1 flex justify-end">
      {confirmAll ? <div className="flex items-center gap-2 text-[10px]"><span>Revoke all active permissions?</span><button type="button" disabled={busyId !== null} onClick={() => void revokeAll()} className="font-semibold text-neutral-100">Confirm</button><button type="button" onClick={() => setConfirmAll(false)} className="text-[var(--color-ink-dim)]">Cancel</button></div> : <button type="button" disabled={busyId !== null} onClick={() => setConfirmAll(true)} className="no-drag rounded-lg border border-white/10 px-2 py-1 text-[9.5px] text-[var(--color-ink-soft)] hover:bg-white/8 disabled:opacity-50">Revoke all</button>}
    </div> : null}
  </div>;
}

function scopeText(grant: PermissionGrant): string {
  if (grant.target?.processName && grant.target.windowTitle) return `Exact window: ${grant.target.processName} · ${grant.target.windowTitle} · ref ${grant.target.windowId ?? 'unknown'}`;
  if (grant.target?.app) return `Application: ${grant.target.app}`;
  if (grant.target?.origin) return `Website origin: ${grant.target.origin}`;
  return 'Target unavailable';
}

function dateText(value: number): string {
  return Number.isFinite(value) ? new Date(value).toLocaleString() : 'unknown';
}
