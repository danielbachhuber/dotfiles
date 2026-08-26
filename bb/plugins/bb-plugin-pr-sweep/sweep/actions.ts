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
  feedback: "Address feedback",
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

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 */
export const MAX_THREAD_TITLE = 30;

/**
 * "Resolve conflict #5687", or "Address issues #5780" when the row needed more
 * than one thing. Deliberately the same string the button carried, so the
 * sidebar entry names the work the user asked for rather than a step of it.
 *
 * The number is what identifies the pull request, so if the pair somehow
 * exceeds the budget the label gives way, never the number.
 */
export function threadTitle(flags: readonly string[], number: number): string {
  const suffix = ` #${number}`;
  const label = actionSummary(flags);
  const full = `${label}${suffix}`;
  if (full.length <= MAX_THREAD_TITLE) return full;

  const room = MAX_THREAD_TITLE - suffix.length;
  if (room <= 1) return suffix.trimStart().slice(0, MAX_THREAD_TITLE);
  return `${label.slice(0, room - 1).trimEnd()}…${suffix}`;
}

/**
 * Model per action, keyed by the row's worst flag. Anything unlisted uses the
 * provider's default.
 *
 * Note that `resolve-merge-conflicts` argues the markers are the easy part and
 * the real work is the semantic collisions git could not mark, so a conflict is
 * arguably the worst candidate for a cheap model. The default below is the
 * user's explicit choice; override it with the "Model by action" setting.
 */
export const DEFAULT_MODEL_BY_ACTION: Record<string, string> = {
  conflict: "claude-sonnet-5",
};

/**
 * Parses the "Model by action" setting. Never throws: a malformed setting must
 * not stop a thread from spawning, so it falls back to the defaults and the
 * caller logs it.
 */
export function parseModelByAction(raw: string | undefined): {
  models: Record<string, string>;
  error: string | null;
} {
  if (!raw || raw.trim() === "") return { models: DEFAULT_MODEL_BY_ACTION, error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { models: DEFAULT_MODEL_BY_ACTION, error: "not valid JSON" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { models: DEFAULT_MODEL_BY_ACTION, error: "expected a JSON object" };
  }

  const models: Record<string, string> = {};
  const unknown: string[] = [];
  for (const [flag, model] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof model !== "string" || model.trim() === "") continue;
    if (!(FLAG_SEVERITY as readonly string[]).includes(flag)) {
      unknown.push(flag);
      continue;
    }
    models[flag] = model.trim();
  }

  return {
    models,
    error: unknown.length ? `ignored unknown flag(s): ${unknown.join(", ")}` : null,
  };
}

/** The model for a row's worst flag, or undefined to take the provider default. */
export function modelForFlags(
  flags: readonly string[],
  models: Record<string, string>,
): string | undefined {
  for (const flag of FLAG_SEVERITY) {
    if (flags.includes(flag)) return models[flag];
  }
  return undefined;
}

export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;

export type PermissionModeSetting = (typeof PERMISSION_MODES)[number];

/**
 * Narrows the stored setting, which the SDK types only as `string`, to the
 * union `threads.spawn` accepts. An unrecognized value falls back to the
 * declared default rather than being passed through, so a hand-edited settings
 * file cannot reach the spawn call with a mode bb would reject.
 */
export function parsePermissionMode(raw: string | undefined): PermissionModeSetting {
  return (PERMISSION_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as PermissionModeSetting)
    : "full";
}

export const DISPLAY_SECTIONS = [
  // Ready to Merge leads: it is the only section whose rows are finished, and
  // the cheapest thing on the page to clear.
  "ready-to-merge",
  "needs-action",
  "in-progress",
  "waiting-on-ci",
  "partial-approval",
  "awaiting-review",
  "draft",
] as const;

export type DisplaySection = (typeof DISPLAY_SECTIONS)[number];

export const SECTION_TITLES: Record<DisplaySection, string> = {
  "needs-action": "Needs Action",
  "in-progress": "In Progress",
  "ready-to-merge": "Ready to Merge",
  "waiting-on-ci": "Waiting on CI",
  "partial-approval": "Partial Approval",
  "awaiting-review": "Awaiting Review",
  draft: "Draft",
};

