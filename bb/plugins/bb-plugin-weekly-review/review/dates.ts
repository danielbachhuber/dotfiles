import type { Day, Instant } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Formats a Date as a local-time `YYYY-MM-DD`. */
export function toDay(date: Date): Day {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parses a `YYYY-MM-DD` as local midnight, avoiding the UTC shift `new Date(str)` applies. */
export function fromDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Maps an upstream instant onto the local calendar day it happened on. GitHub
 * returns UTC, so a 7pm-Pacific event would land on the wrong day without this.
 */
export function instantToDay(instant: Instant): Day {
  return toDay(new Date(instant));
}

/**
 * The zero value GitHub returns for a PR that was never closed. Callers should
 * normalize it to null rather than treating it as a year-1 timestamp.
 */
export function normalizeClosedAt(value: string | null | undefined): Instant | null {
  if (!value) return null;
  if (value.startsWith('0001-01-01')) return null;
  return value;
}

export interface Range {
  from: Day;
  to: Day;
}

/**
 * Resolves the week to report on, matching the weekly-review convention: Monday
 * of the current week through today, except on a weekend, when the most recent
 * full Monday–Friday is more useful than a two-day stub.
 */
export function resolveRange(from?: string, to?: string, today: Date = new Date()): Range {
  if (from && to) return { from, to };
  if (from && !to) return { from, to: toDay(today) };

  const dow = today.getDay(); // 0 Sun … 6 Sat
  const isWeekend = dow === 0 || dow === 6;

  if (isWeekend) {
    // Back up to the Friday just past, then to that week's Monday.
    const daysSinceFriday = dow === 6 ? 1 : 2;
    const friday = new Date(today.getTime() - daysSinceFriday * MS_PER_DAY);
    const monday = new Date(friday.getTime() - 4 * MS_PER_DAY);
    return { from: toDay(monday), to: toDay(friday) };
  }

  const monday = new Date(today.getTime() - (dow - 1) * MS_PER_DAY);
  return { from: toDay(monday), to: toDay(today) };
}

/** Every calendar day in the range, inclusive. */
export function daysInRange({ from, to }: Range): Day[] {
  const out: Day[] = [];
  const end = fromDay(to);
  for (let cur = fromDay(from); cur <= end; cur = new Date(cur.getTime() + MS_PER_DAY)) {
    out.push(toDay(cur));
  }
  return out;
}

export function isWithin(day: Day, range: Range): boolean {
  return day >= range.from && day <= range.to;
}

/** Whole days between two calendar days. */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((fromDay(b).getTime() - fromDay(a).getTime()) / MS_PER_DAY);
}

export function formatDayLong(day: Day): string {
  return fromDay(day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDayShort(day: Day): string {
  return fromDay(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
