/**
 * The deterministic half of the overview: where the week's hours went, and
 * which of them landed on something with a number.
 *
 * Time entries carry a leading `#5837: …` reference often enough to be worth
 * joining on — about a third of logged hours in practice. That third is the
 * only place the record says how long a specific piece of work actually took;
 * the rest is meetings, planning, and admin, which is a finding rather than a
 * gap. Both numbers are reported, so the page never implies the third is the
 * whole week.
 */
import type { Day, HarvestEntry, WeekData } from "./types.js";

/** A `#1234` at the start of a time entry's notes. */
const LEADING_REF = /^#(\d+)\b/;

export function referenceIn(notes: string): number | null {
  const match = LEADING_REF.exec(notes.trim());
  return match === null ? null : Number(match[1]);
}

export interface CategoryHours {
  task: string;
  hours: number;
  /** Share of the week's logged time, 0–1. */
  share: number;
}

export function categories(entries: HarvestEntry[]): CategoryHours[] {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.task, (totals.get(entry.task) ?? 0) + entry.hours);
  const total = [...totals.values()].reduce((sum, hours) => sum + hours, 0);
  return [...totals.entries()]
    .map(([task, hours]) => ({
      task,
      hours: round(hours),
      share: total === 0 ? 0 : hours / total,
    }))
    .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task));
}

/** What a referenced number turned out to be, once matched against the week. */
export type RefKind =
  | "authored"
  | "reviewed"
  | "issue-filed"
  | "issue-assigned"
  | "unknown";

export interface WorkItem {
  number: number;
  kind: RefKind;
  title: string;
  url: string;
  hours: number;
  /** Which time categories the hours came from, largest first. */
  tasks: string[];
  days: Day[];
}

export interface TimeAttribution {
  /** Every referenced item, most hours first. */
  items: WorkItem[];
  /** Hours whose notes named an item. */
  attributed: number;
  /** Hours logged against a category only — meetings, planning, admin. */
  unattributed: number;
  total: number;
}

/**
 * Joins the week's time entries onto the pull requests and issues the week
 * already knows about. An entry naming something outside the week — an issue
 * filed months ago, a PR in another repository — is kept as `unknown` rather
 * than dropped: the hours were spent either way, and a missing title is less
 * misleading than a missing row.
 */
export function attributeTime(week: WeekData): TimeAttribution {
  const github = week.github.data;
  const lookup = new Map<number, { kind: RefKind; title: string; url: string }>();
  const index = (
    items: Array<{ number: number; title: string; url: string }>,
    kind: RefKind,
  ) => {
    for (const item of items) if (!lookup.has(item.number)) lookup.set(item.number, { ...item, kind });
  };
  // Ordered by how specifically each says "this was my work this week".
  index(github.authored, "authored");
  index(github.issuesCreated, "issue-filed");
  index(github.issuesAssigned, "issue-assigned");
  index(github.reviewed, "reviewed");

  const byNumber = new Map<number, WorkItem & { taskHours: Map<string, number> }>();
  let attributed = 0;
  let total = 0;

  for (const entry of week.harvest.data) {
    total += entry.hours;
    const number = referenceIn(entry.notes);
    if (number === null) continue;
    attributed += entry.hours;

    let item = byNumber.get(number);
    if (item === undefined) {
      const known = lookup.get(number);
      item = {
        number,
        kind: known?.kind ?? "unknown",
        title: known?.title ?? titleFromNotes(entry.notes) ?? `#${number}`,
        url: known?.url ?? "",
        hours: 0,
        tasks: [],
        days: [],
        taskHours: new Map(),
      };
      byNumber.set(number, item);
    }
    item.hours += entry.hours;
    item.taskHours.set(entry.task, (item.taskHours.get(entry.task) ?? 0) + entry.hours);
    if (!item.days.includes(entry.day)) item.days.push(entry.day);
  }

  const items = [...byNumber.values()]
    .map(({ taskHours, ...item }) => ({
      ...item,
      hours: round(item.hours),
      days: item.days.sort(),
      tasks: [...taskHours.entries()].sort((a, b) => b[1] - a[1]).map(([task]) => task),
    }))
    .sort((a, b) => b.hours - a.hours || a.number - b.number);

  return {
    items,
    attributed: round(attributed),
    unattributed: round(total - attributed),
    total: round(total),
  };
}

/**
 * `#5837: Move the silo-singleton feature toggles…` — the note usually repeats
 * the title, which is what rescues a reference to something outside the week.
 */
function titleFromNotes(notes: string): string | null {
  const rest = notes.trim().replace(LEADING_REF, "").replace(/^[:\s-]+/, "").trim();
  return rest === "" ? null : rest;
}

function round(hours: number): number {
  return Math.round(hours * 100) / 100;
}

export interface InFlight {
  openPullRequests: Array<{ number: number; title: string; url: string; isDraft: boolean }>;
  /** Assigned issues untouched longest, oldest first. */
  stalest: Array<{ number: number; title: string; url: string; touched: string }>;
}

/** What the week leaves open, which is the part that decides the next one. */
export function inFlight(week: WeekData, limit = 8): InFlight {
  const github = week.github.data;
  return {
    openPullRequests: github.authored
      .filter((pr) => pr.state === "open")
      .map(({ number, title, url, isDraft }) => ({ number, title, url, isDraft })),
    stalest: [...github.issuesAssigned]
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        url: issue.url,
        touched: issue.updatedAt ?? issue.createdAt,
      }))
      .sort((a, b) => a.touched.localeCompare(b.touched))
      .slice(0, limit),
  };
}
