import type { GhRunner } from "@danielb/gh-shared/gh";

/** One unresolved inline review thread, as its first comment left it. */
export interface ThreadComment {
  author: string;
  /** The file it sits on. Half of knowing whether a comment is yours to act on. */
  path: string;
  /** The comment on one line. The panel clamps it; nothing is dropped here. */
  body: string;
  /** It sits on code that has since changed, so it may no longer apply. */
  outdated: boolean;
}

/** Unresolved inline review threads on one pull request. */
export interface ThreadCounts {
  unresolved: number;
  /** Of the unresolved ones, how many sit on code that has since changed. */
  outdated: number;
  /**
   * What those threads say, oldest first.
   *
   * A count cannot tell a typo nit from a design objection, and the row was
   * asking you to open GitHub to find out. Capped at the first comment of each
   * thread: the reply chain is the conversation, the first comment is the ask.
   */
  comments: ThreadComment[];
}

export const THREADS_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        repository { nameWithOwner }
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            path
            comments(first: 1) { nodes { body author { login } } }
          }
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
  reviewThreads?: {
    nodes?: Array<{
      isResolved?: boolean;
      isOutdated?: boolean;
      path?: string;
      comments?: { nodes?: Array<{ body?: string; author?: { login?: string } | null } | null> | null };
    } | null> | null;
  };
}

export function parseThreadCounts(raw: string): Map<string, ThreadCounts> {
  const counts = new Map<string, ThreadCounts>();
  const parsed = JSON.parse(raw) as { data?: { search?: { nodes?: RawNode[] } } };

  for (const node of parsed.data?.search?.nodes ?? []) {
    const repo = node.repository?.nameWithOwner;
    if (!repo || typeof node.number !== "number") continue;

    let unresolved = 0;
    let outdated = 0;
    const comments: ThreadComment[] = [];
    for (const thread of node.reviewThreads?.nodes ?? []) {
      if (!thread || thread.isResolved) continue;
      unresolved += 1;
      if (thread.isOutdated) outdated += 1;

      const first = thread.comments?.nodes?.[0];
      const body = (first?.body ?? "").replace(/\s+/g, " ").trim();
      if (body === "") continue;
      comments.push({
        author: first?.author?.login ?? "",
        path: thread.path ?? "",
        body,
        outdated: thread.isOutdated === true,
      });
    }
    counts.set(threadKey(repo, node.number), { unresolved, outdated, comments });
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
