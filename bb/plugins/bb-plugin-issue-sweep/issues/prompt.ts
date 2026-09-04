import type { IssueRow } from "./types.js";

/**
 * A prompt in the three pieces the panel needs it in.
 *
 * `header` identifies the issue and is drawn as a preview card rather than
 * text you could edit — retyping it could only ever break the link between the
 * thread and the row. `body` is the panel's opinion about what to do, which is
 * the part worth steering, so it is what the composer opens with. `trailer` is
 * the standing procedure, which is the same every time and so is worth neither
 * the reading nor the screen space.
 *
 * All three reach the agent; only `body` reaches the composer.
 */
export interface PromptParts {
  header: string;
  body: string;
  trailer: string;
}

/** The three pieces as one prompt, with `body` overridable by what was typed. */
export function joinPromptParts(parts: PromptParts, body = parts.body): string {
  return [parts.header, "", body, "", parts.trailer].join("\n");
}

/**
 * One label for every thread this panel starts, so a sidebar entry says at a
 * glance which sweep it came from: "Dev" here, "Refine" from pr-sweep,
 * "Review" from review-sweep, "Dep" from the Dependabot automation.
 */
export const THREAD_LABEL = "Dev";

const SEPARATOR = ": ";

/**
 * "Dev #5718: Port the last four Conversation Helper reads off the datastore".
 *
 * The whole title, uncut. bb clips a thread title to the sidebar's width and
 * appends its own ellipsis, so a title cut to a guessed budget here read as
 * "Retire the last…..." — truncated twice, once by us and once for real. It
 * also threw away the tail that the thread list, search, and hover would have
 * shown in full.
 *
 * Unlike the two pull request sweeps, nothing is stripped off the front of the
 * title. Their titles are commit subjects, where "fix(sync): " is noise the
 * diff already carries; an issue title is prose, and a leading "Bug: " is part
 * of what the issue says.
 */
export function threadTitle(number: number, title: string): string {
  const head = `${THREAD_LABEL} #${number}`;
  const gist = title.replace(/\s+/g, " ").trim();
  return gist ? `${head}${SEPARATOR}${gist}` : head;
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
export function buildPromptParts(row: IssueRow): PromptParts {
  const blocked =
    row.blockedBy > 0
      ? [
          "",
          `Note that GitHub reports this issue as blocked by ${row.blockedBy} open issue(s). Check what they are with \`gh issue view ${row.number} --repo ${row.repo}\` before starting; if the blocker is real, say so and stop rather than working around it.`,
        ]
      : [];

  return {
    header: [`Work on issue ${row.repo}#${row.number}: "${row.title}".`, row.url].join("\n"),

    // Thin on purpose. Unlike a merge conflict or a review request this panel
    // has no finding to report, so the editable half says the obvious thing
    // and leaves room to say a different one. Not empty: BB's composer will
    // not submit a blank draft, and starting a thread should not require
    // typing.
    body: ["Work on this issue.", ...blocked].join("\n"),

    trailer: [
      `Read it first, including its comments: \`gh issue view ${row.number} --repo ${row.repo} --comments\`. The requirement has often moved since the description was written.`,
      "",
      // Starting the thread asks for the work, not for a commit. An issue is
      // open-ended enough that the first diff is often the wrong one, so the
      // standing rule against committing without an explicit ask stands here.
      "Leave your changes in the working tree for me to review. Do not commit unless I ask.",
      "Ask me first before: committing, pushing, opening a pull request, force-pushing, or closing the issue.",
      "",
      "Show me your plan before you write code. The issue names a problem, not a solution, and I would rather correct the approach than the diff.",
    ].join("\n"),
  };
}

/** The whole prompt, for anything that wants it in one piece. */
export function buildPrompt(row: IssueRow): string {
  return joinPromptParts(buildPromptParts(row));
}
