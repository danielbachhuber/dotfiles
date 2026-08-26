import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PullRequestsPanel, NeedsActionCount, OpenPullRequest } from "./prs/panel.js";
import { ReviewsPanel, NeedsReviewCount, OpenReviewedPullRequest } from "./reviews/panel.js";
import { IssuesPanel, AssignedCount } from "./issues/panel.js";
import {
  NewIssuePage,
  CreateIssueComposerAction,
  CreateIssueHeaderAction,
} from "./new-issue/panel.js";

/**
 * Four sidebar rows from one plugin, unchanged from when they were four
 * plugins: same ids, paths and icons, so nothing the user had pinned or
 * learned moves.
 *
 * The three header actions carry distinct ids and each resolves ownership on
 * the server, so a thread only ever shows the control belonging to the domain
 * that started it.
 */
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "prs",
    title: "Pull requests",
    icon: "GitPullRequest",
    path: "prs",
    component: PullRequestsPanel,
    experimental_sidebarAccessory: NeedsActionCount,
  });

  app.slots.navPanel({
    id: "reviews",
    title: "Reviews",
    icon: "Eye",
    path: "reviews",
    component: ReviewsPanel,
    experimental_sidebarAccessory: NeedsReviewCount,
  });

  app.slots.navPanel({
    id: "issues",
    title: "Issues",
    icon: "ListTodo",
    path: "issues",
    component: IssuesPanel,
    experimental_sidebarAccessory: AssignedCount,
  });

  app.slots.navPanel({
    id: "new-issue",
    title: "New issue",
    icon: "Plus",
    path: "new-issue",
    component: NewIssuePage,
  });

  app.composer.customize({
    id: "create-issue",
    scopes: ["thread"],
    actions: [{ id: "create-issue", component: CreateIssueComposerAction }],
  });

  app.slots.experimental_threadHeaderAction({
    id: "open-pull-request",
    title: "Open pull request",
    component: OpenPullRequest,
  });

  app.slots.experimental_threadHeaderAction({
    id: "open-reviewed-pull-request",
    title: "Open pull request",
    component: OpenReviewedPullRequest,
  });

  app.slots.experimental_threadHeaderAction({
    id: "create-issue",
    title: "Create issue",
    component: CreateIssueHeaderAction,
  });
});
