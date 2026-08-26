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

  it("points the agent at the pr-sweep skill", () => {
    expect(buildPrompt(row({ flags: ["conflict"] }))).toContain("pr-sweep");
  });

  it("describes a merge conflict as a merge of the base branch", () => {
    const prompt = buildPrompt(row({ flags: ["conflict"] }));
    expect(prompt).toMatch(/conflict/i);
    expect(prompt).toMatch(/merge the base branch/i);
  });

  it("tells the agent to read the failing log before touching code", () => {
    expect(buildPrompt(row({ flags: ["ci-failing"] }))).toMatch(/read the failing log/i);
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
