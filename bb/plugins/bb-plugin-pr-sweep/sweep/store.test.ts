import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, createStore } from "./store.js";
import type { ClassifiedRow } from "./types.js";

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
    isDraft: false,
    flags: ["conflict"],
    group: "needs-action",
    checks: { pass: 1, fail: 0, skip: 0, pending: 0, cancelled: 0, total: 1 },
    approvedBy: [],
    commentedBy: [],
    waitingOn: [],
    awaitingReReview: false,
    ...overrides,
  };
}

describe("store", () => {
  it("round-trips a row with its arrays and nested checks intact", () => {
    const store = freshStore();
    store.replaceRepoRows("acme/widgets", [row({ approvedBy: ["hubber"], flags: ["merge-ready"] })]);
    const [read] = store.readRows();
    expect(read).toMatchObject({
      repo: "acme/widgets",
      approvedBy: ["hubber"],
      flags: ["merge-ready"],
      checks: { pass: 1, total: 1 },
    });
  });

  it("replaces only the named repository's rows", () => {
    const store = freshStore();
    store.replaceRepoRows("acme/widgets", [row({ number: 1 })]);
    store.replaceRepoRows("acme/gadgets", [row({ repo: "acme/gadgets", number: 2 })]);
    store.replaceRepoRows("acme/widgets", [row({ number: 3 })]);

    expect(store.readRows().map((entry) => `${entry.repo}#${entry.number}`).sort()).toEqual([
      "acme/gadgets#2",
      "acme/widgets#3",
    ]);
  });

  it("replaceAll drops repositories that no longer have open PRs", () => {
    const store = freshStore();
    store.replaceRepoRows("acme/gone", [row({ repo: "acme/gone", number: 9 })]);
    store.replaceAll({
      rows: [row({ number: 1 })],
      repos: ["acme/widgets"],
      failedRepos: [],
      skippedRepos: [],
      truncated: false,
      sweptAt: 1_700_000_000_000,
    });
    expect(store.readRows().map((entry) => entry.repo)).toEqual(["acme/widgets"]);
  });

  it("keeps a failed repository's previous rows on replaceAll", () => {
    const store = freshStore();
    store.replaceRepoRows("acme/flaky", [row({ repo: "acme/flaky", number: 5 })]);
    store.replaceAll({
      rows: [row({ number: 1 })],
      repos: ["acme/widgets", "acme/flaky"],
      failedRepos: ["acme/flaky"],
      skippedRepos: [],
      truncated: false,
      sweptAt: 1_700_000_000_000,
    });
    expect(store.readRows().map((entry) => entry.repo).sort()).toEqual([
      "acme/flaky",
      "acme/widgets",
    ]);
  });

  it("records sweep metadata and clears the previous error on success", () => {
    const store = freshStore();
    store.recordFailure("network down");
    expect(store.readMeta().lastError).toBe("network down");

    store.replaceAll({
      rows: [],
      repos: [],
      failedRepos: ["acme/flaky"],
      skippedRepos: [],
      truncated: true,
      sweptAt: 1_700_000_000_000,
    });
    expect(store.readMeta()).toMatchObject({
      sweptAt: 1_700_000_000_000,
      failedRepos: ["acme/flaky"],
      skippedRepos: [],
      truncated: true,
      lastError: null,
    });
  });

  it("reports an empty meta before the first sweep", () => {
    expect(freshStore().readMeta()).toMatchObject({ sweptAt: null, lastError: null });
  });
});

