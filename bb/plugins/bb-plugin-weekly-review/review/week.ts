import type {
  Day, HarvestEntry, Issue, PullRequest, Review, ReflectNote, SlackThread, Task, WeekData,
} from './types.js';
import { daysInRange, fromDay, instantToDay, isWithin, toDay, type Range } from './dates.js';

/** What happened to an authored PR on a particular day. */
export interface PrEvent {
  /** The state to lead with. */
  kind: 'opened' | 'merged' | 'closed';
  /** True when the PR was also opened on this same day, so one row can say both. */
  openedSameDay: boolean;
  pr: PullRequest;
}

export interface DaySlice {
  day: Day;
  harvest: HarvestEntry[];
  hours: number;
  prEvents: PrEvent[];
  reviews: Review[];
  issuesCreated: Issue[];
  reflect: ReflectNote[];
  slack: SlackThread[];
  /** True when nothing at all landed on this day. */
  empty: boolean;
}

/**
 * Distributes the week's dated activity across its days.
 *
 * A single PR can produce two events in one week — opened Monday, merged Thursday
 * — and both are worth seeing. Events whose day falls outside the range are
 * dropped, which is what keeps a PR merged this week but opened last week from
 * inventing a day.
 */
export function buildDaySlices(week: WeekData): DaySlice[] {
  const range: Range = { from: week.from, to: week.to };
  const gh = week.github.data;

  const byDay = new Map<Day, DaySlice>();
  for (const day of daysInRange(range)) {
    byDay.set(day, {
      day, harvest: [], hours: 0, prEvents: [], reviews: [],
      issuesCreated: [], reflect: [], slack: [], empty: true,
    });
  }

  const slice = (day: Day): DaySlice | undefined => byDay.get(day);

  for (const entry of week.harvest.data) {
    const s = slice(entry.day);
    if (!s) continue;
    s.harvest.push(entry);
    s.hours = Math.round((s.hours + entry.hours) * 100) / 100;
  }

  for (const pr of gh.authored) {
    const opened = instantToDay(pr.createdAt);
    const closed = pr.closedAt ? instantToDay(pr.closedAt) : null;
    const openedHere = isWithin(opened, range);
    const closedHere = closed !== null && isWithin(closed, range);

    // Opened and resolved on the same day is one row, not two — the duplicate
    // otherwise reads as two separate pieces of work.
    if (closedHere && closed === opened) {
      slice(closed)?.prEvents.push({
        kind: pr.state === 'merged' ? 'merged' : 'closed',
        openedSameDay: true,
        pr,
      });
      continue;
    }

    if (openedHere) slice(opened)?.prEvents.push({ kind: 'opened', openedSameDay: false, pr });
    if (closedHere) {
      slice(closed!)?.prEvents.push({
        kind: pr.state === 'merged' ? 'merged' : 'closed',
        openedSameDay: false,
        pr,
      });
    }
  }

  // `updatedAt` is the closest thing the search API gives us to "when reviewed".
  for (const review of gh.reviewed) {
    slice(instantToDay(review.updatedAt))?.reviews.push(review);
  }

  for (const issue of gh.issuesCreated) {
    slice(instantToDay(issue.createdAt))?.issuesCreated.push(issue);
  }

  for (const note of week.reflect?.data ?? []) slice(note.day)?.reflect.push(note);
  for (const thread of week.slack?.data ?? []) slice(thread.day)?.slack.push(thread);

  const slices = [...byDay.values()];
  for (const s of slices) {
    s.prEvents.sort((a, b) => rank(a.kind) - rank(b.kind) || b.pr.number - a.pr.number);
    s.empty = s.harvest.length === 0 && s.prEvents.length === 0 && s.reviews.length === 0
      && s.issuesCreated.length === 0 && s.reflect.length === 0 && s.slack.length === 0;
  }
  return slices;
}

function rank(kind: PrEvent['kind']): number {
  return kind === 'merged' ? 0 : kind === 'opened' ? 1 : 2;
}

export interface WeekTotals {
  hours: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  issuesCreated: number;
  tasksCompleted: number;
}

export function weekTotals(week: WeekData, slices: DaySlice[]): WeekTotals {
  const events = slices.flatMap((s) => s.prEvents);
  return {
    hours: Math.round(slices.reduce((sum, s) => sum + s.hours, 0) * 100) / 100,
    prsOpened: events.filter((e) => e.kind === 'opened').length,
    prsMerged: events.filter((e) => e.kind === 'merged').length,
    reviews: week.github.data.reviewed.length,
    issuesCreated: week.github.data.issuesCreated.length,
    tasksCompleted: week.todoist.data.completed.length,
  };
}

/** Assigned issues untouched for this many days get flagged in the standing panel. */
export const STALE_DAYS = 30;

export function isStale(issue: Issue, today: Day): boolean {
  const touched = issue.updatedAt ?? issue.createdAt;
  if (!touched) return false;
  const days = (new Date(`${today}T23:59:59`).getTime() - new Date(touched).getTime()) / 86_400_000;
  return days > STALE_DAYS;
}

/** Sums hours per task category, largest first. */
export function hoursByCategory(entries: HarvestEntry[]): Array<{ task: string; hours: number }> {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.task, (totals.get(e.task) ?? 0) + e.hours);
  return [...totals.entries()]
    .map(([task, hours]) => ({ task, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task));
}

export interface Backlog {
  overdue: Task[];
  upcoming: Task[];
  someday: Task[];
}

/**
 * Splits the incomplete list for the standing panel. Recurring tasks are
 * excluded from "overdue" — a daily habit one day late isn't a slipping
 * commitment.
 */
export function splitBacklog(tasks: Task[], today: Day, horizonDays = 14): Backlog {
  const horizon = toDay(new Date(fromDay(today).getTime() + horizonDays * 86_400_000));

  const overdue: Task[] = [];
  const upcoming: Task[] = [];
  const someday: Task[] = [];

  for (const t of tasks) {
    if (!t.due) someday.push(t);
    else if (t.due < today && !t.recurring) overdue.push(t);
    else if (t.due <= horizon) upcoming.push(t);
  }

  const byDue = (a: Task, b: Task) => (a.due ?? "").localeCompare(b.due ?? "");
  return { overdue: overdue.sort(byDue), upcoming: upcoming.sort(byDue), someday };
}
