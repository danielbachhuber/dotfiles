/**
 * What an agent is asked about a week, and the shape of what it sends back.
 *
 * Two jobs, both of them things a script cannot do: fetching the daily notes,
 * which are only reachable over MCP, and reading the hand-written entry
 * against the evidence. Everything else the page shows is derived from the
 * record, so nothing else needs a model.
 */
import { z } from "zod";

/**
 * The default prompt for collecting the week's daily notes.
 *
 * A different kind of job from the feedback: this one fetches something a
 * script cannot reach and resolves the handful of meetings name matching could
 * not, and nothing it produces is a judgment about the work.
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

/**
 * The agent's read of an entry that was written by hand.
 *
 * A separate job from the interpretation, and a smaller one. The entry is the
 * user's own writing and stays that way: nothing here proposes replacement
 * prose, and nothing in this plugin writes to the document. What an agent is
 * good for is having read all of the evidence at once, which is the one thing
 * a person drafting from memory has not done.
 */
export const missingItemSchema = z.object({
  title: z.string().trim().min(1).max(140),
  /** Why it is worth a line, from the week's evidence rather than in general. */
  why: z.string().trim().max(500),
  refs: z.array(z.number().int().positive()).max(30).default([]),
});

export const expandItemSchema = z.object({
  /** The words in the entry this is about, quoted so it can be found. */
  quote: z.string().trim().min(1).max(300),
  /** What the evidence adds that the entry does not say. */
  detail: z.string().trim().max(600),
  refs: z.array(z.number().int().positive()).max(30).default([]),
});

export const feedbackSchema = z.object({
  /** A sentence or two: what the entry covers well, and what it is light on. */
  assessment: z.string().trim().min(1).max(1200),
  /** In the week, absent from the entry. */
  missing: z.array(missingItemSchema).max(20).default([]),
  /** In the entry, thinner than the evidence supports. */
  expand: z.array(expandItemSchema).max(20).default([]),
  /** Stamped on ingest, not by the agent. */
  reviewedAt: z.string().optional(),
  /** The entry the feedback was given on, so stale feedback is visible as stale. */
  entryHeading: z.string().optional(),
});

export type MissingItem = z.infer<typeof missingItemSchema>;
export type ExpandItem = z.infer<typeof expandItemSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;

export const DEFAULT_FEEDBACK_PROMPT = `Someone has written this week's review entry by hand and wants to know what
they missed. You are checking their draft against the week's evidence.

You are not rewriting the entry, and you are not writing to the document. The
entry is theirs and stays in their words. Propose no replacement prose.

Your one advantage is that you have read all of the evidence at once, which
they have not. Use it for exactly that.

Return three things.

**assessment** — a sentence or two. What does the entry cover well, and what is
it light on? Be specific and be willing to say it is already good.

**missing** — things that happened this week and are absent from the entry.
Rank them by whether the person would regret leaving them out. A quiet
architectural decision they will need to remember in six months beats a
recurring standup. Give the issue and pull request numbers as refs. Leave out
anything they plausibly left out on purpose: routine maintenance, dependency
bumps, and meetings with nothing in them do not belong in a weekly entry.

**expand** — places the entry says something the evidence says more about.
Quote the words from the entry so they can be found, then say what the evidence
adds. This is where the value is: a line reading "worked on feature toggles" is
true, and the digest knows it took 3.3 hours across three days and closed four
issues.

Say nothing you cannot support from the evidence below. If the entry is
complete, say so and return empty lists rather than inventing gaps.

---

## The entry as written

{{ENTRY}}

---

## The week

{{DIGEST}}

---

Write the result as JSON matching this shape:

{
  "assessment": "…",
  "missing": [ { "title": "…", "why": "…", "refs": [123] } ],
  "expand": [ { "quote": "…", "detail": "…", "refs": [456] } ]
}

Write it to a file under /tmp, then record it by running:

{{COMMAND}}

That command validates the JSON and puts it on the page. If it reports a
validation error, fix the file and run it again.

Then lay the same findings out here, in the thread, so they can be read without
opening the page: the assessment, then what is missing, then what deserves more
detail. This is a conversation, not a hand-off. Expect to be asked which of
these matter, to be pushed back on, and to be asked for the underlying evidence
behind a particular line.

The entry is being rewritten in the document while you talk. Re-read it with
\`bb weekly-review entry {{MONDAY}}\` before answering anything that depends on
what it currently says, and record a fresh assessment with the same command
when enough has changed to be worth one. Never edit the document yourself.`;
