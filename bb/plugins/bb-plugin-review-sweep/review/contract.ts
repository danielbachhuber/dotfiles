import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * What BB's new-thread composer is seeded with. The settings still decide
 * these; the composer only lets one thread differ from them.
 */
const seedSchema = z.object({
  projectId: z.string(),
  /** Blank in settings arrives as null: "let BB choose". */
  providerId: z.string().nullable(),
  model: z.string().nullable(),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
  prompt: z.string(),
});

/**
 * BB's composer resolves a complete NewThreadRequest and guarantees it is
 * JSON-serializable, so this validates only the fields the plugin reads and
 * forwards the rest verbatim. `threads.spawn` validates the remainder
 * server-side, which is where that check belongs.
 */
const newThreadRequestSchema = z.looseObject({
  projectId: z.string().min(1),
  input: z.array(z.looseObject({ type: z.string() })).min(1),
});

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
  /**
   * Everything the panel needs to open BB's composer for a review, without
   * starting anything. Answers one of three ways: the review already has a
   * thread, nothing can be started and here is why, or here are the seeds.
   */
  reviewThisDraft: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({
      /** The thread already linked to this review; the panel opens it. */
      existingThreadId: z.string().nullable(),
      /** Why nothing can be started, or null. */
      reason: z.string().nullable(),
      /** Null whenever `existingThreadId` or `reason` is set. */
      seed: seedSchema.nullable(),
    }),
  },
  /**
   * Starts a thread from what the composer resolved, or returns the one
   * already linked to the review. Idempotent by design: two fast submits must
   * not produce two threads.
   */
  reviewThisSubmit: {
    input: z
      .object({
        repo: z.string(),
        number: z.number(),
        request: newThreadRequestSchema,
      })
      .strict(),
    output: z.object({
      threadId: z.string().nullable(),
      /** True when an existing thread was returned rather than a new one started. */
      existing: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
});
