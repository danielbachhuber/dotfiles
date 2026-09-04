import type { GithubData, Issue, PullRequest, Review } from "../types.js";
import type { Range } from "../dates.js";
import { normalizeClosedAt } from "../dates.js";
import { runJson } from "./shell.js";

export async function fetchGithub(
  range: Range,
  config: { gh: string; repo: string; author: string },
): Promise<GithubData> {
  const { gh, repo, author } = config;
  const search = (kind: "prs" | "issues", args: string[], fields: string) =>
    runJson<any[]>(gh, [
      "search", kind, "--repo", repo, "--limit", "1000", "--json", fields, ...args,
    ]);

  const window = `${range.from}..${range.to}`;
  const prFields = "number,title,state,createdAt,closedAt,url,isDraft";

  const [created, merged, reviewed, issuesCreated, issuesAssigned] = await Promise.all([
    search("prs", ["--author", author, "--created", window], prFields),
    // A PR opened weeks ago but merged this week still belongs in the week.
    search("prs", ["--author", author, "--merged-at", window], prFields),
    search("prs", ["--reviewed-by", author, "--updated", window],
      "number,title,author,state,url,updatedAt"),
    search("issues", ["--author", author, "--created", window],
      "number,title,state,createdAt,url"),
    // A current snapshot, deliberately not bounded by the week — it feeds priorities.
    search("issues", ["--assignee", author, "--state", "open"],
      "number,title,createdAt,updatedAt,url,labels"),
  ]);

  return {
    authored: dedupeByNumber([...created, ...merged].map(toPullRequest)),
    // `--reviewed-by` also matches your own PRs; this section is about
    // reviewing other people's work, so drop the self-authored ones.
    reviewed: dedupeByNumber(reviewed.map(toReview).filter((r) => r.author !== author)),
    issuesCreated: dedupeByNumber(issuesCreated.map(toIssue)),
    issuesAssigned: dedupeByNumber(issuesAssigned.map(toIssue)),
  };
}

function toPullRequest(raw: any): PullRequest {
  return {
    number: raw.number,
    title: raw.title ?? "",
    url: raw.url ?? "",
    state: raw.state ?? "open",
    createdAt: raw.createdAt,
    closedAt: normalizeClosedAt(raw.closedAt),
    isDraft: Boolean(raw.isDraft),
  };
}

function toReview(raw: any): Review {
  return {
    number: raw.number,
    title: raw.title ?? "",
    url: raw.url ?? "",
    author: raw.author?.login ?? "unknown",
    state: raw.state ?? "",
    updatedAt: raw.updatedAt,
  };
}

function toIssue(raw: any): Issue {
  return {
    number: raw.number,
    title: raw.title ?? "",
    url: raw.url ?? "",
    state: raw.state,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    labels: (raw.labels ?? [])
      .map((l: any) => (typeof l === "string" ? l : l?.name))
      .filter(Boolean),
  };
}

/** The created and merged queries overlap whenever a PR was opened and merged in the same week. */
function dedupeByNumber<T extends { number: number }>(items: T[]): T[] {
  const seen = new Map<number, T>();
  for (const item of items) if (!seen.has(item.number)) seen.set(item.number, item);
  return [...seen.values()].sort((a, b) => b.number - a.number);
}
