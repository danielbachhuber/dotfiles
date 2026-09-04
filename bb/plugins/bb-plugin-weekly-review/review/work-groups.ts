/**
 * The week grouped by what the work was, rather than by which Harvest
 * category it was booked to.
 *
 * A category answers "how much of the week was meetings". It cannot answer
 * "what did the feature-toggle migration cost", because that migration was
 * meetings and planning and development and review, and the time sheet files
 * those four apart. A body of work puts them back together.
 *
 * Assignment is deterministic where the record allows it and explicit where it
 * does not. An entry naming `#5837` belongs to whichever body claims 5837 —
 * no judgment required. An entry reading `Phase 3 review` belongs wherever the
 * interpreter put it, matched verbatim on the day and the text.
 */
import type { Interpretation } from "./interpretation.js";
import type { Issue, PullRequest, Review, WeekData } from "./types.js";
import type { TimeEntry, TimeSection } from "./time-sections.js";
import { timeSections } from "./time-sections.js";

export interface WorkGroup {
  title: string;
  detail: string;
  status: Interpretation["bodiesOfWork"][number]["status"];
  /** Summed from the entries actually assigned, not from the agent's claim. */
  hours: number;
  entries: TimeEntry[];
  /** Categories the hours came from, largest first. */
  tasks: Array<{ task: string; hours: number }>;
  pullRequests: PullRequest[];
  issues: Issue[];
  reviews: Review[];
  /** Numbers the interpretation claimed that the week has never heard of. */
  unknownRefs: number[];
}

export interface WorkGrouping {
  groups: WorkGroup[];
  /** Everything no body of work claimed, still grouped by category. */
  ungrouped: TimeSection[];
  ungroupedHours: number;
}

const key = (day: string, label: string) => `${day} ${label}`;

export function groupByWork(week: WeekData, interpretation: Interpretation): WorkGrouping {
  const github = week.github.data;
  const sections = timeSections(week);
  const allEntries = sections.flatMap((section) =>
    section.entries.map((entry) => ({ entry, task: section.task })),
  );

  // Which body claims each number and each bare entry. First claim wins, so a
  // pull request listed under two bodies lands in the one the interpreter
  // ranked higher rather than being counted twice.
  const byRef = new Map<number, number>();
  const byEntry = new Map<string, number>();
  interpretation.bodiesOfWork.forEach((body, index) => {
    for (const ref of body.refs) if (!byRef.has(ref)) byRef.set(ref, index);
    for (const entry of body.entries) {
      const at = key(entry.day, entry.label.trim());
      if (!byEntry.has(at)) byEntry.set(at, index);
    }
  });

  const claimed = new Set<string>();
  const owner = (entry: TimeEntry): number | undefined =>
    entry.reference !== null
      ? byRef.get(entry.reference)
      : byEntry.get(key(entry.day, entry.label));

  const groups: WorkGroup[] = interpretation.bodiesOfWork.map((body) => {
    const refs = new Set(body.refs);
    const issues = github.issuesCreated.concat(github.issuesAssigned).filter((issue) => refs.has(issue.number));
    return {
      title: body.title,
      detail: body.detail,
      status: body.status,
      hours: 0,
      entries: [],
      tasks: [],
      pullRequests: github.authored.filter((pr) => refs.has(pr.number)),
      issues: issues.filter(
        (issue, index) => issues.findIndex((other) => other.number === issue.number) === index,
      ),
      reviews: github.reviewed.filter((review) => refs.has(review.number)),
      unknownRefs: [],
    };
  });

  const taskHours = groups.map(() => new Map<string, number>());

  for (const { entry, task } of allEntries) {
    const index = owner(entry);
    if (index === undefined || groups[index] === undefined) continue;
    claimed.add(key(entry.day, entry.label));
    groups[index].entries.push(entry);
    groups[index].hours += entry.hours;
    taskHours[index].set(task, (taskHours[index].get(task) ?? 0) + entry.hours);
  }

  const known = new Set<number>();
  for (const group of [
    github.authored,
    github.issuesCreated,
    github.issuesAssigned,
    github.reviewed,
  ]) {
    for (const item of group) known.add(item.number);
  }

  interpretation.bodiesOfWork.forEach((body, index) => {
    const group = groups[index];
    group.unknownRefs = body.refs.filter((ref) => !known.has(ref));
    group.hours = round(group.hours);
    group.entries.sort((a, b) => a.day.localeCompare(b.day) || b.hours - a.hours);
    group.tasks = [...taskHours[index].entries()]
      .map(([task, hours]) => ({ task, hours: round(hours) }))
      .sort((a, b) => b.hours - a.hours || a.task.localeCompare(b.task));
  });

  // What is left keeps its categories: with no body of work to belong to, how
  // it was booked is the only thing still known about it.
  let ungroupedHours = 0;
  const ungrouped: TimeSection[] = [];
  for (const section of sections) {
    const entries = section.entries.filter((entry) => !claimed.has(key(entry.day, entry.label)));
    if (entries.length === 0) continue;
    const hours = round(entries.reduce((sum, entry) => sum + entry.hours, 0));
    ungroupedHours += hours;
    ungrouped.push({ ...section, entries, hours, share: 0 });
  }

  return { groups, ungrouped, ungroupedHours: round(ungroupedHours) };
}

function round(hours: number): number {
  return Math.round(hours * 100) / 100;
}
