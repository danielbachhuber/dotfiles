import { describe, expect, it } from "vitest";
import { isAdoptable, issueReferences, soleIssueReference } from "./adopt.js";

/** The prompt from the thread that prompted this feature, shape-for-shape. */
const REAL_PROMPT =
  "https://github.com/acme/widgets/issues/5837\n\n" +
  "Work on this. The screens, we can reconfigure so that they only appear on " +
  "those silos based off of a code switch.";

describe("issueReferences", () => {
  it("finds the issue a real hand-written prompt opens with", () => {
    expect(issueReferences(REAL_PROMPT)).toEqual([{ repo: "acme/widgets", number: 5837 }]);
  });

  it("ignores a pull request URL, which belongs to the other sweep", () => {
    // GitHub numbers issues and pull requests in one sequence per repository,
    // so the path is the only thing that says which one a link means.
    expect(issueReferences("https://github.com/acme/widgets/pull/5879")).toEqual([]);
  });

  it("reads a link with a fragment or query on it", () => {
    expect(
      issueReferences("https://github.com/acme/widgets/issues/12#issuecomment-99"),
    ).toEqual([{ repo: "acme/widgets", number: 12 }]);
    expect(
      issueReferences("https://www.github.com/acme/widgets/issues/12?referrer=x"),
    ).toEqual([{ repo: "acme/widgets", number: 12 }]);
  });

  it("never reads a number out of prose", () => {
    expect(issueReferences("Work on issue 5837")).toEqual([]);
    expect(issueReferences("Fix #5837")).toEqual([]);
    expect(issueReferences("acme/widgets#5837")).toEqual([]);
  });

  it("lowercases the repository, the way GitHub compares it", () => {
    expect(issueReferences("https://github.com/Acme/Widgets/issues/12")).toEqual([
      { repo: "acme/widgets", number: 12 },
    ]);
  });

  it("counts one issue once, however often it is linked", () => {
    const text =
      "https://github.com/acme/widgets/issues/12 and again " +
      "https://github.com/acme/widgets/issues/12";
    expect(issueReferences(text)).toEqual([{ repo: "acme/widgets", number: 12 }]);
  });

  it("keeps two different issues apart, and in the order they appear", () => {
    const text =
      "fold https://github.com/acme/widgets/issues/12 into " +
      "https://github.com/acme/widgets/issues/9";
    expect(issueReferences(text)).toEqual([
      { repo: "acme/widgets", number: 12 },
      { repo: "acme/widgets", number: 9 },
    ]);
  });

  it("skips a number too large to compare exactly against a row", () => {
    expect(issueReferences("https://github.com/acme/widgets/issues/99999999999999999999")).toEqual(
      [],
    );
  });
});

describe("soleIssueReference", () => {
  it("answers when the prompt is about exactly one issue", () => {
    expect(soleIssueReference(REAL_PROMPT)).toEqual({ repo: "acme/widgets", number: 5837 });
  });

  it("declines a prompt that links nothing", () => {
    expect(soleIssueReference("Work on the widget rotation bug")).toBeNull();
  });

  it("declines the prompt that had both sweeps claiming one thread", () => {
    // Live: "Work on <issue 5934> as a stacked PR on top of <pull 5937>".
    // issue-sweep saw one issue, pr-sweep saw one pull request, and both
    // renamed and linked the same thread. Whichever swept last owned the
    // title.
    const text =
      "Work on https://github.com/acme/widgets/issues/5934 as a stacked PR " +
      "on top of https://github.com/acme/widgets/pull/5937";
    expect(soleIssueReference(text)).toBeNull();
  });

  it("declines a prompt naming an issue and its own pull request", () => {
    const text =
      "https://github.com/acme/widgets/issues/12 is fixed by " +
      "https://github.com/acme/widgets/pull/13";
    expect(soleIssueReference(text)).toBeNull();
  });

  it("declines a prompt about two issues rather than picking one", () => {
    // "Fold A into B" is one thread doing half of each. Attaching it to either
    // would tell the panel that the other is unstarted work when it is not.
    const text =
      "fold https://github.com/acme/widgets/issues/12 into " +
      "https://github.com/acme/widgets/issues/9";
    expect(soleIssueReference(text)).toBeNull();
  });
});

describe("isAdoptable", () => {
  it("takes a thread typed into the composer", () => {
    expect(isAdoptable({ id: "thr_1", originPluginId: null, archivedAt: null })).toBe(true);
  });

  it("leaves a thread another plugin started to that plugin", () => {
    expect(isAdoptable({ id: "thr_1", originPluginId: "pr-sweep", archivedAt: null })).toBe(false);
    expect(isAdoptable({ id: "thr_1", originPluginId: "issue-sweep", archivedAt: null })).toBe(
      false,
    );
  });

  it("leaves an archived thread alone, since its work is over", () => {
    expect(isAdoptable({ id: "thr_1", originPluginId: null, archivedAt: 1 })).toBe(false);
  });
});
