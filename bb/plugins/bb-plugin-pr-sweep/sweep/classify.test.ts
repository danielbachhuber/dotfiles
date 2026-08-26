import { describe, expect, it } from "vitest";
import { classify, classifyOne, isBotLogin, summarizeChecks } from "./classify.js";
import { checkRun, makePr, review, statusContext, teamRequest, userRequest } from "./fixtures.js";

describe("summarizeChecks", () => {
  it("counts SKIPPED as skipped, never as a failure", () => {
    const summary = summarizeChecks([
      checkRun("a", "COMPLETED", "SUCCESS"),
      checkRun("b", "COMPLETED", "SKIPPED"),
      checkRun("c", "COMPLETED", "SKIPPED"),
    ]);
    expect(summary).toMatchObject({ pass: 1, skip: 2, fail: 0, total: 3 });
  });

  it("counts NEUTRAL as skipped, never as a failure", () => {
    expect(summarizeChecks([checkRun("a", "COMPLETED", "NEUTRAL")])).toMatchObject({
      skip: 1,
      fail: 0,
    });
  });

  it("reads StatusContext entries via .state, not .conclusion", () => {
    const summary = summarizeChecks([
      statusContext("legacy-pass", "SUCCESS"),
      statusContext("legacy-fail", "FAILURE"),
      statusContext("legacy-run", "PENDING"),
    ]);
    expect(summary).toMatchObject({ pass: 1, fail: 1, pending: 1, total: 3 });
  });

  it("counts an IN_PROGRESS run with a null conclusion as pending", () => {
    expect(summarizeChecks([checkRun("a", "IN_PROGRESS", null)])).toMatchObject({
      pending: 1,
      pass: 0,
      fail: 0,
    });
  });

  it("counts CANCELLED separately from FAILURE", () => {
    expect(summarizeChecks([checkRun("a", "COMPLETED", "CANCELLED")])).toMatchObject({
      cancelled: 1,
      fail: 0,
    });
  });

  it("treats a null or empty rollup as zero checks", () => {
    expect(summarizeChecks(null)).toMatchObject({ total: 0 });
    expect(summarizeChecks([])).toMatchObject({ total: 0 });
  });
});

describe("classifyOne reviewer state", () => {
  it("does not flag no-reviewer when a team is requested", () => {
    // Team entries carry name+slug and no .login. Reading .login here would
    // make a PR with a whole team assigned look reviewer-less.
    const row = classifyOne(makePr({ reviewRequests: [teamRequest("reviewers")] }), "acme/widgets");
    expect(row.flags).not.toContain("no-reviewer");
    expect(row.waitingOn).toEqual(["reviewers"]);
  });

  it("does not flag no-reviewer once a requested reviewer has submitted", () => {
    const row = classifyOne(
      makePr({ reviewRequests: [], latestReviews: [review("APPROVED", "hubber")] }),
      "acme/widgets",
    );
    expect(row.flags).not.toContain("no-reviewer");
  });

  it("flags no-reviewer on a non-draft with no requests and no reviews", () => {
    const row = classifyOne(makePr({ reviewRequests: [], latestReviews: [] }), "acme/widgets");
    expect(row.flags).toContain("no-reviewer");
  });

  it("exempts drafts from no-reviewer", () => {
    const row = classifyOne(
      makePr({ isDraft: true, reviewRequests: [], latestReviews: [] }),
      "acme/widgets",
    );
    expect(row.flags).not.toContain("no-reviewer");
  });

  it("flags feedback for a live COMMENTED review, including on a draft", () => {
    const row = classifyOne(
      makePr({ isDraft: true, latestReviews: [review("COMMENTED", "hubber")] }),
      "acme/widgets",
    );
    expect(row.flags).toContain("feedback");
  });

  it("does not flag a re-requested reviewer as work", () => {
    // reviewDecision stays CHANGES_REQUESTED after the author answers and
    // re-requests; GitHub drops the reviewer from latestReviews. The ball is
    // in the reviewer's court, so this is not the author's action.
    const row = classifyOne(
      makePr({
        reviewDecision: "CHANGES_REQUESTED",
        latestReviews: [],
        reviewRequests: [userRequest("hubber")],
      }),
      "acme/widgets",
    );
    expect(row.flags).not.toContain("feedback");
    expect(row.awaitingReReview).toBe(true);
    expect(row.group).toBe("clean");
  });

  it("drops the author's own replies and deduplicates commenters", () => {
    const row = classifyOne(
      makePr({
        author: { login: "octocat" },
        reviews: [
          review("COMMENTED", "octocat"),
          review("COMMENTED", "octocat"),
          review("COMMENTED", "hubber"),
          review("COMMENTED", "hubber"),
        ],
      }),
      "acme/widgets",
    );
    expect(row.commentedBy).toEqual(["hubber"]);
  });
});

