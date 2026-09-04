import { describe, expect, test } from "vitest";

import { elapsedLabel, formatHours } from "./time-format.js";

describe("formatHours", () => {
  test("renders zero as 0:00", () => {
    expect(formatHours(0)).toBe("0:00");
  });

  test("renders a quarter hour as 0:15", () => {
    expect(formatHours(0.25)).toBe("0:15");
  });

  test("pads minutes below ten", () => {
    expect(formatHours(2.05)).toBe("2:03");
  });

  test("renders hours past ten without padding them", () => {
    expect(formatHours(10.75)).toBe("10:45");
  });

  test("renders the repeating decimal Harvest returns for 25 minutes", () => {
    // Harvest reports 25 minutes as 0.4166666667, so naive truncation of
    // minutes yields 0:24 and reads as a lost minute.
    expect(formatHours(0.4166666667)).toBe("0:25");
  });

  test("treats a negative duration as zero rather than rendering a minus", () => {
    expect(formatHours(-1)).toBe("0:00");
  });
});

describe("elapsedLabel", () => {
  const startedAt = "2026-09-02T10:00:00Z";
  const now = Date.parse("2026-09-02T10:25:00Z");

  test("counts from the timer start when the entry is running", () => {
    // hours is deliberately stale: Harvest only updates it on write, so a
    // running timer must be measured from its start instead.
    expect(elapsedLabel({ hours: 0.1, timerStartedAt: startedAt }, now)).toBe("0:25");
  });

  test("falls back to the recorded hours when no timer is running", () => {
    expect(elapsedLabel({ hours: 1.5, timerStartedAt: null }, now)).toBe("1:30");
  });

  test("clamps to zero when the clock disagrees about the start", () => {
    const future = "2026-09-02T11:00:00Z";
    expect(elapsedLabel({ hours: 0, timerStartedAt: future }, now)).toBe("0:00");
  });

  test("falls back to the recorded hours when the start is unparseable", () => {
    expect(elapsedLabel({ hours: 0.5, timerStartedAt: "not a date" }, now)).toBe("0:30");
  });
});
