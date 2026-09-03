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

/**
 * The skill for one flag, on one row.
 *
 * Only merge-readiness depends on more than the flag. An approved, green pull
 * request carrying unresolved inline comments is review work before it is a
 * merge, and `address-code-review` is the skill that owns answering comments —
 * it knows to read each thread, reply, and resolve. Routing that to `pr-sweep`
 * sent the thread to a triage skill for work whose shape was already known.
 */
function skillForFlag(flag: Flag, commentsToRead: number): string {
  if (flag === "merge-ready" && commentsToRead > 0) return SKILL_FOR.feedback ?? DEFAULT_SKILL;
  return SKILL_FOR[flag] ?? DEFAULT_SKILL;
}

/** Falls back to a generic label if a row somehow carries no known flag. */
export function actionLabel(flags: readonly string[]): string {
  for (const flag of FLAG_SEVERITY) {
    if (flags.includes(flag)) return ACTION_LABELS[flag];
  }
  return "Work on this";
}

/** The skill for a row's worst flag, which is the work its action starts. */
export function skillFor(flags: readonly string[], commentsToRead = 0): string {
  for (const flag of FLAG_SEVERITY) {
    if (flags.includes(flag)) return skillForFlag(flag, commentsToRead);
  }
  return DEFAULT_SKILL;
}

/** True when a dedicated skill specifies the whole flow, worktree included. */
export function skillOwnsWorkflow(flags: readonly string[], commentsToRead = 0): boolean {
  return skillFor(flags, commentsToRead) !== DEFAULT_SKILL;
}

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 *
 * It is deliberately longer than what the sidebar shows in full: a clipped
 * tail still reads in the thread list, in search, and on hover, and four
 * threads reading "Resolve conflict #…" gave no way to tell them apart.
 */
export const MAX_THREAD_TITLE = 40;

/**
 * One label for every thread this panel starts.
 *
 * The button still names the specific work, because the panel shows it beside
 * a Status column that spells the problem out. A sidebar entry has neither, and
 * the specific label was the expensive part: "Resolve conflict" spends over
 * half the budget saying something the pull request's own title says better.
 */
export const THREAD_LABEL = "Refine";

/**
 * Conventional-commit and ticket prefixes carry no information once the number
 * is already in the title, and they eat the few characters that do.
 */
const TITLE_PREFIX = /^\s*(?:\[[^\]]+\]\s*|\([^)]+\)\s*|[A-Za-z]+!?(?:\([^)]*\))?!?:\s*)+/;

const SEPARATOR = ": ";

/**
 * "Refine #5879: propose exact API replay". The number identifies the pull
 * request, so if the pieces exceed the budget the gist gives way, never the
 * number.
 *
 * Deliberately the same shape as review-sweep's, and deliberately its own copy:
 * these plugins share `gh-shared` for reaching GitHub, not their phrasing, and
 * a shared helper here would be one more thing to rebuild three plugins for.
 */
export function threadTitle(number: number, prTitle = ""): string {
  const suffix = ` #${number}`;
  const head = `${THREAD_LABEL}${suffix}`;

  if (head.length > MAX_THREAD_TITLE) {
    const room = MAX_THREAD_TITLE - suffix.length;
    if (room <= 1) return suffix.trimStart().slice(0, MAX_THREAD_TITLE);
    return `${THREAD_LABEL.slice(0, room - 1).trimEnd()}…${suffix}`;
  }

  const gist = titleGist(prTitle, MAX_THREAD_TITLE - head.length - SEPARATOR.length);
  return gist ? `${head}${SEPARATOR}${gist}` : head;
}

/**
 * "Refine #5840: fix failing CI" — the same shape, but naming what this thread
 * is for rather than what the pull request is about.
 *
 * For a pull request's second thread. One pull request has several threads
 * over its life, and the pull request's own words are the same in all of them:
 * #5840 ended up with three unarchived threads reading "Refine #5840: hide the
 * profile toggles…", which is three ways of saying nothing. What differs is
 * the work each was started for, and that is what the title should carry.
 *
 * Lower-cased, because it follows a colon and completes a phrase rather than
 * starting a sentence.
 */
export function scopedThreadTitle(number: number, scope: string): string {
  const trimmed = scope.trim();
  if (!trimmed) return threadTitle(number);

  const lowered = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return threadTitle(number, lowered);
}

/**
 * The leading whole words of a pull request title that fit in `budget`.
 *
 * Returns "" rather than a single truncated word when nothing fits, so the
 * title falls back to the bare "Refine #5879" instead of trailing a stub.
 */
export function titleGist(prTitle: string, budget: number): string {
  if (budget < 3) return "";
  const cleaned = prTitle.replace(TITLE_PREFIX, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= budget) return cleaned;

  const words = cleaned.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    // One character of the budget belongs to the ellipsis that marks the cut.
    if (next.length > budget - 1) break;
    out = next;
  }
  // A first word longer than the budget still beats saying nothing, so cut it.
  if (!out) return `${cleaned.slice(0, budget - 1).trimEnd()}…`;
  return `${out}…`;
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

