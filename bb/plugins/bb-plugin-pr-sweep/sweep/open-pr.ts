import { REPO_SLUG_PATTERN, type GhRunner } from "@danielb/gh-shared/gh";
import { parseRemoteSlug } from "./spawn-target.js";

/** What the form needs back to confirm before it opens anything. */
export interface ResolvedPullRequest {
  repo: string;
  number: number;
  title: string;
  headRef: string;
  url: string;
  isDraft: boolean;
  /**
   * The repository the branch actually lives in. `null` once the fork it came
   * from has been deleted, which GitHub allows while the pull request stays
   * open.
   */
  headRepo: string | null;
  /** True when the branch lives in a fork rather than in `repo` itself. */
  isFork: boolean;
  /** False when the author has not allowed maintainer edits to the branch. */
  maintainerCanModify: boolean;
}

/**
 * How to get the pull request's branch into a worktree.
 *
 * A fork needs a different fetch and a different push target, and both have to
 * be decided from the pull request rather than discovered when git fails, so
 * the decision is a value the caller can test.
 */
export type WorktreePlan =
  | { kind: "origin"; branch: string }
  | {
      kind: "fork";
      branch: string;
      /** `refs/pull/<n>/head` on the base repository. */
      prRef: string;
      /** A remote name or URL for the fork, or `null` when the fork has gone. */
      pushTo: string | null;
      repo: string;
      number: number;
    };

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

/**
 * The plan for a pull request, given the checkout's remotes.
 *
 * The local branch is named after the pull request's own branch even for a
 * fork. That is not cosmetic: `git push` refuses a branch whose upstream has a
 * different name, and `gh pr view` — which is how bb resolves a thread's pull
 * request — looks the pull request up by the local branch name.
 */
export function worktreePlan(
  pr: ResolvedPullRequest,
  remotes: { name: string; url: string }[],
): WorktreePlan {
  if (!pr.isFork) return { kind: "origin", branch: pr.headRef };
  return {
    kind: "fork",
    branch: pr.headRef,
    prRef: `refs/pull/${pr.number}/head`,
    pushTo: pushTargetForRepo(remotes, pr.headRepo),
    repo: pr.repo,
    number: pr.number,
  };
}

/**
 * Where a push to the fork should go.
 *
 * A remote already pointing at the fork wins over the URL: this checkout keeps
 * ssh remotes for the forks it works with, and those carry whatever
 * per-remote configuration they were set up with.
 */
export function pushTargetForRepo(
  remotes: { name: string; url: string }[],
  repo: string | null,
): string | null {
  if (!repo) return null;
  const match = remotes.find(
    (remote) => parseRemoteSlug(remote.url)?.toLowerCase() === repo.toLowerCase(),
  );
  return match ? match.name : `https://github.com/${repo}.git`;
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
    "--json",
    "number,title,url,headRefName,isDraft,isCrossRepository,headRepository,headRepositoryOwner,maintainerCanModify",
  ]);
  const pr = JSON.parse(raw) as {
    number: number;
    title: string;
    url: string;
    headRefName: string;
    isDraft: boolean;
    isCrossRepository?: boolean;
    headRepository?: { name?: string } | null;
    headRepositoryOwner?: { login?: string } | null;
    maintainerCanModify?: boolean;
  };

  // `headRepository` is only ever the bare name, so the owner has to be joined
  // back on to make a slug. Both go missing when the fork is deleted.
  const owner = pr.headRepositoryOwner?.login;
  const name = pr.headRepository?.name;
  const headRepo = owner && name ? `${owner}/${name}` : null;

  return {
    repo,
    number: pr.number,
    title: pr.title,
    headRef: pr.headRefName,
    url: pr.url,
    isDraft: pr.isDraft,
    headRepo: pr.isCrossRepository ? headRepo : repo,
    isFork: pr.isCrossRepository === true,
    maintainerCanModify: pr.maintainerCanModify !== false,
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

  if (pr.isFork) {
    if (!pr.headRepo) {
      lines.push(
        `The branch came from a fork that has since been deleted, so there is nowhere to push. Treat this as read-only and say so rather than working around it.`,
      );
    } else if (!pr.maintainerCanModify) {
      lines.push(
        `The branch lives on the fork \`${pr.headRepo}\`, and its author has not allowed maintainer edits, so a push will be rejected. Say so rather than working around it.`,
      );
    } else {
      lines.push(
        `The branch lives on the fork \`${pr.headRepo}\`, and this worktree is configured to push there, so \`git push\` still updates the pull request.`,
      );
    }
  }

  const asked = instructions.trim();
  lines.push("", asked === "" ? "Wait for my instructions before changing anything." : asked);
  return lines.join("\n");
}
