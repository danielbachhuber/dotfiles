import type { IssueRow } from "./types.js";

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 */
export const MAX_THREAD_TITLE = 30;

/**
 * The issue's own title, cut to fit the sidebar.
 *
 * No number in front. An issue title already says what the thread is for, and
 * a "#5837 " prefix spent six of the thirty characters the sidebar shows on
 * an identifier that is only useful for looking the issue up — which the row
 * itself is for. Six characters is the difference between a phrase and a
 * fragment at this width.
 *
 * pr-sweep keeps its numbers on purpose: its titles are actions ("Resolve
 * conflict"), not descriptions, so there the number is the only thing saying
 * which pull request.
 */
export function threadTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= MAX_THREAD_TITLE) return trimmed;

  // Cut at a word boundary where one is available, so the title reads as a
  // phrase rather than stopping mid-word.
  const clipped = trimmed.slice(0, MAX_THREAD_TITLE - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const kept = lastSpace > MAX_THREAD_TITLE / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${kept.trimEnd()}…`;
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
