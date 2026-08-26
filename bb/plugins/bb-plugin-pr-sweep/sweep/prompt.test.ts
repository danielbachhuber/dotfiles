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

  it("authorizes the commit, push and reply the skills end in", () => {
    // Standing instructions forbid committing without an explicit ask and
    // outrank the skill, so the prompt has to supply that ask or the thread
    // stops at a staged merge. address-code-review also ends in posting
    // replies, so withholding those would break it halfway.
    for (const flags of [["conflict"], ["feedback"], ["ci-failing"]]) {
      const prompt = buildPrompt(row({ flags }));
      expect(prompt).toMatch(/explicit request/i);
      expect(prompt).toMatch(/commit, push, and reply/i);
    }
  });

  it("still withholds the irreversible actions", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toMatch(/force-push/i);
    expect(prompt).toMatch(/merging the PR/i);
  });

  it("keeps the triage guardrails for a pr-sweep step", () => {
    const prompt = buildPrompt(row({ flags: ["ci-failing"] }));
    expect(prompt).toMatch(/`pr-sweep`/);
    expect(prompt).toMatch(/show me the evidence/i);
    expect(prompt).toMatch(/worktree/i);
  });

  it("omits the triage guardrails when no step routes to pr-sweep", () => {
    const prompt = buildPrompt(row({ flags: ["conflict", "feedback"] }));
    expect(prompt).not.toMatch(/show me the evidence/i);
  });

  it("numbers several flags as ordered steps, worst first", () => {
    const prompt = buildPrompt(row({ flags: ["conflict", "feedback"] }));
    expect(prompt).toMatch(/found 2 things, worst first/);
    expect(prompt).toMatch(/1\. It conflicts with its base branch\./);
    expect(prompt).toMatch(/ {3}Use the `resolve-merge-conflicts` skill\./);
    expect(prompt).toMatch(/2\. There is live reviewer feedback/);
    expect(prompt).toMatch(/ {3}Use the `address-code-review` skill\./);
    expect(prompt.indexOf("resolve-merge-conflicts")).toBeLessThan(
      prompt.indexOf("address-code-review"),
    );
  });

  it("tells the agent to finish each step before the next and re-check after", () => {
    const prompt = buildPrompt(row({ flags: ["conflict", "feedback"] }));
    expect(prompt).toMatch(/finish each before starting the next/i);
    expect(prompt).toMatch(/re-check the later ones/i);
  });

  it("does not number a single finding as a list of steps", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toMatch(/found one thing/i);
    expect(prompt).not.toMatch(/finish each before starting the next/i);
  });

  it("says so when a row carries no flags at all", () => {
    const prompt = buildPrompt(row({ flags: [] }));
    expect(prompt).toMatch(/flagged nothing/i);
    expect(prompt).toMatch(/`pr-sweep`/);
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

  it("gives every step a skill", () => {
    const prompt = buildPrompt(
      row({ flags: ["conflict", "ci-failing", "feedback", "no-reviewer"] }),
    );
    expect(prompt.match(/ {3}Use the `[a-z-]+` skill\./g)).toHaveLength(4);
  });

  it("still withholds the actions that cannot be undone", () => {
    const prompt = buildPrompt(row({ flags: ["merge-ready"] }));
    expect(prompt).toMatch(/force-pushing/i);
    expect(prompt).toMatch(/merging the PR/i);
  });
});
