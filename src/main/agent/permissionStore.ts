import type { Database } from '../data/database';
import type { PermissionGrant, RiskLevel } from '../../shared/types';
import { PERMISSION_POLICY_VERSION, validateStandingGrant } from './scope';

interface GrantRow {
  id: string;
  tool_name: string;
  target_json: string;
  risk: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  policy_version: number;
}

/** Durable store for narrowly scoped Always Allow decisions. */
export class PermissionGrantStore {
  constructor(private readonly db: Database) {}

  listActive(now = Date.now()): PermissionGrant[] {
    this.clearExpired(now);
    const rows = this.db.query<GrantRow>(
      `SELECT * FROM permission_grants
       WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`,
      [now],
    );
    const grants: PermissionGrant[] = [];
    for (const row of rows) {
      const grant = toGrant(row);
      if (grant) grants.push(grant);
      else this.revoke(String(row.id), now);
    }
    return grants;
  }

  save(grant: PermissionGrant): void {
    if (grant.scope !== 'always' || grant.risk === 'high' || grant.risk === 'critical' || grant.policyVersion !== PERMISSION_POLICY_VERSION || !validateStandingGrant(grant.toolName, grant.target)) {
      throw new Error('The persistent permission does not match the current capability policy.');
    }
    this.db.execute(
      `INSERT INTO permission_grants
        (id, tool_name, target_json, risk, created_at, last_used_at, expires_at, revoked_at, policy_version)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET target_json = excluded.target_json, risk = excluded.risk,
         last_used_at = excluded.last_used_at, revoked_at = NULL, policy_version = excluded.policy_version`,
      [grant.id, grant.toolName, JSON.stringify(grant.target), grant.risk ?? 'medium', grant.grantedAt, grant.lastUsedAt ?? null, grant.policyVersion],
    );
  }

  markUsed(grant: PermissionGrant): void {
    if (!grant.lastUsedAt) return;
    this.db.execute(
      'UPDATE permission_grants SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL AND policy_version = ?',
      [grant.lastUsedAt, grant.id, PERMISSION_POLICY_VERSION],
    );
  }

  revoke(id: string, at = Date.now()): boolean {
    return this.db.execute('UPDATE permission_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [at, id]) > 0;
  }

  revokeAll(at = Date.now()): number {
    return this.db.execute('UPDATE permission_grants SET revoked_at = ? WHERE revoked_at IS NULL', [at]);
  }

  clearExpired(now = Date.now()): number {
    return this.db.execute(
      'UPDATE permission_grants SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?',
      [now, now],
    );
  }
}

function toGrant(row: GrantRow): PermissionGrant | null {
  let target: PermissionGrant['target'];
  try {
    const parsed: unknown = JSON.parse(String(row.target_json));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    target = parsed as PermissionGrant['target'];
  } catch {
    return null;
  }
  if (Number(row.policy_version) !== PERMISSION_POLICY_VERSION || !validateStandingGrant(String(row.tool_name), target)) return null;
  const risk = ['safe', 'low', 'medium', 'high', 'critical'].includes(String(row.risk)) ? String(row.risk) as RiskLevel : 'high';
  if (risk === 'high' || risk === 'critical') return null;
  return {
    id: String(row.id),
    toolName: String(row.tool_name),
    scope: 'always',
    target,
    risk,
    grantedAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    expiresAt: row.expires_at === null ? undefined : Number(row.expires_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    policyVersion: Number(row.policy_version),
  };
}
