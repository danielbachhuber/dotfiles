import { describe, expect, it } from "vitest";
import { isAdoptable, pullRequestReferences, solePullRequestReference } from "./adopt.js";

const PROMPT =
  "https://github.com/acme/widgets/pull/5879\n\n" +
  "Have a look at the review feedback on this and work through it.";

describe("pullRequestReferences", () => {
  it("finds the pull request a hand-written prompt opens with", () => {
    expect(pullRequestReferences(PROMPT)).toEqual([{ repo: "acme/widgets", number: 5879 }]);
  });

  it("ignores an issue URL, which belongs to the other sweep", () => {
    // One number sequence per repository covers both, so the path is the only
    // thing that says which kind of thing a link means.
    expect(pullRequestReferences("https://github.com/acme/widgets/issues/5837")).toEqual([]);
  });

  it("reads a link to a diff, a review comment, or one carrying a query", () => {
    expect(pullRequestReferences("https://github.com/acme/widgets/pull/12/files")).toEqual([
      { repo: "acme/widgets", number: 12 },
    ]);
    expect(
      pullRequestReferences("https://github.com/acme/widgets/pull/12#discussion_r99"),
    ).toEqual([{ repo: "acme/widgets", number: 12 }]);
    expect(pullRequestReferences("https://www.github.com/acme/widgets/pull/12?x=1")).toEqual([
      { repo: "acme/widgets", number: 12 },
    ]);
  });

  it("never reads a number out of prose", () => {
    expect(pullRequestReferences("Work on PR 5879")).toEqual([]);
    expect(pullRequestReferences("Fix #5879")).toEqual([]);
    expect(pullRequestReferences("acme/widgets#5879")).toEqual([]);
  });

  it("lowercases the repository, the way GitHub compares it", () => {
    expect(pullRequestReferences("https://github.com/Acme/Widgets/pull/12")).toEqual([
      { repo: "acme/widgets", number: 12 },
    ]);
  });

  it("counts one pull request once, however often it is linked", () => {
    const text =
      "https://github.com/acme/widgets/pull/12 then " +
      "https://github.com/acme/widgets/pull/12/files";
    expect(pullRequestReferences(text)).toEqual([{ repo: "acme/widgets", number: 12 }]);
  });

  it("skips a number too large to compare exactly against a row", () => {
    expect(pullRequestReferences("https://github.com/acme/widgets/pull/99999999999999999999")).toEqual(
      [],
    );
  });
});

describe("solePullRequestReference", () => {
  it("answers when the prompt is about exactly one pull request", () => {
    expect(solePullRequestReference(PROMPT)).toEqual({ repo: "acme/widgets", number: 5879 });
  });

  it("declines a prompt that links nothing", () => {
    expect(solePullRequestReference("Look at the failing build")).toBeNull();
  });

  it("declines the prompt that had both sweeps claiming one thread", () => {
    // Live: "Work on <issue 5934> as a stacked PR on top of <pull 5937>".
    // issue-sweep saw one issue, pr-sweep saw one pull request, and both
    // renamed and linked the same thread. Whichever swept last owned the
    // title.
    const text =
      "Work on https://github.com/acme/widgets/issues/5934 as a stacked PR " +
      "on top of https://github.com/acme/widgets/pull/5937";
    expect(solePullRequestReference(text)).toBeNull();
  });

  it("declines a prompt naming an issue and its own pull request", () => {
    const text =
      "https://github.com/acme/widgets/issues/12 is fixed by " +
      "https://github.com/acme/widgets/pull/13";
    expect(solePullRequestReference(text)).toBeNull();
  });

  it("declines a prompt about two pull requests rather than picking one", () => {
    const text =
      "rebase https://github.com/acme/widgets/pull/12 onto " +
      "https://github.com/acme/widgets/pull/9";
    expect(solePullRequestReference(text)).toBeNull();
  });
});

describe("isAdoptable", () => {
  it("takes a thread typed into the composer", () => {
    expect(isAdoptable({ id: "thr_1", originPluginId: null, archivedAt: null })).toBe(true);
  });

  it("leaves a thread any plugin started to that plugin", () => {
    expect(isAdoptable({ id: "thr_1", originPluginId: "pr-sweep", archivedAt: null })).toBe(false);
    expect(isAdoptable({ id: "thr_1", originPluginId: "issue-sweep", archivedAt: null })).toBe(
      false,
    );
  });

  it("leaves an archived thread alone, since its work is over", () => {
    expect(isAdoptable({ id: "thr_1", originPluginId: null, archivedAt: 1 })).toBe(false);
  });
});