/**
 * Where a row belongs in the panel, as distinct from its flag-derived group.
 *
 * A pull request with a thread is being worked on, whatever its flags say, so
 * it leaves the section that means "this is waiting for you". Leaving it in
 * Needs Action overstates the queue and invites a second click on work already
 * running.
 *
 * An unflagged row splits on draft: a draft is not waiting on anyone even when
 * a reviewer is nominally assigned, because it is not offered for review yet.
 * A draft carrying a flag still belongs in Needs Action — red CI matters on a
 * draft.
 */
/**
 * True when the only thing a pull request carries is a run in flight.
 *
 * A run decides for itself and there is nothing to do but wait, so such a row
 * does not belong in the section that means "this is waiting for you". A row
 * with any other flag keeps that flag's section: broken CI beside a running
 * job is still broken.
 */
export function isOnlyWaitingOnCi(flags: readonly string[]): boolean {
  return flags.length === 1 && flags[0] === "ci-pending";
}

export function displaySection(
  group: string,
  hasThread: boolean,
  isDraft: boolean,
  outstandingReviewers = 0,
  flags: readonly string[] = [],
): DisplaySection {
  if (hasThread) return "in-progress";
  if (isOnlyWaitingOnCi(flags)) return "waiting-on-ci";
  if (group === "ready-to-merge") {
    // One approval clears the technical bar, but a pull request people were
    // asked to look at and have not is not the same thing as one nobody is
    // waiting on. Merging the first is a judgement call; merging the second is
    // just housekeeping.
    return outstandingReviewers > 0 ? "partial-approval" : "ready-to-merge";
  }
  if (group === "clean") return isDraft ? "draft" : "awaiting-review";
  return "needs-action";
}

export interface WorkStep {
  flag: Flag;
  skill: string;
}

/**
 * Every flag a row carries, worst first, paired with the skill that owns it.
 *
 * A pull request often needs more than one thing — a conflict AND live review
 * feedback — and those are sequential, not independent: resolving the conflict
 * changes the code the feedback refers to. One thread walks the steps in this
 * order rather than the panel spawning one thread per flag, which would put two
 * agents on the same branch.
 */
export function workSteps(flags: readonly string[]): WorkStep[] {
  return FLAG_SEVERITY.filter((flag) => flags.includes(flag)).map((flag) => ({
    flag,
    skill: SKILL_FOR[flag] ?? DEFAULT_SKILL,
  }));
}

/**
 * The button's label. One flag reads as the action; several read as the
 * sequence the thread will work, because a single click now starts all of
 * them and "Resolve conflict" alone understates that.
 *
 * Capped at two named steps: a third would not fit the column, and the exact
 * tail matters less than knowing more is queued. The Status column lists them
 * all.
 */
export function actionSummary(flags: readonly string[]): string {
  const steps = workSteps(flags);
  if (steps.length === 0) return "Work on this";
  if (steps.length === 1) return ACTION_LABELS[steps[0]!.flag];

  // Naming each step spelled out the sequence but wrapped to two lines and
  // grew with every extra flag. The Status column already lists them, so the
  // button only has to say that one click covers all of them.
  return "Address issues";
}

/**
 * What an unflagged pull request is actually doing. "clean" is true but
 * uninformative: most unflagged rows are not idle, they are sitting with a
 * reviewer. Only a row with nobody outstanding is merely clean.
 */
export function unflaggedStatus(review: {
  waitingOn: readonly string[];
  awaitingReReview: boolean;
}): "awaiting review" | "clean" {
  return review.awaitingReReview || review.waitingOn.length > 0 ? "awaiting review" : "clean";
}

export type StatusTone = "positive" | "negative" | "info";

/** The tone a status badge carries. Only merge-readiness is good news. */
export function statusTone(flag: string | null): StatusTone {
  if (flag === null) return "info";
  if (flag === "merge-ready") return "positive";
  // A run in flight is not a fault. Colouring it like one made every pull
  // request mid-pipeline look broken.
  if (flag === "ci-pending") return "info";
  return "negative";
}
