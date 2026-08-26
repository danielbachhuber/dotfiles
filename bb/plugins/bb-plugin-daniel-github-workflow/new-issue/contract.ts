import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const promptInputSchema = z.looseObject({ type: z.string() });
const newThreadRequestSchema = z.looseObject({
  projectId: z.string().min(1),
  input: z.array(promptInputSchema).min(1),
});

export const rpcContract = defineRpcContract({
  thread_is_ours: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ isOurs: z.boolean() }),
  },
  issue_create_send: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ sent: z.boolean() }),
  },
  issue_thread_create: {
    input: z.object({ request: newThreadRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
});
