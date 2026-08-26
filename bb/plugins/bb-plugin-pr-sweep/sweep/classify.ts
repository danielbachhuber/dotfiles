import {
  FLAG_SEVERITY,
  groupForFlags,
  type ChecksSummary,
  type ClassifiedRow,
  type Flag,
  type RawPullRequest,
} from "./types.js";

const SKIPPED_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL"]);
const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/**
 * A rollup mixes CheckRun entries (.status/.conclusion) with StatusContext
 * entries (.state). Reading .conclusion alone returns null for every status
 * context AND for every run still in progress, so both shapes are handled.
 */
export function summarizeChecks(
  rollup: RawPullRequest["statusCheckRollup"],
): ChecksSummary {
  const summary: ChecksSummary = {
    pass: 0,
    fail: 0,
    skip: 0,
    pending: 0,
    cancelled: 0,
    total: 0,
  };

  for (const entry of rollup ?? []) {
    summary.total += 1;

    // StatusContext: no status/conclusion, only state.
    if (entry.state !== undefined && entry.status === undefined) {
      const state = entry.state.toUpperCase();
      if (state === "SUCCESS") summary.pass += 1;
      else if (state === "PENDING" || state === "EXPECTED") summary.pending += 1;
      else summary.fail += 1;
      continue;
    }

    // CheckRun: a run that has not completed has no meaningful conclusion.
    if ((entry.status ?? "").toUpperCase() !== "COMPLETED") {
      summary.pending += 1;
      continue;
    }

    const conclusion = (entry.conclusion ?? "").toUpperCase();
    if (conclusion === "SUCCESS") summary.pass += 1;
    else if (SKIPPED_CONCLUSIONS.has(conclusion)) summary.skip += 1;
    else if (conclusion === "CANCELLED") summary.cancelled += 1;
    else if (FAILED_CONCLUSIONS.has(conclusion)) summary.fail += 1;
    else summary.pending += 1;
  }

  return summary;
}

const LIVE_FEEDBACK_STATES = new Set(["CHANGES_REQUESTED", "COMMENTED"]);

/** Requested reviewers, as user logins or team slugs. Never reads .login alone. */
function requestedReviewers(pr: RawPullRequest): string[] {
  return pr.reviewRequests.map((entry) => entry.login ?? entry.slug ?? entry.name ?? "unknown");
}

function approvers(pr: RawPullRequest): string[] {
  return pr.latestReviews
    .filter((entry) => entry.state === "APPROVED")
    .map((entry) => entry.author?.login)
    .filter((login): login is string => Boolean(login));
}

/** Everyone who ever commented, minus the author's own replies, deduplicated. */
function commenters(pr: RawPullRequest): string[] {
  const authorLogin = pr.author?.login ?? null;
  const seen = new Set<string>();
  for (const entry of pr.reviews) {
    const login = entry.author?.login;
    if (!login || login === authorLogin) continue;
    if (entry.state === "APPROVED" || LIVE_FEEDBACK_STATES.has(entry.state)) seen.add(login);
  }
  return [...seen];
}

/**
 * The newest comment's author, when it is not the pull request's own author.
 *
 * GitHub's review states say nothing about general comments, so an approved
 * pull request can sit with an unanswered question and still look ready. If
 * the author spoke last, the ball is with the reviewer and there is nothing to
 * report.
 */
/**
 * Accounts whose comments are not a question waiting on anyone.
 *
 * `gh pr list --json comments` exposes only `login` on the author, with no bot
 * flag, so this matches on the name: the `[bot]` suffix GitHub Apps carry, plus
 * the bare logins the common CI integrations post under. Left as a list rather
 * than a setting because a wrong entry here only costs one row's hint.
 */
const BOT_LOGINS = new Set([
  "github-actions",
  "dependabot",
  "codecov",
  "renovate",
  "vercel",
  "netlify",
  "sonarcloud",
]);

export function isBotLogin(login: string): boolean {
  return login.endsWith("[bot]") || BOT_LOGINS.has(login.toLowerCase());
}

export function lastCommentBy(pr: RawPullRequest): string | null {
  const authorLogin = pr.author?.login ?? null;
  let newest: { at: number; login: string } | null = null;

  for (const comment of pr.comments ?? []) {
    const login = comment.author?.login;
    if (!login || isBotLogin(login)) continue;
    const at = Date.parse(comment.createdAt ?? "");
    if (Number.isNaN(at)) continue;
    if (newest === null || at > newest.at) newest = { at, login };
  }

  if (newest === null || newest.login === authorLogin) return null;
  return newest.login;
}

function hasLiveFeedback(pr: RawPullRequest): boolean {
  return pr.latestReviews.some((entry) => LIVE_FEEDBACK_STATES.has(entry.state));
}

function isAwaitingReReview(pr: RawPullRequest): boolean {
  return (
    pr.reviewDecision === "CHANGES_REQUESTED" &&
    !hasLiveFeedback(pr) &&
    pr.reviewRequests.length > 0
  );
}

export function classifyOne(pr: RawPullRequest, repo: string): ClassifiedRow {
  const checks = summarizeChecks(pr.statusCheckRollup);
  const approvedBy = approvers(pr);
  const flags = new Set<Flag>();

  if (pr.mergeable === "CONFLICTING") flags.add("conflict");
  else if (pr.mergeable === "UNKNOWN") flags.add("mergeable-unknown");

  if (checks.fail > 0) flags.add("ci-failing");
  if (checks.cancelled > 0) flags.add("ci-cancelled");
  if (checks.pending > 0) flags.add("ci-pending");
  if (checks.total === 0) flags.add("ci-absent");

  if (hasLiveFeedback(pr)) flags.add("feedback");

  const covered = pr.reviewRequests.length > 0 || pr.latestReviews.length > 0;
  if (!pr.isDraft && !covered) flags.add("no-reviewer");

  // Merge readiness: everything the author controls is done. An empty rollup
  // is not green, and BLOCKED with an approval means a required review is
  // still missing, so GitHub would refuse the merge.
  const green =
    checks.total > 0 && checks.fail === 0 && checks.pending === 0 && checks.cancelled === 0;
  const ready =
    approvedBy.length > 0 &&
    green &&
    pr.mergeable === "MERGEABLE" &&
    !pr.isDraft &&
    !hasLiveFeedback(pr);

  if (ready) {
    if (pr.mergeStateStatus === "BLOCKED") flags.add("merge-blocked");
    else flags.add("merge-ready");
  }

  const ordered = FLAG_SEVERITY.filter((flag) => flags.has(flag));

  return {
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    flags: ordered,
    group: groupForFlags(ordered),
    checks,
    approvedBy,
    commentedBy: commenters(pr),
    waitingOn: requestedReviewers(pr),
    lastCommentBy: lastCommentBy(pr),
    awaitingReReview: isAwaitingReReview(pr),
  };
}

export function classify(prs: RawPullRequest[], repo: string): ClassifiedRow[] {
  return prs
    .map((pr) => classifyOne(pr, repo))
    .sort((a, b) => {
      const rank = (row: ClassifiedRow) =>
        row.flags.length === 0 ? FLAG_SEVERITY.length : FLAG_SEVERITY.indexOf(row.flags[0]!);
      return rank(a) - rank(b) || a.number - b.number;
    });
}
