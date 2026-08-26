export const REPO_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** The subset of `gh search issues --json` output this plugin reads. */
export interface RawIssue {
  number: number;
  title: string;
  url: string;
  repository?: { nameWithOwner?: string };
  labels?: Array<{ name?: string }>;
  createdAt?: string;
  updatedAt?: string;
  commentsCount?: number;
  isPullRequest?: boolean;
}

export interface IssueRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  /** Epoch milliseconds, so the panel can format without reparsing. */
  createdAt: number;
  updatedAt: number;
  commentsCount: number;
}

export interface SweepResult {
  rows: IssueRow[];
  truncated: boolean;
  sweptAt: number;
}

/**
 * Narrows one search hit to a row, or null when it is not an issue this panel
 * should list. GitHub models pull requests as issues, so the search returns
 * both; everything else dropped here is a hit too malformed to render.
 */
export function toRow(raw: RawIssue): IssueRow | null {
  if (raw.isPullRequest) return null;

  const repo = raw.repository?.nameWithOwner;
  if (!repo || !REPO_SLUG_PATTERN.test(repo)) return null;

  const createdAt = Date.parse(raw.createdAt ?? "");
  // A hit with no updatedAt takes its creation time rather than 0, which would
  // sink an untouched issue to the bottom of a table sorted on activity.
  const updatedAt = Date.parse(raw.updatedAt ?? "");
  const resolvedUpdatedAt = Number.isNaN(updatedAt) ? createdAt : updatedAt;
  if (Number.isNaN(resolvedUpdatedAt)) return null;

  return {
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    labels: (raw.labels ?? []).map((label) => label.name).filter((name): name is string => !!name),
    createdAt: Number.isNaN(createdAt) ? resolvedUpdatedAt : createdAt,
    updatedAt: resolvedUpdatedAt,
    commentsCount: raw.commentsCount ?? 0,
  };
}

/**
 * Newest activity first. The repo-then-number tiebreak matters more than it
 * looks: rows come back from SQLite in insertion order, and issues bulk-edited
 * in one action share a timestamp to the second, so without it those rows
 * would reshuffle between sweeps.
 */
export function sortRows(rows: readonly IssueRow[]): IssueRow[] {
  return [...rows].sort(
    (a, b) =>
      b.updatedAt - a.updatedAt || a.repo.localeCompare(b.repo) || a.number - b.number,
  );
}
