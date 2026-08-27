import type { IssueRow } from "./types.js";

/**
 * The sidebar clips a thread title past roughly this width, and the row above
 * it already names the project, so the repository is wasted characters here.
 */
export const MAX_THREAD_TITLE = 30;

/**
 * "#4060 Document product features". The number leads because it is what
 * identifies the issue, and it is what survives when the title is cut.
 */
export function threadTitle(title: string, number: number): string {
  const prefix = `#${number} `;
  const room = MAX_THREAD_TITLE - prefix.length;
  if (room <= 1) return `#${number}`;
  if (title.length <= room) return `${prefix}${title}`;

  // Cut at a word boundary where one is available, so the title reads as a
  // phrase rather than stopping mid-word.
  const clipped = title.slice(0, room - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const kept = lastSpace > room / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${prefix}${kept.trimEnd()}…`;
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
    // Standing user instructions forbid committing without an explicit ask.
    // Clicking Start thread is that ask, but only for this issue's own branch.
    "I started this from the Issues panel, which is my explicit request for this work. You do not need to ask me before committing to this thread's own branch.",
    "Ask me first before: pushing, opening a pull request, force-pushing, or closing the issue.",
    "",
    "Show me your plan before you write code. The issue names a problem, not a solution, and I would rather correct the approach than the diff.",
  ].join("\n");
}
