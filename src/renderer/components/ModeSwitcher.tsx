import { useEffect, useRef } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { Mode, ModeDescriptor } from '@shared/types';
import { MODE_DESCRIPTORS } from '@shared/types';

interface ModeSwitcherProps {
  current: Mode;
  /** Describe what a pending switch would newly permit, or null if none. */
  onRequestMode: (next: Mode) => void;
  /** Disables interaction while a request is in flight. */
  disabled?: boolean;
  /** Rendered as a popover under the bar rather than inline. */
  variant?: 'popover' | 'inline';
  onDismiss?: () => void;
}

/**
 * Guide / Hybrid / Agent picker.
 *
 * Renders every mode from MODE_DESCRIPTORS (never a hard-coded list) with its
 * summary, so the consequence of each choice is visible *before* selecting it.
 * Modes that allow state changes are marked with a warning affordance; the
 * actual consent gate lives in the parent (App) so it can also be reached from
 * the keyboard and from a settings change.
 */
export function ModeSwitcher({
  current,
  onRequestMode,
  disabled = false,
  variant = 'popover',
  onDismiss,
}: ModeSwitcherProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click / Escape for the popover presentation.
  useEffect(() => {
    if (variant !== 'popover' || !onDismiss) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [variant, onDismiss]);

  const isPopover = variant === 'popover';

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Cyps operating mode"
      className={[
        isPopover
          ? 'glass-raised animate-slide-down absolute left-0 top-[calc(100%+8px)] z-40 w-[288px] rounded-2xl p-2'
          : 'w-full rounded-2xl border border-[var(--color-glass-border)] bg-white/4 p-2',
      ].join(' ')}
    >
      {isPopover ? (
        <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-dim)]">
          How much may Cyps do?
        </p>
      ) : null}

      <ul className="flex flex-col gap-1">
        {MODE_DESCRIPTORS.map((descriptor) => (
          <li key={descriptor.id}>
            <ModeRow
              descriptor={descriptor}
              selected={descriptor.id === current}
              disabled={disabled}
              onSelect={() => onRequestMode(descriptor.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModeRow({
  descriptor,
  selected,
  disabled,
  onSelect,
}: {
  descriptor: ModeDescriptor;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={[
        'no-drag group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left',
        'transition-colors duration-[var(--cyps-duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'bg-sky-500/18 ring-1 ring-inset ring-sky-400/40'
          : 'hover:bg-white/8',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-sky-300 bg-sky-400/25' : 'border-[var(--color-ink-dim)]',
        ].join(' ')}
      >
        {selected ? <Check size={11} strokeWidth={3} className="text-sky-100" /> : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">
            {descriptor.label}
          </span>
          {descriptor.allowsStateChange ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-200"
              title="This mode can change things on your computer"
            >
              <AlertTriangle size={9} strokeWidth={2.6} aria-hidden="true" />
              Can act
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-ink-dim)]">
          {descriptor.summary}
        </span>
      </span>
    </button>
  );
}
