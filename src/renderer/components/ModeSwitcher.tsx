import { useEffect, useRef, type RefObject } from 'react';
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
  /** Anchors the popover to a compact Workspace header trigger. */
  placement?: 'default' | 'anchored';
  onDismiss?: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
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
  placement = 'default',
  onDismiss,
  returnFocusRef,
}: ModeSwitcherProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isPopover = variant === 'popover';

  // Dismiss on outside click / Escape for the popover presentation.
  useEffect(() => {
    if (variant !== 'popover' || !onDismiss) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        window.requestAnimationFrame(() => returnFocusRef?.current?.focus());
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [variant, onDismiss, returnFocusRef]);

  useEffect(() => {
    if (variant !== 'popover') return;
    window.requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  }, [variant]);

  const focusNextItem = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={ref}
      id={isPopover ? 'pixel-mode-menu' : undefined}
      role={isPopover ? 'menu' : 'radiogroup'}
      aria-label="Pixel operating mode"
      onKeyDown={isPopover ? focusNextItem : undefined}
      data-layout-panel
      className={[
        isPopover
          ? placement === 'anchored'
            ? 'workspace-mode-popover w-[min(292px,calc(100vw-24px))] rounded-xl p-1.5'
            : 'pixel-surface-raised animate-slide-down ml-11 mt-2 w-[288px] rounded-2xl p-2'
          : 'w-full rounded-2xl border border-[var(--color-border)] bg-white/4 p-2',
      ].join(' ')}
    >
      {isPopover ? (
        <p role="none" className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-dim)]">
          How much may Pixel do?
        </p>
      ) : null}

      <div role="group" className="flex flex-col gap-1">
        {MODE_DESCRIPTORS.map((descriptor) => (
          <ModeRow
            key={descriptor.id}
            descriptor={descriptor}
            selected={descriptor.id === current}
            disabled={disabled}
            menuItem={isPopover}
            onSelect={() => {
              onRequestMode(descriptor.id);
              window.requestAnimationFrame(() => returnFocusRef?.current?.focus());
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ModeRow({
  descriptor,
  selected,
  disabled,
  menuItem,
  onSelect,
}: {
  descriptor: ModeDescriptor;
  selected: boolean;
  disabled: boolean;
  menuItem: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={menuItem ? 'menuitemradio' : 'radio'}
      aria-checked={selected}
      tabIndex={menuItem ? (selected ? 0 : -1) : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={[
        'no-drag group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left',
        'transition-colors duration-[var(--cyps-duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'bg-neutral-500/18 ring-1 ring-inset ring-neutral-400/40'
          : 'hover:bg-white/8',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-neutral-300 bg-neutral-400/25' : 'border-[var(--color-ink-dim)]',
        ].join(' ')}
      >
        {selected ? <Check size={11} strokeWidth={3} className="text-neutral-100" /> : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">
            {descriptor.label}
          </span>
          {descriptor.allowsStateChange ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-neutral-400/35 bg-neutral-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-neutral-200"
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
