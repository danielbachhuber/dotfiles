import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_AFTER_DAYS,
  MAX_THREAD_TITLE,
  actionLabel,
  ageLabel,
  ageTone,
  displaySection,
  parsePermissionMode,
  parseStaleAfterDays,
  returnsInLabel,
  reviewersLabel,
  snoozeUntil,
  sizeLabel,
  threadTitle,
  titleGist,
} from "./actions.js";
import { ageInDays, sizeBucket } from "./types.js";
import { NOW } from "./fixtures.js";

describe("actionLabel", () => {
  it("names the work rather than the state", () => {
    expect(actionLabel("first-look")).toBe("Review");
    expect(actionLabel("re-review")).toBe("Re-review");
  });
});

describe("threadTitle", () => {
  it("carries a few words of the pull request title, so a queue of reviews is legible", () => {
    expect(threadTitle("re-review", 5622, "Retry sync on 429")).toBe(
      "Re-review #5622: Retry sync on 429",
    );
  });

  it("falls back to the bare label and number when there is no title", () => {
    expect(threadTitle("re-review", 4821)).toBe("Re-review #4821");
    expect(threadTitle("first-look", 4821, "   ")).toBe("Review #4821");
  });

  it("drops a conventional-commit prefix, which the number already covers", () => {
    expect(threadTitle("first-look", 12, "fix(sync): handle empty page")).toBe(
      "Review #12: handle empty page",
    );
    expect(threadTitle("first-look", 12, "[ACME-4] Handle empty page")).toBe(
      "Review #12: Handle empty page",
    );
  });

  it("cuts the gist on a word boundary and stays inside the budget", () => {
    const title = threadTitle(
      "first-look",
      5931,
      "Add a retry with exponential backoff to the sync worker",
    );
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    expect(title).toBe("Review #5931: Add a retry with…");
    expect(title).not.toContain("expon");
  });

  it("keeps the whole number, whatever else has to go", () => {
    // The largest integer JavaScript represents exactly. Anything longer would
    // be a rounded literal, so this is as far as the invariant can be tested;
    // the branch that clips the label itself is unreachable at this budget and
    // stands as a guard for a smaller one.
    const title = threadTitle("re-review", Number.MAX_SAFE_INTEGER, "Add the widget endpoint");
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    expect(title).toContain(`#${Number.MAX_SAFE_INTEGER}`);
  });
});

describe("titleGist", () => {
  it("says nothing rather than a stub when the budget is tiny", () => {
    expect(titleGist("Add the widget endpoint", 2)).toBe("");
  });

  it("cuts a single over-long word rather than returning empty", () => {
    expect(titleGist("Supercalifragilistic", 10)).toBe("Supercali…");
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

  it("sets an ignored review apart, draft or not", () => {
    expect(displaySection(false, false, true)).toBe("snoozed");
    expect(displaySection(false, true, true)).toBe("snoozed");
  });

  it("lets a thread outrank the deferral, since the work is already happening", () => {
    expect(displaySection(true, false, true)).toBe("in-progress");
  });
});

describe("snoozeUntil", () => {
  it("defers by exactly 48 hours", () => {
    expect(snoozeUntil(NOW) - NOW).toBe(48 * 3_600_000);
  });
});

describe("returnsInLabel", () => {
  it("counts the hours left, rounding up so nothing reads as zero", () => {
    expect(returnsInLabel(NOW + 41 * 3_600_000, NOW)).toBe("returns in 41 hours");
    expect(returnsInLabel(NOW + 1_800_000, NOW)).toBe("returns in 1 hour");
  });

  it("switches to days past the point where an hour count stops meaning anything", () => {
    expect(returnsInLabel(NOW + 48 * 3_600_000, NOW)).toBe("returns in 2 days");
  });

  it("says returning rather than a negative count for a deadline already passed", () => {
    expect(returnsInLabel(NOW - 3_600_000, NOW)).toBe("returning");
  });
});

describe("ageInDays", () => {
  it("floors to whole days and never goes negative", () => {
    expect(ageInDays(NOW, NOW)).toBe(0);
    expect(ageInDays(NOW - 86_400_000 * 2.9, NOW)).toBe(2);
    expect(ageInDays(NOW + 86_400_000, NOW)).toBe(0);
  });
});

describe("ageTone", () => {
  it("emphasises only a wait at or past the threshold", () => {
    expect(ageTone(NOW - 86_400_000, NOW, 2)).toBe("quiet");
    expect(ageTone(NOW - 86_400_000 * 2, NOW, 2)).toBe("stale");
    expect(ageTone(NOW - 86_400_000 * 9, NOW, 2)).toBe("stale");
  });

  it("treats a zero threshold as everything being overdue", () => {
    expect(ageTone(NOW, NOW, 0)).toBe("stale");
  });
});

describe("ageLabel", () => {
  const HOUR = 3_600_000;

  it("counts hours below two days, where the hour is the useful number", () => {
    expect(ageLabel(NOW, NOW)).toBe("just now");
    expect(ageLabel(NOW - HOUR, NOW)).toBe("1 hour");
    expect(ageLabel(NOW - HOUR * 3, NOW)).toBe("3 hours");
    // A request that arrived this morning and one that arrived last night both
    // used to read "today", which is the difference between answering now and
    // having already sat overnight.
    expect(ageLabel(NOW - HOUR * 27, NOW)).toBe("27 hours");
    expect(ageLabel(NOW - HOUR * 47, NOW)).toBe("47 hours");
  });

  it("switches to days at forty-eight hours, where hours stop meaning much", () => {
    expect(ageLabel(NOW - HOUR * 48, NOW)).toBe("2 days");
    expect(ageLabel(NOW - 86_400_000 * 6, NOW)).toBe("6 days");
  });

  it("never reports a negative age for a clock skewed forward", () => {
    expect(ageLabel(NOW + HOUR, NOW)).toBe("just now");
  });
});

describe("reviewersLabel", () => {
  it("lists you first, then the rest as given", () => {
    expect(reviewersLabel(["you", "mona", "platform"])).toBe("you, mona, platform");
  });

  it("falls back to an em dash rather than claiming nobody was asked", () => {
    expect(reviewersLabel([])).toBe("—");
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