describe("classifyOne merge readiness", () => {
  const approved = {
    latestReviews: [review("APPROVED", "hubber")],
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
  };

  it("flags merge-ready when approved, green, and clean", () => {
    const row = classifyOne(makePr(approved), "acme/widgets");
    expect(row.flags).toContain("merge-ready");
    expect(row.group).toBe("ready-to-merge");
    expect(row.approvedBy).toEqual(["hubber"]);
  });

  it("stays merge-ready with skipped checks in the rollup", () => {
    const row = classifyOne(
      makePr({
        ...approved,
        statusCheckRollup: [
          checkRun("a", "COMPLETED", "SUCCESS"),
          checkRun("b", "COMPLETED", "SKIPPED"),
        ],
      }),
      "acme/widgets",
    );
    expect(row.flags).toContain("merge-ready");
  });

  it("stays merge-ready while a reviewer is still outstanding, and names them", () => {
    // One approval clears the technical bar. Whether it clears the social one
    // is the user's call, so the row surfaces who is waiting rather than
    // demoting the PR.
    const row = classifyOne(
      makePr({ ...approved, reviewRequests: [teamRequest("reviewers")] }),
      "acme/widgets",
    );
    expect(row.flags).toContain("merge-ready");
    expect(row.waitingOn).toEqual(["reviewers"]);
  });

  it("reads the approval from latestReviews even when reviewDecision hides it", () => {
    // Branch protection holds reviewDecision at REVIEW_REQUIRED while an
    // approval already stands.
    const row = classifyOne(
      makePr({ ...approved, reviewDecision: "REVIEW_REQUIRED" }),
      "acme/widgets",
    );
    expect(row.flags).toContain("merge-ready");
  });

  it("flags merge-blocked instead of merge-ready when GitHub says BLOCKED", () => {
    const row = classifyOne(makePr({ ...approved, mergeStateStatus: "BLOCKED" }), "acme/widgets");
    expect(row.flags).toContain("merge-blocked");
    expect(row.flags).not.toContain("merge-ready");
    expect(row.group).toBe("needs-action");
  });

  it("is not merge-ready with an empty rollup", () => {
    const row = classifyOne(makePr({ ...approved, statusCheckRollup: [] }), "acme/widgets");
    expect(row.flags).not.toContain("merge-ready");
    expect(row.flags).toContain("ci-absent");
  });

  it("is not merge-ready when a live COMMENTED review outranks the approval", () => {
    const row = classifyOne(
      makePr({
        ...approved,
        latestReviews: [review("APPROVED", "hubber"), review("COMMENTED", "mona")],
      }),
      "acme/widgets",
    );
    expect(row.flags).not.toContain("merge-ready");
    expect(row.flags).toContain("feedback");
    expect(row.group).toBe("needs-action");
  });

  it("is not merge-ready on a draft", () => {
    const row = classifyOne(makePr({ ...approved, isDraft: true }), "acme/widgets");
    expect(row.flags).not.toContain("merge-ready");
  });

  it("reports UNKNOWN mergeability as unknown, never as clean", () => {
    const row = classifyOne(makePr({ ...approved, mergeable: "UNKNOWN" }), "acme/widgets");
    expect(row.flags).toContain("mergeable-unknown");
    expect(row.flags).not.toContain("merge-ready");
  });

  it("does not treat BLOCKED alone as a conflict", () => {
    // BLOCKED means review required and is the resting state of most open PRs.
    const row = classifyOne(makePr({ mergeStateStatus: "BLOCKED" }), "acme/widgets");
    expect(row.flags).not.toContain("conflict");
  });
});

