import { workSteps } from "./actions.js";
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
    case "merge-ready": {
      const threads =
        row.unresolvedThreads > 0
          ? ` There ${row.unresolvedThreads === 1 ? "is" : "are"} ${row.unresolvedThreads} unresolved review comment${row.unresolvedThreads === 1 ? "" : "s"}${row.outdatedThreads > 0 ? `, ${row.outdatedThreads} of them on code that has since changed` : ""}. Read and answer them before merging; an approval does not clear them.`
          : "";
      return `It is approved${row.approvedBy.length ? ` by ${row.approvedBy.join(", ")}` : ""} and every check is green${row.waitingOn.length ? `, though ${row.waitingOn.join(", ")} has not reviewed yet` : ""}.${threads}`;
    }
    default:
      return null;
  }
}

export function buildPrompt(row: ClassifiedRow): string {
  const steps = workSteps(row.flags, row.unresolvedThreads);

  if (steps.length === 0) {
    return [
      `Look at pull request ${row.repo}#${row.number}: "${row.title}".`,
      row.url,
      "",
      "A deterministic sweep flagged nothing on it. Use the `pr-sweep` skill to check whether that is right.",
    ].join("\n");
  }

  // Numbered because the steps are sequential, not a menu: resolving a conflict
  // changes the code that review feedback refers to, and a fixed CI run changes
  // what is left to answer. One thread walks them in this order.
  const numbered = steps.flatMap(({ flag, skill }, index) => {
    const finding = describeFlag(flag, row);
    return [
      `${index + 1}. ${finding ?? flag}`,
      `   Use the \`${skill}\` skill.`,
    ];
  });

  const usesPrSweep = steps.some((step) => step.skill === "pr-sweep");

  return [
    `Work through pull request ${row.repo}#${row.number}: "${row.title}".`,
    row.url,
    "",
    steps.length === 1
      ? "A deterministic sweep found one thing:"
      : `A deterministic sweep found ${steps.length} things, worst first. Finish each step, including its commit and push, before starting the next, and re-check the later ones afterwards — an earlier fix often changes them:`,
    ...numbered,
    "",
    // Standing user instructions forbid committing without an explicit ask and
    // outrank a skill, so without this the thread does the work and stops at a
    // staged merge. Clicking the row's action is that ask.
    "I started this from the PR Sweep panel, which is my explicit request for this work. Follow each skill all the way through, including its commit, push, and reply steps. You do not need to ask me before committing or pushing to this PR's own branch.",
    "Still ask me first before: force-pushing, rewriting any pushed commit, or merging the PR.",
    "",
    // The thread starts in a bb-managed worktree on a fresh branch, not the
    // pull request's. A prompt that just said "work in a worktree" sent an
    // agent that was already in one to build a second at an arbitrary /tmp
    // path, where bb could not see the work and the diff panel read "no
    // changes".
    "You already have a git worktree: the one this thread starts in. It is on a new branch, not this pull request's, so check the branch before editing anything. Get onto the PR's head branch — the skills above tell you how.",
    "If a skill has you create a worktree, create it at a path INSIDE the one you start in, using a relative path such as `.claude/worktrees/pr-<n>`. bb owns the directory this thread runs in and deletes it when the thread is archived, so a worktree inside it is cleaned up with everything else. One created somewhere else, `/tmp` especially, outlives the thread, stays invisible to bb's diff, and has to be found and removed by hand. Never point `git worktree add` at the directory you are already in.",
    ...(usesPrSweep
      ? [
          "",
          "For any step above whose skill is `pr-sweep`, that skill is triage rather than a fixed workflow, so show me the evidence — the failing log, the thread bodies — before proposing work.",
        ]
      : []),
  ].join("\n");
}
