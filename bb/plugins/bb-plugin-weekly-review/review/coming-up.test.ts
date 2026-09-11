import { describe, expect, it } from "vitest";
import { comingUpWindow } from "./dates.js";
import { comingUp } from "./week.js";
import type { CalendarEvent, Task, WeekData } from "./types.js";

function task(id: string, content: string, due: string | null, recurring = false): Task {
  return {
    id, content, url: `https://app.todoist.test/task/${id}`,
    priority: 1, due, dueString: due, recurring, labels: [],
  };
}

function event(id: string, day: string, title: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id, day, title, allDay: false, minutes: 30, attendees: 2, free: false,
    startsAt: `${day}T09:00:00-07:00`, ...extra,
  };
}

function week(overrides: Partial<WeekData> = {}): WeekData {
  const empty = { ok: true, fetchedAt: "2026-09-11T12:00:00.000Z" };
  return {
    from: "2026-09-07",
    to: "2026-09-11",
    generatedAt: "2026-09-11T12:00:00.000Z",
    harvest: { ...empty, data: [] },
    github: { ...empty, data: { authored: [], reviewed: [], issuesCreated: [], issuesAssigned: [] } },
    todoist: { ...empty, data: { completed: [], incomplete: [] } },
    docs: { ...empty, data: [] },
    ...overrides,
  };
}

describe("comingUpWindow", () => {
  it("starts tomorrow, not today", () => {
    // Friday 11 September 2026 → Saturday through the Sunday that closes next
    // week. Today belongs to the week being reviewed, which is the rest of the
    // page; a meeting that happened this morning is not something to plan for.
    expect(comingUpWindow(new Date(2026, 8, 11))).toEqual({
      from: "2026-09-12",
      to: "2026-09-20",
    });
  });

  it("treats Sunday as the end of this week, not the start of next", () => {
    expect(comingUpWindow(new Date(2026, 8, 13))).toEqual({
      from: "2026-09-14",
      to: "2026-09-20",
    });
  });

  it("gives a Monday the rest of this week and all of next", () => {
    expect(comingUpWindow(new Date(2026, 8, 14))).toEqual({
      from: "2026-09-15",
      to: "2026-09-27",
    });
  });
});

describe("comingUp", () => {
  const calendar = {
    ok: true,
    fetchedAt: "2026-09-11T12:00:00.000Z",
    data: [
      event("e1", "2026-09-11", "Standup"),
      event("e2", "2026-09-15", "Roadmap planning", { attendees: 14 }),
      event("e3", "2026-09-16", "Octocat owns the release", {
        allDay: true, minutes: null, free: true, startsAt: undefined,
      }),
      // Past the window: gathered because the window is wider than a week,
      // but this one is a fortnight out and does not belong on the list.
      event("e4", "2026-09-30", "Quarterly review"),
    ],
  };

  it("groups events onto the days they fall on, inside the window only", () => {
    const ahead = comingUp(week({ calendar }), "2026-09-11");
    expect(ahead.days.map((day) => day.day)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(ahead.days[0].events.map((e) => e.title)).toEqual(["Roadmap planning"]);
  });

  it("leaves out today's own meetings", () => {
    const ahead = comingUp(week({ calendar }), "2026-09-11");
    expect(JSON.stringify(ahead)).not.toContain("Standup");
  });

  it("leaves out a day with nothing on it", () => {
    const ahead = comingUp(week({ calendar }), "2026-09-11");
    expect(ahead.days.map((day) => day.day)).not.toContain("2026-09-12");
  });

  it("keeps a task due today out of the window", () => {
    const ahead = comingUp(
      week({
        todoist: {
          ok: true,
          fetchedAt: "2026-09-11T12:00:00.000Z",
          data: { completed: [], incomplete: [task("t0", "Book the room", "2026-09-11")] },
        },
      }),
      "2026-09-11",
    );
    expect(ahead.empty).toBe(true);
  });

  it("puts a task on its due day beside that day's meetings", () => {
    const ahead = comingUp(
      week({
        calendar,
        todoist: {
          ok: true,
          fetchedAt: "2026-09-11T12:00:00.000Z",
          data: {
            completed: [],
            incomplete: [task("t1", "Send the roadmap draft", "2026-09-15")],
          },
        },
      }),
      "2026-09-11",
    );
    const day = ahead.days.find((d) => d.day === "2026-09-15");
    expect(day?.tasks.map((t) => t.content)).toEqual(["Send the roadmap draft"]);
    expect(day?.events.map((e) => e.title)).toEqual(["Roadmap planning"]);
  });

  it("separates what is late from what is ahead, and ignores a recurring habit", () => {
    const ahead = comingUp(
      week({
        calendar,
        todoist: {
          ok: true,
          fetchedAt: "2026-09-11T12:00:00.000Z",
          data: {
            completed: [],
            incomplete: [
              task("t1", "File the expense report", "2026-09-02"),
              task("t2", "Water the plants", "2026-09-10", true),
              task("t3", "No due date at all", null),
            ],
          },
        },
      }),
      "2026-09-11",
    );
    expect(ahead.overdue.map((t) => t.content)).toEqual(["File the expense report"]);
    // A daily habit one day behind is not a slipping commitment, so
    // `splitBacklog` spares it the overdue block — and it is not ahead of us
    // either, so it does not get nudged onto a day it is not due on.
    expect(JSON.stringify(ahead)).not.toContain("Water the plants");
    // The someday pile is a backlog, not a claim on next week.
    expect(JSON.stringify(ahead)).not.toContain("No due date at all");
  });

  it("counts a task due past the window rather than dropping it", () => {
    const ahead = comingUp(
      week({
        todoist: {
          ok: true,
          fetchedAt: "2026-09-11T12:00:00.000Z",
          data: { completed: [], incomplete: [task("t9", "Renew the domain", "2026-09-24")] },
        },
      }),
      "2026-09-11",
    );
    expect(ahead.later.map((t) => t.content)).toEqual(["Renew the domain"]);
    expect(ahead.days).toEqual([]);
  });

  it("is empty, not broken, for a week gathered before the calendar existed", () => {
    const ahead = comingUp(week(), "2026-09-11");
    expect(ahead.empty).toBe(true);
    expect(ahead.days).toEqual([]);
  });
});
