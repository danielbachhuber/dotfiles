import { describe, expect, it } from "vitest";
import { sortRows, toRow, type IssueRow, type RawIssue } from "./types.js";

function raw(overrides: Partial<RawIssue> = {}): RawIssue {
  return {
    number: 12,
    title: "Widget rotation drifts after a resize",
    url: "https://github.com/acme/widgets/issues/12",
    repository: { nameWithOwner: "acme/widgets" },
    labels: [{ name: "bug" }],
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-03T00:00:00Z",
    commentsCount: 3,
    isPullRequest: false,
    ...overrides,
  };
}

function row(overrides: Partial<IssueRow> = {}): IssueRow {
  return { ...toRow(raw())!, ...overrides };
}

describe("toRow", () => {
  it("carries the fields the table renders", () => {
    expect(toRow(raw())).toEqual({
      repo: "acme/widgets",
      number: 12,
      title: "Widget rotation drifts after a resize",
      url: "https://github.com/acme/widgets/issues/12",
      labels: ["bug"],
      createdAt: Date.parse("2026-01-02T00:00:00Z"),
      updatedAt: Date.parse("2026-01-03T00:00:00Z"),
      commentsCount: 3,
      boardStatus: null,
    });
  });

  it("reads the status from the named board, ignoring the others", () => {
    // These issues sit on two boards at once — a team one and someone's
    // personal project — so "the first project item" would pick whichever
    // GitHub happened to return first.
    const row = toRow(
      raw({
        projectItems: [
          { title: "Someone's untitled project", status: { name: "Backlog" } },
          { title: "Acme Board", status: { name: "In Review" } },
        ],
      }),
      "Acme Board",
    );
    expect(row?.boardStatus).toBe("In Review");
  });

  it("reports no status when the issue is not on the named board", () => {
    const row = toRow(
      raw({ projectItems: [{ title: "Other board", status: { name: "In Progress" } }] }),
      "Acme Board",
    );
    expect(row?.boardStatus).toBeNull();
  });

  it("takes the first status it finds when no board is named", () => {
    const row = toRow(
      raw({ projectItems: [{ title: "Anything", status: { name: "Ready for Dev" } }] }),
      "",
    );
    expect(row?.boardStatus).toBe("Ready for Dev");
  });

  it("drops a pull request", () => {
    // `gh search issues` returns pull requests too, since GitHub models them
    // as issues. The panel is about issues only.
    expect(toRow(raw({ isPullRequest: true }))).toBeNull();
  });

  it("drops a hit with no repository slug", () => {
    expect(toRow(raw({ repository: undefined }))).toBeNull();
  });

  it("drops a hit whose repository slug is not owner/name", () => {
    expect(toRow(raw({ repository: { nameWithOwner: "not a slug" } }))).toBeNull();
  });

  it("tolerates missing labels and comment count", () => {
    const parsed = toRow(raw({ labels: undefined, commentsCount: undefined }));
    expect(parsed?.labels).toEqual([]);
    expect(parsed?.commentsCount).toBe(0);
  });

  it("drops a label with no name", () => {
    expect(toRow(raw({ labels: [{ name: "bug" }, {}] }))?.labels).toEqual(["bug"]);
  });

  it("falls back to created time when a hit has no update time", () => {
    // Sorting is on updatedAt, so a missing one would sink the row to the
    // bottom of the table rather than sit at its real age.
    const parsed = toRow(raw({ updatedAt: undefined }));
    expect(parsed?.updatedAt).toBe(Date.parse("2026-01-02T00:00:00Z"));
  });

  it("drops a hit with an unparseable timestamp", () => {
    expect(toRow(raw({ updatedAt: "yesterday", createdAt: "yesterday" }))).toBeNull();
  });
});

describe("sortRows", () => {
  it("puts the most recently updated first", () => {
    const older = row({ number: 1, updatedAt: 100 });
    const newer = row({ number: 2, updatedAt: 200 });
    expect(sortRows([older, newer]).map((entry) => entry.number)).toEqual([2, 1]);
  });

  it("breaks a tie by repository then number, so the order never flickers", () => {
    const rows = [
      row({ repo: "acme/widgets", number: 9, updatedAt: 100 }),
      row({ repo: "acme/gadgets", number: 4, updatedAt: 100 }),
      row({ repo: "acme/widgets", number: 2, updatedAt: 100 }),
    ];
    expect(sortRows(rows).map((entry) => `${entry.repo}#${entry.number}`)).toEqual([
      "acme/gadgets#4",
      "acme/widgets#2",
      "acme/widgets#9",
    ]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ number: 1, updatedAt: 100 }), row({ number: 2, updatedAt: 200 })];
    sortRows(rows);
    expect(rows.map((entry) => entry.number)).toEqual([1, 2]);
  });
});
