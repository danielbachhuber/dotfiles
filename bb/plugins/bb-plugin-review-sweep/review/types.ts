/**
 * A review request is not a defect, so this plugin has no equivalent of
 * pr-sweep's severity-ordered flag list. Every row is simply waiting on you;
 * what varies is how long, and whether you have looked at it before.
 */
export type ReviewState = "first-look" | "re-review";

export type RowGroup = "needs-review" | "draft";

export interface ChangeSize {
  additions: number;
  deletions: number;
  changedFiles: number;
}

/** Coarse buckets, so a glance can find the small one to clear now. */
export type SizeBucket = "xs" | "s" | "m" | "l" | "xl";

export interface ClassifiedRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  /** The PR author. Unlike pr-sweep, this is never you. */
  author: string;
  isDraft: boolean;
  state: ReviewState;
  /**
   * When the review landed in your queue, in epoch ms. Resolved from the
   * ReviewRequestedEvent timeline rather than the PR's own timestamps: a PR
   * opened in January and assigned to you today has been yours for a day, and
   * `updatedAt` moves on every unrelated comment.
   */
  requestedAt: number;
  /** Your most recent submitted review, or null if you have never reviewed it. */
  lastReviewedAt: number | null;
  /**
   * Everyone whose review is still outstanding, you included and listed first.
   *
   * Your own entry is the literal "you" rather than your login: every row in
   * this panel is a request of you, so repeating the same login down the whole
   * column carries no information, while "you, platform" versus "platform"
   * answers the question the column exists for — is this mine alone, or could a
   * teammate take it?
   */
  requestedReviewers: string[];
  size: ChangeSize;
}

export interface SweepResult {
  rows: ClassifiedRow[];
  /** Repositories dropped from the results: no project here matches them. */
  skippedRepos: string[];
  truncated: boolean;
  sweptAt: number;
}

// ---------------------------------------------------------------------------
// The subset of the GraphQL response this plugin reads.
// ---------------------------------------------------------------------------

export interface RawReviewRequestedEvent {
  createdAt?: string;
  requestedReviewer?: { login?: string; slug?: string } | null;
}

export interface RawReviewRequest {
  requestedReviewer?: { login?: string; slug?: string } | null;
}

export interface RawReview {
  state?: string;
  submittedAt?: string | null;
  author?: { login?: string } | null;
}

export interface RawPullRequest {
  number?: number;
  title?: string;
  url?: string;
  isDraft?: boolean;
  createdAt?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  repository?: { nameWithOwner?: string } | null;
  author?: { login?: string } | null;
  reviews?: { nodes?: Array<RawReview | null> | null } | null;
  reviewRequests?: { nodes?: Array<RawReviewRequest | null> | null } | null;
  timelineItems?: { nodes?: Array<RawReviewRequestedEvent | null> | null } | null;
}

export interface RawSearchResponse {
  data?: {
    viewer?: { login?: string } | null;
    search?: { nodes?: Array<RawPullRequest | null> | null } | null;
  } | null;
}

/**
 * Change-size thresholds, measured on lines touched rather than files, because
 * a one-line edit across nine files is still a one-line review.
 */
export function sizeBucket(size: ChangeSize): SizeBucket {
  const lines = size.additions + size.deletions;
  if (lines < 10) return "xs";
  if (lines < 50) return "s";
  if (lines < 250) return "m";
  if (lines < 1000) return "l";
  return "xl";
}

/** Whole days since the review was requested, floored. Same-day reads as 0. */
export function ageInDays(requestedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - requestedAt) / 86_400_000));
}

export function groupForRow(row: Pick<ClassifiedRow, "isDraft">): RowGroup {
  return row.isDraft ? "draft" : "needs-review";
}
