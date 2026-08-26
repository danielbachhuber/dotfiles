import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt.js";
import { classifyOne } from "./classify.js";
import { NOW, daysAgo, makePr, reviewRequest, submittedReview } from "./fixtures.js";

const ME = "hubot";

function rowFor(overrides = {}) {
  const row = classifyOne(makePr(overrides), ME);
  if (!row) throw new Error("fixture did not classify");
  return row;
}

describe("buildPrompt", () => {
  it("forbids posting to GitHub without asking", () => {
    // Reviewing someone else's pull request is outward-facing: a wrong finding
    // lands publicly and cannot be quietly undone.
    const prompt = buildPrompt(rowFor(), NOW);
    expect(prompt).toMatch(/Do NOT post anything to GitHub/);
    expect(prompt).toMatch(/without asking me first/);
  });

  it("overrides a skill whose own last step posts a comment", () => {
    // The claude-plugins-official /code-review ends with `gh pr comment` and has
    // no flag to suppress it, and this plugin cannot control which code-review a
    // spawned thread resolves. The instruction has to name that case.
    expect(buildPrompt(rowFor(), NOW)).toMatch(/even if the skill .* ends with a step that posts/);
  });

  it("names the skill that owns the work", () => {
    expect(buildPrompt(rowFor(), NOW)).toContain("`code-review`");
  });

  it("identifies the pull request and its author", () => {
    const prompt = buildPrompt(rowFor(), NOW);
    expect(prompt).toContain("acme/widgets#1");
    expect(prompt).toContain("opened by octocat");
    expect(prompt).toContain("https://github.com/acme/widgets/pull/1");
  });

  it("states how long it has been waiting and how big it is", () => {
    const prompt = buildPrompt(
      rowFor({ timelineItems: { nodes: [reviewRequest({ login: ME }, daysAgo(6))] } }),
      NOW,
    );
    expect(prompt).toContain("6 day(s)");
    expect(prompt).toContain("+40 −6, 3 files");
  });

  it("scopes a re-review to what changed and to my earlier points", () => {
    const prompt = buildPrompt(
      rowFor({
        reviews: { nodes: [submittedReview("CHANGES_REQUESTED", ME, daysAgo(8))] },
        timelineItems: { nodes: [reviewRequest({ login: ME }, daysAgo(2))] },
      }),
      NOW,
    );
    expect(prompt).toMatch(/reviewed it before/);
    expect(prompt).toMatch(/which of my earlier points were addressed/);
  });

  it("asks a first look for an approve-or-not verdict instead", () => {
    const prompt = buildPrompt(rowFor(), NOW);
    expect(prompt).toMatch(/whether you would approve it/);
    expect(prompt).not.toMatch(/earlier points/);
  });

  it("keeps the review out of my own working copy", () => {
    expect(buildPrompt(rowFor(), NOW)).toMatch(/rather than checking the branch out/);
  });
});
