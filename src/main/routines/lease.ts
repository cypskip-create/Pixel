import { randomUUID } from 'node:crypto';
import type { Database } from '../data/database';

export interface SchedulerLeaseInfo {
  lockName: string;
  ownerId: string;
  pid: number;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
}

/**
 * SQLite transactional scheduler lease lock.
 *
 * Prevents two concurrent Pixel instances or workers from ticking and
 * dispatching the same scheduled routines simultaneously. Stale leases whose
 * `expires_at <= now` are atomically reclaimed inside a SQLite transaction.
 */
export class SchedulerLeaseManager {
  readonly ownerId: string;

  constructor(
    private readonly db: Database,
    private readonly lockName = 'pixel-routine-scheduler',
    ownerId?: string,
  ) {
    this.ownerId = ownerId ?? `sched_${process.pid}_${randomUUID().slice(0, 8)}`;
  }

  /**
   * Attempts to acquire or renew the scheduler lease atomically.
   * Returns `true` if this owner holds the lease; `false` if another live
   * owner holds an unexpired lease.
   */
  acquireOrRenew(ttlMs = 45_000, now = Date.now()): boolean {
    const expiresAt = now + Math.max(5_000, ttlMs);
    let acquired = false;
    this.db.transaction(() => {
      const existing = this.db.queryOne<{
        owner_id: string;
        expires_at: number;
      }>(
        'SELECT owner_id, expires_at FROM scheduler_leases WHERE lock_name = ?',
        [this.lockName],
      );

      if (!existing) {
        this.db.execute(
          `INSERT INTO scheduler_leases (lock_name, owner_id, pid, acquired_at, heartbeat_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [this.lockName, this.ownerId, process.pid, now, now, expiresAt],
        );
        acquired = true;
        return;
      }

      if (existing.owner_id === this.ownerId) {
        this.db.execute(
          `UPDATE scheduler_leases SET heartbeat_at = ?, expires_at = ?, pid = ?
           WHERE lock_name = ? AND owner_id = ?`,
          [now, expiresAt, process.pid, this.lockName, this.ownerId],
        );
        acquired = true;
        return;
      }

      if (Number(existing.expires_at) <= now) {
        // Reclaim stale lease atomically.
        this.db.execute(
          `UPDATE scheduler_leases
           SET owner_id = ?, pid = ?, acquired_at = ?, heartbeat_at = ?, expires_at = ?
           WHERE lock_name = ? AND expires_at <= ?`,
          [this.ownerId, process.pid, now, now, expiresAt, this.lockName, now],
        );
        const verify = this.db.queryOne<{ owner_id: string }>(
          'SELECT owner_id FROM scheduler_leases WHERE lock_name = ?',
          [this.lockName],
        );
        acquired = verify?.owner_id === this.ownerId;
      }
    });
    return acquired;
  }

  release(): boolean {
    return this.db.execute(
      'DELETE FROM scheduler_leases WHERE lock_name = ? AND owner_id = ?',
      [this.lockName, this.ownerId],
    ) > 0;
  }

  inspect(): SchedulerLeaseInfo | null {
    const row = this.db.queryOne<{
      lock_name: string;
      owner_id: string;
      pid: number;
      acquired_at: number;
      heartbeat_at: number;
      expires_at: number;
    }>('SELECT * FROM scheduler_leases WHERE lock_name = ?', [this.lockName]);
    if (!row) return null;
    return {
      lockName: String(row.lock_name),
      ownerId: String(row.owner_id),
      pid: Number(row.pid),
      acquiredAt: Number(row.acquired_at),
      heartbeatAt: Number(row.heartbeat_at),
      expiresAt: Number(row.expires_at),
    };
  }
}
