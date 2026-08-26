import type { RawPullRequest } from "./types.js";

export function checkRun(name: string, status: string, conclusion: string | null) {
  return {
    __typename: "CheckRun",
    name,
    status,
    conclusion,
    workflowName: "ci",
    detailsUrl: `https://example.test/checks/${name}`,
  };
}

export function statusContext(name: string, state: string) {
  return { __typename: "StatusContext", name, state };
}

export function userRequest(login: string) {
  return { __typename: "User", login };
}

export function teamRequest(slug: string) {
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return { __typename: "Team", name, slug };
}

export function review(state: string, login: string) {
  return { state, author: { login } };
}

export function makePr(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
  return {
    number: 1,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/1",
    author: { login: "octocat" },
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewRequests: [],
    latestReviews: [],
    reviews: [],
    reviewDecision: null,
    statusCheckRollup: [checkRun("build", "COMPLETED", "SUCCESS")],
    ...overrides,
  };
}
