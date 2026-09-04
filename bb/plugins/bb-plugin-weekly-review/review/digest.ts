/**
 * The week, reduced to what an interpreter needs.
 *
 * Everything deterministic is settled before this runs: the sources are
 * gathered, the hours are joined onto their issues and pull requests. What is
 * left is a judgment — which of these forty titles are one body of work, and
 * which of the open threads deserves next week — and that is the only thing
 * the agent is asked for.
 *
 * Text rather than JSON, and titles rather than bodies: the interpretation
 * turns on what the work was called, and a compact digest keeps the whole week
 * in one prompt instead of sending the agent off to read files.
 */
import type { WeekData } from "./types.js";
import { attributeTime, categories } from "./overview.js";
import { weekTotals } from "./week.js";
import { buildDaySlices } from "./week.js";

export function buildDigest(week: WeekData): string {
  const github = week.github.data;
  const time = attributeTime(week);
  const totals = weekTotals(week, buildDaySlices(week));
  const out: string[] = [];

  out.push(`# Week of ${week.from} through ${week.to}`);
  out.push("");
  out.push(
    `${time.total.toFixed(1)} hours logged. ${totals.prsOpened} pull requests opened, ` +
      `${totals.prsMerged} merged, ${totals.reviews} reviewed, ` +
      `${totals.issuesCreated} issues filed, ${totals.tasksCompleted} tasks completed.`,
  );

  out.push("", "## Hours by category");
  for (const category of categories(week.harvest.data)) {
    out.push(`- ${category.hours.toFixed(1)}h (${Math.round(category.share * 100)}%) ${category.task}`);
  }

  if (time.items.length > 0) {
    out.push("", "## Hours attributed to a specific item");
    for (const item of time.items) {
      out.push(`- ${item.hours.toFixed(1)}h #${item.number} ${item.title} [${item.kind}]`);
    }
    out.push(
      `(${time.attributed.toFixed(1)}h of ${time.total.toFixed(1)}h; the rest is logged to a category only.)`,
    );
  }

  section(out, "Pull requests authored", github.authored, (pr) =>
    `- #${pr.number} [${pr.state}${pr.isDraft ? ", draft" : ""}] ${pr.title}`);
  section(out, "Issues filed", github.issuesCreated, (issue) =>
    `- #${issue.number} ${issue.title}`);
  section(out, "Pull requests reviewed", github.reviewed, (review) =>
    `- #${review.number} by ${review.author}: ${review.title}`);
  section(out, "Issues assigned and still open", github.issuesAssigned, (issue) =>
    `- #${issue.number} (last touched ${(issue.updatedAt ?? issue.createdAt).slice(0, 10)}) ${issue.title}`);
  section(out, "Tasks completed", week.todoist.data.completed, (task) => `- ${task.content}`);

  const notes = week.reflect?.data ?? [];
  if (notes.length > 0) {
    out.push("", "## Daily notes");
    for (const note of notes) out.push(`### ${note.day} — ${note.title}`, note.body);
  }

  const timeNotes = week.harvest.data.filter((entry) => entry.notes !== "");
  if (timeNotes.length > 0) {
    out.push("", "## Time entries, with notes");
    for (const entry of timeNotes) {
      out.push(`- ${entry.day} ${entry.hours.toFixed(2)}h ${entry.task}: ${entry.notes}`);
    }
  }

  const failed = ([
    ["Harvest", week.harvest],
    ["GitHub", week.github],
    ["Todoist", week.todoist],
    ["Docs", week.docs],
  ] as const).filter(([, source]) => !source.ok);
  if (failed.length > 0) {
    out.push(
      "",
      "## Sources that did not gather",
      ...failed.map(([name, source]) => `- ${name}: ${source.error ?? "unknown error"}`),
      "Treat these as missing evidence, not as an absence of work.",
    );
  }

  return out.join("\n");
}

function section<T>(out: string[], title: string, items: T[], line: (item: T) => string): void {
  if (items.length === 0) return;
  out.push("", `## ${title} (${items.length})`);
  for (const item of items) out.push(line(item));
}
