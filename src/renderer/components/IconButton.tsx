import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Tone = 'ghost' | 'subtle' | 'primary' | 'danger' | 'success';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons are invisible to screen readers otherwise. */
  label: string;
  children: ReactNode;
  tone?: Tone;
  /** Shows a small dot when the control has something to reveal. */
  dot?: boolean;
  active?: boolean;
}

const TONE_CLASSES: Record<Tone, string> = {
  ghost:
    'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-white/10 border-transparent',
  subtle:
    'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] bg-white/6 hover:bg-white/12 border-[var(--color-glass-border)]',
  primary: 'text-sky-100 bg-sky-500/22 hover:bg-sky-500/32 border-sky-400/35',
  danger: 'text-rose-100 bg-rose-500/22 hover:bg-rose-500/32 border-rose-400/40',
  success: 'text-emerald-100 bg-emerald-500/22 hover:bg-emerald-500/32 border-emerald-400/40',
};

/**
 * Square icon button. Always labelled for assistive tech, always focusable,
 * and always showing a focus ring via the global :focus-visible rule.
 */
export function IconButton(props: IconButtonProps) {
  const {
    label,
    children,
    tone = 'ghost',
    dot = false,
    active = false,
    className = '',
    type = 'button',
    ...rest
  } = props;

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active ? true : undefined}
      className={[
        'no-drag relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        'border transition-colors duration-[var(--cyps-duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        TONE_CLASSES[tone],
        active ? 'ring-1 ring-sky-300/50' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
      {dot ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-300 ring-2 ring-[var(--color-glass)]"
        />
      ) : null}
    </button>
  );
}