describe("thread links", () => {
  it("records and reads the thread started for a PR", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1_700_000_000_000);
    expect(store.threadFor("acme/widgets", 42)).toBe("thr_1");
  });

  it("returns null for a PR with no thread", () => {
    expect(freshStore().threadFor("acme/widgets", 42)).toBeNull();
  });

  it("keeps every thread a pull request has had, newest first", () => {
    // One pull request genuinely has several threads over its life: a conflict
    // thread, then a CI thread, then a merge thread. Keyed by pull request,
    // the store could only remember the newest and quietly forgot the rest.
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.linkThread("acme/widgets", 42, "thr_2", 2);

    expect(store.allThreadLinks().get("acme/widgets#42")).toEqual(["thr_2", "thr_1"]);
  });

  it("acts on the newest thread, which is the work in progress", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.linkThread("acme/widgets", 42, "thr_2", 2);

    expect(store.threadFor("acme/widgets", 42)).toBe("thr_2");
    expect(store.threadLinks().get("acme/widgets#42")).toBe("thr_2");
  });

  it("updates a thread rather than duplicating it when it is re-linked", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.linkThread("acme/widgets", 42, "thr_1", 5);

    expect(store.allThreadLinks().get("acme/widgets#42")).toEqual(["thr_1"]);
  });

  it("drops one thread of several without disturbing the others", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.linkThread("acme/widgets", 42, "thr_2", 2);
    store.unlinkThread("thr_2");

    expect(store.allThreadLinks().get("acme/widgets#42")).toEqual(["thr_1"]);
    expect(store.threadFor("acme/widgets", 42)).toBe("thr_1");
  });

  it("keys links by repo and number together", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.linkThread("acme/gadgets", 42, "thr_2", 1);
    expect(store.threadLinks()).toEqual(
      new Map([
        ["acme/widgets#42", "thr_1"],
        ["acme/gadgets#42", "thr_2"],
      ]),
    );
  });

  it("drops a link when its thread goes away", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.unlinkThread("thr_1");
    expect(store.threadFor("acme/widgets", 42)).toBeNull();
  });

  it("survives a sweep that replaces every row", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    store.replaceAll({
      rows: [row({ number: 42 })],
      repos: ["acme/widgets"],
      failedRepos: [],
      skippedRepos: [],
      truncated: false,
      sweptAt: 2,
    });
    expect(store.threadFor("acme/widgets", 42)).toBe("thr_1");
  });
});

describe("thread reasons", () => {
  it("records the flag a thread was started for", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1, "conflict");
    expect(store.threadReasons()).toEqual([
      { repo: "acme/widgets", number: 42, threadId: "thr_1", reason: "conflict" },
    ]);
  });

  it("leaves the reason null when none was given", () => {
    // Links written before the column existed. They are simply never
    // auto-archived, rather than being archived against a guessed reason.
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1);
    expect(store.threadReasons()[0]?.reason).toBeNull();
  });

  it("keeps a reason per thread, since each was started for its own flag", () => {
    // The archive sweep asks "is the flag this thread was started for gone
    // yet", one thread at a time. Collapsing two threads into one reason meant
    // the conflict thread was judged by the CI thread's flag.
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1, "conflict");
    store.linkThread("acme/widgets", 42, "thr_2", 2, "ci-failing");

    expect(store.threadReasons()).toEqual(
      expect.arrayContaining([
        { repo: "acme/widgets", number: 42, threadId: "thr_1", reason: "conflict" },
        { repo: "acme/widgets", number: 42, threadId: "thr_2", reason: "ci-failing" },
      ]),
    );
  });

  it("updates a thread's reason rather than adding a second row for it", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1, "conflict");
    store.linkThread("acme/widgets", 42, "thr_1", 2, "ci-failing");

    expect(store.threadReasons()).toEqual([
      { repo: "acme/widgets", number: 42, threadId: "thr_1", reason: "ci-failing" },
    ]);
  });

  it("drops the reason with the link", () => {
    const store = freshStore();
    store.linkThread("acme/widgets", 42, "thr_1", 1, "conflict");
    store.unlinkThread("thr_1");
    expect(store.threadReasons()).toEqual([]);
  });
});

describe("scannedThreads", () => {
  it("starts empty and remembers what it is told", () => {
    const store = freshStore();
    expect(store.scannedThreads()).toEqual(new Set());

    store.markThreadScanned("thr_1", 100);
    store.markThreadScanned("thr_2", 200);

    expect(store.scannedThreads()).toEqual(new Set(["thr_1", "thr_2"]));
  });

  it("counts a thread once however often it is marked", () => {
    const store = freshStore();
    store.markThreadScanned("thr_1", 100);
    store.markThreadScanned("thr_1", 300);

    expect(store.scannedThreads()).toEqual(new Set(["thr_1"]));
  });

  it("survives a sweep, so a prompt is never read twice", () => {
    const store = freshStore();
    store.markThreadScanned("thr_1", 100);
    store.replaceAll({
      rows: [row()],
      repos: ["acme/widgets"],
      failedRepos: [],
      skippedRepos: [],
      truncated: false,
      sweptAt: 1_700_000_000_000,
    });

    expect(store.scannedThreads()).toEqual(new Set(["thr_1"]));
  });
});

describe("skipped repositories", () => {
  it("round-trips through meta so the panel can explain an empty list", () => {
    const store = freshStore();
    store.replaceAll({
      rows: [],
      repos: [],
      failedRepos: [],
      skippedRepos: ["acme/gadgets"],
      truncated: false,
      sweptAt: 5,
    });
    expect(store.readMeta().skippedRepos).toEqual(["acme/gadgets"]);
  });
});

