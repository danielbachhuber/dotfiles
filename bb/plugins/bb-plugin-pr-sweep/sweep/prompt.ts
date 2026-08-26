import type { ClassifiedRow, Flag } from "./types.js";

function describeFlag(flag: Flag, row: ClassifiedRow): string | null {
  switch (flag) {
    case "conflict":
      return "It conflicts with its base branch. Work in a worktree and merge the base branch in rather than rebasing, since the branch is already pushed.";
    case "mergeable-unknown":
      return "GitHub has not computed its mergeability. Re-check before assuming it is clean.";
    case "ci-failing":
      return `CI is failing (${row.checks.fail} failing of ${row.checks.total}). Read the failing log before touching any code, then reproduce it locally with the repo's own command.`;
    case "ci-cancelled":
      return "A CI run was cancelled. Check whether it was superseded or killed before re-running it.";
    case "ci-absent":
      return "CI never ran on this PR. Find out why rather than assuming it is green.";
    case "ci-pending":
      return "CI is still in flight. The run decides; do not pre-empt it.";
    case "feedback":
      return `There is live reviewer feedback${row.commentedBy.length ? ` from ${row.commentedBy.join(", ")}` : ""}. List the unresolved threads and read the bodies. Not every thread asks for a change.`;
    case "no-reviewer":
      return "It has no reviewer. Suggest one based on the changed paths, and ask before assigning.";
    case "merge-blocked":
      return "It is approved and green, but GitHub reports the merge as blocked, so a required review or ruleset is unsatisfied. Find out which one.";
    case "merge-ready":
      return `It is approved${row.approvedBy.length ? ` by ${row.approvedBy.join(", ")}` : ""} and green${row.waitingOn.length ? `, though ${row.waitingOn.join(", ")} has not reviewed yet` : ""}. Confirm before merging.`;
    default:
      return null;
  }
}

export function buildPrompt(row: ClassifiedRow): string {
  const problems = row.flags
    .map((flag) => describeFlag(flag, row))
    .filter((text): text is string => text !== null)
    .map((text) => `- ${text}`);

  return [
    `Work on pull request ${row.repo}#${row.number}: "${row.title}".`,
    row.url,
    "",
    problems.length ? "What a deterministic sweep found:" : "No problems were flagged.",
    ...problems,
    "",
    "Use the `pr-sweep` skill's playbook for each of these. In particular:",
    "- Show me the evidence (the failing log, the thread bodies, the conflicting files) before proposing any work.",
    "- Make code changes in a worktree, never by checking out the branch in my own checkout.",
    "- Show the diff and stop. Commit only after I approve.",
    "- Ask before anything leaves the machine: pushing, replying, assigning a reviewer, re-running CI, or merging.",
  ].join("\n");
}