describe("classify", () => {
  it("orders rows worst-flag first, then by number", () => {
    const rows = classify(
      [
        makePr({ number: 3 }),
        makePr({ number: 1, mergeable: "CONFLICTING" }),
        makePr({ number: 2, statusCheckRollup: [checkRun("a", "COMPLETED", "FAILURE")] }),
      ],
      "acme/widgets",
    );
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
  });

  it("stamps the repo on every row", () => {
    expect(classify([makePr()], "acme/widgets")[0]!.repo).toBe("acme/widgets");
  });
});

describe("lastCommentBy", () => {
  const comment = (login: string, createdAt: string) => ({
    author: { login },
    createdAt,
  });

  it("names whoever spoke last when it was not the author", () => {
    // #5783's shape: approved, no review threads, and a general comment from
    // the reviewer pointing at work still to do.
    const row = classifyOne(
      makePr({
        author: { login: "octocat" },
        comments: [
          comment("octocat", "2026-01-01T00:00:00Z"),
          comment("hubber", "2026-01-02T00:00:00Z"),
        ],
      }),
      "acme/widgets",
    );
    expect(row.lastCommentBy).toBe("hubber");
  });

  it("says nothing when the author had the last word", () => {
    const row = classifyOne(
      makePr({
        author: { login: "octocat" },
        comments: [
          comment("hubber", "2026-01-01T00:00:00Z"),
          comment("octocat", "2026-01-02T00:00:00Z"),
        ],
      }),
      "acme/widgets",
    );
    expect(row.lastCommentBy).toBeNull();
  });

  it("reads order from the timestamp, not the array", () => {
    const row = classifyOne(
      makePr({
        author: { login: "octocat" },
        comments: [
          comment("hubber", "2026-01-05T00:00:00Z"),
          comment("octocat", "2026-01-02T00:00:00Z"),
        ],
      }),
      "acme/widgets",
    );
    expect(row.lastCommentBy).toBe("hubber");
  });

  it("says nothing for a pull request with no comments", () => {
    expect(classifyOne(makePr(), "acme/widgets").lastCommentBy).toBeNull();
  });
});

describe("bot comments", () => {
  const comment = (login: string, createdAt: string) => ({ author: { login }, createdAt });

  it("ignores CI chatter, which is not a question awaiting a reply", () => {
    const row = classifyOne(
      makePr({
        author: { login: "octocat" },
        comments: [
          comment("hubber", "2026-01-01T00:00:00Z"),
          comment("github-actions", "2026-01-05T00:00:00Z"),
        ],
      }),
      "acme/widgets",
    );
    expect(row.lastCommentBy).toBe("hubber");
  });

  it("recognises a GitHub App by its [bot] suffix", () => {
    expect(isBotLogin("some-app[bot]")).toBe(true);
    expect(isBotLogin("dependabot")).toBe(true);
    expect(isBotLogin("Github-Actions")).toBe(true);
    expect(isBotLogin("robennals")).toBe(false);
  });

  it("says nothing when only bots have commented", () => {
    const row = classifyOne(
      makePr({
        author: { login: "octocat" },
        comments: [comment("github-actions", "2026-01-05T00:00:00Z")],
      }),
      "acme/widgets",
    );
    expect(row.lastCommentBy).toBeNull();
  });
});