/**
 * Everything on a row that has to be read before it can be merged.
 *
 * Unresolved inline threads and written review notes are the same problem
 * wearing different hats — an approval that came with conditions — so they add
 * up rather than being tracked separately.
 */
export function commentsToRead(row: {
  unresolvedThreads: number;
  notedBy: readonly string[];
}): number {
  return row.unresolvedThreads + row.notedBy.length;
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
  // A draft is not offered to anyone yet, so it is not waiting on you whatever
  // else is true of it. Its flags still show in the Status column — a draft
  // with failing CI reads "draft, CI failing" — they just do not pull it into
  // the actionable queue.
  if (isDraft) return "draft";
  if (isOnlyWaitingOnCi(flags)) return "waiting-on-ci";
  if (group === "ready-to-merge") {
    // One approval clears the technical bar, but a pull request people were
    // asked to look at and have not is not the same thing as one nobody is
    // waiting on. Merging the first is a judgement call; merging the second is
    // just housekeeping.
    return outstandingReviewers > 0 ? "partial-approval" : "ready-to-merge";
  }
  if (group === "clean") return "awaiting-review";
  return "needs-action";
}

/**
 * The sections the sidebar badge counts: rows where the next move is yours.
 *
 * Ready to Merge belongs here even though nothing is wrong with those rows —
 * clicking merge is an action, and a finished pull request nobody merges is
 * exactly the thing a badge should nag about.
 *
 * The rest are excluded because the next move is someone else's or already
 * under way: In Progress has a thread running, Waiting on CI is waiting on a
 * machine, Partial Approval and Awaiting Review are waiting on a reviewer, and
 * a Draft has not been offered to anyone.
 */
export const COUNTED_SECTIONS: readonly DisplaySection[] = ["needs-action", "ready-to-merge"];

/** True when a row's section is one the badge counts. */
export function isCounted(section: DisplaySection): boolean {
  return COUNTED_SECTIONS.includes(section);
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
export function workSteps(flags: readonly string[], commentsToRead = 0): WorkStep[] {
  return FLAG_SEVERITY.filter((flag) => flags.includes(flag)).map((flag) => ({
    flag,
    skill: skillForFlag(flag, commentsToRead),
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
export function actionSummary(flags: readonly string[], commentsToRead = 0): string {
  const steps = workSteps(flags);
  if (steps.length === 0) return "Work on this";
  if (steps.length === 1) {
    // An approval does not clear inline comments: #5801 was approved, green,
    // and carrying three. "Merge" alone understated what the click starts.
    if (steps[0]!.flag === "merge-ready" && commentsToRead > 0) {
      // Short enough for the action column and for the sidebar title, which
      // "Review comments and merge" was not: it overflowed the column and put
      // a horizontal scrollbar on the table.
      return "Review and merge";
    }
    return ACTION_LABELS[steps[0]!.flag];
  }

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

export type StatusTone = "positive" | "negative" | "info" | "neutral";

/** The tone a status badge carries. Only merge-readiness is good news. */
export function statusTone(flag: string | null): StatusTone {
  if (flag === null) return "info";
  if (flag === "merge-ready") return "positive";
  // A run in flight is not a fault. Colouring it like one made every pull
  // request mid-pipeline look broken.
  if (flag === "ci-pending") return "info";
  return "negative";
}

/**
 * The flag that decides a row's action, or null when it carries none. Every
 * other per-row choice — label, skill, model — already resolves against this
 * one, so a thread's stored reason has to as well.
 */
export function worstFlag(flags: readonly string[]): Flag | null {
  return FLAG_SEVERITY.find((flag) => flags.includes(flag)) ?? null;
}

/**
 * Whether the work a thread was started for is done, judged from the row
 * rather than from anything the thread said about itself.
 *
 * A thread reports success in prose, and prose is not a signal a sweep can
 * act on. The pull request is: the sweep already recomputes every flag from
 * GitHub each cycle, so "the flag that justified this thread is gone" is a
 * fact, checked against the same source that raised it.
 *
 * Conflicts get one extra guard. `mergeable-unknown` means GitHub has not
 * finished recomputing mergeability, and an unknown is not an answer — the
 * conflict flag is absent during that window whether or not anything was
 * fixed. Waiting for a definite MERGEABLE costs one sweep and avoids
 * archiving a thread whose merge never actually landed.
 */
export function isWorkFinished(reason: string, flags: readonly string[]): boolean {
  if (flags.includes(reason)) return false;
  if (reason === "conflict" && flags.includes("mergeable-unknown")) return false;
  return true;
}

/**
 * Parses the "Auto-archive actions" setting: the flags whose threads close
 * themselves once the flag clears. Blank turns the whole behaviour off.
 *
 * Unknown names are dropped rather than honoured, so a typo cannot archive
 * every thread by matching a flag no row will ever carry.
 */
export function parseAutoArchiveActions(raw: string | undefined): Set<string> {
  const known = new Set<string>(FLAG_SEVERITY);
  return new Set(
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => known.has(entry)),
  );
}
