import { describe, expect, it } from "vitest";
import {
  SEARCH_GRAPHQL,
  SEARCH_LIMIT,
  SEARCH_QUERY,
  parseSearch,
  runSweep,
  type GhRunner,
} from "./gh.js";
import { NOW, daysAgo, makePr, makeSearchResponse, reviewRequest } from "./fixtures.js";

function stubRunner(payload: unknown): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args) {
      calls.push(args);
      return JSON.stringify(payload);
    },
  };
}

describe("SEARCH_QUERY", () => {
  it("uses review-requested, which also matches requests reaching me via a team", () => {
    // user-review-requested: is direct-only and silently drops team requests.
    expect(SEARCH_QUERY).toContain("review-requested:@me");
    expect(SEARCH_QUERY).not.toContain("user-review-requested");
  });
});

describe("SEARCH_GRAPHQL", () => {
  it("asks for the review-request timeline, which gh pr list cannot supply", () => {
    expect(SEARCH_GRAPHQL).toContain("REVIEW_REQUESTED_EVENT");
  });
});

describe("parseSearch", () => {
  it("rejects a response with no viewer login", () => {
    // Every classification compares against the viewer, so a missing login is
    // unusable rather than a partial result to carry on with.
    expect(() => parseSearch(JSON.stringify({ data: { search: { nodes: [] } } }))).toThrow(
      /no viewer login/,
    );
  });

  it("surfaces GraphQL errors in the thrown message", () => {
    const raw = JSON.stringify({ data: null, errors: [{ message: "rate limited" }] });
    expect(() => parseSearch(raw)).toThrow(/rate limited/);
  });

  it("returns the viewer login on a well-formed response", () => {
    expect(parseSearch(JSON.stringify(makeSearchResponse([]))).viewer).toBe("hubot");
  });
});

describe("runSweep", () => {
  it("makes exactly one gh call for the whole sweep", async () => {
    const gh = stubRunner(makeSearchResponse([makePr(), makePr({ number: 2 })]));
    await runSweep(gh, () => NOW);
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]!.slice(0, 2)).toEqual(["api", "graphql"]);
  });

  it("passes the query as a raw string and the limit as an Int", async () => {
    const gh = stubRunner(makeSearchResponse([]));
    await runSweep(gh, () => NOW);
    const args = gh.calls[0]!;
    expect(args[args.indexOf("-f", 4) + 1]).toBe(`q=${SEARCH_QUERY}`);
    expect(args[args.indexOf("-F") + 1]).toBe(`limit=${SEARCH_LIMIT}`);
  });

  it("classifies against the viewer the same response reported", async () => {
    const gh = stubRunner(
      makeSearchResponse(
        [
          makePr({
            timelineItems: { nodes: [reviewRequest({ login: "octocat" }, daysAgo(7))] },
          }),
        ],
        "octocat",
      ),
    );
    const result = await runSweep(gh, () => NOW);
    expect(result.rows[0]!.requestedAt).toBe(Date.parse(daysAgo(7)));
  });

  it("reports truncation at the search ceiling", async () => {
    const full = Array.from({ length: SEARCH_LIMIT }, (_, index) => makePr({ number: index + 1 }));
    const result = await runSweep(stubRunner(makeSearchResponse(full)), () => NOW);
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(SEARCH_LIMIT);
  });

  it("does not report truncation below the ceiling", async () => {
    const result = await runSweep(stubRunner(makeSearchResponse([makePr()])), () => NOW);
    expect(result.truncated).toBe(false);
  });

  it("stamps the sweep time from the injected clock", async () => {
    const result = await runSweep(stubRunner(makeSearchResponse([])), () => NOW);
    expect(result.sweptAt).toBe(NOW);
  });
});

describe("runSweep repository filter", () => {
  /**
   * One search covers every repository at once, so unlike pr-sweep there is no
   * per-repository call to skip: the saving is not the point here, the panel
   * agreeing with the other two is.
   */
  it("drops rows outside the filter and reports their repositories", async () => {
    const gh = stubRunner(
      makeSearchResponse([
        makePr({ number: 1, repository: { nameWithOwner: "acme/widgets" } }),
        makePr({ number: 2, repository: { nameWithOwner: "acme/gadgets" } }),
      ]),
    );
    const result = await runSweep(gh, () => NOW, { allows: (repo) => repo === "acme/widgets" });
    expect(result.rows.map((row) => row.repo)).toEqual(["acme/widgets"]);
    expect(result.skippedRepos).toEqual(["acme/gadgets"]);
    // Still one call: the filter cannot save a request it cannot scope.
    expect(gh.calls).toHaveLength(1);
  });

  it("keeps every row and skips nothing without a filter", async () => {
    const gh = stubRunner(
      makeSearchResponse([
        makePr({ number: 1, repository: { nameWithOwner: "acme/widgets" } }),
        makePr({ number: 2, repository: { nameWithOwner: "acme/gadgets" } }),
      ]),
    );
    const result = await runSweep(gh, () => NOW);
    expect(result.rows).toHaveLength(2);
    expect(result.skippedRepos).toEqual([]);
  });
});

