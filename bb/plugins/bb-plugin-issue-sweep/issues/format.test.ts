import { describe, expect, it } from "vitest";
import { commentsLabel, relativeTime, subtasksLabel } from "./format.js";

const NOW = Date.parse("2026-06-15T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("calls the last minute just now", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("just now");
  });

  it("counts minutes, hours, and days", () => {
    expect(relativeTime(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe("2d ago");
  });

  it("switches to weeks, then months, then years", () => {
    expect(relativeTime(NOW - 10 * DAY, NOW)).toBe("1w ago");
    expect(relativeTime(NOW - 45 * DAY, NOW)).toBe("1mo ago");
    expect(relativeTime(NOW - 800 * DAY, NOW)).toBe("2y ago");
  });

  it("rounds down, so nothing ever reads older than it is", () => {
    expect(relativeTime(NOW - (2 * DAY - 1), NOW)).toBe("1d ago");
  });

  it("does not go negative when a clock skews forward", () => {
    // GitHub's timestamp can land slightly ahead of the local clock. "in 3m"
    // on an issue you did not just touch reads as a bug.
    expect(relativeTime(NOW + 3 * MINUTE, NOW)).toBe("just now");
  });
});

describe("commentsLabel", () => {
  it("says nothing about an issue with no discussion", () => {
    expect(commentsLabel(0)).toBeNull();
  });

  it("counts one comment in the singular", () => {
    expect(commentsLabel(1)).toBe("1 comment");
    expect(commentsLabel(4)).toBe("4 comments");
  });
});

describe("subtasksLabel", () => {
  it("reads as done over total, named for what it counts", () => {
    expect(subtasksLabel({ completed: 8, total: 14, source: "sub-issues" })).toBe(
      "8/14 sub-issues",
    );
    expect(subtasksLabel({ completed: 12, total: 21, source: "tasks" })).toBe("12/21 tasks");
  });

  it("still speaks up when none of them are done", () => {
    expect(subtasksLabel({ completed: 0, total: 3, source: "sub-issues" })).toBe(
      "0/3 sub-issues",
    );
  });

  it("says nothing about an issue with no checklist", () => {
    expect(subtasksLabel(null)).toBeNull();
    // Rows stored before this field existed read back without it.
    expect(subtasksLabel(undefined)).toBeNull();
    expect(subtasksLabel({ completed: 0, total: 0, source: "tasks" })).toBeNull();
  });
});
