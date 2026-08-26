import { skillFor, skillOwnsWorkflow } from "./actions.js";
import type { ClassifiedRow, Flag } from "./types.js";

/**
 * What the sweep found, stated as fact. Deliberately not prescriptive: the
 * skill named at the top of the prompt owns the method, and a second, looser
 * account of the same workflow here would compete with it.
 */
function describeFlag(flag: Flag, row: ClassifiedRow): string | null {
  switch (flag) {
    case "conflict":
      return "It conflicts with its base branch.";
    case "mergeable-unknown":
      return "GitHub has not computed its mergeability, across two queries.";
    case "ci-failing":
      return `CI is failing: ${row.checks.fail} failing of ${row.checks.total} checks.`;
    case "ci-cancelled":
      return `A CI run was cancelled: ${row.checks.cancelled} of ${row.checks.total} checks.`;
    case "ci-absent":
      return "CI never ran. The check rollup is empty, which is not the same as green.";
    case "ci-pending":
      return `CI is still in flight: ${row.checks.pending} of ${row.checks.total} checks running.`;
    case "feedback":
      return `There is live reviewer feedback${row.commentedBy.length ? ` from ${row.commentedBy.join(", ")}` : ""}.`;
    case "no-reviewer":
      return "It is not a draft and has no reviewer requested and no reviews.";
    case "merge-blocked":
      return "It is approved and green, but GitHub reports the merge as blocked, so a required review or ruleset is unsatisfied.";
    case "merge-ready":
      return `It is approved${row.approvedBy.length ? ` by ${row.approvedBy.join(", ")}` : ""} and every check is green${row.waitingOn.length ? `, though ${row.waitingOn.join(", ")} has not reviewed yet` : ""}.`;
    default:
      return null;
  }
}

export function buildPrompt(row: ClassifiedRow): string {
  const problems = row.flags
    .map((flag) => describeFlag(flag, row))
    .filter((text): text is string => text !== null)
    .map((text) => `- ${text}`);

  const skill = skillFor(row.flags);

  // A dedicated skill specifies the whole flow, ending in a commit and a push.
  // Standing user instructions forbid committing without an explicit ask, and
  // those instructions outrank a skill — so without this paragraph the thread
  // does the work, stops at a staged merge, and reports that it did not commit
  // "per repository instructions". Clicking the row's action IS the ask, so
  // the prompt says so and lets the skill run to its end.
  const authorization = skillOwnsWorkflow(row.flags)
    ? [
        "",
        "I started this from the PR Sweep panel, which is my explicit request for this work. Follow the skill all the way through, including its commit and push steps. You do not need to ask me before committing or pushing to this PR's own branch.",
        "Still ask me first before: force-pushing, rewriting any pushed commit, merging the PR, or posting a review reply.",
      ]
    : [];

  const guardrails = skillOwnsWorkflow(row.flags)
    ? []
    : [
        "",
        "In particular:",
        "- Show me the evidence (the failing log, the thread bodies, the conflicting files) before proposing any work.",
        "- Make code changes in a worktree, never by checking out the branch in my own checkout.",
        "- Show the diff and stop. Commit only after I approve.",
        "- Ask before anything leaves the machine: pushing, replying, assigning a reviewer, re-running CI, or merging.",
      ];

  return [
    `Use the \`${skill}\` skill to work on pull request ${row.repo}#${row.number}: "${row.title}".`,
    row.url,
    "",
    problems.length ? "What a deterministic sweep found:" : "No problems were flagged.",
    ...problems,
    ...authorization,
    ...guardrails,
  ].join("\n");
}
