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
