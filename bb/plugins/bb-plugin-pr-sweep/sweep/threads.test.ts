import { describe, expect, it } from "vitest";
import { fetchThreadCounts, parseThreadCounts, threadKey } from "./threads.js";
import type { GhRunner } from "@danielb/gh-shared/gh";

const response = (nodes: unknown[]) => JSON.stringify({ data: { search: { nodes } } });

type RawThread = {
  isResolved: boolean;
  isOutdated?: boolean;
  path?: string;
  comments?: { nodes: Array<{ body: string; author: { login: string } }> };
};

/** A thread carrying a comment, the shape GitHub actually returns. */
const thread = (overrides: Partial<RawThread> = {}): RawThread => ({
  isResolved: false,
  path: "server/widgets.ts",
  comments: { nodes: [{ body: "This drops the null case.", author: { login: "hubber" } }] },
  ...overrides,
});

const node = (
  number: number,
  threads: RawThread[],
  repo = "acme/widgets",
) => ({
  number,
  repository: { nameWithOwner: repo },
  reviewThreads: { nodes: threads },
});

describe("parseThreadCounts", () => {
  it("counts only the unresolved threads", () => {
    const counts = parseThreadCounts(
      response([
        node(42, [
          { isResolved: false },
          { isResolved: true },
          { isResolved: false, isOutdated: true },
        ]),
      ]),
    );
    expect(counts.get(threadKey("acme/widgets", 42))).toMatchObject({ unresolved: 2, outdated: 1 });
  });

  it("reports zero for a pull request with no threads, not absence", () => {
    // The difference matters: absence means the query did not cover it, zero
    // means it genuinely has none.
    const counts = parseThreadCounts(response([node(42, [])]));
    expect(counts.get(threadKey("acme/widgets", 42))).toEqual({
      unresolved: 0,
      outdated: 0,
      comments: [],
    });
  });

  it("keys by repository as well as number", () => {
    const counts = parseThreadCounts(
      response([
        node(42, [{ isResolved: false }]),
        node(42, [{ isResolved: false }, { isResolved: false }], "acme/gadgets"),
      ]),
    );
    expect(counts.get(threadKey("acme/widgets", 42))!.unresolved).toBe(1);
    expect(counts.get(threadKey("acme/gadgets", 42))!.unresolved).toBe(2);
  });

  it("skips a node too incomplete to key", () => {
    const counts = parseThreadCounts(
      response([{ reviewThreads: { nodes: [] } }, { number: 1, repository: {} }]),
    );
    expect(counts.size).toBe(0);
  });

  it("tolerates an empty search result", () => {
    expect(parseThreadCounts(JSON.stringify({ data: { search: { nodes: [] } } })).size).toBe(0);
    expect(parseThreadCounts(JSON.stringify({})).size).toBe(0);
  });
});

describe("fetchThreadCounts", () => {
  it("asks GraphQL, since gh pr list cannot return reviewThreads", async () => {
    const calls: string[][] = [];
    const gh: GhRunner = {
      async run(args) {
        calls.push(args);
        return response([node(42, [{ isResolved: false }])]);
      },
    };
    const counts = await fetchThreadCounts(gh);
    expect(calls[0]!.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(counts.get(threadKey("acme/widgets", 42))!.unresolved).toBe(1);
  });
});

describe("what an unresolved thread says", () => {
  it("carries the comment, since a count cannot tell a nit from an objection", () => {
    // The row said "5 unresolved comments" for a set containing two blocking
    // questions and three nits.
    const counts = parseThreadCounts(
      response([
        node(42, [
          thread({
            path: "client/stories.tsx",
            comments: {
              nodes: [{ body: "There is now no way to turn it on.", author: { login: "hubber" } }],
            },
          }),
        ]),
      ]),
    );
    expect(counts.get(threadKey("acme/widgets", 42))!.comments).toEqual([
      {
        author: "hubber",
        path: "client/stories.tsx",
        body: "There is now no way to turn it on.",
        outdated: false,
      },
    ]);
  });

  it("flattens the comment to one line and lets the panel decide where to clip", () => {
    const counts = parseThreadCounts(
      response([
        node(42, [
          thread({ comments: { nodes: [{ body: "one\n\n  two  three", author: { login: "hubber" } }] } }),
        ]),
      ]),
    );
    expect(counts.get(threadKey("acme/widgets", 42))!.comments[0]!.body).toBe("one two three");
  });

  it("marks a comment on code that has since changed", () => {
    // #4043 had 33 unresolved threads and all 33 were outdated: not 33 things
    // to answer, but a rewrite that left them behind.
    const counts = parseThreadCounts(response([node(42, [thread({ isOutdated: true })])]));
    expect(counts.get(threadKey("acme/widgets", 42))!.comments[0]!.outdated).toBe(true);
  });

  it("skips a resolved thread's comment along with its count", () => {
    const counts = parseThreadCounts(response([node(42, [thread({ isResolved: true })])]));
    expect(counts.get(threadKey("acme/widgets", 42))!.comments).toEqual([]);
  });

  it("counts a thread whose comment is missing rather than dropping it", () => {
    // The count is the reliable signal; the body is the bonus. A thread with
    // no readable first comment must still say the pull request has one.
    const counts = parseThreadCounts(
      response([node(42, [thread({ comments: { nodes: [] } })])]),
    );
    const entry = counts.get(threadKey("acme/widgets", 42))!;
    expect(entry.unresolved).toBe(1);
    expect(entry.comments).toEqual([]);
  });
});
