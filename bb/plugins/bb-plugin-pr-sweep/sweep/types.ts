import type { ReviewNote } from "./classify.js";
import type { ThreadComment } from "./threads.js";
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

/** How big the change is, which is half of how long it will take. */
export interface ChangeSize {
  additions: number;
  deletions: number;
  changedFiles: number;
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
  /**
   * Reviewers whose latest review carries a written body.
   *
   * Invisible to every other signal: an approval with three paragraphs of
   * caveats is APPROVED, has no unresolved inline thread, and adds no issue
   * comment, so it reads as unqualified agreement.
   */
  notedBy: string[];
  /** Answered and re-requested: the ball is in the reviewer's court. */
  awaitingReReview: boolean;
  /**
   * When anything last happened, in epoch ms, or null when GitHub did not say.
   *
   * A one-line deletion waiting a week and one opened this morning are the
   * same row without it, and they are not the same decision.
   */
  updatedAt: number | null;
  /** The diff's shape. The other half of sizing the job. */
  size: ChangeSize;
  /**
   * The checks that failed, by name. "1 fail of 15" is the same sentence
   * whatever broke; the name is the difference between re-running it and
   * opening the code.
   */
  failingChecks: string[];
  /**
   * What each reviewer wrote in their review body, as they wrote it.
   *
   * `notedBy` names them; this says what they said. An approval carrying "the
   * biggest is that there is now no way to turn it on" is not an approval you
   * act on the same way as a bare one.
   */
  notes: ReviewNote[];
  /**
   * The first comment of each unresolved inline thread.
   *
   * The count told you how many; these tell you whether they are nits or
   * blockers, which is the question you were opening GitHub to answer.
   */
  threadComments: ThreadComment[];
}

/** The subset of `gh pr list --json` output this plugin reads. */
export interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  author: { login: string } | null;
  isDraft: boolean;
  /** ISO 8601. The last time anything happened, for "how long has this sat". */
  updatedAt?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable: string;
  mergeStateStatus: string;
  reviewRequests: Array<{ __typename?: string; login?: string; slug?: string; name?: string }>;
  latestReviews: Array<{
    state: string;
    author?: { login: string } | null;
    /** An approval can carry paragraphs of caveats here. See `reviewNotes`. */
    body?: string | null;
  }>;
  reviews: Array<{ state: string; author?: { login: string } | null; body?: string | null }>;
  reviewDecision: string | null;
  comments?: Array<{ author?: { login: string } | null; createdAt?: string }> | null;
  statusCheckRollup: Array<{
    __typename?: string;
    name?: string;
    /** StatusContext names itself here rather than in `name`. */
    context?: string;
    status?: string;
    conclusion?: string | null;
    state?: string;
    /** Which run of a re-run check this is. See `latestChecks`. */
    startedAt?: string | null;
  }> | null;
}

export interface SweepResult {
  rows: ClassifiedRow[];
  repos: string[];
  failedRepos: string[];
  truncated: boolean;
  sweptAt: number;
}
