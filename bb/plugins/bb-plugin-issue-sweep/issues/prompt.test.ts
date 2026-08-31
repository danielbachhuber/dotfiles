import { describe, expect, it } from "vitest";
import { MAX_THREAD_TITLE, buildPrompt, threadTitle } from "./prompt.js";
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
  it("is the issue's own title, with no number in front", () => {
    // The number spent six of thirty characters on something the row already
    // shows, and six characters is a phrase versus a fragment at this width.
    expect(threadTitle("Fix the widget")).toBe("Fix the widget");
    expect(threadTitle("Fix the widget")).not.toMatch(/#/);
  });

  it("leaves out the repository, which the sidebar already shows", () => {
    expect(threadTitle("Fix the widget")).not.toMatch(/\//);
  });

  it("fits the sidebar however long the title is", () => {
    const long = "Represent translated fields with a top-level translations attribute";
    expect(threadTitle(long).length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
  });

  it("cuts at a word boundary rather than mid-word", () => {
    expect(threadTitle("Move the silo-singleton config out of the instance")).toBe(
      "Move the silo-singleton…",
    );
  });

  it("spends the whole budget on the title now the prefix is gone", () => {
    // Exactly at the cap is not truncated at all.
    const exact = "x".repeat(MAX_THREAD_TITLE);
    expect(threadTitle(exact)).toBe(exact);
  });

  it("cuts mid-word rather than to nothing when the first word is huge", () => {
    const title = `${"x".repeat(40)} tail`;
    const result = threadTitle(title);
    expect(result.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    expect(result).toMatch(/^x+…$/);
  });

  it("trims surrounding space rather than spending the budget on it", () => {
    expect(threadTitle("  Fix the widget  ")).toBe("Fix the widget");
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
