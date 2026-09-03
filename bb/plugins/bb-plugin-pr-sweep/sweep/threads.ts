import type { GhRunner } from "@danielb/gh-shared/gh";

/** Unresolved inline review threads on one pull request. */
export interface ThreadCounts {
  unresolved: number;
  /** Of the unresolved ones, how many sit on code that has since changed. */
  outdated: number;
}

export const THREADS_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        repository { nameWithOwner }
        reviewThreads(first: 100) {
          nodes { isResolved isOutdated }
        }
      }
    }
  }
}`;

export const THREADS_SEARCH = "is:pr is:open author:@me archived:false";

/** `repo#number`, the key rows are already stored under. */
export function threadKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

interface RawNode {
  number?: number;
  repository?: { nameWithOwner?: string };
  reviewThreads?: { nodes?: Array<{ isResolved?: boolean; isOutdated?: boolean } | null> | null };
}

export function parseThreadCounts(raw: string): Map<string, ThreadCounts> {
  const counts = new Map<string, ThreadCounts>();
  const parsed = JSON.parse(raw) as { data?: { search?: { nodes?: RawNode[] } } };

  for (const node of parsed.data?.search?.nodes ?? []) {
    const repo = node.repository?.nameWithOwner;
    if (!repo || typeof node.number !== "number") continue;

    let unresolved = 0;
    let outdated = 0;
    for (const thread of node.reviewThreads?.nodes ?? []) {
      if (!thread || thread.isResolved) continue;
      unresolved += 1;
      if (thread.isOutdated) outdated += 1;
    }
    counts.set(threadKey(repo, node.number), { unresolved, outdated });
  }

  return counts;
}

/**
 * Unresolved review threads for every open pull request the user authored.
 *
 * One GraphQL call for the whole sweep, not one per repository: `gh pr list
 * --json` cannot return reviewThreads at all, and an inline comment is
 * invisible to every field it can return. #5801 read "ready to merge,
 * approved" while carrying three unresolved threads.
 *
 * A failure here is not a failed sweep — the rows are still correct, they just
 * lose this one hint — so the caller treats an empty map as "unknown".
 */
export async function fetchThreadCounts(gh: GhRunner): Promise<Map<string, ThreadCounts>> {
  const raw = await gh.run([
    "api", "graphql",
    "-f", `query=${THREADS_QUERY}`,
    "-f", `q=${THREADS_SEARCH}`,
  ]);
  return parseThreadCounts(raw);
}
