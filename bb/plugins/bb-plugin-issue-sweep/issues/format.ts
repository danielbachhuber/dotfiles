const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Compact relative age, for a column read by scanning rather than by reading.
 * Every unit rounds down, so a row never claims to be older than it is.
 */
export function relativeTime(at: number, now: number): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)}w ago`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo ago`;
  return `${Math.floor(elapsed / YEAR)}y ago`;
}

/**
 * "8/14 sub-issues", the completion state of an issue's own checklist. Shown
 * even at 0 done: what the row is really reporting is that the issue has parts
 * to it, which is worth knowing before opening it.
 */
export function subtasksLabel(
  subtasks: { completed: number; total: number; source: "sub-issues" | "tasks" } | null | undefined,
): string | null {
  if (!subtasks || subtasks.total <= 0) return null;
  return `${subtasks.completed}/${subtasks.total} ${subtasks.source}`;
}

export function commentsLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 comment" : `${count} comments`;
}
