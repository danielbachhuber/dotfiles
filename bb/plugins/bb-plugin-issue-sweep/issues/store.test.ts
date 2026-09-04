import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS, createStore, type DatabaseLike, type Store } from "./store.js";
import type { IssueRow, SweepResult } from "./types.js";

function row(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    repo: "acme/widgets",
    number: 12,
    title: "Widget rotation drifts after a resize",
    url: "https://github.com/acme/widgets/issues/12",
    labels: ["bug"],
    createdAt: 100,
    updatedAt: 200,
    commentsCount: 3,
    boardStatus: null,
    onBoard: false,
    blockedBy: 0,
    closingPr: null,
    subtasks: null,
    ...overrides,
  };
}

function result(overrides: Partial<SweepResult> = {}): SweepResult {
  return { rows: [row()], truncated: false, failedRepos: [], sweptAt: 1_700_000_000_000, ...overrides };
}

let store: Store;

beforeEach(() => {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  store = createStore(db as unknown as DatabaseLike);
});

describe("createStore", () => {
  it("starts empty, with nothing swept", () => {
    expect(store.readRows()).toEqual([]);
    expect(store.readMeta()).toEqual({ sweptAt: null, truncated: false, lastError: null });
  });

  it("round-trips a row through json without losing a field", () => {
    store.replaceAll(result());
    expect(store.readRows()).toEqual([row()]);
  });

  it("reads rows back newest first, whatever order they were written in", () => {
    store.replaceAll(
      result({ rows: [row({ number: 1, updatedAt: 100 }), row({ number: 2, updatedAt: 300 })] }),
    );
    expect(store.readRows().map((entry) => entry.number)).toEqual([2, 1]);
  });

  it("drops issues that a later sweep no longer carries", () => {
    store.replaceAll(result({ rows: [row({ number: 1 }), row({ number: 2 })] }));
    store.replaceAll(result({ rows: [row({ number: 2 })] }));
    expect(store.readRows().map((entry) => entry.number)).toEqual([2]);
  });

  it("records the sweep time and the truncation flag", () => {
    store.replaceAll(result({ truncated: true, sweptAt: 42 }));
    expect(store.readMeta()).toEqual({ sweptAt: 42, truncated: true, lastError: null });
  });

  it("keeps the last rows when a sweep fails, so the panel does not blank", () => {
    store.replaceAll(result());
    store.recordFailure("`gh` was not found on PATH.");
    expect(store.readRows()).toEqual([row()]);
    expect(store.readMeta().lastError).toBe("`gh` was not found on PATH.");
    expect(store.readMeta().sweptAt).toBe(1_700_000_000_000);
  });

  it("clears a recorded failure once a sweep succeeds", () => {
    store.recordFailure("`gh` is not authenticated. Run `gh auth login`.");
    store.replaceAll(result());
    expect(store.readMeta().lastError).toBeNull();
  });

  it("survives a sweep that returns nothing", () => {
    store.replaceAll(result());
    store.replaceAll(result({ rows: [] }));
    expect(store.readRows()).toEqual([]);
    expect(store.readMeta().sweptAt).toBe(1_700_000_000_000);
  });
});

describe("auto-applied board status", () => {
  it("remembers the last status this plugin applied on its own", () => {
    store.recordAutoStatus("acme/widgets", 12, "In Review", 1_700_000_000_000);
    expect(store.autoAppliedStatus("acme/widgets", 12)).toBe("In Review");
  });

  it("reports nothing for an issue it has never moved", () => {
    expect(store.autoAppliedStatus("acme/widgets", 99)).toBeNull();
  });

  it("keeps one record per issue, the most recent", () => {
    // Start thread writes In Progress, then a pull request writes In Review;
    // only the latter should block a repeat.
    store.recordAutoStatus("acme/widgets", 12, "In Progress", 1);
    store.recordAutoStatus("acme/widgets", 12, "In Review", 2);
    expect(store.autoAppliedStatus("acme/widgets", 12)).toBe("In Review");
  });

  it("keys by repository as well as number", () => {
    store.recordAutoStatus("acme/widgets", 12, "In Review", 1);
    expect(store.autoAppliedStatus("acme/gadgets", 12)).toBeNull();
  });

  it("survives the listing being swapped out under it", () => {
    // replaceAll wipes rows; a card this plugin already moved must not become
    // eligible to be moved again just because the sweep refreshed.
    store.recordAutoStatus("acme/widgets", 12, "In Review", 1);
    store.replaceAll(result());
    expect(store.autoAppliedStatus("acme/widgets", 12)).toBe("In Review");
  });
});

