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
