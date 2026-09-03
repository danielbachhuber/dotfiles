import type { IssueRow } from "./types.js";

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 */
/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 *
 * It is deliberately longer than what the sidebar shows in full: a clipped
 * tail still reads in the thread list, in search, and on hover.
 */
export const MAX_THREAD_TITLE = 40;

/**
 * One label for every thread this panel starts, so a sidebar entry says at a
 * glance which sweep it came from: "Dev" here, "Refine" from pr-sweep,
 * "Review" from review-sweep, "Dep" from the Dependabot automation.
 */
export const THREAD_LABEL = "Dev";

const SEPARATOR = ": ";

/**
 * "Dev #5718: Port the last four…". The number identifies the issue, so if the
 * pieces exceed the budget the gist gives way, never the number.
 *
 * Unlike the two pull request sweeps, nothing is stripped off the front of the
 * title. Their titles are commit subjects, where "fix(sync): " is noise the
 * diff already carries; an issue title is prose, and a leading "Bug: " is part
 * of what the issue says.
 */
export function threadTitle(number: number, title: string): string {
  const suffix = ` #${number}`;
  const head = `${THREAD_LABEL}${suffix}`;

  if (head.length > MAX_THREAD_TITLE) {
    const room = MAX_THREAD_TITLE - suffix.length;
    if (room <= 1) return suffix.trimStart().slice(0, MAX_THREAD_TITLE);
    return `${THREAD_LABEL.slice(0, room - 1).trimEnd()}…${suffix}`;
  }

  const gist = titleGist(title, MAX_THREAD_TITLE - head.length - SEPARATOR.length);
  return gist ? `${head}${SEPARATOR}${gist}` : head;
}

/**
 * The leading whole words of an issue title that fit in `budget`.
 *
 * Cut on word boundaries: three whole words say more than three and a half,
 * and a trailing fragment reads like a bug. Returns "" when nothing fits, so
 * the title falls back to the bare "Dev #5718" instead of trailing a stub.
 */
export function titleGist(title: string, budget: number): string {
  if (budget < 3) return "";
  const cleaned = title.replace(/\s+/g, " ").trim();
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
 * What the thread is being started for.
 *
 * Deliberately thin on method. Unlike a merge conflict or a review request,
 * "work this issue" has no fixed shape — the issue itself says what the work
 * is — so the prompt hands over the identifiers and gets out of the way rather
 * than inventing a procedure the repository's own skills and AGENTS.md already
 * specify better.
 *
 * It does not paste the issue body: the sweep stores only what the table
 * renders, and a body read at sweep time can be stale by the time the thread
 * runs. Reading it first-hand also picks up the comments, which is usually
 * where the real requirement ended up.
 */
export function buildPrompt(row: IssueRow): string {
  const blocked =
    row.blockedBy > 0
      ? [
          "",
          `Note that GitHub reports this issue as blocked by ${row.blockedBy} open issue(s). Check what they are with \`gh issue view ${row.number} --repo ${row.repo}\` before starting; if the blocker is real, say so and stop rather than working around it.`,
        ]
      : [];

  return [
    `Work on issue ${row.repo}#${row.number}: "${row.title}".`,
    row.url,
    "",
    `Read it first, including its comments: \`gh issue view ${row.number} --repo ${row.repo} --comments\`. The requirement has often moved since the description was written.`,
    ...blocked,
    "",
    // Starting the thread asks for the work, not for a commit. An issue is
    // open-ended enough that the first diff is often the wrong one, so the
    // standing rule against committing without an explicit ask stands here.
    "Leave your changes in the working tree for me to review. Do not commit unless I ask.",
    "Ask me first before: committing, pushing, opening a pull request, force-pushing, or closing the issue.",
    "",
    "Show me your plan before you write code. The issue names a problem, not a solution, and I would rather correct the approach than the diff.",
  ].join("\n");
}
