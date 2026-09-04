import { REVIEW_SKILL, ageInDays, sizeLabel } from "./actions.js";
import type { ClassifiedRow } from "./types.js";

/**
 * A prompt in the three pieces the panel needs it in.
 *
 * `header` identifies the pull request and is drawn as a preview card rather
 * than text you could edit — retyping it could only ever break the link between
 * the thread and the row. `body` is the panel's opinion about what to do, which
 * is the part worth steering, so it is what the composer opens with. `trailer`
 * is the standing procedure, which is the same every time and so is worth
 * neither the reading nor the screen space.
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
 * The two ends as prompt items, ready to sit either side of what the composer
 * returned.
 *
 * The blank lines are carried here because bb concatenates a message's text
 * items with no separator at all: without them the URL that ends the header
 * runs into the first word typed, and the last word typed runs into the
 * trailer. They cannot live in `header`/`trailer` themselves, which are also
 * joined by {@link joinPromptParts} and would double up.
 */
export function headerItem(parts: PromptParts): string {
  return `${parts.header}\n\n`;
}

export function trailerItem(parts: PromptParts): string {
  return `\n\n${parts.trailer}`;
}

/**
 * What the sweep found, stated as fact, then the one constraint that matters.
 *
 * The no-posting paragraph is not decoration. Reviewing someone else's pull
 * request is outward-facing in a way pushing to your own branch is not: a wrong
 * finding lands publicly on a colleague's PR and cannot be quietly undone. It is
 * also load-bearing against the skill itself — the claude-plugins-official
 * `/code-review` ends by posting a `gh pr comment` with no flag to suppress it,
 * and this plugin cannot control which `code-review` a spawned thread resolves.
 * A direct user instruction outranks a skill's own steps, so the instruction is
 * what holds, not the routing.
 */
export function buildPromptParts(row: ClassifiedRow, now: number): PromptParts {
  const waited = ageInDays(row.requestedAt, now);
  const context =
    row.state === "re-review"
      ? `You have reviewed it before; it came back to you ${waited === 0 ? "today" : `${waited} day(s) ago`}.`
      : `It has been waiting on you for ${waited === 0 ? "less than a day" : `${waited} day(s)`}.`;

  return {
    header: [
      `Review pull request ${row.repo}#${row.number}: "${row.title}", opened by ${row.author}.`,
      row.url,
    ].join("\n"),

    // What this review is and how it should read — the half worth steering.
    body: [
      `A review was requested of you. ${context} The diff is ${sizeLabel(row.size)}.`,
      "",
      `Use the \`${REVIEW_SKILL}\` skill.`,
      "",
      row.state === "re-review"
        ? "Because this is a re-review, say explicitly which of my earlier points were addressed and which were not, and confine new findings to what changed since my last review."
        : "Lead with whether you would approve it, then the findings worth my time. Skip nitpicks a linter would catch.",
    ].join("\n"),

    trailer: [
      // The one hard rule. Out of the composer but never out of the
      // prompt: it is the whole safety story for this action, and it is the
      // same sentence every time, which is what the trailer is for.
      "Report your findings in this thread. Do NOT post anything to GitHub — no review, no comment, no approval, no inline comments — without asking me first and showing me exactly what you intend to post. That holds even if the skill you are following ends with a step that posts a comment: skip that step and show me the comment instead.",
      "",
      "Read the diff with `gh pr diff` and `gh pr view` rather than checking the branch out into my own working copy.",
    ].join("\n"),
  };
}

/** The whole prompt, for anything that wants it in one piece. */
export function buildPrompt(row: ClassifiedRow, now: number): string {
  return joinPromptParts(buildPromptParts(row, now));
}
