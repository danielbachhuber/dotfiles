import { describe, expect, it } from "vitest";
import {
  buildOpenPrompt,
  parsePullRequestInput,
  resolvePullRequest,
  worktreePath,
} from "./open-pr.js";
import type { GhRunner } from "@danielb/gh-shared/gh";

describe("parsePullRequestInput", () => {
  it("reads a bare number against the fallback repository", () => {
    expect(parsePullRequestInput("5801", "acme/widgets")).toEqual({
      repo: "acme/widgets",
      number: 5801,
    });
    expect(parsePullRequestInput("#5801", "acme/widgets")).toEqual({
      repo: "acme/widgets",
      number: 5801,
    });
  });

  it("takes the repository from a URL, over the fallback", () => {
    expect(
      parsePullRequestInput("https://github.com/acme/gadgets/pull/42", "acme/widgets"),
    ).toEqual({ repo: "acme/gadgets", number: 42 });
  });

  it("tolerates the trailing paths GitHub adds", () => {
    for (const suffix of ["/files", "#discussion_r1", "?w=1"]) {
      expect(
        parsePullRequestInput(`https://github.com/acme/gadgets/pull/42${suffix}`, ""),
      ).toEqual({ repo: "acme/gadgets", number: 42 });
    }
  });

  it("asks for a URL when a bare number has no repository to attach to", () => {
    expect(parsePullRequestInput("42", "")).toEqual({
      error: "Paste the pull request URL, or set a default repository.",
    });
  });

  it("rejects anything else rather than guessing", () => {
    expect(parsePullRequestInput("", "acme/widgets")).toHaveProperty("error");
    expect(parsePullRequestInput("not a pr", "acme/widgets")).toHaveProperty("error");
    // An issue URL is not a pull request URL.
    expect(
      parsePullRequestInput("https://github.com/acme/widgets/issues/42", "acme/widgets"),
    ).toHaveProperty("error");
  });
});

describe("worktreePath", () => {
  it("sits beside the checkout, named after the pull request", () => {
    expect(worktreePath("/Users/me/projects/widgets", 42)).toBe(
      "/Users/me/projects/widgets-pr-42",
    );
  });

  it("tolerates a trailing slash on the project path", () => {
    expect(worktreePath("/Users/me/projects/widgets/", 42)).toBe(
      "/Users/me/projects/widgets-pr-42",
    );
  });
});

describe("resolvePullRequest", () => {
  const gh = (payload: unknown): GhRunner => ({
    async run() {
      return JSON.stringify(payload);
    },
  });

  it("carries the branch, which is the whole point", async () => {
    const pr = await resolvePullRequest(
      gh({
        number: 42,
        title: "Add the widget endpoint",
        url: "https://github.com/acme/widgets/pull/42",
        headRefName: "feat/widgets",
        isDraft: false,
      }),
      "acme/widgets",
      42,
    );
    expect(pr).toMatchObject({ headRef: "feat/widgets", number: 42, repo: "acme/widgets" });
  });

  it("refuses a repository that could smuggle an argument", async () => {
    await expect(resolvePullRequest(gh({}), "--version", 1)).rejects.toThrow(/invalid repository/i);
  });
});

describe("buildOpenPrompt", () => {
  const pr = {
    repo: "acme/widgets",
    number: 42,
    title: "Add the widget endpoint",
    headRef: "feat/widgets",
    url: "https://github.com/acme/widgets/pull/42",
    isDraft: false,
  };

  it("says where the agent is and that it should stay there", () => {
    const prompt = buildOpenPrompt(pr, "");
    expect(prompt).toContain("`feat/widgets`");
    expect(prompt).toContain("acme/widgets#42");
    expect(prompt).toMatch(/Do not create another worktree/);
  });

  it("waits when given no instructions", () => {
    expect(buildOpenPrompt(pr, "  ")).toMatch(/Wait for my instructions/);
  });

  it("passes instructions through instead of waiting", () => {
    const prompt = buildOpenPrompt(pr, "Rebase the docs section.");
    expect(prompt).toContain("Rebase the docs section.");
    expect(prompt).not.toMatch(/Wait for my instructions/);
  });
});
