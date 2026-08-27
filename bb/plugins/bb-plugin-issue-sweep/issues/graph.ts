import type { GhRunner } from "./gh.js";

/**
 * The two facts about an issue that `gh issue list` cannot report, both of
 * them only reachable through GraphQL, and both cheap enough to take in the
 * one search that already covers the whole sweep.
 */
export interface IssueFacts {
  /**
   * How many *open* issues block this one, via GitHub's issue dependencies.
   * Closed blockers are dropped: a dependency that is finished no longer
   * blocks anything.
   */
  openBlockers: number;
  /**
   * An open pull request that closes this issue — the "Fixes #n" link — or
   * null. Its existence is what moves the issue to In Review: the work has
   * left your hands and is waiting on someone else.
   */
  closingPr: number | null;
}

export const FACTS_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on Issue {
        number
        repository { nameWithOwner }
        blockedBy(first: 20) { nodes { state } }
        closedByPullRequestsReferences(first: 10, includeClosedPrs: false) {
          nodes { number state }
        }
      }
    }
  }
}`;

/** The same population the listing sweep covers, so the two agree. */
export const FACTS_SEARCH = "assignee:@me is:issue is:open archived:false";

/** `repo#number`, the key rows are already stored under. */
export function factsKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

interface RawNode {
  number?: number;
  repository?: { nameWithOwner?: string };
  blockedBy?: { nodes?: Array<{ state?: string } | null> | null } | null;
  closedByPullRequestsReferences?: {
    nodes?: Array<{ number?: number; state?: string } | null> | null;
  } | null;
}

/**
 * Facts per issue. Only issues with something to say get an entry, so a
 * missing key reads as "nothing blocking, nothing in flight".
 */
export function parseIssueFacts(raw: string): Map<string, IssueFacts> {
  const facts = new Map<string, IssueFacts>();
  const parsed = JSON.parse(raw) as { data?: { search?: { nodes?: Array<RawNode | null> } } };

  for (const node of parsed.data?.search?.nodes ?? []) {
    const repo = node?.repository?.nameWithOwner;
    if (!repo || typeof node?.number !== "number") continue;

    let openBlockers = 0;
    for (const blocker of node.blockedBy?.nodes ?? []) {
      if (blocker?.state === "OPEN") openBlockers += 1;
    }

    // `includeClosedPrs: false` already excludes merged and closed ones, but
    // the state is checked anyway: a merged PR means the issue is finished,
    // not in review, and that is the wrong direction to move a board card.
    let closingPr: number | null = null;
    for (const pr of node.closedByPullRequestsReferences?.nodes ?? []) {
      if (pr?.state !== "OPEN" || typeof pr.number !== "number") continue;
      // The lowest number, so a second pull request opened against the same
      // issue does not make this flap between two values.
      if (closingPr === null || pr.number < closingPr) closingPr = pr.number;
    }

    if (openBlockers > 0 || closingPr !== null) {
      facts.set(factsKey(repo, node.number), { openBlockers, closingPr });
    }
  }

  return facts;
}

export async function fetchIssueFacts(gh: GhRunner): Promise<Map<string, IssueFacts>> {
  const raw = await gh.run([
    "api", "graphql",
    "-f", `query=${FACTS_QUERY}`,
    "-f", `q=${FACTS_SEARCH}`,
  ]);
  return parseIssueFacts(raw);
}
