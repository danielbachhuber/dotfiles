import { describe, expect, it } from "vitest";
import {
  buildOpenPrompt,
  parsePullRequestInput,
  pushTargetForRepo,
  resolvePullRequest,
  worktreePath,
  worktreePlan,
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

  it("reports a fork's own repository, and that it is one", async () => {
    const pr = await resolvePullRequest(
      gh({
        number: 42,
        title: "Add the widget endpoint",
        url: "https://github.com/acme/widgets/pull/42",
        headRefName: "feat/widgets",
        isDraft: false,
        isCrossRepository: true,
        headRepository: { name: "widgets" },
        headRepositoryOwner: { login: "octocat" },
        maintainerCanModify: true,
      }),
      "acme/widgets",
      42,
    );
    expect(pr).toMatchObject({
      isFork: true,
      headRepo: "octocat/widgets",
      maintainerCanModify: true,
    });
  });

  it("has no head repository once the fork is deleted", async () => {
    const pr = await resolvePullRequest(
      gh({
        number: 42,
        title: "Add the widget endpoint",
        url: "https://github.com/acme/widgets/pull/42",
        headRefName: "feat/widgets",
        isDraft: false,
        isCrossRepository: true,
        headRepository: null,
        headRepositoryOwner: null,
        maintainerCanModify: false,
      }),
      "acme/widgets",
      42,
    );
    expect(pr).toMatchObject({ isFork: true, headRepo: null, maintainerCanModify: false });
  });

  it("names the base repository as the head of a same-repository pull request", async () => {
    const pr = await resolvePullRequest(
      gh({
        number: 42,
        title: "Add the widget endpoint",
        url: "https://github.com/acme/widgets/pull/42",
        headRefName: "feat/widgets",
        isDraft: false,
        isCrossRepository: false,
        headRepository: { name: "widgets" },
        headRepositoryOwner: { login: "acme" },
        maintainerCanModify: true,
      }),
      "acme/widgets",
      42,
    );
    expect(pr).toMatchObject({ isFork: false, headRepo: "acme/widgets" });
  });

  it("refuses a repository that could smuggle an argument", async () => {
    await expect(resolvePullRequest(gh({}), "--version", 1)).rejects.toThrow(/invalid repository/i);
  });
});

const basePr = {
  repo: "acme/widgets",
  number: 42,
  title: "Add the widget endpoint",
  headRef: "feat/widgets",
  url: "https://github.com/acme/widgets/pull/42",
  isDraft: false,
  headRepo: "acme/widgets",
  isFork: false,
  maintainerCanModify: true,
};

describe("pushTargetForRepo", () => {
  const remotes = [
    { name: "origin", url: "git@github.com:acme/widgets.git" },
    { name: "octocat", url: "git@github.com:octocat/widgets.git" },
  ];

  it("prefers a remote already pointing at the fork", () => {
    expect(pushTargetForRepo(remotes, "octocat/widgets")).toBe("octocat");
    expect(pushTargetForRepo(remotes, "OctoCat/Widgets")).toBe("octocat");
  });

  it("falls back to the fork's URL when no remote has it", () => {
    expect(pushTargetForRepo(remotes, "hubber/widgets")).toBe(
      "https://github.com/hubber/widgets.git",
    );
  });

  it("has nowhere to push when the fork is gone", () => {
    expect(pushTargetForRepo(remotes, null)).toBeNull();
  });
});

describe("worktreePlan", () => {
  it("fetches a same-repository branch from origin by name", () => {
    expect(worktreePlan(basePr, [])).toEqual({ kind: "origin", branch: "feat/widgets" });
  });

  it("fetches a fork's branch from refs/pull, and keeps the branch name", () => {
    expect(
      worktreePlan(
        { ...basePr, isFork: true, headRepo: "octocat/widgets" },
        [{ name: "octocat", url: "git@github.com:octocat/widgets.git" }],
      ),
    ).toEqual({
      kind: "fork",
      branch: "feat/widgets",
      prRef: "refs/pull/42/head",
      pushTo: "octocat",
      repo: "acme/widgets",
      number: 42,
    });
  });
});

describe("buildOpenPrompt", () => {
  const pr = basePr;

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

  it("says a fork's push still reaches the pull request", () => {
    const prompt = buildOpenPrompt(
      { ...pr, isFork: true, headRepo: "octocat/widgets" },
      "",
    );
    expect(prompt).toContain("`octocat/widgets`");
    expect(prompt).toMatch(/git push` still updates the pull request/);
  });

  it("says when a fork's author has not allowed edits", () => {
    const prompt = buildOpenPrompt(
      { ...pr, isFork: true, headRepo: "octocat/widgets", maintainerCanModify: false },
      "",
    );
    expect(prompt).toMatch(/a push will be rejected/);
  });

  it("says when the fork is gone", () => {
    const prompt = buildOpenPrompt(
      { ...pr, isFork: true, headRepo: null, maintainerCanModify: false },
      "",
    );
    expect(prompt).toMatch(/nowhere to push/);
  });

  it("says nothing about forks for a same-repository pull request", () => {
    expect(buildOpenPrompt(pr, "")).not.toMatch(/fork/i);
  });
});
