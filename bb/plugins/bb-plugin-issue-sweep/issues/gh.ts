import {
  GhUnavailableError,
  createGhRunner,
  type GhRunner,
} from "@danielb/gh-shared/gh";

// Re-exported so this plugin's own modules keep importing from one place.
export { GhUnavailableError, createGhRunner };
export type { GhRunner };

import {
  REPO_SLUG_PATTERN,
  sortRows,
  toRow,
  type IssueRow,
  type RawIssue,
  type SweepResult,
} from "./types.js";

export const SEARCH_LIMIT = 100;

/** Discovery only: which repositories have issues assigned to me. */
export const SEARCH_FIELDS = ["number", "repository", "isPullRequest"].join(",");

/**
 * The per-repository call. `gh search issues` cannot return `projectItems` —
 * only `gh issue list` can — and the board status is the whole point of the
 * listing, so discovery names the repositories and each one is then listed.
 */
export const ISSUE_LIST_FIELDS = [
  "number", "title", "url", "labels",
  "createdAt", "updatedAt", "comments", "projectItems",
].join(",");




/**
 * Two calls, like pr-sweep: one search naming the repositories, then one
 * listing per repository.
 *
 * The search alone would be cheaper, but it cannot return `projectItems`, and
 * without the board status the listing is just a pile of titles.
 */
export async function runSweep(
  gh: GhRunner,
  now: () => number,
  board = "",
): Promise<SweepResult> {
  const raw = await gh.run([
    "search", "issues",
    "--assignee=@me",
    "--state=open",
    "--limit", String(SEARCH_LIMIT),
    "--json", SEARCH_FIELDS,
  ]);

  const hits = JSON.parse(raw) as RawIssue[];
  const repos = new Set<string>();
  for (const hit of hits) {
    if (hit.isPullRequest) continue;
    const slug = hit.repository?.nameWithOwner;
    if (slug && REPO_SLUG_PATTERN.test(slug)) repos.add(slug);
  }

  const rows: IssueRow[] = [];
  const failedRepos: string[] = [];
  for (const repo of [...repos].sort()) {
    try {
      const listed = await gh.run([
        "issue", "list",
        "--repo", repo,
        "--assignee", "@me",
        "--state", "open",
        "--limit", String(SEARCH_LIMIT),
        "--json", ISSUE_LIST_FIELDS,
      ]);
      for (const item of JSON.parse(listed) as RawIssue[]) {
        // `gh issue list` knows the repository from the flag, so it never
        // returns one; toRow needs it to build the row's key.
        const row = toRow({ ...item, repository: { nameWithOwner: repo } }, board);
        if (row) rows.push(row);
      }
    } catch (error) {
      if (error instanceof GhUnavailableError) throw error;
      failedRepos.push(repo);
    }
  }

  return {
    rows: sortRows(rows),
    // Measured against the hits, not the rows: a page full of pull requests
    // still means the search was capped.
    truncated: hits.length >= SEARCH_LIMIT,
    failedRepos,
    sweptAt: now(),
  };
}
