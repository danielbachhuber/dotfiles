import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_AFTER_DAYS,
  MAX_THREAD_TITLE,
  actionLabel,
  displaySection,
  parsePermissionMode,
  parseStaleAfterDays,
  sizeLabel,
  threadTitle,
  waitLabel,
  waitTone,
} from "./actions.js";
import { daysWaiting, sizeBucket } from "./types.js";
import { NOW } from "./fixtures.js";

describe("actionLabel", () => {
  it("names the work rather than the state", () => {
    expect(actionLabel("first-look")).toBe("Review");
    expect(actionLabel("re-review")).toBe("Re-review");
  });
});

describe("threadTitle", () => {
  it("reads as the button that started it, plus the number", () => {
    expect(threadTitle("re-review", 4821)).toBe("Re-review #4821");
  });

  it("keeps the number when the pair would overflow", () => {
    const title = threadTitle("re-review", 1234567890123456789);
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    expect(title).toContain("1234567890123456");
  });
});

describe("parsePermissionMode", () => {
  it("defaults to full, the only mode that can reach GitHub to read a diff", () => {
    expect(parsePermissionMode(undefined)).toBe("full");
    expect(parsePermissionMode("")).toBe("full");
    expect(parsePermissionMode("nonsense")).toBe("full");
  });

  it("passes a recognised mode through", () => {
    expect(parsePermissionMode("auto")).toBe("auto");
    expect(parsePermissionMode("accept-edits")).toBe("accept-edits");
  });
});

describe("parseStaleAfterDays", () => {
  it("never throws on a hand-edited setting", () => {
    expect(parseStaleAfterDays("abc")).toBe(DEFAULT_STALE_AFTER_DAYS);
    expect(parseStaleAfterDays("-3")).toBe(DEFAULT_STALE_AFTER_DAYS);
    expect(parseStaleAfterDays(undefined)).toBe(DEFAULT_STALE_AFTER_DAYS);
  });

  it("accepts a number, floored", () => {
    expect(parseStaleAfterDays("5")).toBe(5);
    expect(parseStaleAfterDays("3.7")).toBe(3);
    expect(parseStaleAfterDays("0")).toBe(0);
  });
});

describe("displaySection", () => {
  it("moves a row with a thread out of the queue, draft or not", () => {
    expect(displaySection(true, false)).toBe("in-progress");
    expect(displaySection(true, true)).toBe("in-progress");
  });

  it("sets a draft apart, since it is not offered for review yet", () => {
    expect(displaySection(false, true)).toBe("draft");
  });

  it("puts everything else in the queue", () => {
    expect(displaySection(false, false)).toBe("needs-review");
  });
});

describe("daysWaiting", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysWaiting(NOW, NOW)).toBe(0);
    expect(daysWaiting(NOW - 86_400_000 * 2.9, NOW)).toBe(2);
    expect(daysWaiting(NOW + 86_400_000, NOW)).toBe(0);
  });
});

describe("waitTone", () => {
  it("emphasises only a wait at or past the threshold", () => {
    expect(waitTone(NOW - 86_400_000, NOW, 2)).toBe("quiet");
    expect(waitTone(NOW - 86_400_000 * 2, NOW, 2)).toBe("stale");
    expect(waitTone(NOW - 86_400_000 * 9, NOW, 2)).toBe("stale");
  });

  it("treats a zero threshold as everything being overdue", () => {
    expect(waitTone(NOW, NOW, 0)).toBe("stale");
  });
});

describe("waitLabel", () => {
  it("reads naturally at the boundaries", () => {
    expect(waitLabel(NOW, NOW)).toBe("today");
    expect(waitLabel(NOW - 86_400_000, NOW)).toBe("1 day");
    expect(waitLabel(NOW - 86_400_000 * 6, NOW)).toBe("6 days");
  });
});

describe("sizeLabel", () => {
  it("singularises one file", () => {
    expect(sizeLabel({ additions: 3, deletions: 0, changedFiles: 1 })).toBe("+3 −0, 1 file");
  });

  it("reads additions then deletions then files", () => {
    expect(sizeLabel({ additions: 120, deletions: 8, changedFiles: 6 })).toBe("+120 −8, 6 files");
  });
});

describe("sizeBucket", () => {
  it("measures lines touched, not files, so a wide one-line edit stays small", () => {
    expect(sizeBucket({ additions: 1, deletions: 1, changedFiles: 9 })).toBe("xs");
  });

  it("buckets by total lines changed", () => {
    expect(sizeBucket({ additions: 5, deletions: 0, changedFiles: 1 })).toBe("xs");
    expect(sizeBucket({ additions: 30, deletions: 5, changedFiles: 2 })).toBe("s");
    expect(sizeBucket({ additions: 200, deletions: 20, changedFiles: 8 })).toBe("m");
    expect(sizeBucket({ additions: 600, deletions: 100, changedFiles: 20 })).toBe("l");
    expect(sizeBucket({ additions: 2000, deletions: 40, changedFiles: 60 })).toBe("xl");
  });
});
