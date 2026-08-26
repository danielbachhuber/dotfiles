import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RawPullRequest } from "../prs/types.js";

const execFileAsync = promisify(execFile);

export const REPO_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export const PR_LIST_FIELDS = [
  "number", "title", "url", "author", "isDraft", "mergeable", "mergeStateStatus",
  "reviewRequests", "latestReviews", "reviews", "reviewDecision", "statusCheckRollup",
].join(",");

const SEARCH_LIMIT = 100;

export class GhUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhUnavailableError";
  }
}

export interface GhRunner {
  run(args: string[]): Promise<string>;
}

/** Argument-array spawn only. A shell string is never constructed. */
export function createGhRunner(ghPath: string): GhRunner {
  return {
    async run(args: string[]) {
      try {
        const { stdout } = await execFileAsync(ghPath, args, {
          maxBuffer: 32 * 1024 * 1024,
          timeout: 60_000,
        });
        return stdout;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT/.test(message)) {
          throw new GhUnavailableError(`\`${ghPath}\` was not found on PATH.`);
        }
        if (/auth|logged in|credentials|token/i.test(message)) {
          throw new GhUnavailableError("`gh` is not authenticated. Run `gh auth login`.");
        }
        throw error;
      }
    },
  };
}

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
