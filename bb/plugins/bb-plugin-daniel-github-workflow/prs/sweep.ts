import { classify } from "./classify.js";
import type { ClassifiedRow, SweepResult } from "./types.js";
import {
  GhUnavailableError,
  discoverRepos,
  fetchRepoPullRequests,
  type GhRunner,
} from "../shared/gh.js";

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
