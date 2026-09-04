const MINUTES_PER_HOUR = 60;
const MS_PER_HOUR = 3_600_000;

/**
 * Render decimal hours the way Harvest does, as `H:MM`.
 *
 * Harvest reports durations as repeating decimals (25 minutes is
 * 0.4166666667), so minutes are rounded rather than truncated. Truncating
 * loses a minute on almost every value the API returns.
 */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0:00";

  const totalMinutes = Math.round(hours * MINUTES_PER_HOUR);
  const wholeHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  return `${wholeHours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Render how long an entry has accumulated.
 *
 * A running timer is measured from its start, because Harvest only advances
 * `hours` when the entry is written. A stopped entry has no start to measure
 * from, so its recorded hours are the answer.
 */
export function elapsedLabel(
  entry: { hours: number; timerStartedAt: string | null },
  nowMs: number,
): string {
  if (entry.timerStartedAt === null) return formatHours(entry.hours);

  const startedMs = Date.parse(entry.timerStartedAt);
  if (Number.isNaN(startedMs)) return formatHours(entry.hours);

  return formatHours((nowMs - startedMs) / MS_PER_HOUR);
}
