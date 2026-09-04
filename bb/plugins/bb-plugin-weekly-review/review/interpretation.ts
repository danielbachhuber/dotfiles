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
work is a set of pull requests and issues that were the same effort, not a
single pull request and not a commit scope. Titles that repeat a phrase are
usually one body of work. Name each one in the words the work itself used, say
what happened in a sentence or two, mark whether it shipped or is still in
progress, and list every issue and pull request number it covers. Attach hours
only where the digest attributes them.

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

/** Fills the prompt's two placeholders. A template missing one still works. */
export function renderPrompt(template: string, digest: string, command: string): string {
  return template.replaceAll("{{DIGEST}}", digest).replaceAll("{{COMMAND}}", command);
}
