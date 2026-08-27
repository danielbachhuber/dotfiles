import type { GhRunner } from "./gh.js";

/**
 * GitHub's issue dependencies, which are neither a label nor a board field and
 * so are invisible to `gh issue list`. Only GraphQL reports them, and one
 * search covers the whole sweep.
 */
export const BLOCKED_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on Issue {
        number
        repository { nameWithOwner }
        blockedBy(first: 20) { nodes { state } }
      }
    }
  }
}`;

/** The same population the listing sweep covers, so the two agree. */
export const BLOCKED_SEARCH = "assignee:@me is:issue is:open archived:false";

/** `repo#number`, the key rows are already stored under. */
export function blockedKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

interface RawNode {
  number?: number;
  repository?: { nameWithOwner?: string };
  blockedBy?: { nodes?: Array<{ state?: string } | null> | null } | null;
}

/**
 * Open blockers per issue. Closed ones are dropped on purpose: a dependency
 * that has been finished no longer blocks anything, and counting it would
 * strand an issue in the Blocked section forever.
 *
 * Only issues with at least one open blocker get an entry, so a missing key
 * reads as "not blocked" without the caller checking for zero.
 */
export function parseBlockedBy(raw: string): Map<string, number> {
  const blocked = new Map<string, number>();
  const parsed = JSON.parse(raw) as { data?: { search?: { nodes?: Array<RawNode | null> } } };

  for (const node of parsed.data?.search?.nodes ?? []) {
    const repo = node?.repository?.nameWithOwner;
    if (!repo || typeof node?.number !== "number") continue;

    let open = 0;
    for (const blocker of node.blockedBy?.nodes ?? []) {
      if (blocker?.state === "OPEN") open += 1;
    }
    if (open > 0) blocked.set(blockedKey(repo, node.number), open);
  }

  return blocked;
}

export async function fetchBlockedBy(gh: GhRunner): Promise<Map<string, number>> {
  const raw = await gh.run([
    "api", "graphql",
    "-f", `query=${BLOCKED_QUERY}`,
    "-f", `q=${BLOCKED_SEARCH}`,
  ]);
  return parseBlockedBy(raw);
}
