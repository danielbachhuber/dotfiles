import {
  groupForRow,
  type ClassifiedRow,
  type RawPullRequest,
  type RawReviewRequestedEvent,
  type ReviewState,
} from "./types.js";

/** Epoch ms, or null for a missing or unparseable timestamp. */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A review that was actually submitted. PENDING reviews are drafts, not looks. */
const SUBMITTED_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]);

/**
 * The last time you submitted a review on this pull request, or null.
 *
 * DISMISSED counts: a dismissed approval still means you read the diff once,
 * which is what separates a re-review from a first look.
 */
export function lastReviewedAt(pr: RawPullRequest, viewer: string): number | null {
  let latest: number | null = null;
  for (const review of pr.reviews?.nodes ?? []) {
    if (!review || review.author?.login !== viewer) continue;
    if (!SUBMITTED_STATES.has((review.state ?? "").toUpperCase())) continue;
    const at = parseTime(review.submittedAt);
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/**
 * When the review became yours, as a three-step fallback so a missing timeline
 * degrades instead of throwing.
 *
 * 1. The newest request naming you directly. Exact.
 * 2. The newest request of any kind. Covers a request that reached you through
 *    a team, where the event names the team and never your login — the search
 *    query already guarantees you are a requested reviewer, so the most recent
 *    request is the one that put you here.
 * 3. The pull request's own creation time, for a PR whose timeline window
 *    (`last: N`) did not reach back far enough to include the event.
 */
export function requestedAt(pr: RawPullRequest, viewer: string): number {
  const events = (pr.timelineItems?.nodes ?? []).filter(
    (node): node is RawReviewRequestedEvent => Boolean(node),
  );

  const newest = (candidates: RawReviewRequestedEvent[]): number | null => {
    let latest: number | null = null;
    for (const event of candidates) {
      const at = parseTime(event.createdAt);
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
    return latest;
  };

  const direct = newest(events.filter((event) => event.requestedReviewer?.login === viewer));
  if (direct !== null) return direct;

  const any = newest(events);
  if (any !== null) return any;

  return parseTime(pr.createdAt) ?? 0;
}

/**
 * Who still owes a review, you first and the rest alphabetical.
 *
 * Reads `reviewRequests`, which is the set of requests still outstanding — not
 * the `ReviewRequestedEvent` timeline above, which is a history and includes
 * requests already answered or withdrawn.
 *
 * Your own entry becomes "you". A team is named by its slug, which is the
 * useful case: it tells you a teammate could take this one instead.
 */
export function requestedReviewers(pr: RawPullRequest, viewer: string): string[] {
  const others = new Set<string>();
  let includesViewer = false;

  for (const request of pr.reviewRequests?.nodes ?? []) {
    const reviewer = request?.requestedReviewer;
    if (!reviewer) continue;
    if (reviewer.login === viewer) {
      includesViewer = true;
      continue;
    }
    const name = reviewer.login ?? reviewer.slug;
    if (name) others.add(name);
  }

  return [...(includesViewer ? ["you"] : []), ...[...others].sort()];
}

/**
 * A re-review is a review you have already done that came back to you: your
 * last submitted review predates the current request. Reviewing and then being
 * re-requested is the case GitHub's own views lose most easily, and it is
 * usually the cheapest row in the queue to clear.
 *
 * The comparison is against `requested`, not "has any review": a PR you
 * reviewed *after* the last request is not waiting on you at all, and reading
 * it as a first look would be worse than reading it as a re-review.
 */
export function reviewState(reviewed: number | null, requested: number): ReviewState {
  return reviewed !== null && reviewed < requested ? "re-review" : "first-look";
}

/** Returns null for a node too incomplete to act on, rather than a broken row. */
export function classifyOne(pr: RawPullRequest, viewer: string): ClassifiedRow | null {
  const repo = pr.repository?.nameWithOwner;
  const number = pr.number;
  const url = pr.url;
  if (!repo || typeof number !== "number" || !url) return null;

  const reviewed = lastReviewedAt(pr, viewer);
  const requested = requestedAt(pr, viewer);

  return {
    repo,
    number,
    title: pr.title ?? "",
    url,
    author: pr.author?.login ?? "unknown",
    isDraft: pr.isDraft === true,
    state: reviewState(reviewed, requested),
    requestedAt: requested,
    lastReviewedAt: reviewed,
    requestedReviewers: requestedReviewers(pr, viewer),
    size: {
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changedFiles ?? 0,
    },
  };
}

/**
 * Oldest request first. This is the opposite of pr-sweep, which sorts by worst
 * flag: nothing in a review queue is broken, so the only ordering that helps is
 * the one that surfaces whoever has been waiting longest on you.
 */
export function classify(prs: Array<RawPullRequest | null>, viewer: string): ClassifiedRow[] {
  return prs
    .flatMap((pr) => (pr ? (classifyOne(pr, viewer) ?? []) : []))
    .sort((a, b) => a.requestedAt - b.requestedAt || a.repo.localeCompare(b.repo) || a.number - b.number);
}

export { groupForRow };
