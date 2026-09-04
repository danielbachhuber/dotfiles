import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * The subset of BB's environment union these seeds ever produce. Kept tight
 * rather than loose: it is this plugin's own output, so a wrong shape is a bug
 * here, not bad input from elsewhere.
 */
const environmentSchema = z.union([
  z.object({ type: z.literal("project-default") }),
  z.object({
    type: z.literal("host"),
    /** Omitted: the composer resolves the project's own host, as it always has. */
    hostId: z.string().optional(),
    workspace: z.object({
      type: z.literal("managed-worktree"),
      baseBranch: z.object({ kind: z.literal("default") }),
    }),
  }),
]);

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
  environment: environmentSchema,
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
   * Everything the panel needs to open BB's composer for an issue, without
   * starting anything. Answers one of three ways: the issue already has a
   * thread, nothing can be started and here is why, or here are the seeds.
   */
  startThreadDraft: {
    input: z.object({ repo: z.string(), number: z.number() }).strict(),
    output: z.object({
      /** The thread already linked to this issue; the panel opens it. */
      existingThreadId: z.string().nullable(),
      /** Why nothing can be started, or null. */
      reason: z.string().nullable(),
      /** Null whenever `existingThreadId` or `reason` is set. */
      seed: seedSchema.nullable(),
    }),
  },
  /**
   * Starts a thread from what the composer resolved, or returns the one
   * already linked to the issue. Idempotent by design: two fast submits must
   * not produce two threads.
   */
  startThreadSubmit: {
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
