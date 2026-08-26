import { describe, expect, it } from "vitest";
import {
  classify,
  classifyOne,
  lastReviewedAt,
  parseTime,
  requestedAt,
  requestedReviewers,
  reviewState,
} from "./classify.js";
import {
  NOW,
  daysAgo,
  makePr,
  pendingRequest,
  reviewRequest,
  submittedReview,
} from "./fixtures.js";

const ME = "hubot";

describe("parseTime", () => {
  it("returns null rather than NaN for missing or unparseable input", () => {
    expect(parseTime(undefined)).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("not a date")).toBeNull();
  });
});

describe("requestedAt", () => {
  it("prefers the newest request naming me directly", () => {
    const pr = makePr({
      timelineItems: {
        nodes: [
          reviewRequest({ login: ME }, daysAgo(9)),
          reviewRequest({ login: "octocat" }, daysAgo(1)),
          reviewRequest({ login: ME }, daysAgo(3)),
        ],
      },
    });
    expect(requestedAt(pr, ME)).toBe(Date.parse(daysAgo(3)));
  });

  it("falls back to the newest request of any kind for a team request", () => {
    // A request reaching me through a team names the team, never my login, so
    // insisting on a direct match would age every team request from PR open.
    const pr = makePr({
      timelineItems: {
        nodes: [
          reviewRequest({ slug: "platform" }, daysAgo(6)),
          reviewRequest({ slug: "platform" }, daysAgo(2)),
        ],
      },
    });
    expect(requestedAt(pr, ME)).toBe(Date.parse(daysAgo(2)));
  });

  it("falls back to the pull request's own creation time with no timeline", () => {
    const pr = makePr({ timelineItems: { nodes: [] }, createdAt: daysAgo(11) });
    expect(requestedAt(pr, ME)).toBe(Date.parse(daysAgo(11)));
  });

  it("survives a null node and an unparseable timestamp", () => {
    const pr = makePr({
      timelineItems: { nodes: [null, { createdAt: "nonsense" }] },
      createdAt: daysAgo(5),
    });
    expect(requestedAt(pr, ME)).toBe(Date.parse(daysAgo(5)));
  });

  it("returns 0 when there is nothing to read at all", () => {
    expect(requestedAt({ createdAt: undefined, timelineItems: null }, ME)).toBe(0);
  });
});

describe("lastReviewedAt", () => {
  it("ignores reviews by anyone else", () => {
    const pr = makePr({
      reviews: { nodes: [submittedReview("APPROVED", "octocat", daysAgo(1))] },
    });
    expect(lastReviewedAt(pr, ME)).toBeNull();
  });

  it("ignores a PENDING review, which is an unsubmitted draft", () => {
    const pr = makePr({ reviews: { nodes: [submittedReview("PENDING", ME, daysAgo(1))] } });
    expect(lastReviewedAt(pr, ME)).toBeNull();
  });

  it("counts a DISMISSED review, because I still read the diff", () => {
    const pr = makePr({ reviews: { nodes: [submittedReview("DISMISSED", ME, daysAgo(4))] } });
    expect(lastReviewedAt(pr, ME)).toBe(Date.parse(daysAgo(4)));
  });

  it("takes the most recent of several of my reviews", () => {
    const pr = makePr({
      reviews: {
        nodes: [
          submittedReview("COMMENTED", ME, daysAgo(8)),
          submittedReview("CHANGES_REQUESTED", ME, daysAgo(2)),
          submittedReview("COMMENTED", ME, daysAgo(5)),
        ],
      },
    });
    expect(lastReviewedAt(pr, ME)).toBe(Date.parse(daysAgo(2)));
  });
});

