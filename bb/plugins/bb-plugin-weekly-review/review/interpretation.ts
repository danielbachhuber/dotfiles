/**
 * The agent's reading of a week, and the prompt that asks for it.
 *
 * Kept beside the week as `overview.json`, so it is as inspectable and as
 * disposable as the week itself: delete the file and the deterministic page is
 * exactly what it was.
 */
import { z } from "zod";

export const bodyOfWorkSchema = z.object({
  /** What to call this thread of work, in the words the work itself used. */
  title: z.string().trim().min(1).max(120),
  /** A sentence or two on what actually happened and why it mattered. */
  detail: z.string().trim().max(600),
  status: z.enum(["shipped", "in progress", "blocked", "abandoned"]),
  /** Hours, when the time entries attributed any to it. */
  hours: z.number().nonnegative().optional(),
  /** Issue and pull request numbers this covers, so the page can link them. */
  refs: z.array(z.number().int().positive()).max(60).default([]),
  /**
   * Time entries that belong here but name no issue or pull request — the
   * meetings, the planning, the reviews. Matched verbatim on the day and the
   * entry's own text, the same escape hatch a daily note uses. Entries that do
   * name a number are claimed through `refs` and need not be listed.
   */
  entries: z
    .array(z.object({ day: z.string(), label: z.string() }))
    .max(120)
    .default([]),
});

export const nextItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** Why this one, stated from the week's evidence rather than in general. */
  why: z.string().trim().max(400),
  refs: z.array(z.number().int().positive()).max(20).default([]),
});

export const interpretationSchema = z.object({
  /** Two or three sentences: what kind of week this was. */
  summary: z.string().trim().min(1).max(1200),
  bodiesOfWork: z.array(bodyOfWorkSchema).max(20).default([]),
  next: z.array(nextItemSchema).max(20).default([]),
  /** Stamped on ingest, not by the agent. */
  interpretedAt: z.string().optional(),
});

export type BodyOfWork = z.infer<typeof bodyOfWorkSchema>;
export type NextItem = z.infer<typeof nextItemSchema>;
export type Interpretation = z.infer<typeof interpretationSchema>;

/**
 * The default prompt. Editable, and stored per install, so this is only ever
 * the starting point — `{{DIGEST}}` and `{{COMMAND}}` are substituted before
 * the thread is spawned.
 */
export const DEFAULT_PROMPT = `You are reading one week of someone's work and writing the overview they will
use to plan the next one. Everything below was gathered from Harvest, GitHub,
and Todoist. Nothing is missing that you should go looking for; interpret what
is here.

Produce three things.

**summary** — two or three sentences on what kind of week this was. Lead with
the shape of it, not a count. If most of the hours went to meetings and
planning while most of the output was pull requests, say so: that gap is the
most useful sentence you can write.

**bodiesOfWork** — the substantial threads of work, largest first. A body of
work is a set of pull requests, issues, meetings and hours that were the same
effort, not a single pull request and not a commit scope. Titles that repeat a
phrase are usually one body of work. Name each one in the words the work itself
used, say what happened in a sentence or two, and mark whether it shipped or is
still in progress.

Every body of work claims its evidence twice over. \`refs\` is every issue and
pull request number it covers. \`entries\` is every time entry that belongs to it
but names no number — the meetings, the planning, the reviews — copied verbatim
from the "Time entries, with notes" list as \`{ "day": "…", "label": "…" }\`,
where the label is the entry's text exactly as printed. An entry that does name
a number is already claimed through \`refs\`; do not list it again.

This is what turns the page from a time sheet into an account of the week, so
be thorough with \`entries\`. Meetings are work. A recurring standup and a
one-off review are not the same body of work; a series of conversations
pushing one decision forward is. Anything genuinely miscellaneous can be left
out and will be shown on its own.

**next** — where the time should go next, drawn from what this week left open:
pull requests still unmerged, issues assigned and going stale, work the notes
say is half done. Say why each one, from this week's evidence rather than in
general. Rank them.

Leave out anything you cannot support from the digest. Do not invent numbers.

---

{{DIGEST}}

---

Write the result as JSON matching this shape:

{
  "summary": "…",
  "bodiesOfWork": [
    { "title": "…", "detail": "…", "status": "shipped|in progress|blocked|abandoned",
      "hours": 0, "refs": [123, 456] }
  ],
  "next": [ { "title": "…", "why": "…", "refs": [789] } ]
}

Write it to a file under /tmp, then record it by running:

{{COMMAND}}

That command validates the JSON and puts it on the page. If it reports a
validation error, fix the file and run it again. Report what you recorded, then
stop.`;

/**
 * The default prompt for collecting the week's daily notes.
 *
 * Kept separate from the interpretation because it is a different kind of job:
 * this one fetches something a script cannot reach and resolves the handful of
 * meetings name matching could not, and nothing it produces is a judgment
 * about the work.
 */
export const DEFAULT_NOTES_PROMPT = `Collect this week's daily notes so they can sit beside the meetings they were
taken in.

The week runs {{FROM}} through {{TO}}.

1. Read the meetings already logged for the week:

   {{MEETINGS_COMMAND}}

   Each line is a time entry. A line marked \`needs notes\` has nothing matched
   to it yet. Not all of them are meetings, and not all of them will appear in
   the notes; that is fine.

2. Pull the daily note for each day in the range from Reflect. If a day has no
   note, skip it; do not invent one.

3. Split each day's note into one entry per meeting. A daily note is already
   written that way — a top-level bullet per conversation, its detail nested
   underneath. The bullet becomes \`title\` and everything under it becomes
   \`body\`, kept verbatim, including the names of who was there.

4. Where a bullet is plainly the same conversation as a logged meeting but is
   called something different — logged as "Phase 3 review", written up as "PSI
   deadline check-in" — set \`meeting\` to the time entry's text exactly as step
   1 printed it. Leave \`meeting\` off when the names already agree; the page
   matches those itself. Do not guess: an unmatched note still gets recorded,
   and a wrong pairing is worse than none.

5. Write the result to a file under /tmp as JSON:

   [ { "day": "YYYY-MM-DD", "title": "…", "body": "…", "meeting": "…" } ]

   then record it with:

   {{COMMAND}}

That command validates the file and puts the notes on the page. If it reports a
validation error, fix the file and run it again. Say which meetings you matched
and which you could not, then stop.`;

/** Substitutes `{{NAME}}` placeholders. A template missing one still works. */
export function renderPrompt(
  template: string,
  values: Record<string, string>,
): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${name}}}`, value);
  }
  return out;
}
