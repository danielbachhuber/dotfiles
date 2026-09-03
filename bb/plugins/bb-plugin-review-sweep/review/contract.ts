import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const rowSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  isDraft: z.boolean(),
  state: z.enum(["first-look", "re-review"]),
  requestedAt: z.number(),
  lastReviewedAt: z.number().nullable(),
  requestedReviewers: z.array(z.string()),
  size: z.object({
    additions: z.number(),
    deletions: z.number(),
    changedFiles: z.number(),
  }),
  canSpawn: z.boolean(),
  /** The thread already started for this review, if any. */
  threadId: z.string().nullable(),
  /** When an ignored review comes back, or null when it is not ignored. */
  snoozedUntil: z.number().nullable(),
});

export const rpcContract = defineRpcContract({
  listRows: {
    input: z.null(),
    output: z.object({
      rows: z.array(rowSchema),
      sweptAt: z.number().nullable(),
      truncated: z.boolean(),
      lastError: z.string().nullable(),
      /** Resolved server-side so the panel does not re-parse the setting. */
      staleAfterDays: z.number(),
    }),
  },
  refresh: {
    input: z.null(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  pullRequestForThread: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z
      .object({ repo: z.string(), number: z.number(), url: z.string(), title: z.string() })
      .nullable(),
  },
  archiveThread: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  },
  snooze: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({ until: z.number() }),
  },
  unsnooze: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  reviewThis: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({
      threadId: z.string().nullable(),
      /** True when an existing thread was returned rather than a new one started. */
      existing: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
});
