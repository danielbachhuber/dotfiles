/**
 * The week's time, grouped the way it was logged.
 *
 * "Where the time went" was a table of six numbers, which says how the week
 * was distributed and nothing about what any of it was. These are the same
 * six numbers with their entries underneath: every meeting and how long it
 * ran, every stretch of development and what it was against.
 */
import type { Day, HarvestEntry, WeekData } from "./types.js";
import { referenceIn } from "./overview.js";

export interface TimeEntry {
  day: Day;
  hours: number;
  /** The entry's own note, with any leading `#1234:` stripped off. */
  label: string;
  /** The issue or pull request the note named, when it named one. */
  reference: number | null;
  /** The Harvest category it was booked to: what kind of time this was. */
  task: string;
}

export interface TimeSection {
  task: string;
  hours: number;
  /** Share of the week's logged time, 0–1. */
  share: number;
  entries: TimeEntry[];
}

/**
 * One section per category, most hours first, entries within a section in the
 * order they happened. Deliberately not grouped by note: two conversations
 * with the same person on two days were two conversations, and a row that
 * merges them loses the thing a weekly review is looking for.
 */
export function timeSections(week: WeekData): TimeSection[] {
  const byTask = new Map<string, HarvestEntry[]>();
  for (const entry of week.harvest.data) {
    const existing = byTask.get(entry.task);
    if (existing === undefined) byTask.set(entry.task, [entry]);
    else existing.push(entry);
  }

  const total = week.harvest.data.reduce((sum, entry) => sum + entry.hours, 0);

  return [...byTask.entries()]
    .map(([task, entries]) => {
      const hours = entries.reduce((sum, entry) => sum + entry.hours, 0);
      return {
        task,
        hours: round(hours),
        share: total === 0 ? 0 : hours / total,
        entries: entries
          .slice()
          .sort((a, b) => a.day.localeCompare(b.day) || b.hours - a.hours)
          .map(toTimeEntry),
      };
    })
    .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task));
}

function toTimeEntry(entry: HarvestEntry): TimeEntry {
  const reference = referenceIn(entry.notes);
  return {
    day: entry.day,
    hours: round(entry.hours),
    label: entry.notes.replace(/^#\d+\s*:?\s*/, "").trim(),
    reference,
    task: entry.task,
  };
}

function round(hours: number): number {
  return Math.round(hours * 100) / 100;
}