describe("requestedReviewers", () => {
  it("renders me as \"you\" rather than repeating my login on every row", () => {
    const pr = makePr({ reviewRequests: { nodes: [pendingRequest({ login: ME })] } });
    expect(requestedReviewers(pr, ME)).toEqual(["you"]);
  });

  it("puts me first and sorts the rest", () => {
    const pr = makePr({
      reviewRequests: {
        nodes: [
          pendingRequest({ login: "mona" }),
          pendingRequest({ login: ME }),
          pendingRequest({ slug: "platform" }),
        ],
      },
    });
    expect(requestedReviewers(pr, ME)).toEqual(["you", "mona", "platform"]);
  });

  it("names a team by slug, which is what says a teammate could take it", () => {
    const pr = makePr({ reviewRequests: { nodes: [pendingRequest({ slug: "platform" })] } });
    expect(requestedReviewers(pr, ME)).toEqual(["platform"]);
  });

  it("omits me when the request only ever reached me through a team", () => {
    // reviewRequests names the team, not the member, so there is no "you" to
    // show — and the team slug is the more useful thing to display anyway.
    const pr = makePr({ reviewRequests: { nodes: [pendingRequest({ slug: "platform" })] } });
    expect(requestedReviewers(pr, ME)).not.toContain("you");
  });

  it("deduplicates and survives null or empty nodes", () => {
    const pr = makePr({
      reviewRequests: {
        nodes: [null, {}, pendingRequest({ login: "mona" }), pendingRequest({ login: "mona" })],
      },
    });
    expect(requestedReviewers(pr, ME)).toEqual(["mona"]);
  });

  it("is empty when the field is missing entirely", () => {
    expect(requestedReviewers(makePr({ reviewRequests: null }), ME)).toEqual([]);
  });
});

describe("reviewState", () => {
  it("is a first look when I have never reviewed", () => {
    expect(reviewState(null, NOW)).toBe("first-look");
  });

  it("is a re-review when my review predates the current request", () => {
    expect(reviewState(Date.parse(daysAgo(6)), Date.parse(daysAgo(2)))).toBe("re-review");
  });

  it("is a first look when I reviewed after the request", () => {
    // Reviewed after being asked means the ball is not in my court, so calling
    // it a re-review would misreport who is waiting.
    expect(reviewState(Date.parse(daysAgo(1)), Date.parse(daysAgo(4)))).toBe("first-look");
  });
});

describe("classifyOne", () => {
  it("returns null for a node missing the fields an action needs", () => {
    expect(classifyOne({ number: 1, url: "https://example.test" }, ME)).toBeNull();
    expect(classifyOne({ repository: { nameWithOwner: "acme/widgets" }, number: 1 }, ME)).toBeNull();
    expect(
      classifyOne({ repository: { nameWithOwner: "acme/widgets" }, url: "u" }, ME),
    ).toBeNull();
  });

  it("carries the author, draft state, and change size through", () => {
    const row = classifyOne(
      makePr({ isDraft: true, additions: 12, deletions: 300, changedFiles: 9 }),
      ME,
    );
    expect(row).toMatchObject({
      repo: "acme/widgets",
      number: 1,
      author: "octocat",
      isDraft: true,
      size: { additions: 12, deletions: 300, changedFiles: 9 },
    });
  });

  it("defaults a missing author to unknown rather than dropping the row", () => {
    expect(classifyOne(makePr({ author: null }), ME)?.author).toBe("unknown");
  });
});

describe("classify", () => {
  it("sorts oldest request first", () => {
    const rows = classify(
      [
        makePr({ number: 3, timelineItems: { nodes: [reviewRequest({ login: ME }, daysAgo(1))] } }),
        makePr({ number: 1, timelineItems: { nodes: [reviewRequest({ login: ME }, daysAgo(9))] } }),
        makePr({ number: 2, timelineItems: { nodes: [reviewRequest({ login: ME }, daysAgo(4))] } }),
      ],
      ME,
    );
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
  });

  it("breaks a timestamp tie deterministically by repo then number", () => {
    const at = { nodes: [reviewRequest({ login: ME }, daysAgo(2))] };
    const rows = classify(
      [
        makePr({ number: 7, repository: { nameWithOwner: "acme/zzz" }, timelineItems: at }),
        makePr({ number: 9, repository: { nameWithOwner: "acme/aaa" }, timelineItems: at }),
        makePr({ number: 2, repository: { nameWithOwner: "acme/aaa" }, timelineItems: at }),
      ],
      ME,
    );
    expect(rows.map((row) => `${row.repo}#${row.number}`)).toEqual([
      "acme/aaa#2",
      "acme/aaa#9",
      "acme/zzz#7",
    ]);
  });

  it("drops null and unusable nodes without failing the whole sweep", () => {
    expect(classify([null, { number: 1 }, makePr()], ME)).toHaveLength(1);
  });
});
