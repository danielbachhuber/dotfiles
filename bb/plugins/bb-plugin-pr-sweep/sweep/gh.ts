import {
  GhUnavailableError,
  REPO_SLUG_PATTERN,
  createGhRunner,
  type GhRunner,
} from "@danielb/gh-shared/gh";

// Re-exported so this plugin's own modules keep importing from one place.
export { GhUnavailableError, REPO_SLUG_PATTERN, createGhRunner };
export type { GhRunner };

import { classify } from "./classify.js";
import type { ClassifiedRow, RawPullRequest, SweepResult } from "./types.js";


export const PR_LIST_FIELDS = [
  "number", "title", "url", "author", "isDraft", "mergeable", "mergeStateStatus",
  "reviewRequests", "latestReviews", "reviews", "reviewDecision", "statusCheckRollup",
  // Who spoke last: an approved PR whose newest comment is not the author's is
  // usually waiting on a reply, and that is invisible in the review states.
  "comments",
].join(",");

const SEARCH_LIMIT = 100;




export async function discoverRepos(
  gh: GhRunner,
): Promise<{ repos: string[]; truncated: boolean }> {
  const raw = await gh.run([
    "search", "prs",
    "--author=@me",
    "--state=open",
    "--limit", String(SEARCH_LIMIT),
    "--json", "repository,number",
  ]);
  const hits = JSON.parse(raw) as Array<{ repository?: { nameWithOwner?: string } }>;
  const repos = new Set<string>();
  for (const hit of hits) {
    const slug = hit.repository?.nameWithOwner;
    if (slug && REPO_SLUG_PATTERN.test(slug)) repos.add(slug);
  }
  return { repos: [...repos].sort(), truncated: hits.length >= SEARCH_LIMIT };
}

export async function fetchRepoPullRequests(
  gh: GhRunner,
  repo: string,
): Promise<RawPullRequest[]> {
  if (!REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(`Invalid repository slug: ${repo}`);
  }

  const raw = await gh.run([
    "pr", "list",
    "--repo", repo,
    "--author", "@me",
    "--state", "open",
    "--limit", "100",
    "--json", PR_LIST_FIELDS,
  ]);
  const prs = JSON.parse(raw) as RawPullRequest[];

  // GitHub computes mergeability lazily, so a first query returns UNKNOWN
  // often. Re-query those rows once; an UNKNOWN that survives stays UNKNOWN
  // and is never reported as clean.
  for (const pr of prs) {
    if (pr.mergeable !== "UNKNOWN") continue;
    try {
      const detail = await gh.run([
        "pr", "view", String(pr.number),
        "--repo", repo,
        "--json", "number,mergeable,mergeStateStatus",
      ]);
      const parsed = JSON.parse(detail) as { mergeable?: string; mergeStateStatus?: string };
      if (parsed.mergeable && parsed.mergeable !== "UNKNOWN") {
        pr.mergeable = parsed.mergeable;
        pr.mergeStateStatus = parsed.mergeStateStatus ?? pr.mergeStateStatus;
      }
    } catch {
      // Leave it UNKNOWN. The classifier flags that as mergeable-unknown.
    }
  }

  return prs;
}

export async function runSweep(gh: GhRunner, now: () => number): Promise<SweepResult> {
  const { repos, truncated } = await discoverRepos(gh);
  const rows: ClassifiedRow[] = [];
  const failedRepos: string[] = [];

  for (const repo of repos) {
    try {
      rows.push(...classify(await fetchRepoPullRequests(gh, repo), repo));
    } catch (error) {
      if (error instanceof GhUnavailableError) throw error;
      failedRepos.push(repo);
    }
  }

  return { rows, repos, failedRepos, truncated, sweptAt: now() };
}