describe("setRowStatus", () => {
  it("moves a stored row to its new status without a sweep", () => {
    store.replaceAll(result({ rows: [row({ boardStatus: "Ready" })] }));

    expect(store.setRowStatus("acme/widgets", 12, "In Progress")).toBe(true);
    expect(store.readRows()[0]!.boardStatus).toBe("In Progress");
  });

  it("leaves every other field of the row alone", () => {
    store.replaceAll(result({ rows: [row({ boardStatus: "Ready", onBoard: true })] }));
    store.setRowStatus("acme/widgets", 12, "In Progress");

    expect(store.readRows()[0]).toEqual(row({ boardStatus: "In Progress", onBoard: true }));
  });

  it("reports nothing done when the row already reads that way", () => {
    store.replaceAll(result({ rows: [row({ boardStatus: "In Progress" })] }));

    expect(store.setRowStatus("acme/widgets", 12, "In Progress")).toBe(false);
  });

  it("reports nothing done when the row is not in the listing", () => {
    store.replaceAll(result());

    expect(store.setRowStatus("acme/widgets", 999, "In Progress")).toBe(false);
    expect(store.setRowStatus("acme/gadgets", 12, "In Progress")).toBe(false);
  });

  it("gives way to the next sweep, which is the board's own answer", () => {
    store.replaceAll(result({ rows: [row({ boardStatus: "Ready" })] }));
    store.setRowStatus("acme/widgets", 12, "In Progress");
    store.replaceAll(result({ rows: [row({ boardStatus: "Backlog" })] }));

    expect(store.readRows()[0]!.boardStatus).toBe("Backlog");
  });
});

describe("scannedThreads", () => {
  it("starts empty and remembers what it is told", () => {
    expect(store.scannedThreads()).toEqual(new Set());

    store.markThreadScanned("thr_1", 100);
    store.markThreadScanned("thr_2", 200);

    expect(store.scannedThreads()).toEqual(new Set(["thr_1", "thr_2"]));
  });

  it("counts a thread once however often it is marked", () => {
    store.markThreadScanned("thr_1", 100);
    store.markThreadScanned("thr_1", 300);

    expect(store.scannedThreads()).toEqual(new Set(["thr_1"]));
  });

  it("survives a sweep, so a prompt is never read twice", () => {
    store.markThreadScanned("thr_1", 100);
    store.replaceAll(result());

    expect(store.scannedThreads()).toEqual(new Set(["thr_1"]));
  });
});

describe("an issue with more than one thread", () => {
  it("keeps every thread it has had, newest first", () => {
    // Keyed by issue, the store could only remember the newest and quietly
    // forgot the rest — which is how two unarchived threads ended up on one
    // issue with nothing recording either of them.
    store.linkThread("acme/widgets", 12, "thr_1", 1);
    store.linkThread("acme/widgets", 12, "thr_2", 2);

    expect(store.allThreadLinks().get("acme/widgets#12")).toEqual(["thr_2", "thr_1"]);
  });

  it("acts on the newest thread, which is the work in progress", () => {
    store.linkThread("acme/widgets", 12, "thr_1", 1);
    store.linkThread("acme/widgets", 12, "thr_2", 2);

    expect(store.threadFor("acme/widgets", 12)).toBe("thr_2");
    expect(store.threadLinks().get("acme/widgets#12")).toBe("thr_2");
  });

  it("updates a thread rather than duplicating it when it is re-linked", () => {
    store.linkThread("acme/widgets", 12, "thr_1", 1);
    store.linkThread("acme/widgets", 12, "thr_1", 5);

    expect(store.allThreadLinks().get("acme/widgets#12")).toEqual(["thr_1"]);
  });

  it("drops one thread of several without disturbing the others", () => {
    store.linkThread("acme/widgets", 12, "thr_1", 1);
    store.linkThread("acme/widgets", 12, "thr_2", 2);
    store.unlinkThread("thr_2");

    expect(store.allThreadLinks().get("acme/widgets#12")).toEqual(["thr_1"]);
    expect(store.threadFor("acme/widgets", 12)).toBe("thr_1");
  });

  it("keeps issues apart even at the same number", () => {
    store.linkThread("acme/widgets", 12, "thr_1", 1);
    store.linkThread("acme/gadgets", 12, "thr_2", 1);

    expect(store.allThreadLinks().get("acme/widgets#12")).toEqual(["thr_1"]);
    expect(store.allThreadLinks().get("acme/gadgets#12")).toEqual(["thr_2"]);
  });
});
