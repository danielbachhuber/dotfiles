import { describe, expect, it } from "vitest";
import { SEARCH_LIMIT, runSweep, type GhRunner } from "./gh.js";

function hit(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/widgets/issues/${number}`,
    repository: { nameWithOwner: "acme/widgets" },
    labels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    commentsCount: 0,
    isPullRequest: false,
    ...overrides,
  };
}

function runnerFor(hits: unknown[]): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    gh: {
      async run(args) {
        calls.push(args);
        return JSON.stringify(hits);
      },
    },
  };
}

describe("runSweep", () => {
  it("asks gh for open issues assigned to the authenticated user", async () => {
    const { gh, calls } = runnerFor([]);
    await runSweep(gh, () => 1_700_000_000_000);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--assignee=@me");
    expect(calls[0]).toContain("--state=open");
    expect(calls[0].slice(0, 2)).toEqual(["search", "issues"]);
  });

  it("stamps the sweep time from the injected clock", async () => {
    const { gh } = runnerFor([]);
    expect((await runSweep(gh, () => 42)).sweptAt).toBe(42);
  });

  it("returns rows newest first", async () => {
    const { gh } = runnerFor([
      hit(1, { updatedAt: "2026-01-01T00:00:00Z" }),
      hit(2, { updatedAt: "2026-03-01T00:00:00Z" }),
    ]);
    const result = await runSweep(gh, () => 0);
    expect(result.rows.map((row) => row.number)).toEqual([2, 1]);
  });

  it("drops pull requests from the results", async () => {
    const { gh } = runnerFor([hit(1), hit(2, { isPullRequest: true })]);
    const result = await runSweep(gh, () => 0);
    expect(result.rows.map((row) => row.number)).toEqual([1]);
  });

  it("reports truncation when the search fills its ceiling", async () => {
    const full = Array.from({ length: SEARCH_LIMIT }, (_, index) => hit(index + 1));
    expect((await runSweep(runnerFor(full).gh, () => 0)).truncated).toBe(true);
    expect((await runSweep(runnerFor([hit(1)]).gh, () => 0)).truncated).toBe(false);
  });

  it("counts truncation against the raw hits, not the surviving rows", async () => {
    // A full page of pull requests still means the search was capped, even
    // though every hit is filtered out.
    const full = Array.from({ length: SEARCH_LIMIT }, (_, index) =>
      hit(index + 1, { isPullRequest: true }),
    );
    const result = await runSweep(runnerFor(full).gh, () => 0);
    expect(result.rows).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  it("surfaces malformed json as an error rather than an empty sweep", async () => {
    const gh: GhRunner = { async run() { return "not json"; } };
    await expect(runSweep(gh, () => 0)).rejects.toThrow();
  });
});

describe("runSweep repository filter", () => {
  /** Records the repositories the per-repository listing was made for. */
  function trackingRunner(fetched: string[]): GhRunner {
    return {
      async run(args) {
        if (args[0] === "search") {
          return JSON.stringify([
            hit(1, { repository: { nameWithOwner: "acme/widgets" } }),
            hit(2, { repository: { nameWithOwner: "acme/gadgets" } }),
          ]);
        }
        if (args[0] === "issue" && args[1] === "list") {
          fetched.push(args[args.indexOf("--repo") + 1]!);
          return JSON.stringify([hit(1)]);
        }
        return JSON.stringify({ data: {} });
      },
    };
  }

  it("never lists a repository the filter excludes", async () => {
    const fetched: string[] = [];
    const result = await runSweep(trackingRunner(fetched), () => 0, "", {
      allows: (repo) => repo === "acme/widgets",
    });
    // The saving is the point: an excluded repo costs no gh call at all.
    expect(fetched).toEqual(["acme/widgets"]);
    expect(result.skippedRepos).toEqual(["acme/gadgets"]);
  });

  it("lists everything and skips nothing without a filter", async () => {
    const fetched: string[] = [];
    const result = await runSweep(trackingRunner(fetched), () => 0);
    expect(fetched).toEqual(["acme/gadgets", "acme/widgets"]);
    expect(result.skippedRepos).toEqual([]);
  });
});

