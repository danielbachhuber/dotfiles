// bb-plugin-diff-viewed — backend entry.
//
// One job: persist which files in a thread's diff have been marked viewed, so
// the mark survives a reload and follows the thread across app windows. All
// the interesting logic — keying, fingerprinting, pruning — lives in
// viewed/marks.ts as pure functions; this file is the storage boundary and the
// wire contract.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { prune, recordKey, withMark, type ViewedRecord } from "./viewed/marks";
import { PREFS_KEY, type ToolbarPrefs } from "./viewed/prefs";

const recordSchema = z.record(z.string(), z.string());

const threadIdSchema = z.string().trim().min(1).max(200);
// A rename card's label is `previous -> current`, so paths are not bounded by
// a single path length. 2000 is generous and still keeps a hostile client from
// filling kv storage with one key.
const pathSchema = z.string().trim().min(1).max(2000);

/**
 * Toolbar preferences. Both fields are optional on the wire because "never
 * chosen" is a real state: it is what leaves bb's own width-driven view-mode
 * default in charge.
 */
const prefsSchema = z
  .object({
    wrap: z.boolean().optional(),
    view: z.enum(["unified", "split"]).optional(),
  })
  .strict();

export const rpcContract = defineRpcContract({
  viewed_list: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ record: recordSchema }),
  },
  viewed_set: {
    input: z
      .object({
        threadId: threadIdSchema,
        path: pathSchema,
        fingerprint: z.string().trim().min(1).max(200),
        viewed: z.boolean(),
      })
      .strict(),
    output: z.object({ record: recordSchema }),
  },
  viewed_prune: {
    input: z
      .object({
        threadId: threadIdSchema,
        presentPaths: z.array(pathSchema).max(5000),
      })
      .strict(),
    output: z.object({ record: recordSchema }),
  },
  prefs_get: {
    input: z.null(),
    output: z.object({ prefs: prefsSchema }),
  },
  prefs_set: {
    input: prefsSchema,
    output: z.object({ prefs: prefsSchema }),
  },
});

/**
 * Realtime channel the content script listens on. The payload carries the
 * thread id so a window showing a different thread can ignore it without a
 * refetch.
 */
export const VIEWED_CHANGED = "viewed-changed";

/** Realtime channel for a toolbar preference change. */
export const PREFS_CHANGED = "prefs-changed";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  async function read(threadId: string): Promise<ViewedRecord> {
    return (await bb.storage.kv.get<ViewedRecord>(recordKey(threadId))) ?? {};
  }

  async function readPrefs(): Promise<ToolbarPrefs> {
    return (await bb.storage.kv.get<ToolbarPrefs>(PREFS_KEY)) ?? {};
  }

  /**
   * Persist only when the pure layer actually produced a different record.
   * Identity is the signal: `withMark` and `prune` return their input when
   * nothing changed, which keeps a redundant checkbox click from writing
   * storage and waking every open window.
   */
  async function commit(
    threadId: string,
    before: ViewedRecord,
    after: ViewedRecord,
  ): Promise<ViewedRecord> {
    if (after === before) return before;
    await bb.storage.kv.set(recordKey(threadId), after);
    bb.realtime.publish(VIEWED_CHANGED, { threadId });
    return after;
  }

  bb.rpc.register(rpcContract, {
    viewed_list: async ({ threadId }) => ({ record: await read(threadId) }),
    viewed_set: async ({ threadId, path, fingerprint, viewed }) => {
      const before = await read(threadId);
      const after = withMark(before, { path, fingerprint }, viewed);
      return { record: await commit(threadId, before, after) };
    },
    viewed_prune: async ({ threadId, presentPaths }) => {
      const before = await read(threadId);
      const after = prune(before, presentPaths);
      return { record: await commit(threadId, before, after) };
    },
    prefs_get: async () => ({ prefs: await readPrefs() }),
    prefs_set: async (prefs) => {
      await bb.storage.kv.set(PREFS_KEY, prefs);
      bb.realtime.publish(PREFS_CHANGED, prefs);
      return { prefs };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
