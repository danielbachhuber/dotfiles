import { describe, expect, it } from "vitest";
import { FACTS_SEARCH, factsKey, fetchIssueFacts, parseIssueFacts } from "./graph.js";
import type { GhRunner } from "./gh.js";

function payload(nodes: unknown[]): string {
  return JSON.stringify({ data: { search: { nodes } } });
}

function node(
  number: number,
  {
    blockers = [] as string[],
    closingPrs = [] as Array<[number, string]>,
    repo = "acme/widgets",
  } = {},
) {
  return {
    number,
    repository: { nameWithOwner: repo },
    blockedBy: { nodes: blockers.map((state) => ({ state })) },
    closedByPullRequestsReferences: {
      nodes: closingPrs.map(([prNumber, state]) => ({ number: prNumber, state })),
    },
  };
}

describe("parseIssueFacts: blockers", () => {
  it("counts the open blockers of an issue", () => {
    const facts = parseIssueFacts(payload([node(42, { blockers: ["OPEN", "OPEN"] })]));
    expect(facts.get("acme/widgets#42")?.openBlockers).toBe(2);
  });

  it("ignores blockers that have been closed", () => {
    // A dependency that is finished no longer blocks anything. Counting it
    // would strand the issue in the Blocked section for good.
    const facts = parseIssueFacts(payload([node(42, { blockers: ["CLOSED", "OPEN", "CLOSED"] })]));
    expect(facts.get("acme/widgets#42")?.openBlockers).toBe(1);
  });

  it("leaves out an issue whose blockers are all closed", () => {
    // Absent, not zero: the caller reads a missing key as "nothing to say".
    expect(parseIssueFacts(payload([node(42, { blockers: ["CLOSED"] })])).size).toBe(0);
  });
});

describe("parseIssueFacts: closing pull requests", () => {
  it("reports an open pull request that closes the issue", () => {
    const facts = parseIssueFacts(payload([node(42, { closingPrs: [[5810, "OPEN"]] })]));
    expect(facts.get("acme/widgets#42")?.closingPr).toBe(5810);
  });

  it("ignores a merged one, which means finished rather than in review", () => {
    // Promoting to In Review on a merged pull request moves the card the wrong
    // way: the work is done, not waiting.
    const facts = parseIssueFacts(
      payload([node(42, { closingPrs: [[5810, "MERGED"], [5811, "CLOSED"]] })]),
    );
    expect(facts.size).toBe(0);
  });

  it("takes the lowest number when two pull requests close the same issue", () => {
    // Otherwise the value flaps between them as GitHub reorders the list.
    const facts = parseIssueFacts(
      payload([node(42, { closingPrs: [[5900, "OPEN"], [5810, "OPEN"]] })]),
    );
    expect(facts.get("acme/widgets#42")?.closingPr).toBe(5810);
  });

  it("carries both facts about the same issue", () => {
    const facts = parseIssueFacts(
      payload([node(42, { blockers: ["OPEN"], closingPrs: [[5810, "OPEN"]] })]),
    );
    expect(facts.get("acme/widgets#42")).toEqual({ openBlockers: 1, closingPr: 5810 });
  });
});

describe("parseIssueFacts: shape", () => {
  it("keys by repository as well as number", () => {
    // Two repositories can both have a #42, and they are different issues.
    const facts = parseIssueFacts(
      payload([
        node(42, { blockers: ["OPEN"] }),
        node(42, { blockers: ["OPEN", "OPEN"], repo: "acme/gadgets" }),
      ]),
    );
    expect(facts.get("acme/widgets#42")?.openBlockers).toBe(1);
    expect(facts.get("acme/gadgets#42")?.openBlockers).toBe(2);
  });

  it("leaves out an issue with nothing to say", () => {
    expect(parseIssueFacts(payload([node(42)])).size).toBe(0);
  });

  it("skips a node too malformed to key", () => {
    const facts = parseIssueFacts(
      payload([
        { number: 1, blockedBy: { nodes: [{ state: "OPEN" }] } },
        { repository: { nameWithOwner: "acme/widgets" }, blockedBy: { nodes: [] } },
        null,
        {},
      ]),
    );
    expect(facts.size).toBe(0);
  });

  it("survives nulls, which is what a match that is not an issue gives", () => {
    const bare = { number: 42, repository: { nameWithOwner: "acme/widgets" } };
    expect(
      parseIssueFacts(
        payload([{ ...bare, blockedBy: null, closedByPullRequestsReferences: null }]),
      ).size,
    ).toBe(0);
    expect(parseIssueFacts(payload([])).size).toBe(0);
    expect(parseIssueFacts(JSON.stringify({})).size).toBe(0);
  });

  it("drops a pull request reference with no number", () => {
    const facts = parseIssueFacts(
      payload([
        {
          number: 42,
          repository: { nameWithOwner: "acme/widgets" },
          closedByPullRequestsReferences: { nodes: [{ state: "OPEN" }] },
        },
      ]),
    );
    expect(facts.size).toBe(0);
  });
});

describe("factsKey", () => {
  it("matches the key rows are stored under", () => {
    expect(factsKey("acme/widgets", 42)).toBe("acme/widgets#42");
  });
});

describe("fetchIssueFacts", () => {
  it("asks for the same population the listing sweep covers", async () => {
    // A search that disagreed with the listing would move cards for issues
    // that are not in the table, or miss ones that are.
    const calls: string[][] = [];
    const gh: GhRunner = {
      async run(args) {
        calls.push([...args]);
        return payload([node(42, { blockers: ["OPEN"] })]);
      },
    };

    const facts = await fetchIssueFacts(gh);
    expect(facts.get("acme/widgets#42")?.openBlockers).toBe(1);
    expect(calls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(calls[0]).toContain(`q=${FACTS_SEARCH}`);
    expect(FACTS_SEARCH).toContain("assignee:@me");
    expect(FACTS_SEARCH).toContain("is:open");
  });
});
