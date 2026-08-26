import type { RawPullRequest, RawSearchResponse } from "./types.js";

/**
 * All fixtures are synthetic. `~/.dotfiles` is a public repository: never paste
 * a real pull request title, reviewer login, repository name, or URL into a
 * test.
 */

/** A fixed instant, so "days waiting" assertions never depend on the clock. */
export const NOW = Date.parse("2026-03-10T12:00:00Z");

export function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

export function reviewRequest(reviewer: { login?: string; slug?: string }, at: string) {
  return { createdAt: at, requestedReviewer: reviewer };
}

export function submittedReview(state: string, login: string, at: string) {
  return { state, submittedAt: at, author: { login } };
}

export function makePr(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
  return {
    number: 1,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/1",
    isDraft: false,
    createdAt: daysAgo(9),
    additions: 40,
    deletions: 6,
    changedFiles: 3,
    repository: { nameWithOwner: "acme/widgets" },
    author: { login: "octocat" },
    reviews: { nodes: [] },
    timelineItems: { nodes: [reviewRequest({ login: "hubot" }, daysAgo(4))] },
    ...overrides,
  };
}

/** The shape `gh api graphql` prints, wrapped exactly as the real one is. */
export function makeSearchResponse(
  prs: RawPullRequest[],
  viewer = "hubot",
): RawSearchResponse {
  return { data: { viewer: { login: viewer }, search: { nodes: prs } } };
}
