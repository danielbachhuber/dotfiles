// The RPC wire contract. server.ts registers handlers against it; app.tsx
// imports only its type. Every field the panel renders must appear in the row
// schema here, or the server drops it and the panel goes empty.

import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ADD_MAX, TEXT_MAX } from "./types.js";

export const todoSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  text: z.string(),
  status: z.enum(["open", "done"]),
  source: z.enum(["agent", "user"]),
  position: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const countsSchema = z.object({
  threadId: z.string(),
  open: z.number(),
  done: z.number(),
});

const threadInput = z.object({ threadId: z.string().min(1) }).strict();
const listOutput = z.object({ todos: z.array(todoSchema) });

export const rpcContract = defineRpcContract({
  todos_list: { input: threadInput, output: listOutput },
  todos_counts: {
    input: z.object({}).strict(),
    output: z.object({ counts: z.array(countsSchema) }),
  },
  todos_add: {
    input: z
      .object({
        threadId: z.string().min(1),
        texts: z.array(z.string().min(1).max(TEXT_MAX * 2)).min(1).max(ADD_MAX),
      })
      .strict(),
    output: listOutput,
  },
  todos_set_status: {
    input: z
      .object({
        threadId: z.string().min(1),
        ids: z.array(z.string().min(1)).min(1),
        status: z.enum(["open", "done"]),
      })
      .strict(),
    output: listOutput,
  },
  todos_remove: {
    input: z
      .object({ threadId: z.string().min(1), id: z.string().min(1) })
      .strict(),
    output: listOutput,
  },
  todos_clear_done: { input: threadInput, output: listOutput },
});

/** Realtime channel the panel, the header button, and the decorator all watch. */
export const REALTIME_CHANNEL = "todos";
