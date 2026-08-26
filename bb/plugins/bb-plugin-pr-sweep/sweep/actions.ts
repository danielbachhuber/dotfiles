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

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 */
export const MAX_THREAD_TITLE = 30;

/**
 * "Resolve conflict #5687". The number is what identifies the pull request, so
 * if the pair somehow exceeds the budget the label gives way, never the number.
 */
export function threadTitle(flags: readonly string[], number: number): string {
  const suffix = ` #${number}`;
  const label = actionLabel(flags);
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
  conflict: "claude-haiku-4-5-20251001",
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
