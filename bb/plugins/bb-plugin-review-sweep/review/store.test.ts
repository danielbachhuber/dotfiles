import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, createStore } from "./store.js";
import type { ClassifiedRow, SweepResult } from "./types.js";
import { NOW } from "./fixtures.js";

function freshStore() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return createStore(db as never);
}

function row(overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    repo: "acme/widgets",
    number: 1,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/1",
    author: "octocat",
    isDraft: false,
    state: "first-look",
    requestedAt: NOW - 86_400_000 * 4,
    lastReviewedAt: null,
    requestedReviewers: ["you"],
    size: { additions: 40, deletions: 6, changedFiles: 3 },
    ...overrides,
  };
}

function result(rows: ClassifiedRow[], overrides: Partial<SweepResult> = {}): SweepResult {
  return { rows, truncated: false, sweptAt: NOW, ...overrides };
}

describe("store", () => {
  it("round-trips a row with its reviewer list and nested size intact", () => {
    const store = freshStore();
    store.replaceAll(
      result([
        row({
          state: "re-review",
          lastReviewedAt: NOW - 999,
          requestedReviewers: ["you", "platform"],
        }),
      ]),
    );
    expect(store.readRows()[0]).toMatchObject({
      repo: "acme/widgets",
      state: "re-review",
      lastReviewedAt: NOW - 999,
      requestedReviewers: ["you", "platform"],
      size: { additions: 40, changedFiles: 3 },
    });
  });

  it("replaces the whole queue, since one call returns all of it", () => {
    // Unlike pr-sweep there is no per-repository partial state to preserve: a
    // row absent from a successful sweep is a review that left the queue.
    const store = freshStore();
    store.replaceAll(result([row({ number: 1 }), row({ number: 2 })]));
    store.replaceAll(result([row({ number: 2 })]));
    expect(store.readRows().map((entry) => entry.number)).toEqual([2]);
  });

  it("clears a previous error once a sweep succeeds", () => {
    const store = freshStore();
    store.recordFailure("gh exploded");
    expect(store.readMeta().lastError).toBe("gh exploded");
    store.replaceAll(result([row()]));
    expect(store.readMeta().lastError).toBeNull();
  });

  it("leaves the last known rows in place when a sweep fails", () => {
    const store = freshStore();
    store.replaceAll(result([row()]));
    store.recordFailure("gh exploded");
    expect(store.readRows()).toHaveLength(1);
    expect(store.readMeta().sweptAt).toBe(NOW);
  });

  it("reports empty meta before the first sweep", () => {
    expect(freshStore().readMeta()).toEqual({
      sweptAt: null,
      truncated: false,
      lastError: null,
    });
  });

  it("persists truncation", () => {
    const store = freshStore();
    store.replaceAll(result([row()], { truncated: true }));
    expect(store.readMeta().truncated).toBe(true);
  });

  describe("thread links", () => {
    it("links, reads back, and reverses", () => {
      const store = freshStore();
      store.linkThread("acme/widgets", 1, "thread-a", NOW);
      expect(store.threadFor("acme/widgets", 1)).toBe("thread-a");
      expect(store.threadLinks().get("acme/widgets#1")).toBe("thread-a");
      expect(store.pullRequestForThread("thread-a")).toEqual({
        repo: "acme/widgets",
        number: 1,
      });
    });

    it("returns null for a thread it did not start, which is what scopes the header", () => {
      expect(freshStore().pullRequestForThread("someone-elses-thread")).toBeNull();
    });

    it("keeps one thread per review, replacing on re-link", () => {
      const store = freshStore();
      store.linkThread("acme/widgets", 1, "thread-a", NOW);
      store.linkThread("acme/widgets", 1, "thread-b", NOW + 1);
      expect(store.threadFor("acme/widgets", 1)).toBe("thread-b");
      expect(store.threadLinks().size).toBe(1);
    });

    it("unlinks by thread id, leaving other links alone", () => {
      const store = freshStore();
      store.linkThread("acme/widgets", 1, "thread-a", NOW);
      store.linkThread("acme/widgets", 2, "thread-b", NOW);
      store.unlinkThread("thread-a");
      expect(store.threadFor("acme/widgets", 1)).toBeNull();
      expect(store.threadFor("acme/widgets", 2)).toBe("thread-b");
    });

    it("survives a sweep that no longer carries the linked review", () => {
      // Submitting the review drops the request out of the queue, but the
      // thread is still yours to open.
      const store = freshStore();
      store.linkThread("acme/widgets", 1, "thread-a", NOW);
      store.replaceAll(result([]));
      expect(store.pullRequestForThread("thread-a")).toEqual({
        repo: "acme/widgets",
        number: 1,
      });
    });
  });

  it("hides a review until its deadline, then stops", () => {
    const store = freshStore();
    store.snooze("acme/widgets", 1, NOW + 3_600_000, NOW);

    expect(store.snoozesUntil(NOW).get("acme/widgets#1")).toBe(NOW + 3_600_000);
    // Read at the deadline, not before it: a snooze that has run out is not a
    // snooze, whatever is still on disk.
    expect(store.snoozesUntil(NOW + 3_600_000).size).toBe(0);
  });

  it("replaces a deadline rather than extending it, so a second click is idempotent", () => {
    const store = freshStore();
    store.snooze("acme/widgets", 1, NOW + 3_600_000, NOW);
    store.snooze("acme/widgets", 1, NOW + 7_200_000, NOW);

    expect(store.snoozesUntil(NOW).size).toBe(1);
    expect(store.snoozesUntil(NOW).get("acme/widgets#1")).toBe(NOW + 7_200_000);
  });

  it("takes a review back before its deadline", () => {
    const store = freshStore();
    store.snooze("acme/widgets", 1, NOW + 3_600_000, NOW);
    store.unsnooze("acme/widgets", 1);

    expect(store.snoozesUntil(NOW).size).toBe(0);
  });

  it("keeps a snooze across a sweep, which replaces every row", () => {
    const store = freshStore();
    store.snooze("acme/widgets", 1, NOW + 3_600_000, NOW);
    store.replaceAll(result([row()]));

    expect(store.snoozesUntil(NOW).get("acme/widgets#1")).toBe(NOW + 3_600_000);
  });

  it("prunes only the deadlines that have passed", () => {
    const store = freshStore();
    store.snooze("acme/widgets", 1, NOW - 1, NOW);
    store.snooze("acme/widgets", 2, NOW + 3_600_000, NOW);

    expect(store.pruneSnoozes(NOW)).toBe(1);
    expect(store.pruneSnoozes(NOW)).toBe(0);
    expect(store.snoozesUntil(NOW).get("acme/widgets#2")).toBe(NOW + 3_600_000);
  });
});
