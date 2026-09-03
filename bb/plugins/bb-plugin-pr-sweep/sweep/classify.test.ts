import { failingChecks, latestChecks, reviewNoteDetails, reviewNotes } from "./classify.js";
import { describe, expect, it } from "vitest";
import { classify, classifyOne, isBotLogin, repoRunsChecks, summarizeChecks } from "./classify.js";
import { checkRun, makePr, review, statusContext, teamRequest, userRequest } from "./fixtures.js";
import type { RawPullRequest } from "./types.js";

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

  it("is not merge-blocked while a re-requested review is outstanding", () => {
    // An approval from an earlier round still stands in latestReviews after
    // the author answers the changes and re-requests review. GitHub holds
    // mergeStateStatus at BLOCKED for the review it is still waiting on, so
    // the row read "merge blocked · Unblock merge" on a pull request whose
    // next move belongs to the reviewers.
    const row = classifyOne(
      makePr({
        latestReviews: [review("APPROVED", "hubber")],
        reviewDecision: "CHANGES_REQUESTED",
        mergeStateStatus: "BLOCKED",
        reviewRequests: [userRequest("octocat")],
      }),
      "acme/widgets",
    );
    expect(row.awaitingReReview).toBe(true);
    expect(row.flags).not.toContain("merge-blocked");
    expect(row.flags).not.toContain("merge-ready");
    expect(row.group).toBe("clean");
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
    expect(isBotLogin("hubber")).toBe(false);
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

describe("a repository where CI does not run on pull requests", () => {
  it("does not flag a missing rollup as a fault", () => {
    // psi-deploy's shape: workflows exist but none trigger on pull requests,
    // so every row read "no CI" forever with nothing to fix.
    const reviewed = { reviewRequests: [userRequest("hubber")] };
    const rows = classify(
      [makePr({ number: 1, statusCheckRollup: [], ...reviewed })],
      "acme/deploy",
    );
    expect(rows[0]!.flags).not.toContain("ci-absent");
    expect(rows[0]!.flags).toEqual([]);
  });

  it("still flags a pull request that skipped CI where others ran it", () => {
    const rows = classify(
      [
        makePr({ number: 1, statusCheckRollup: [], reviewRequests: [userRequest("hubber")] }),
        makePr({
          number: 2,
          statusCheckRollup: [checkRun("build", "COMPLETED", "SUCCESS")],
          reviewRequests: [userRequest("hubber")],
        }),
      ],
      "acme/widgets",
    );
    expect(rows.find((row) => row.number === 1)!.flags).toContain("ci-absent");
    expect(rows.find((row) => row.number === 2)!.flags).toEqual([]);
  });

  it("reads the repository from every pull request, not just the first", () => {
    expect(repoRunsChecks([makePr({ statusCheckRollup: [] })])).toBe(false);
    expect(
      repoRunsChecks([
        makePr({ statusCheckRollup: [] }),
        makePr({ statusCheckRollup: [checkRun("a", "COMPLETED", "SUCCESS")] }),
      ]),
    ).toBe(true);
  });
});

describe("latestChecks", () => {
  const run = (name: string, conclusion: string, startedAt: string | null) => ({
    __typename: "CheckRun",
    name,
    status: "COMPLETED",
    conclusion,
    startedAt,
  });

  it("keeps only the latest run of a re-run check", () => {
    // The exact shape that made #5850 read "1 fail" while it was green: a
    // check failed, was re-run twenty seconds later, and GitHub returned both.
    const rollup = [
      run("Validate PR title", "FAILURE", "2026-08-28T12:38:14Z"),
      run("Validate PR title", "SUCCESS", "2026-08-28T12:38:34Z"),
    ];
    expect(latestChecks(rollup)).toEqual([rollup[1]]);
    expect(summarizeChecks(rollup)).toMatchObject({ pass: 1, fail: 0, total: 1 });
  });

  it("does not care which order the rollup returns them in", () => {
    const later = run("Build", "SUCCESS", "2026-08-28T12:38:34Z");
    const earlier = run("Build", "FAILURE", "2026-08-28T12:38:14Z");
    expect(latestChecks([later, earlier])).toEqual([later]);
    expect(latestChecks([earlier, later])).toEqual([later]);
  });

  it("collapses a repeat that passed both times, so the count is not doubled", () => {
    const rollup = [
      run("Identify changed files", "SUCCESS", "2026-08-28T12:38:14Z"),
      run("Identify changed files", "SUCCESS", "2026-08-28T12:38:14Z"),
    ];
    expect(summarizeChecks(rollup)).toMatchObject({ pass: 1, total: 1 });
  });

  it("keeps checks with different names apart", () => {
    const rollup = [
      run("Lint", "FAILURE", "2026-08-28T12:38:14Z"),
      run("Test", "SUCCESS", "2026-08-28T12:38:14Z"),
    ];
    expect(latestChecks(rollup)).toHaveLength(2);
    expect(summarizeChecks(rollup)).toMatchObject({ pass: 1, fail: 1, total: 2 });
  });

  it("identifies a StatusContext by its context, since it has no name", () => {
    const rollup = [
      { __typename: "StatusContext", context: "ci/circleci", state: "FAILURE" },
      { __typename: "StatusContext", context: "ci/circleci", state: "SUCCESS" },
    ];
    expect(latestChecks(rollup)).toHaveLength(1);
  });

  it("prefers a dated run over an undated one", () => {
    const dated = run("Build", "SUCCESS", "2026-08-28T12:38:34Z");
    const undated = run("Build", "FAILURE", null);
    expect(latestChecks([undated, dated])).toEqual([dated]);
    expect(latestChecks([dated, undated])).toEqual([dated]);
  });

  it("keeps every nameless entry rather than collapsing them together", () => {
    // Two anonymous entries are two checks, not one seen twice. Collapsing
    // them would hide a failure behind an unrelated success.
    const rollup = [
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
    ];
    expect(latestChecks(rollup)).toHaveLength(2);
    expect(summarizeChecks(rollup)).toMatchObject({ pass: 1, fail: 1, total: 2 });
  });

  it("leaves a rollup with no repeats untouched", () => {
    expect(latestChecks([])).toEqual([]);
    expect(latestChecks(null)).toEqual([]);
  });
});

describe("reviewNotes", () => {
  // The full review history, not just the latest per reviewer: a body that a
  // later empty review would hide is exactly what this has to keep.
  const pr = (reviews: unknown[], authorLogin = "octocat") =>
    ({ author: { login: authorLogin }, reviews, latestReviews: reviews }) as never;

  it("reports an approval that came with prose", () => {
    // #5840: APPROVED, no unresolved thread, no issue comment, and 3,495
    // characters of caveats in the review body. Every other signal on the row
    // read as unqualified agreement.
    expect(
      reviewNotes(pr([{ state: "APPROVED", author: { login: "hubber" }, body: "One thing…" }])),
    ).toEqual(["hubber"]);
  });

  it("ignores an approval with nothing written on it", () => {
    expect(reviewNotes(pr([{ state: "APPROVED", author: { login: "hubber" }, body: "" }]))).toEqual(
      [],
    );
    expect(
      reviewNotes(pr([{ state: "APPROVED", author: { login: "hubber" }, body: "   " }])),
    ).toEqual([]);
    expect(reviewNotes(pr([{ state: "APPROVED", author: { login: "hubber" } }]))).toEqual([]);
  });

  it("counts a body on any review state, not just an approval", () => {
    expect(
      reviewNotes(pr([{ state: "COMMENTED", author: { login: "mona" }, body: "hmm" }])),
    ).toEqual(["mona"]);
  });

  it("ignores the pull request author talking about their own work", () => {
    expect(
      reviewNotes(pr([{ state: "COMMENTED", author: { login: "octocat" }, body: "context" }])),
    ).toEqual([]);
  });

  it("names each reviewer once", () => {
    const notes = reviewNotes(
      pr([
        { state: "APPROVED", author: { login: "hubber" }, body: "a" },
        { state: "COMMENTED", author: { login: "hubber" }, body: "b" },
      ]),
    );
    expect(notes).toEqual(["hubber"]);
  });

  it("lets a clean approval retire the round it answered", () => {
    // An earlier round's notes were dealt with by the round that superseded
    // them; re-raising them would make the flag permanent.
    // `reviews` is the whole history, so it carries both rounds. An empty
    // approval is a sign-off and clears what the reviewer said before it; an
    // empty COMMENTED review, as on #5886, resolves nothing and clears
    // nothing.
    const raw = {
      author: { login: "octocat" },
      reviews: [
        { state: "CHANGES_REQUESTED", author: { login: "hubber" }, body: "fix this" },
        { state: "APPROVED", author: { login: "hubber" }, body: "" },
      ],
      latestReviews: [{ state: "APPROVED", author: { login: "hubber" }, body: "" }],
    } as never;
    expect(reviewNotes(raw)).toEqual([]);
  });
});

describe("failingChecks", () => {
  it("names the checks that failed, so a flaky visual test reads differently from a type error", () => {
    // "1 fail of 15" is the same sentence whatever broke. The name is the
    // difference between re-running it and opening the code.
    expect(
      failingChecks([
        { name: "Run Storybook tests and visual regression", conclusion: "FAILURE" },
        { name: "typecheck", conclusion: "SUCCESS" },
      ]),
    ).toEqual(["Run Storybook tests and visual regression"]);
  });

  it("names a StatusContext, which puts its name in context rather than name", () => {
    expect(failingChecks([{ context: "ci/circleci", state: "FAILURE" }])).toEqual(["ci/circleci"]);
  });

  it("reports a re-run check by its latest attempt only", () => {
    // A re-run does not replace its predecessor in the rollup: GitHub returns
    // both, and counting the older one had a green pull request reading as
    // failing.
    expect(
      failingChecks([
        { name: "e2e", conclusion: "FAILURE", startedAt: "2026-09-01T10:00:00Z" },
        { name: "e2e", conclusion: "SUCCESS", startedAt: "2026-09-01T11:00:00Z" },
      ]),
    ).toEqual([]);
  });

  it("says nothing when the rollup is empty or everything passed", () => {
    expect(failingChecks(null)).toEqual([]);
    expect(failingChecks([{ name: "typecheck", conclusion: "SUCCESS" }])).toEqual([]);
  });
});

describe("reviewNoteDetails", () => {
  const pr = (overrides: Partial<RawPullRequest>) =>
    ({
      // `reviews` mirrors `latestReviews` unless a case sets both: the full
      // history is what this reads, and most cases have only one round.
      reviews: overrides.reviews ?? overrides.latestReviews ?? [],
      number: 1,
      title: "t",
      url: "u",
      author: { login: "octocat" },
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewRequests: [],
      latestReviews: [],
      reviewDecision: null,
      statusCheckRollup: [],
      ...overrides,
    }) as RawPullRequest;

  it("carries what the reviewer actually wrote, not just that they wrote something", () => {
    // The row said "hubber wrote notes on their review", which is true of a
    // typo nit and of a blocking objection alike.
    expect(
      reviewNoteDetails(
        pr({
          latestReviews: [
            {
              state: "APPROVED",
              author: { login: "hubber" },
              body: "A few minor comments.\n\nThe biggest is that there is now no way to turn it on.",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        author: "hubber",
        approved: true,
        body: "A few minor comments. The biggest is that there is now no way to turn it on.",
      },
    ]);
  });

  it("flattens the body to one line and lets the panel decide where to clip", () => {
    // Not truncated here: the first line of this body is "A few minor
    // comments", the least useful sentence in it. Flattening and clamping in
    // CSS keeps the sentence that matters visible.
    const notes = reviewNoteDetails(
      pr({
        latestReviews: [
          { state: "COMMENTED", author: { login: "hubber" }, body: "one\n\n  two   three\n" },
        ],
      }),
    );
    expect(notes[0]!.body).toBe("one two three");
  });

  it("marks an approval, since a note on one reads differently from a rejection", () => {
    const notes = reviewNoteDetails(
      pr({
        latestReviews: [
          { state: "CHANGES_REQUESTED", author: { login: "hubber" }, body: "no" },
          { state: "APPROVED", author: { login: "acmebot" }, body: "yes" },
        ],
      }),
    );
    expect(notes.map((note) => [note.author, note.approved])).toEqual([
      ["hubber", false],
      ["acmebot", true],
    ]);
  });

  it("ignores an empty body and the author's own review", () => {
    expect(
      reviewNoteDetails(
        pr({
          latestReviews: [
            { state: "APPROVED", author: { login: "hubber" }, body: "   " },
            { state: "COMMENTED", author: { login: "octocat" }, body: "my own note" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("keeps a body a later empty review would have hidden", () => {
    // Live on #5886: a reviewer approved with 189 characters of caveats, then
    // left a second, empty COMMENTED review. `latestReviews` returns only the
    // last review per reviewer, so the substance vanished — from this and from
    // `notedBy`, which had the same bug.
    const subject = pr({
      reviews: [
        { state: "APPROVED", author: { login: "hubber" }, body: "The biggest is that it cannot be enabled." },
        { state: "COMMENTED", author: { login: "hubber" }, body: "" },
      ],
      latestReviews: [{ state: "COMMENTED", author: { login: "hubber" }, body: "" }],
    });
    expect(reviewNoteDetails(subject)).toEqual([
      { author: "hubber", approved: true, body: "The biggest is that it cannot be enabled." },
    ]);
    expect(reviewNotes(subject)).toEqual(["hubber"]);
  });

  it("takes the most recent body when a reviewer wrote more than one", () => {
    const subject = pr({
      reviews: [
        { state: "COMMENTED", author: { login: "hubber" }, body: "first pass" },
        { state: "CHANGES_REQUESTED", author: { login: "hubber" }, body: "second pass" },
      ],
      latestReviews: [{ state: "CHANGES_REQUESTED", author: { login: "hubber" }, body: "second pass" }],
    });
    expect(reviewNoteDetails(subject)).toEqual([
      { author: "hubber", approved: false, body: "second pass" },
    ]);
  });

  it("agrees with notedBy, which names the same reviewers", () => {
    const subject = pr({
      latestReviews: [
        { state: "APPROVED", author: { login: "hubber" }, body: "caveats" },
        { state: "APPROVED", author: { login: "acmebot" }, body: "" },
      ],
    });
    expect(reviewNoteDetails(subject).map((note) => note.author)).toEqual(reviewNotes(subject));
  });
});
