import { describe, expect, it } from "vitest";
import { BLOCKED_SEARCH, blockedKey, fetchBlockedBy, parseBlockedBy } from "./blocked.js";
import type { GhRunner } from "./gh.js";

function payload(nodes: unknown[]): string {
  return JSON.stringify({ data: { search: { nodes } } });
}

function node(number: number, blockers: string[], repo = "acme/widgets") {
  return {
    number,
    repository: { nameWithOwner: repo },
    blockedBy: { nodes: blockers.map((state) => ({ state })) },
  };
}

describe("parseBlockedBy", () => {
  it("counts the open blockers of an issue", () => {
    const blocked = parseBlockedBy(payload([node(42, ["OPEN", "OPEN"])]));
    expect(blocked.get("acme/widgets#42")).toBe(2);
  });

  it("ignores blockers that have been closed", () => {
    // A dependency that is finished no longer blocks anything. Counting it
    // would strand the issue in the Blocked section for good.
    const blocked = parseBlockedBy(payload([node(42, ["CLOSED", "OPEN", "CLOSED"])]));
    expect(blocked.get("acme/widgets#42")).toBe(1);
  });

  it("leaves out an issue whose blockers are all closed", () => {
    // Absent, not zero: the caller reads a missing key as "not blocked".
    const blocked = parseBlockedBy(payload([node(42, ["CLOSED"])]));
    expect(blocked.has("acme/widgets#42")).toBe(false);
  });

  it("leaves out an issue with no dependencies at all", () => {
    expect(parseBlockedBy(payload([node(42, [])])).size).toBe(0);
  });

  it("keys by repository as well as number", () => {
    // Two repositories can both have a #42, and they are different issues.
    const blocked = parseBlockedBy(
      payload([node(42, ["OPEN"], "acme/widgets"), node(42, ["OPEN", "OPEN"], "acme/gadgets")]),
    );
    expect(blocked.get("acme/widgets#42")).toBe(1);
    expect(blocked.get("acme/gadgets#42")).toBe(2);
  });

  it("skips a node too malformed to key", () => {
    const blocked = parseBlockedBy(
      payload([
        { number: 1, blockedBy: { nodes: [{ state: "OPEN" }] } },
        { repository: { nameWithOwner: "acme/widgets" }, blockedBy: { nodes: [] } },
        null,
        {},
      ]),
    );
    expect(blocked.size).toBe(0);
  });

  it("survives a null blockedBy, which is what a search match that is not an issue gives", () => {
    expect(parseBlockedBy(payload([{ ...node(42, []), blockedBy: null }])).size).toBe(0);
    expect(parseBlockedBy(payload([])).size).toBe(0);
    expect(parseBlockedBy(JSON.stringify({})).size).toBe(0);
  });
});

describe("blockedKey", () => {
  it("matches the key rows are stored under", () => {
    expect(blockedKey("acme/widgets", 42)).toBe("acme/widgets#42");
  });
});

describe("fetchBlockedBy", () => {
  it("asks for the same population the listing sweep covers", async () => {
    // A search that disagreed with the listing would mark rows blocked that
    // are not in the table, or miss ones that are.
    const calls: string[][] = [];
    const gh: GhRunner = {
      async run(args) {
        calls.push([...args]);
        return payload([node(42, ["OPEN"])]);
      },
    };

    const blocked = await fetchBlockedBy(gh);
    expect(blocked.get("acme/widgets#42")).toBe(1);
    expect(calls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(calls[0]).toContain(`q=${BLOCKED_SEARCH}`);
    expect(BLOCKED_SEARCH).toContain("assignee:@me");
    expect(BLOCKED_SEARCH).toContain("is:open");
  });
});
