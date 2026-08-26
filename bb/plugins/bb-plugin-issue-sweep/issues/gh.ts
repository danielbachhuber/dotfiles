import {
  GhUnavailableError,
  createGhRunner,
  type GhRunner,
} from "@danielb/gh-shared/gh";

// Re-exported so this plugin's own modules keep importing from one place.
export { GhUnavailableError, createGhRunner };
export type { GhRunner };

import { sortRows, toRow, type IssueRow, type RawIssue, type SweepResult } from "./types.js";

export const SEARCH_LIMIT = 100;

export const SEARCH_FIELDS = [
  "number", "title", "url", "repository", "labels",
  "createdAt", "updatedAt", "commentsCount", "isPullRequest",
].join(",");




/**
 * One search call covers every repository, so there is no per-repo fan-out and
 * no partial-failure state: the sweep either has the whole picture or it threw.
 */
export async function runSweep(gh: GhRunner, now: () => number): Promise<SweepResult> {
  const raw = await gh.run([
    "search", "issues",
    "--assignee=@me",
    "--state=open",
    "--limit", String(SEARCH_LIMIT),
    "--json", SEARCH_FIELDS,
  ]);

  const hits = JSON.parse(raw) as RawIssue[];
  const rows: IssueRow[] = [];
  for (const item of hits) {
    const row = toRow(item);
    if (row) rows.push(row);
  }

  return {
    rows: sortRows(rows),
    // Measured against the hits, not the rows: a page full of pull requests
    // still means the search was capped.
    truncated: hits.length >= SEARCH_LIMIT,
    sweptAt: now(),
  };
}
