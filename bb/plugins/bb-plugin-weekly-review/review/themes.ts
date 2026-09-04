/**
 * The week grouped by what the work was about, without asking a model.
 *
 * Harvest categories are how time is booked, not what it was for: an hour of
 * "Meetings" and an hour of "Planning" can be the same piece of work, and the
 * category view files them apart. The notes already carry the theme — "Open
 * Source Roadmap w/ Marius", "1:1 w/ Rob", "Phase 3 review" — so the grouping
 * can be read straight out of them.
 *
 * Three rules, applied in order, then a merge pass:
 *
 *   1. An entry naming an issue or pull request takes that item's title as its
 *      theme, except in Code Review, where reviewing other people's work is
 *      one coherent thread rather than twenty.
 *   2. An entry of the form `<something> w/ <person>` takes `<something>`,
 *      unless that is a generic word for a meeting — `1:1`, `Chat`, `Coffee
 *      chat` — in which case it is a one-on-one.
 *   3. Anything else is its own name. An entry with no note at all falls back
 *      to its category, which is the only thing known about it.
 *
 * Then themes sharing a run of significant words are merged, which is what
 * puts "Architecture Talk", "Architecture Talk Prep" and "Prep Architecture
 * Talk" together, and what collects two issues from the same migration under
 * one heading.
 */
import type { Day, WeekData } from "./types.js";
import type { TimeEntry } from "./time-sections.js";
import { referenceIn } from "./overview.js";

export interface ThemeDay {
  day: Day;
  hours: number;
  entries: TimeEntry[];
}

export interface Theme {
  title: string;
  hours: number;
  /** Days the work happened on, in order, with what happened on each. */
  days: ThemeDay[];
  /** Categories the hours were booked to, largest first. */
  tasks: Array<{ task: string; hours: number }>;
  entryCount: number;
  refs: number[];
}

export interface ThemeGrouping {
  themes: Theme[];
  /** The tail: single short entries that never became a thread of work. */
  everythingElse: Theme | null;
  total: number;
}

/** Words that describe the shape of a meeting rather than its subject. */
const GENERIC_MEETING = new Set([
  "1:1", "1-1", "one-on-one", "one on one", "chat", "coffee chat", "intro chat",
  "tech lead chat", "check-in", "checkin", "catch-up", "catchup", "call",
  "coaching call", "sync", "debrief", "meeting", "convo", "conversation",
]);

const ONE_ON_ONES = "One-on-ones";

const STOP = new Set([
  "the", "a", "an", "of", "to", "for", "and", "or", "on", "in", "out", "off",
  "with", "from", "into", "its", "it", "this", "that", "last", "onto", "why",
  "which", "up", "at", "by", "as", "is", "are", "be",
]);

/**
 * A theme below both of these never became a thread of work, and belongs in
 * the tail rather than in a heading of its own.
 */
const MIN_HOURS = 0.5;
const MIN_ENTRIES = 2;

export function buildThemes(week: WeekData): ThemeGrouping {
  const titles = titlesByNumber(week);

  const buckets = new Map<string, { title: string; entries: TimeEntry[]; hours: number }>();
  const add = (title: string, entry: TimeEntry) => {
    const existing = buckets.get(title);
    if (existing === undefined) buckets.set(title, { title, entries: [entry], hours: entry.hours });
    else {
      existing.entries.push(entry);
      existing.hours += entry.hours;
    }
  };

  for (const raw of week.harvest.data) {
    const reference = referenceIn(raw.notes);
    const label = raw.notes.replace(/^#\d+\s*:?\s*/, "").trim();
    const entry: TimeEntry = { day: raw.day, hours: raw.hours, label, reference, task: raw.task };
    add(themeFor(entry, titles), entry);
  }

  const merged = mergeRelated([...buckets.values()]);

  const themes: Theme[] = [];
  const tail: TimeEntry[] = [];
  for (const bucket of merged) {
    if (bucket.hours >= MIN_HOURS || bucket.entries.length >= MIN_ENTRIES) {
      themes.push(toTheme(bucket.title, bucket.entries));
    } else {
      tail.push(...bucket.entries);
    }
  }
  themes.sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title));

  return {
    themes,
    everythingElse: tail.length === 0 ? null : toTheme("Everything else", tail),
    total: round(week.harvest.data.reduce((sum, entry) => sum + entry.hours, 0)),
  };
}

