import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const rowSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  labels: z.array(z.string()),
  boardStatus: z.string().nullable(),
  onBoard: z.boolean(),
  blockedBy: z.number(),
  closingPr: z.number().nullable(),
  /**
   * Checklist progress, or null. Optional as well as nullable: rows stored
   * before this field existed are read back from SQLite without it.
   */
  subtasks: z
    .object({
      completed: z.number(),
      total: z.number(),
      source: z.enum(["sub-issues", "tasks"]),
    })
    .nullish(),
  /** The thread this plugin started for the issue, or null. */
  threadId: z.string().nullable(),
  /** False when no bb project is checked out for the issue's repository. */
  canSpawn: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  commentsCount: z.number(),
});

export const rpcContract = defineRpcContract({
  listRows: {
    input: z.null(),
    output: z.object({
      rows: z.array(rowSchema),
      statusOrder: z.array(z.string()),
      /**
       * The board's own Status options, by name and in the board's order. The
       * panel picks by name and never sees an option id: the ids are the
       * board's private node ids, and the server has to resolve them anyway.
       */
      statusOptions: z.array(z.string()),
      /** Board statuses the sidebar badge counts. Empty counts every row. */
      countedStatuses: z.array(z.string()),
      /** Named so the panel can say which board it is offering to add to. */
      boardName: z.string(),
      sweptAt: z.number().nullable(),
      truncated: z.boolean(),
      lastError: z.string().nullable(),
      /**
       * Whether the Harvest plugin is installed, enabled, and usable. The
       * per-row clock renders only when it is, so the panel stays fully
       * useful with no Harvest plugin present.
       */
      harvest: z.object({
        available: z.boolean(),
        /**
         * The reference the running timer is against, so the matching row can
         * show it. Read with the listing rather than followed live: realtime
         * signals are scoped to the plugin that publishes them, so Issue Sweep
         * cannot subscribe to the Harvest plugin's broadcast.
         */
        running: z
          .object({ externalId: z.string(), groupId: z.string().nullable() })
          .nullable(),
      }),
    }),
  },
  refresh: {
    input: z.null(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  /**
   * Moves an issue to a status on the configured board, adding it to the board
   * first when it is not on it. One call covers both because the panel offers
   * them as one gesture.
   */
  /**
   * Starts a thread for an issue, or returns the one already linked to it.
   * Idempotent by design: two fast clicks must not produce two threads.
   */
  startThread: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({
      threadId: z.string().nullable(),
      /** True when an existing thread was returned rather than a new one started. */
      existing: z.boolean(),
      reason: z.string().nullable(),
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
    output: z.object({ projectId: z.number(), taskId: z.number() }).nullable(),
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
  setBoardStatus: {
    input: z.object({ repo: z.string(), number: z.number(), status: z.string() }),
    output: z.object({
      ok: z.boolean(),
      /** True when the issue was not on the board and had to be added. */
      added: z.boolean(),
      error: z.string().nullable(),
    }),
  },
});
