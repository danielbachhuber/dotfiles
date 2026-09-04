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
  /** The newest thread for this PR, which its action opens. Null when it has none. */
  threadId: z.string().nullable(),
  /**
   * Every thread for this PR, newest first, so the row can offer the older
   * ones rather than pretending the newest is the only one. Includes
   * `threadId` as its first entry.
   */
  threadIds: z.array(z.string()),
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
      harvest: z.object({
        available: z.boolean(),
        /**
         * The reference the running timer is against, so the matching row can
         * show it. Read with the listing rather than followed live: realtime
         * signals are scoped to the plugin that publishes them, so this plugin
         * cannot subscribe to the Harvest plugin's broadcast.
         */
        running: z
          .object({ externalId: z.string(), groupId: z.string().nullable() })
          .nullable(),
      }),
    }),
  },
  /**
   * The Harvest surface, proxied.
   *
   * bb plugins cannot render each other's React components, so Issue Sweep
   * draws its own clock and forwards these to the Harvest plugin, which owns
   * every credential and every Harvest request. Reads degrade to an empty
   * answer; the write reports its failure.
   */
  harvestAssignments: {
    input: z.null(),
    output: z.object({
      projects: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          code: z.string().nullable(),
          clientName: z.string().nullable(),
          tasks: z.array(z.object({ id: z.number(), name: z.string() })),
        }),
      ),
    }),
  },
  harvestTrackedHours: {
    input: z.object({ externalId: z.string(), groupId: z.string().nullish() }).strict(),
    output: z.object({ hours: z.number() }),
  },
  harvestLastSelection: {
    input: z.object({ scope: z.string().nullable() }).strict(),
    // `exact` must be declared, or zod silently strips it and the picker
    // cannot tell a surface's own history from the global fallback.
    output: z
      .object({ projectId: z.number(), taskId: z.number(), exact: z.boolean() })
      .nullable(),
  },
  harvestStartTimer: {
    input: z
      .object({
        projectId: z.number(),
        taskId: z.number(),
        notes: z.string(),
        externalReference: z
          .object({
            id: z.string(),
            groupId: z.string().nullable(),
            accountId: z.string().nullable(),
            permalink: z.string().nullable(),
          })
          .optional(),
      })
      .strict(),
    output: z.object({
      entry: z
        .object({
          id: z.number(),
          projectName: z.string(),
          taskName: z.string(),
          notes: z.string().nullable(),
          hours: z.number(),
          timerStartedAt: z.string().nullable(),
          externalReference: z
            .object({
              id: z.string(),
              groupId: z.string().nullable(),
              accountId: z.string().nullable(),
              permalink: z.string().nullable(),
            })
            .nullable(),
        })
        .nullable(),
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
