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
import type { Day, WeekData } from "./types.js";
import { attributeTime, categories } from "./overview.js";
import { buildDaySlices, comingUp, splitBacklog, weekTotals } from "./week.js";

export function buildDigest(week: WeekData, today?: Day): string {
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

  // What is still owed. Overdue and near-term only: the someday pile is a
  // backlog rather than a claim on next week, and listing it would bury the
  // few tasks that are actually late.
  const backlog = splitBacklog(week.todoist.data.incomplete, week.to);
  section(out, "Tasks overdue", backlog.overdue, (task) =>
    `- ${task.content} (due ${task.due})`);
  section(out, "Tasks due in the next two weeks", backlog.upcoming, (task) =>
    `- ${task.content} (due ${task.due}${task.recurring ? ", recurring" : ""})`);
  if (backlog.someday.length > 0) {
    out.push(`(${backlog.someday.length} further tasks carry no due date.)`);
  }

  // Conversations, with their summaries kept whole. A Slack thread is often
  // where a decision was actually made, and the entry has no other record of
  // it: nothing in Harvest or GitHub says a hand-off was agreed in a DM.
  const slack = week.slack?.data ?? [];
  if (slack.length > 0) {
    out.push("", `## Slack conversations (${slack.length})`);
    for (const thread of slack) {
      const who = thread.participants?.length ? ` — ${thread.participants.join(", ")}` : "";
      out.push(`- ${thread.day} ${thread.channel}${who}: ${thread.summary}`);
    }
  }

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

  // What is ahead, so a recommendation for next week argues against the
  // actual calendar rather than against an empty one. The day is taken from
  // the caller when given, which is what keeps the digest testable.
  const ahead = comingUp(week, today ?? new Date().toISOString().slice(0, 10));
  if (!ahead.empty) {
    out.push("", `## Coming up (${ahead.window.from} through ${ahead.window.to})`);
    if (ahead.overdue.length > 0) {
      out.push(`### Overdue (${ahead.overdue.length})`);
      for (const task of ahead.overdue) out.push(`- ${task.content} (due ${task.due})`);
    }
    for (const day of ahead.days) {
      out.push(`### ${day.day}`);
      for (const event of day.events) {
        const when = event.allDay ? "all day" : (event.startsAt ?? "").slice(11, 16);
        const who = event.attendees > 1 ? `, ${event.attendees} people` : "";
        const free = event.free ? ", marked free" : "";
        // An invitation you have not answered is a decision still owed, which
        // is exactly the kind of thing next week's plan should account for.
        const reply = event.response === "needsAction"
          ? ", unanswered"
          : event.response === "tentative" ? ", maybe" : "";
        out.push(`- ${when} ${event.title}${who}${reply}${free}`);
      }
      for (const task of day.tasks) out.push(`- task due: ${task.content}`);
    }
    if (ahead.later.length > 0) {
      out.push(`(${ahead.later.length} further tasks are due after next week.)`);
    }
  }

  const failed = ([
    ["Harvest", week.harvest],
    ["GitHub", week.github],
    ["Todoist", week.todoist],
    ["Docs", week.docs],
    ["Slack", week.slack],
    ["Calendar", week.calendar],
    // Absent is not failed: Slack and the calendar are written by an agent
    // step and by a CLI that may not be configured, and a week gathered
    // before either existed has no record of them at all.
  ] as const).filter(([, source]) => source !== undefined && !source.ok);
  if (failed.length > 0) {
    out.push(
      "",
      "## Sources that did not gather",
      ...failed.map(([name, source]) => `- ${name}: ${source?.error ?? "unknown error"}`),
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
