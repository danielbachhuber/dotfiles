import { describe, expect, it } from "vitest";
import { buildPrompt, threadTitle } from "./prompt.js";
import type { IssueRow } from "./types.js";

function row(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Widget rotation drifts after a resize",
    url: "https://github.com/acme/widgets/issues/42",
    labels: [],
    createdAt: 100,
    updatedAt: 200,
    commentsCount: 0,
    blockedBy: 0,
    closingPr: null,
    boardStatus: null,
    onBoard: false,
    ...overrides,
  };
}

describe("threadTitle", () => {
  it("names the sweep, the issue number, and the issue's own title", () => {
    expect(threadTitle(5718, "Port the last four Conversation Helper reads")).toBe(
      "Dev #5718: Port the last four Conversation Helper reads",
    );
  });

  it("does not truncate, because bb clips a title and adds its own ellipsis", () => {
    // Cutting to a guessed budget here produced "Retire the last…...", cut
    // twice, and threw away the tail the thread list and hover would have
    // shown in full.
    const long = "Represent translated fields with a top-level translations attribute";
    expect(threadTitle(5718, long)).toBe(`Dev #5718: ${long}`);
    expect(threadTitle(5718, long)).not.toContain("…");
  });

  it("leaves out the repository, which the sidebar already shows", () => {
    expect(threadTitle(12, "Fix the widget")).not.toMatch(/\//);
  });

  it("falls back to the bare label and number when there is no title", () => {
    expect(threadTitle(12, "   ")).toBe("Dev #12");
  });

  it("keeps a leading word-and-colon, which on an issue is part of the sentence", () => {
    // The two pull request sweeps strip "fix(sync): " because a commit subject
    // repeats what the diff says. An issue title is prose.
    expect(threadTitle(12, "Bug: login fails")).toBe("Dev #12: Bug: login fails");
  });

  it("collapses the whitespace a wrapped title arrives with", () => {
    expect(threadTitle(12, "  Fix   the\n widget  ")).toBe("Dev #12: Fix the widget");
  });
});

describe("buildPrompt", () => {
  it("names the issue, its repository, and its URL", () => {
    const prompt = buildPrompt(row());
    expect(prompt).toContain("acme/widgets#42");
    expect(prompt).toContain("Widget rotation drifts after a resize");
    expect(prompt).toContain("https://github.com/acme/widgets/issues/42");
  });

  it("sends the thread to read the issue rather than pasting a stale copy", () => {
    // The sweep stores only what the table renders, and the requirement has
    // usually moved into the comments by the time anyone starts.
    const prompt = buildPrompt(row());
    expect(prompt).toContain("gh issue view 42 --repo acme/widgets --comments");
  });

  it("leaves the work uncommitted for review", () => {
    // Starting a thread asks for the work, not for a commit: the first diff on
    // an open-ended issue is often the wrong one.
    const prompt = buildPrompt(row());
    expect(prompt).toMatch(/do not commit unless i ask/i);
    expect(prompt).not.toMatch(/do not need to ask me before committing/i);
  });

  it("still withholds what cannot be undone quietly", () => {
    const prompt = buildPrompt(row());
    expect(prompt).toMatch(/committing/i);
    expect(prompt).toMatch(/pushing/i);
    expect(prompt).toMatch(/pull request/i);
    expect(prompt).toMatch(/closing the issue/i);
  });

  it("asks for the plan first, because an issue names a problem", () => {
    expect(buildPrompt(row())).toMatch(/plan before you write code/i);
  });

  it("warns when the issue is blocked, and says how to check", () => {
    const prompt = buildPrompt(row({ blockedBy: 2 }));
    expect(prompt).toContain("blocked by 2 open issue(s)");
    expect(prompt).toMatch(/say so and stop/i);
  });

  it("says nothing about blockers when there are none", () => {
    expect(buildPrompt(row())).not.toMatch(/blocked/i);
  });
});
