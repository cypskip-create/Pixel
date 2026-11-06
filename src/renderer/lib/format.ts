import type { RiskLevel } from '@shared/types';

/** Stable-enough id for renderer-local records (drafts, notices). */
export function localId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

const RISK_LABEL: Record<RiskLevel, string> = {
  safe: 'Safe',
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

export function riskLabel(risk: RiskLevel): string {
  return RISK_LABEL[risk];
}

/** Tailwind classes per risk level, paired with a distinct icon in the UI. */
export const RISK_CLASSES: Record<RiskLevel, string> = {
  safe: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  low: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  medium: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  high: 'border-rose-400/45 bg-rose-400/10 text-rose-200',
};

/** Truncate for compact chips without breaking surrogate pairs. */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** Render arbitrary unknown values from tool args as a compact string. */
export function stringifyValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable]';
  }
}
