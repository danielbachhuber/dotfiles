/** Ordered worst-first. Index in this array IS the severity rank. */
export const FLAG_SEVERITY = [
  "conflict",
  "ci-failing",
  "feedback",
  "merge-blocked",
  "mergeable-unknown",
  "ci-cancelled",
  "ci-absent",
  "no-reviewer",
  "ci-pending",
  "merge-ready",
] as const;

export type Flag = (typeof FLAG_SEVERITY)[number];

export type RowGroup = "needs-action" | "ready-to-merge" | "clean";

export function groupForFlags(flags: readonly Flag[]): RowGroup {
  if (flags.includes("merge-ready")) return "ready-to-merge";
  return flags.length > 0 ? "needs-action" : "clean";
}

export interface ChecksSummary {
  pass: number;
  fail: number;
  skip: number;
  pending: number;
  cancelled: number;
  total: number;
}

export interface ClassifiedRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  flags: Flag[];
  group: RowGroup;
  checks: ChecksSummary;
  /** Logins with a standing APPROVED review. */
  approvedBy: string[];
  /** Logins who ever commented, author's own replies dropped, deduplicated. */
  commentedBy: string[];
  /** Requested reviewers still outstanding: user logins and team slugs. */
  waitingOn: string[];
  /**
   * The last person to comment, when that is not the pull request's author.
   * A general comment is invisible to reviewDecision and to latestReviews, so
   * an approved pull request can carry an unanswered question and still read
   * as ready to merge.
   */
  lastCommentBy: string | null;
  /**
   * Unresolved inline review threads. Invisible to every field `gh pr list`
   * can return, and the reason an approved pull request can still have
   * comments to address.
   */
  unresolvedThreads: number;
  /** Of those, how many sit on code that has since changed. */
  outdatedThreads: number;
  /** Answered and re-requested: the ball is in the reviewer's court. */
  awaitingReReview: boolean;
}

/** The subset of `gh pr list --json` output this plugin reads. */
export interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  author: { login: string } | null;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewRequests: Array<{ __typename?: string; login?: string; slug?: string; name?: string }>;
  latestReviews: Array<{ state: string; author?: { login: string } | null }>;
  reviews: Array<{ state: string; author?: { login: string } | null }>;
  reviewDecision: string | null;
  comments?: Array<{ author?: { login: string } | null; createdAt?: string }> | null;
  statusCheckRollup: Array<{
    __typename?: string;
    name?: string;
    status?: string;
    conclusion?: string | null;
    state?: string;
  }> | null;
}

export interface SweepResult {
  rows: ClassifiedRow[];
  repos: string[];
  failedRepos: string[];
  truncated: boolean;
  sweptAt: number;
}
