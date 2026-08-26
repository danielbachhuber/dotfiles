import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt.js";
import type { ClassifiedRow } from "./types.js";

function row(overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/42",
    isDraft: false,
    flags: [],
    group: "clean",
    checks: { pass: 3, fail: 0, skip: 1, pending: 0, cancelled: 0, total: 4 },
    approvedBy: [],
    commentedBy: [],
    waitingOn: [],
    awaitingReReview: false,
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("names the PR, its repository, and its URL", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toContain("acme/widgets#42");
    expect(prompt).toContain("https://github.com/acme/widgets/pull/42");
    expect(prompt).toContain("Add the widget endpoint");
  });

  it("names the merge-conflict skill for a conflict", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toContain("`resolve-merge-conflicts` skill");
    expect(prompt).not.toContain("pr-sweep");
  });

  it("names the code-review skill for reviewer feedback", () => {
    const prompt = buildPrompt(row({ flags: ["feedback"] }));
    expect(prompt).toContain("`address-code-review` skill");
  });

  it("falls back to pr-sweep for everything else", () => {
    expect(buildPrompt(row({ flags: ["ci-failing"] }))).toContain("`pr-sweep` skill");
    expect(buildPrompt(row({ flags: ["no-reviewer"] }))).toContain("`pr-sweep` skill");
  });

  it("does not restate workflow a dedicated skill already owns", () => {
    // resolve-merge-conflicts specifies worktree setup on the PR's own branch,
    // including that a bare EnterWorktree is wrong. Repeating a looser version
    // here would contradict it.
    const conflict = buildPrompt(row({ flags: ["conflict"] }));
    expect(conflict).not.toMatch(/worktree/i);
    expect(conflict).not.toMatch(/commit only after/i);
  });

  it("authorizes the commit and push a dedicated skill ends in", () => {
    // Standing instructions forbid committing without an explicit ask and
    // outrank the skill, so the prompt has to supply that ask or the thread
    // stops at a staged merge.
    for (const flags of [["conflict"], ["feedback"]]) {
      const prompt = buildPrompt(row({ flags }));
      expect(prompt).toMatch(/explicit request/i);
      expect(prompt).toMatch(/commit and push/i);
    }
  });

  it("still withholds the irreversible actions", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toMatch(/force-push/i);
    expect(prompt).toMatch(/merging the PR/i);
  });

  it("does not authorize a push on a row with no dedicated skill", () => {
    // pr-sweep rows are triage with no defined end state, so they keep the
    // ask-first guardrails instead.
    const prompt = buildPrompt(row({ flags: ["ci-failing"] }));
    expect(prompt).not.toMatch(/explicit request/i);
    expect(prompt).toMatch(/before anything leaves the machine/i);
  });

  it("keeps the standing guardrails when routing to pr-sweep", () => {
    const ci = buildPrompt(row({ flags: ["ci-failing"] }));
    expect(ci).toMatch(/worktree/i);
    expect(ci).toMatch(/before anything leaves the machine/i);
  });

  it("states the conflict as a finding, leaving the method to the skill", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toContain("It conflicts with its base branch.");
  });

  it("reports how many checks are failing", () => {
    const prompt = buildPrompt(
      row({
        flags: ["ci-failing"],
        checks: { pass: 20, fail: 2, skip: 1, pending: 0, cancelled: 0, total: 23 },
      }),
    );
    expect(prompt).toContain("2 failing of 23 checks");
  });

  it("names who left feedback", () => {
    const prompt = buildPrompt(row({ flags: ["feedback"], commentedBy: ["hubber", "mona"] }));
    expect(prompt).toContain("hubber");
    expect(prompt).toContain("mona");
  });

  it("lists every flag when a PR has several", () => {
    const prompt = buildPrompt(row({ flags: ["conflict", "ci-failing"] }));
    expect(prompt).toMatch(/conflict/i);
    expect(prompt).toMatch(/failing/i);
  });

  it("asks for confirmation before anything leaves the machine", () => {
    expect(buildPrompt(row({ flags: ["merge-ready"] }))).toMatch(/before push|ask|confirm/i);
  });
});
