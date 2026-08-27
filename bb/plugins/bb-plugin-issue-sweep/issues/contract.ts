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
      /** Named so the panel can say which board it is offering to add to. */
      boardName: z.string(),
      sweptAt: z.number().nullable(),
      truncated: z.boolean(),
      lastError: z.string().nullable(),
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
