import { REPO_SLUG_PATTERN, type GhRunner } from "@danielb/gh-shared/gh";

/** What the form needs back to confirm before it opens anything. */
export interface ResolvedPullRequest {
  repo: string;
  number: number;
  title: string;
  headRef: string;
  url: string;
  isDraft: boolean;
}

/**
 * Reads a pull request out of whatever the user typed: a bare number, a `#`
 * number, or a GitHub URL. The URL form carries its own repository, which wins
 * over the fallback, so pasting a link to another repository works without
 * choosing it first.
 */
export function parsePullRequestInput(
  raw: string,
  fallbackRepo: string,
): { repo: string; number: number } | { error: string } {
  const text = raw.trim();
  if (text === "") return { error: "Enter a pull request number or URL." };

  const url = text.match(
    /^https?:\/\/github\.com\/(?<repo>[^/]+\/[^/]+)\/pull\/(?<number>\d+)(?:[/?#].*)?$/,
  );
  if (url?.groups) {
    return { repo: url.groups.repo!, number: Number(url.groups.number) };
  }

  const bare = text.match(/^#?(\d+)$/);
  if (bare) {
    if (!fallbackRepo) {
      return { error: "Paste the pull request URL, or set a default repository." };
    }
    return { repo: fallbackRepo, number: Number(bare[1]) };
  }

  return { error: `Not a pull request number or URL: ${text}` };
}

/**
 * The worktree's path, beside the checkout rather than inside it.
 *
 * bb does not clean up an unmanaged worktree, so the name has to say what it
 * is months later. `<checkout>-pr-<number>` matches the sibling directories
 * already in use.
 */
export function worktreePath(projectPath: string, number: number): string {
  return `${projectPath.replace(/\/+$/, "")}-pr-${number}`;
}

export async function resolvePullRequest(
  gh: GhRunner,
  repo: string,
  number: number,
): Promise<ResolvedPullRequest> {
  if (!REPO_SLUG_PATTERN.test(repo)) throw new Error(`Invalid repository: ${repo}`);

  const raw = await gh.run([
    "pr", "view", String(number),
    "--repo", repo,
    "--json", "number,title,url,headRefName,isDraft",
  ]);
  const pr = JSON.parse(raw) as {
    number: number;
    title: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
  };

  return {
    repo,
    number: pr.number,
    title: pr.title,
    headRef: pr.headRefName,
    url: pr.url,
    isDraft: pr.isDraft,
  };
}

/**
 * What the spawned thread is told.
 *
 * Deliberately short: the worktree is already on the pull request's branch, so
 * none of pr-sweep's worktree guidance applies here and repeating it would
 * send the agent looking for a second one.
 */
export function buildOpenPrompt(pr: ResolvedPullRequest, instructions: string): string {
  const lines = [
    `You are in a git worktree checked out on \`${pr.headRef}\`, the branch of ${pr.repo}#${pr.number}: "${pr.title}".`,
    pr.url,
    "",
    "This worktree is already the pull request's branch, so commits land on it and a push updates the pull request. Do not create another worktree and do not switch branches.",
  ];

  const asked = instructions.trim();
  lines.push("", asked === "" ? "Wait for my instructions before changing anything." : asked);
  return lines.join("\n");
}
