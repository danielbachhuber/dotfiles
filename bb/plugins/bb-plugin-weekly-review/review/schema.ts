/**
 * The wire and on-disk shape of a week, in one place.
 *
 * These schemas run at three boundaries: the RPC responses, the week.json a
 * previous run left on disk, and the reflect.json / slack.json an agent writes
 * by hand. `types.ts` infers its types from here so the two cannot drift, and
 * imports zod only as a type — the frontend gets the types without the runtime.
 */
import { z } from "zod";

/** A calendar day, `YYYY-MM-DD`, in local time. */
export const daySchema = z.string();
/** A full ISO-8601 instant, as the upstream APIs return it. */
export const instantSchema = z.string();

/**
 * Every source is wrapped so a failure is recorded rather than thrown. The page
 * renders "not gathered" for a failed source, which keeps a broken credential
 * from reading as a quiet week.
 */
export function sourceResult<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    fetchedAt: instantSchema,
    data,
  });
}

export const harvestEntrySchema = z.object({
  day: daySchema,
  task: z.string(),
  hours: z.number(),
  notes: z.string(),
});

export const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  /** `open` | `merged` | `closed` */
  state: z.string(),
  createdAt: instantSchema,
  /** Null when still open; the API's `0001-01-01` zero value is normalized away. */
  closedAt: instantSchema.nullable(),
  isDraft: z.boolean(),
});

export const reviewSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  state: z.string(),
  updatedAt: instantSchema,
});

export const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string().optional(),
  createdAt: instantSchema,
  updatedAt: instantSchema.optional(),
  labels: z.array(z.string()),
});

export const taskSchema = z.object({
  id: z.string(),
  content: z.string(),
  url: z.string(),
  priority: z.number(),
  /** Due date as `YYYY-MM-DD`, or null for someday tasks. */
  due: daySchema.nullable(),
  dueString: z.string().nullable(),
  recurring: z.boolean(),
  labels: z.array(z.string()),
});

/** Written by the agent step, not by the fetch — Reflect is MCP-only. */
export const reflectNoteSchema = z.object({
  day: daySchema,
  title: z.string(),
  body: z.string(),
});

/** Written by the agent step, not by the fetch — Slack is MCP-only. */
export const slackThreadSchema = z.object({
  day: daySchema,
  channel: z.string(),
  permalink: z.string().optional(),
  summary: z.string(),
  participants: z.array(z.string()).optional(),
});

export const docRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  /** Path to the cached plain-text copy, relative to the week directory. */
  cachedPath: z.string().optional(),
  error: z.string().optional(),
});

export const githubDataSchema = z.object({
  authored: z.array(pullRequestSchema),
  reviewed: z.array(reviewSchema),
  issuesCreated: z.array(issueSchema),
  issuesAssigned: z.array(issueSchema),
});

export const todoistDataSchema = z.object({
  /**
   * The `td` CLI exposes no completion timestamp, so these cannot be placed on
   * a specific day. They render at week level.
   */
  completed: z.array(taskSchema),
  incomplete: z.array(taskSchema),
});

export const weekDataSchema = z.object({
  from: daySchema,
  to: daySchema,
  generatedAt: instantSchema,
  harvest: sourceResult(z.array(harvestEntrySchema)),
  github: sourceResult(githubDataSchema),
  todoist: sourceResult(todoistDataSchema),
  docs: sourceResult(z.array(docRefSchema)),
  slack: sourceResult(z.array(slackThreadSchema)).optional(),
  reflect: sourceResult(z.array(reflectNoteSchema)).optional(),
});
