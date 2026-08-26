export interface ProjectCandidate {
  id: string;
  remoteUrls: string[];
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
