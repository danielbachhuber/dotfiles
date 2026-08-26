import { ageInDays, sizeBucket, type ChangeSize, type ReviewState } from "./types.js";

/**
 * The skill that owns the work. There is one action here, so unlike pr-sweep
 * there is nothing to route: every row is "read this diff and tell me what you
 * find".
 *
 * Naming it is not enough on its own. Two commands answer to `code-review` on
 * this machine — the built-in one, which posts only when passed `--comment`,
 * and the claude-plugins-official one, whose last step posts a `gh pr comment`
 * unconditionally. Which one a spawned thread resolves is not something this
 * plugin controls, so `buildPrompt` states the no-posting constraint outright
 * rather than relying on picking the right skill.
 */
export const REVIEW_SKILL = "code-review";

export const ACTION_LABELS: Record<ReviewState, string> = {
  "first-look": "Review",
  "re-review": "Re-review",
};

export function actionLabel(state: ReviewState): string {
  return ACTION_LABELS[state] ?? "Review";
}

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 */
export const MAX_THREAD_TITLE = 30;

/**
 * "Review #4821". The number identifies the pull request, so if the pair
 * somehow exceeds the budget the label gives way, never the number.
 */
export function threadTitle(state: ReviewState, number: number): string {
  const suffix = ` #${number}`;
  const label = actionLabel(state);
  const full = `${label}${suffix}`;
  if (full.length <= MAX_THREAD_TITLE) return full;

  const room = MAX_THREAD_TITLE - suffix.length;
  if (room <= 1) return suffix.trimStart().slice(0, MAX_THREAD_TITLE);
  return `${label.slice(0, room - 1).trimEnd()}…${suffix}`;
}

export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;

export type PermissionModeSetting = (typeof PERMISSION_MODES)[number];

/**
 * Narrows the stored setting, which the SDK types only as `string`, to the
 * union `threads.spawn` accepts, so a hand-edited settings file cannot reach
 * the spawn call with a mode bb would reject.
 *
 * The default is `full` for an unobvious reason: `auto` keeps the workspace
 * sandbox, which blocks network egress, and a review thread that cannot reach
 * GitHub cannot read the diff it was started for. The sandbox has no way to
 * express "may read GitHub, may not write to it", so the no-posting rule lives
 * in the prompt instead.
 */
export function parsePermissionMode(raw: string | undefined): PermissionModeSetting {
  return (PERMISSION_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as PermissionModeSetting)
    : "full";
}

export const DEFAULT_STALE_AFTER_DAYS = 2;

/** Never throws: a malformed setting must not stop the panel from rendering. */
export function parseStaleAfterDays(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_STALE_AFTER_DAYS;
  return Math.floor(parsed);
}

export const DISPLAY_SECTIONS = ["needs-review", "in-progress", "draft"] as const;

export type DisplaySection = (typeof DISPLAY_SECTIONS)[number];

export const SECTION_TITLES: Record<DisplaySection, string> = {
  "needs-review": "Needs Review",
  "in-progress": "In Progress",
  draft: "Draft",
};

/**
 * Where a row belongs in the panel.
 *
 * A pull request with a thread is being worked on, so it leaves the section
 * that means "this is waiting for you" — otherwise the queue overstates itself
 * and invites a second click on a review already running.
 *
 * A draft requested of you is a real request, but it is not offered for review
 * yet, so it sits apart rather than aging in the main queue.
 */
export function displaySection(hasThread: boolean, isDraft: boolean): DisplaySection {
  if (hasThread) return "in-progress";
  return isDraft ? "draft" : "needs-review";
}

export type AgeTone = "quiet" | "stale";

/**
 * An age only earns emphasis once it is past the threshold. Colouring every
 * row's age makes the column noise; colouring the overdue ones makes it a
 * signal.
 */
export function ageTone(requestedAt: number, now: number, staleAfterDays: number): AgeTone {
  return ageInDays(requestedAt, now) >= staleAfterDays ? "stale" : "quiet";
}

/** "today", "1 day", "6 days". */
export function ageLabel(requestedAt: number, now: number): string {
  const days = ageInDays(requestedAt, now);
  if (days === 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The Reviewers cell. An em dash rather than "none" for the empty case, which
 * only happens when the outstanding-request set came back empty even though the
 * search matched — a data gap, not a meaningful "nobody".
 */
export function reviewersLabel(reviewers: readonly string[]): string {
  return reviewers.length ? reviewers.join(", ") : "—";
}

/** "+120 −8, 6 files". An en dash for the deletions, not a hyphen. */
export function sizeLabel(size: ChangeSize): string {
  const files = size.changedFiles === 1 ? "1 file" : `${size.changedFiles} files`;
  return `+${size.additions} −${size.deletions}, ${files}`;
}

export { sizeBucket, ageInDays };
