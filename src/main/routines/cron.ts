/**
 * Pure, zero-dependency, IANA-timezone-aware 5-field cron parser and evaluator.
 *
 * Format: `minute hour day-of-month month day-of-week`
 *   - minute:       0–59
 *   - hour:         0–23
 *   - day-of-month: 1–31
 *   - month:        1–12
 *   - day-of-week:  0–6 (0 = Sunday, 7 also accepted as Sunday)
 *
 * Supports `*`, single values, comma lists (`1,15`), ranges (`1-5`), and steps
 * (`*\/15`, `1-10/2`), plus standard macros (`@hourly`, `@daily`, `@weekly`, `@monthly`).
 *
 * Uses `Intl.DateTimeFormat` with explicit IANA time zones so Windows hosts
 * evaluate daylight-saving transitions accurately without relying on local OS TZ.
 */

export interface ParsedCron {
  expression: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domWildcard: boolean;
  dowWildcard: boolean;
}

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function validateTimezone(timezone: string): void {
  if (typeof timezone !== 'string' || timezone.trim().length === 0 || timezone.length > 100) {
    throw new Error('Timezone must be a valid IANA time zone.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error(`Invalid IANA time zone: "${timezone}".`);
  }
}

export function parseCronExpression(raw: string): ParsedCron {
  if (typeof raw !== 'string') {
    throw new Error('Cron expression must be a string.');
  }
  const trimmed = raw.trim();
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  const fields = expanded.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have exactly 5 fields (minute hour dom month dow): "${raw}".`);
  }

  const [minField, hourField, domField, monthField, dowField] = fields as [string, string, string, string, string];
  const minutes = parseField(minField, 0, 59, 'minute');
  const hours = parseField(hourField, 0, 23, 'hour');
  const daysOfMonth = parseField(domField, 1, 31, 'day-of-month');
  const months = parseField(monthField, 1, 12, 'month');
  const rawDow = parseField(dowField, 0, 7, 'day-of-week');
  const daysOfWeek = new Set<number>([...rawDow].map((value) => (value === 7 ? 0 : value)));

  return {
    expression: expanded,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domWildcard: domField === '*',
    dowWildcard: dowField === '*',
  };
}

function parseField(field: string, min: number, max: number, label: string): Set<number> {
  if (!field || field.length > 64) {
    throw new Error(`Invalid cron ${label} field: "${field}".`);
  }
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (!part) throw new Error(`Empty segment in cron ${label} field: "${field}".`);
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) {
      throw new Error(`Invalid step syntax in cron ${label} field: "${part}".`);
    }
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) throw new Error(`Invalid step value in cron ${label} field: "${part}".`);
      step = Number.parseInt(stepPart, 10);
      if (step <= 0) throw new Error(`Cron ${label} step must be positive: "${part}".`);
    }

    let start = min;
    let end = max;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [lowStr, highStr, rangeExtra] = rangePart.split('-');
      if (rangeExtra !== undefined || !/^\d+$/.test(lowStr ?? '') || !/^\d+$/.test(highStr ?? '')) {
        throw new Error(`Invalid range in cron ${label} field: "${part}".`);
      }
      start = Number.parseInt(lowStr, 10);
      end = Number.parseInt(highStr, 10);
      if (start < min || end > max || start > end) {
        throw new Error(`Cron ${label} range out of bounds (${min}-${max}): "${part}".`);
      }
    } else {
      if (!/^\d+$/.test(rangePart)) {
        throw new Error(`Invalid value in cron ${label} field: "${part}".`);
      }
      const single = Number.parseInt(rangePart, 10);
      if (single < min || single > max) {
        throw new Error(`Cron ${label} value out of bounds (${min}-${max}): "${part}".`);
      }
      start = single;
      end = stepPart !== undefined ? max : single;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  if (values.size === 0) {
    throw new Error(`Cron ${label} field matched no values: "${field}".`);
  }
  return values;
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
  localKey: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    validateTimezone(timezone);
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

export function getZonedParts(timestampMs: number, timezone: string): ZonedDateParts {
  const parts = getFormatter(timezone).formatToParts(new Date(timestampMs));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = Number.parseInt(get('year'), 10);
  const month = Number.parseInt(get('month'), 10);
  const day = Number.parseInt(get('day'), 10);
  // Some Intl locales emit hour "24" for midnight; normalize to 0.
  const rawHour = Number.parseInt(get('hour'), 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number.parseInt(get('minute'), 10);
  const dayOfWeek = WEEKDAY_MAP[get('weekday')] ?? 0;
  const pad = (n: number): string => String(n).padStart(2, '0');
  const localKey = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}@${timezone}`;
  return { year, month, day, hour, minute, dayOfWeek, localKey };
}

export function matchesCron(parsed: ParsedCron, parts: ZonedDateParts): boolean {
  if (!parsed.months.has(parts.month)) return false;
  if (!parsed.hours.has(parts.hour)) return false;
  if (!parsed.minutes.has(parts.minute)) return false;

  const domMatch = parsed.daysOfMonth.has(parts.day);
  const dowMatch = parsed.daysOfWeek.has(parts.dayOfWeek);
  if (parsed.domWildcard && parsed.dowWildcard) return true;
  if (parsed.domWildcard) return dowMatch;
  if (parsed.dowWildcard) return domMatch;
  // Standard Vixie cron semantics: when both DOM and DOW are restricted, either matches.
  return domMatch || dowMatch;
}

/**
 * Finds the next UTC timestamp strictly after `afterMs` matching the cron
 * expression in the given IANA timezone. Searches up to `maxLookaheadDays`
 * (default 366 days, handles leap years and DST transitions cleanly).
 */
export function nextCronOccurrence(
  expression: string,
  timezone: string,
  afterMs: number,
  maxLookaheadDays = 366,
): number | null {
  const parsed = parseCronExpression(expression);
  validateTimezone(timezone);

  // Start at the next whole minute strictly after `afterMs`.
  let cursor = Math.floor(afterMs / 60_000) * 60_000 + 60_000;
  const limit = cursor + maxLookaheadDays * 24 * 60 * 60_000;

  while (cursor <= limit) {
    const parts = getZonedParts(cursor, timezone);
    if (!parsed.months.has(parts.month)) {
      // Jump ahead by ~1 day (23h to stay safe across DST transitions) when month mismatches.
      cursor += 23 * 60 * 60_000;
      continue;
    }
    const dayMatches = (parsed.domWildcard && parsed.dowWildcard)
      || (parsed.domWildcard && parsed.daysOfWeek.has(parts.dayOfWeek))
      || (parsed.dowWildcard && parsed.daysOfMonth.has(parts.day))
      || (!parsed.domWildcard && !parsed.dowWildcard && (parsed.daysOfMonth.has(parts.day) || parsed.daysOfWeek.has(parts.dayOfWeek)));

    if (!dayMatches) {
      // Advance to near next day safely (keep minute precision if within 2 hours of midnight).
      const remainingMinutesInDay = (23 - parts.hour) * 60 + (60 - parts.minute);
      const jumpMinutes = Math.max(1, Math.min(remainingMinutesInDay, 60));
      cursor += jumpMinutes * 60_000;
      continue;
    }

    if (!parsed.hours.has(parts.hour)) {
      const jumpMinutes = Math.max(1, 60 - parts.minute);
      cursor += jumpMinutes * 60_000;
      continue;
    }

    if (matchesCron(parsed, parts)) {
      return cursor;
    }

    cursor += 60_000;
  }

  return null;
}

/**
 * Lists all cron occurrences in the half-open interval `(fromMs, toMs]`,
 * capped at `maxOccurrences` to prevent unbounded catch-up loops after long
 * offline periods. Deduplicates by `localKey` so fall-back DST repeated hours
 * never fire the same local wall-clock occurrence twice.
 */
export function listCronOccurrencesBetween(
  expression: string,
  timezone: string,
  fromMs: number,
  toMs: number,
  maxOccurrences = 10,
): Array<{ at: number; scheduledKey: string }> {
  if (toMs <= fromMs || maxOccurrences <= 0) return [];
  const results: Array<{ at: number; scheduledKey: string }> = [];
  const seenKeys = new Set<string>();
  let cursor = fromMs;

  while (results.length < maxOccurrences) {
    const next = nextCronOccurrence(expression, timezone, cursor);
    if (next === null || next > toMs) break;
    const parts = getZonedParts(next, timezone);
    if (!seenKeys.has(parts.localKey)) {
      seenKeys.add(parts.localKey);
      results.push({ at: next, scheduledKey: parts.localKey });
    }
    cursor = next;
  }
  return results;
}
