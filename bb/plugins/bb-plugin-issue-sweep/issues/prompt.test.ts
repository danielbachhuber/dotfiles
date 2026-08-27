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
  it("leads with the number, which is what identifies the issue", () => {
    expect(threadTitle("Fix the widget", 42)).toBe("#42 Fix the widget");
  });

  it("leaves out the repository, which the sidebar already shows", () => {
    expect(threadTitle("Fix the widget", 42)).not.toMatch(/\//);
  });

  it("fits the sidebar however long the title is", () => {
    const long = "Represent translated fields with a top-level translations attribute";
    expect(threadTitle(long, 5496).length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    expect(threadTitle(long, 5496)).toMatch(/^#5496 /);
  });

  it("cuts at a word boundary rather than mid-word", () => {
    expect(threadTitle("Document the v2 HTTP API design", 4042)).toBe(
      "#4042 Document the v2 HTTP…",
    );
  });

  it("keeps the number when the title cannot fit at all", () => {
    // The number survives; the label is what gives way.
    const title = threadTitle("Anything at all", 12_345_678_901_234);
    expect(title).toContain("12345678901234");
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE + "#".length);
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

  it("authorises the commit the standing rules would otherwise block", () => {
    // Clicking Start thread is the explicit request; without saying so the
    // thread does the work and stops at an uncommitted tree.
    expect(buildPrompt(row())).toMatch(/do not need to ask me before committing/i);
  });

  it("still withholds what cannot be undone quietly", () => {
    const prompt = buildPrompt(row());
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
