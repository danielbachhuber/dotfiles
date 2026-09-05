import { REPO_SLUG_PATTERN } from "./gh.js";

export interface ProjectCandidate {
  id: string;
  remoteUrls: string[];
  /**
   * The host holding this project's default checkout, when the caller looked
   * it up. Optional so a caller that only needs an id need not gather it.
   *
   * Worth gathering for anything that seeds or spawns a `host` environment:
   * bb's schema declares `hostId` optional and then rejects the environment
   * without it unless the workspace is `personal` — "hostId is required unless
   * workspace.type is personal". In the composer that rejection is silent, and
   * the environment picker just falls back to the local checkout.
   */
  hostId?: string;
}

/** Returns `owner/name` for a GitHub remote in any common form, else null. */
export function parseRemoteSlug(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const patterns = [
    /^git@github\.com:(?<slug>[^/]+\/[^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/(?<slug>[^/]+\/[^/]+?)(?:\.git)?$/,
    /^https?:\/\/(?:[^@]+@)?github\.com\/(?<slug>[^/]+\/[^/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const slug = trimmed.match(pattern)?.groups?.slug;
    if (slug) return slug;
  }
  return null;
}

export function matchProjectForRepo(
  repo: string,
  candidates: ProjectCandidate[],
): string | null {
  const target = repo.toLowerCase();
  for (const candidate of candidates) {
    for (const url of candidate.remoteUrls) {
      if (parseRemoteSlug(url)?.toLowerCase() === target) return candidate.id;
    }
  }
  return null;
}

/**
 * The project matching a repository, with the host its checkout lives on.
 *
 * Separate from {@link matchProjectForRepo} rather than replacing it: most
 * callers only need the id, and a null host is not a reason to refuse them.
 */
export function matchProjectTargetForRepo(
  repo: string,
  candidates: ProjectCandidate[],
): { id: string; hostId: string | null } | null {
  const target = repo.toLowerCase();
  for (const candidate of candidates) {
    for (const url of candidate.remoteUrls) {
      if (parseRemoteSlug(url)?.toLowerCase() === target) {
        return { id: candidate.id, hostId: candidate.hostId ?? null };
      }
    }
  }
  return null;
}

/**
 * The `owner/name` slugs of every project bb knows about on this machine.
 *
 * bb's project list is per-installation, so a project checked out on another
 * computer is simply absent here — which is the whole basis of the filter.
 */
export function loadedRepoSlugs(candidates: ProjectCandidate[]): Set<string> {
  const slugs = new Set<string>();
  for (const candidate of candidates) {
    for (const url of candidate.remoteUrls) {
      const slug = parseRemoteSlug(url);
      if (slug) slugs.add(slug.toLowerCase());
    }
  }
  return slugs;
}

/**
 * Reads the `extraRepositories` setting: repositories to sweep even with no
 * checkout here.
 *
 * Every entry is validated against {@link REPO_SLUG_PATTERN} rather than at the
 * call site, because these strings become `gh` arguments. An entry that does
 * not look like a slug is dropped, not passed along.
 */
export function parseExtraRepositories(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0 && REPO_SLUG_PATTERN.test(entry));
}

export interface RepoFilter {
  /** True when the filter is narrowing anything at all. */
  scoped: boolean;
  allows(repo: string): boolean;
  partition(repos: string[]): { kept: string[]; skipped: string[] };
}

/**
 * Restricts a sweep to the repositories checked out on this machine.
 *
 * Deliberately does not fall back to "allow everything" when no project
 * matches: a machine with nothing checked out is exactly the case the setting
 * exists for, and a silent widening there would be indistinguishable from the
 * filter not working. The panels report what was skipped instead.
 */
export function buildRepoFilter(options: {
  enabled: boolean;
  candidates: ProjectCandidate[];
  extras: string;
}): RepoFilter {
  const { enabled, candidates, extras } = options;
  if (!enabled) {
    return {
      scoped: false,
      allows: () => true,
      partition: (repos) => ({ kept: [...repos], skipped: [] }),
    };
  }

  const allowed = loadedRepoSlugs(candidates);
  for (const extra of parseExtraRepositories(extras)) allowed.add(extra);

  const allows = (repo: string) => allowed.has(repo.toLowerCase());
  return {
    scoped: true,
    allows,
    partition: (repos) => {
      const kept: string[] = [];
      const skipped: string[] = [];
      for (const repo of repos) (allows(repo) ? kept : skipped).push(repo);
      return { kept, skipped };
    },
  };
}