function themeFor(entry: TimeEntry, titles: Map<number, string>): string {
  if (entry.reference !== null) {
    // Reviewing other people's work is one thread, not one per pull request.
    if (/review/i.test(entry.task)) return "Code review";
    return titles.get(entry.reference) ?? entry.label ?? `#${entry.reference}`;
  }
  if (entry.label === "") return entry.task;

  const withPerson = /^(.*?)\s+w\/\s+\S/.exec(entry.label);
  if (withPerson !== null) {
    const stem = withPerson[1].trim();
    return GENERIC_MEETING.has(stem.toLowerCase()) ? ONE_ON_ONES : stem;
  }
  return entry.label;
}

/**
 * Merges themes that share a run of significant words.
 *
 * Two words is enough when one of the names is only two words long —
 * "Architecture Talk" and "Prep Architecture Talk" are the same thing — and
 * three otherwise, which is what keeps two unrelated issues that both say
 * "the client" apart.
 */
function mergeRelated<T extends { title: string; entries: TimeEntry[]; hours: number }>(
  buckets: T[],
): Array<{ title: string; entries: TimeEntry[]; hours: number }> {
  const words = buckets.map((bucket) => significant(bucket.title));
  const parent = buckets.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    return root;
  };

  for (let a = 0; a < buckets.length; a++) {
    for (let b = a + 1; b < buckets.length; b++) {
      const size = Math.min(words[a].length, words[b].length) === 2 ? 2 : 3;
      if (Math.min(words[a].length, words[b].length) < size) continue;
      if (!shareRun(words[a], words[b], size)) continue;
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootB] = rootA;
    }
  }

  const groups = new Map<number, { title: string; entries: TimeEntry[]; hours: number }>();
  buckets.forEach((bucket, index) => {
    const root = find(index);
    const existing = groups.get(root);
    if (existing === undefined) {
      groups.set(root, { title: bucket.title, entries: [...bucket.entries], hours: bucket.hours });
      return;
    }
    existing.entries.push(...bucket.entries);
    existing.hours += bucket.hours;
    // The shortest name is the general one, which is what a merged group wants.
    if (bucket.title.length < existing.title.length) existing.title = bucket.title;
  });
  return [...groups.values()];
}

function shareRun(a: string[], b: string[], size: number): boolean {
  const runs = new Set<string>();
  for (let i = 0; i + size <= a.length; i++) runs.add(a.slice(i, i + size).join(" "));
  for (let i = 0; i + size <= b.length; i++) {
    if (runs.has(b.slice(i, i + size).join(" "))) return true;
  }
  return false;
}

/** Lowercased content words, crudely singularized so "costs" meets "cost". */
function significant(title: string): string[] {
  return (title.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .filter((word) => !STOP.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

function toTheme(title: string, entries: TimeEntry[]): Theme {
  const byDay = new Map<Day, TimeEntry[]>();
  const byTask = new Map<string, number>();
  const refs: number[] = [];
  let hours = 0;

  for (const entry of entries) {
    hours += entry.hours;
    byTask.set(entry.task, (byTask.get(entry.task) ?? 0) + entry.hours);
    const day = byDay.get(entry.day);
    if (day === undefined) byDay.set(entry.day, [entry]);
    else day.push(entry);
    if (entry.reference !== null && !refs.includes(entry.reference)) refs.push(entry.reference);
  }

  return {
    title,
    hours: round(hours),
    entryCount: entries.length,
    days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, dayEntries]) => ({
        day,
        hours: round(dayEntries.reduce((sum, entry) => sum + entry.hours, 0)),
        entries: dayEntries.slice().sort((a, b) => b.hours - a.hours),
      })),
    tasks: [...byTask.entries()]
      .map(([task, taskHours]) => ({ task, hours: round(taskHours) }))
      .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task)),
    refs,
  };
}

function titlesByNumber(week: WeekData): Map<number, string> {
  const github = week.github.data;
  const titles = new Map<number, string>();
  for (const group of [
    github.authored,
    github.issuesCreated,
    github.issuesAssigned,
    github.reviewed,
  ]) {
    for (const item of group) if (!titles.has(item.number)) titles.set(item.number, item.title);
  }
  return titles;
}

function round(hours: number): number {
  return Math.round(hours * 100) / 100;
}
