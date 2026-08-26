import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const rowSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  labels: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  commentsCount: z.number(),
});

export const rpcContract = defineRpcContract({
  listIssues: {
    input: z.null(),
    output: z.object({
      rows: z.array(rowSchema),
      sweptAt: z.number().nullable(),
      truncated: z.boolean(),
      lastError: z.string().nullable(),
    }),
  },
  refreshIssues: {
    input: z.null(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
});
