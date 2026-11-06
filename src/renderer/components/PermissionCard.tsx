import { useState } from 'react';
import { ChevronRight, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import type { PermissionDecision, PermissionRequest, RiskLevel } from '@shared/types';
import { RISK_CLASSES, riskLabel, stringifyValue } from '@/lib/format';

interface PermissionCardProps {
  request: PermissionRequest;
  onDecide: (decision: PermissionDecision) => void;
  /** True while the decision is being written back to the shell. */
  pending?: boolean;
}

const RISK_ICON: Record<RiskLevel, typeof ShieldCheck> = {
  safe: ShieldCheck,
  low: ShieldCheck,
  medium: ShieldHalf,
  high: ShieldAlert,
};

const RISK_SENTENCE: Record<RiskLevel, string> = {
  safe: 'Read-only. Nothing on your computer changes.',
  low: 'Limited effect on this computer.',
  medium: 'This modifies something on your computer.',
  high: 'This can change or delete important data.',
};

/**
 * The consent gate.
 *
 * Deliberately blocking: there is no auto-approve, no countdown, and no
 * "remember" default. Every control is a real button so the card is fully
 * keyboard operable, and the highest-risk affordance is styled as such.
 */
export function PermissionCard({ request, onDecide, pending = false }: PermissionCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const RiskIcon = RISK_ICON[request.risk];
  const argumentEntries = Object.entries(request.args);

  const decide = (approved: boolean, duration: PermissionDecision['duration']): void => {
    onDecide({ requestId: request.id, approved, duration });
  };

  return (
    <section
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`perm-title-${request.id}`}
      aria-describedby={`perm-body-${request.id}`}
      className="glass-raised animate-pop flex w-[460px] flex-col gap-2.5 rounded-[var(--cyps-radius)] border-amber-300/25 p-3"
    >
      <header className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${RISK_CLASSES[request.risk]}`}
        >
          <RiskIcon size={15} strokeWidth={2.3} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={`perm-title-${request.id}`}
            className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink)]"
          >
            Pixel wants to
            <span
              className={`rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${RISK_CLASSES[request.risk]}`}
            >
              {riskLabel(request.risk)}
            </span>
          </h2>
          <p id={`perm-body-${request.id}`} className="mt-1 text-[12.5px] leading-snug text-[var(--color-ink)]">
            {request.action}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink-dim)]" title={request.target}>
            on <span className="text-[var(--color-ink-soft)]">{request.target}</span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-ink-dim)]">
            {RISK_SENTENCE[request.risk]}
            {request.changesData ? (
              <span className="ml-1 font-medium text-amber-200">Changes saved data.</span>
            ) : null}
          </p>
        </div>
      </header>

      {argumentEntries.length > 0 ? (
        <div className="rounded-xl border border-[var(--color-glass-border)] bg-black/15">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="no-drag flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink-soft)]"
          >
            <ChevronRight
              size={12}
              strokeWidth={2.6}
              aria-hidden="true"
              className="transition-transform duration-[var(--cyps-duration-fast)]"
              style={{ transform: detailsOpen ? 'rotate(90deg)' : 'none' }}
            />
            Exactly what will run
            <code className="ml-auto rounded bg-white/8 px-1 font-mono text-[10px] text-[var(--color-ink-soft)]">
              {request.toolName}
            </code>
          </button>
          {detailsOpen ? (
            <dl className="selectable max-h-32 overflow-y-auto px-2.5 pb-2 font-mono text-[10.5px] leading-relaxed">
              {argumentEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2 py-px">
                  <dt className="shrink-0 text-[var(--color-ink-dim)]">{key}</dt>
                  <dd className="min-w-0 break-all text-[var(--color-ink-soft)]">
                    {stringifyValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true, 'once')}
          autoFocus
          className="no-drag flex-1 rounded-xl border border-sky-400/40 bg-sky-500/25 px-3 py-2 text-[12px] font-semibold text-sky-50 transition-colors duration-[var(--cyps-duration-fast)] hover:bg-sky-500/40 disabled:opacity-50"
        >
          Allow once
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true, 'session')}
          title="Approve for the rest of this app session"
          className="no-drag flex-1 rounded-xl border border-[var(--color-glass-border)] bg-white/8 px-3 py-2 text-[12px] font-semibold text-[var(--color-ink-soft)] transition-colors duration-[var(--cyps-duration-fast)] hover:bg-white/16 hover:text-[var(--color-ink)] disabled:opacity-50"
        >
          Allow for session
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(false, 'once')}
          className="no-drag rounded-xl border border-rose-400/40 bg-rose-500/18 px-3 py-2 text-[12px] font-semibold text-rose-100 transition-colors duration-[var(--cyps-duration-fast)] hover:bg-rose-500/32 disabled:opacity-50"
        >
          Deny
        </button>
      </div>

      <p className="text-[10px] leading-snug text-[var(--color-ink-dim)]">
        Pixel is paused until you choose. Nothing runs on its own.
      </p>
    </section>
  );
}
