import { REVIEW_SKILL } from "./actions.js";
import { daysWaiting, sizeLabel } from "./actions.js";
import type { ClassifiedRow } from "./types.js";

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
export function buildPrompt(row: ClassifiedRow, now: number): string {
  const waited = daysWaiting(row.requestedAt, now);
  const context =
    row.state === "re-review"
      ? `You have reviewed it before; it came back to you ${waited === 0 ? "today" : `${waited} day(s) ago`}.`
      : `It has been waiting on you for ${waited === 0 ? "less than a day" : `${waited} day(s)`}.`;

  return [
    `Review pull request ${row.repo}#${row.number}: "${row.title}", opened by ${row.author}.`,
    row.url,
    "",
    `A review was requested of you. ${context} The diff is ${sizeLabel(row.size)}.`,
    "",
    `Use the \`${REVIEW_SKILL}\` skill.`,
    "",
    // The one hard rule, stated before anything else the thread might infer.
    "Report your findings in this thread. Do NOT post anything to GitHub — no review, no comment, no approval, no inline comments — without asking me first and showing me exactly what you intend to post. That holds even if the skill you are following ends with a step that posts a comment: skip that step and show me the comment instead.",
    "",
    "Read the diff with `gh pr diff` and `gh pr view` rather than checking the branch out into my own working copy.",
    row.state === "re-review"
      ? "Because this is a re-review, say explicitly which of my earlier points were addressed and which were not, and confine new findings to what changed since my last review."
      : "Lead with whether you would approve it, then the findings worth my time. Skip nitpicks a linter would catch.",
  ].join("\n");
}
