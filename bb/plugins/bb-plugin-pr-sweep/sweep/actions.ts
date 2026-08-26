import { FLAG_SEVERITY, type Flag } from "./types.js";

/**
 * The action a flag implies, phrased as the thing the agent will go do. Keyed
 * by flag; the row's worst flag wins, so a PR that both conflicts and has
 * feedback reads "Resolve conflict" (the conflict blocks the feedback work).
 *
 * Kept short on purpose: these render inside a small button beside a title
 * that is already truncating.
 */
const ACTION_LABELS: Record<Flag, string> = {
  conflict: "Resolve conflict",
  "ci-failing": "Fix failing CI",
  feedback: "Answer feedback",
  "merge-blocked": "Unblock merge",
  "mergeable-unknown": "Re-check merge state",
  "ci-cancelled": "Re-run CI",
  "ci-absent": "Check missing CI",
  "no-reviewer": "Add a reviewer",
  "ci-pending": "Check on CI",
  "merge-ready": "Merge",
};

/**
 * The skill that owns each kind of work. Two flags have a dedicated skill that
 * specifies the whole flow, including worktree setup on the PR's own branch;
 * everything else routes to pr-sweep, whose playbooks cover the rest.
 *
 * Routing beats restating: `resolve-merge-conflicts` knows that a bare
 * `EnterWorktree` branches from origin/main and is therefore wrong for a PR.
 * A prompt that hand-rolled its own worktree advice would contradict it.
 */
const SKILL_FOR: Partial<Record<Flag, string>> = {
  conflict: "resolve-merge-conflicts",
  feedback: "address-code-review",
};

const DEFAULT_SKILL = "pr-sweep";

/** Falls back to a generic label if a row somehow carries no known flag. */
export function actionLabel(flags: readonly string[]): string {
  for (const flag of FLAG_SEVERITY) {
    if (flags.includes(flag)) return ACTION_LABELS[flag];
  }
  return "Work on this";
}

/** The skill for a row's worst flag, which is the work its action starts. */
export function skillFor(flags: readonly string[]): string {
  for (const flag of FLAG_SEVERITY) {
    if (flags.includes(flag)) return SKILL_FOR[flag] ?? DEFAULT_SKILL;
  }
  return DEFAULT_SKILL;
}

/** True when a dedicated skill specifies the whole flow, worktree included. */
export function skillOwnsWorkflow(flags: readonly string[]): boolean {
  return skillFor(flags) !== DEFAULT_SKILL;
}
