import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const checksSchema = z.object({
  pass: z.number(),
  fail: z.number(),
  skip: z.number(),
  pending: z.number(),
  cancelled: z.number(),
  total: z.number(),
});

const rowSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  flags: z.array(z.string()),
  group: z.enum(["needs-action", "ready-to-merge", "clean"]),
  checks: checksSchema,
  approvedBy: z.array(z.string()),
  commentedBy: z.array(z.string()),
  waitingOn: z.array(z.string()),
  awaitingReReview: z.boolean(),
  lastCommentBy: z.string().nullable(),
  unresolvedThreads: z.number(),
  outdatedThreads: z.number(),
  notedBy: z.array(z.string()),
  canSpawn: z.boolean(),
  /** The thread already started for this PR, if any. */
  threadId: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  listRows: {
    input: z.null(),
    output: z.object({
      rows: z.array(rowSchema),
      sweptAt: z.number().nullable(),
      failedRepos: z.array(z.string()),
      truncated: z.boolean(),
      lastError: z.string().nullable(),
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
  resolvePullRequest: {
    input: z.object({ input: z.string() }).strict(),
    output: z.object({
      pr: z
        .object({
          repo: z.string(),
          number: z.number(),
          title: z.string(),
          headRef: z.string(),
          url: z.string(),
          isDraft: z.boolean(),
          headRepo: z.string().nullable(),
          isFork: z.boolean(),
          maintainerCanModify: z.boolean(),
        })
        .nullable(),
      error: z.string().nullable(),
    }),
  },
  openPullRequest: {
    input: z.object({ input: z.string(), instructions: z.string() }).strict(),
    output: z.object({
      threadId: z.string().nullable(),
      worktree: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  archiveThread: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  },
  workOnThis: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({
      threadId: z.string().nullable(),
      /** True when an existing thread was returned rather than a new one started. */
      existing: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
});
