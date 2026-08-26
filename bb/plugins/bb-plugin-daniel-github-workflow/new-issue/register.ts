// bb-plugin-new-issue — backend entry.
//
// One job: take what BB's new-thread composer resolved — project, environment,
// execution selection, and the prompt the user typed — and spawn a thread that
// runs the draft-issue-description skill against that project's repo. The
// skill itself owns the drafting workflow; this plugin only prepends the
// instruction and hands the rest over untouched.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract.js";
import { z } from "zod";

/**
 * BB's composer resolves a complete NewThreadRequest and guarantees it is
 * JSON-serializable, so this validates only the two fields the plugin reads
 * and forwards the rest verbatim. threads.spawn validates the remainder
 * server-side, which is where that check belongs.
 */
const promptInputSchema = z.looseObject({ type: z.string() });
const newThreadRequestSchema = z.looseObject({
  projectId: z.string().min(1),
  input: z.array(promptInputSchema).min(1),
});

// Both schemas run at the wire boundary. Handler input/output are inferred
// from the shared contract; app.tsx imports only its type.
export { rpcContract } from "./contract.js";

/**
 * What the "Create issue" button sends. The draft-issue-description skill ends
 * by waiting for confirmation before it files anything, so this is that
 * confirmation — the button exists to save typing it, not to change the flow.
 */
const CREATE_MESSAGE = "Create the issue.";

/** Longest thread title we'll derive from the notes before eliding. */
const TITLE_MAX = 72;

/**
 * The first non-empty line of the notes, elided — enough to recognize the
 * thread in the sidebar before the agent renames it.
 */
export function deriveTitle(notes: string): string {
  const firstLine =
    notes
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  const title =
    firstLine.length > TITLE_MAX
      ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : firstLine;
  return `New issue: ${title}`;
}

/**
 * Prepended as its own prompt item so the user's own text, @-mentions, and
 * attachments reach the agent exactly as they were composed.
 */
export const ISSUE_INSTRUCTION =
  "Use the draft-issue-description skill to draft a GitHub issue for this " +
  "repository. What follows is what the issue should cover, in my own words.";

/** The plain text the user typed, across every text item in the prompt. */
export function extractNotes(input: readonly { type: string }[]): string {
  return input
    .filter(
      (item): item is { type: "text"; text: string } =>
        item.type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

/**
 * Creating an issue, as opposed to the three sweeps that list existing work.
 * It keeps no rows and no store: everything it needs comes from the composer
 * or the thread it is invoked from.
 */
export function registerNewIssue(bb: BbPluginApi) {
  bb.log.info("loaded");

  /**
   * Whether this plugin spawned the thread. threads.spawn stamps
   * originPluginId automatically, so this is the whole check — and it is what
   * keeps the button out of every unrelated thread's composer.
   */
  async function isOurThread(threadId: string): Promise<boolean> {
    const thread = await bb.sdk.threads.get({ threadId });
    return thread.originPluginId === bb.pluginId;
  }

  bb.rpc.register(rpcContract, {
    thread_is_ours: async ({ threadId }) => ({
      isOurs: await isOurThread(threadId),
    }),
    issue_create_send: async ({ threadId }) => {
      // Re-checked server-side: the frontend decides what to render, not what
      // this plugin is allowed to post into.
      if (!(await isOurThread(threadId))) return { sent: false };
      await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: CREATE_MESSAGE, mentions: [] }],
      });
      bb.log.info(`sent the create-issue confirmation to ${threadId}`);
      return { sent: true };
    },
    issue_thread_create: async ({ request }) => {
      const notes = extractNotes(request.input);
      if (notes === "") {
        throw new Error("Say what the issue should cover before submitting.");
      }
      // Everything the composer resolved — project, environment, provider,
      // model, reasoning, permission mode, execution provenance — is forwarded
      // untouched. Only the prompt and the title are the plugin's business.
      const thread = await bb.sdk.threads.spawn({
        ...request,
        input: [
          { type: "text", text: ISSUE_INSTRUCTION, mentions: [] },
          ...request.input,
        ],
        title: deriveTitle(notes),
      } as Parameters<typeof bb.sdk.threads.spawn>[0]);
      bb.log.info(`spawned issue thread ${thread.id} in ${request.projectId}`);
      return { threadId: thread.id };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
