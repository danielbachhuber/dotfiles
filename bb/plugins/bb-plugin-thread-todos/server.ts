// bb-plugin-thread-todos — backend entry.
//
// Owns a per-thread checklist that both the agent and the user write to. The
// agent writes through three native tools; the user writes through the panel's
// RPC methods. Every mutation lands in the same store and publishes on one
// realtime channel, so the panel, the header count, and the sidebar glyph all
// move together.
//
// Nothing here calls a model, and no background service exists: this plugin
// only records what a thread already decided.

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { REALTIME_CHANNEL, rpcContract } from "./todos/contract.js";
import { THREAD_INSTRUCTIONS } from "./todos/instructions.js";
import { renderForAgent } from "./todos/list.js";
import { MIGRATIONS, TodoStore } from "./todos/store.js";
import { ADD_MAX, TEXT_MAX } from "./todos/types.js";

export { rpcContract };

/** The tools this plugin registers, selected for every thread. */
const TOOL_NAMES = ["todo_add", "todo_complete", "todo_reopen"] as const;

const addParams = z.object({
  items: z
    .array(z.string().min(1).max(TEXT_MAX * 2))
    .min(1)
    .max(ADD_MAX)
    .describe("The steps to add, in the order you intend to do them."),
});

const refParams = z.object({
  items: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "The items to change, each an id from a previous call or the item's own text.",
    ),
});

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new TodoStore(db);

  bb.log.info("loaded");

  /**
   * One notification for every mutation, carrying the thread so a panel can
   * ignore other threads' traffic. The payload deliberately carries no rows:
   * every consumer re-reads, which keeps them correct after a missed message.
   */
  function announce(threadId: string): void {
    bb.realtime.publish(REALTIME_CHANNEL, { threadId, at: Date.now() });
  }

  bb.agents.registerTool({
    name: "todo_add",
    description:
      "Append steps to this thread's shared to-do list, which the user sees " +
      "in bb. Call it before starting non-trivial work, and again whenever " +
      "new work surfaces. Items already open on the list are skipped.",
    parameters: addParams,
    presentation: {
      label: { pending: "Adding to-dos", completed: "Added to-dos" },
      icon: { glyph: "ListTodo" },
    },
    execute: ({ items }, ctx) => {
      const created = store.add(ctx.threadId, items, "agent");
      announce(ctx.threadId);
      const preamble =
        created.length === items.length
          ? `Added ${created.length}.`
          : `Added ${created.length} of ${items.length}; the rest were already open.`;
      return `${preamble}\n\n${renderForAgent(store.list(ctx.threadId))}`;
    },
  });

  bb.agents.registerTool({
    name: "todo_complete",
    description:
      "Mark items on this thread's to-do list as done. Call it as each step " +
      "actually lands. Items cannot be deleted — a superseded step is " +
      "completed, not removed.",
    parameters: refParams,
    presentation: {
      label: { pending: "Completing to-dos", completed: "Completed to-dos" },
      icon: { glyph: "CircleCheck" },
    },
    execute: ({ items }, ctx) => setStatus(ctx.threadId, items, "done"),
  });

  bb.agents.registerTool({
    name: "todo_reopen",
    description:
      "Mark completed items on this thread's to-do list as open again, when " +
      "a step you thought was finished turns out not to be.",
    parameters: refParams,
    presentation: {
      label: { pending: "Reopening to-dos", completed: "Reopened to-dos" },
      icon: { glyph: "ListTodo" },
    },
    execute: ({ items }, ctx) => setStatus(ctx.threadId, items, "open"),
  });

  function setStatus(
    threadId: string,
    items: string[],
    status: "open" | "done",
  ): string {
    const { changed, unmatched } = store.setStatus(threadId, items, status);
    if (changed.length > 0) announce(threadId);
    const verb = status === "done" ? "Completed" : "Reopened";
    const missed =
      unmatched.length > 0
        ? ` No item matched: ${unmatched.join(", ")}. Use an id from the list below.`
        : "";
    return `${verb} ${changed.length}.${missed}\n\n${renderForAgent(store.list(threadId))}`;
  }

  // Tools and instructions both resolve at thread.start / turn.submit. Every
  // thread gets them: which threads sprawl is not knowable in advance, and a
  // list that only exists where you remembered to ask for it is not a list you
  // can trust to be complete.
  bb.agents.configure(() => ({
    tools: [...TOOL_NAMES],
    skills: [],
  }));
  bb.agents.contributeInstructions(() => THREAD_INSTRUCTIONS);

  bb.rpc.register(rpcContract, {
    todos_list: ({ threadId }) => ({ todos: store.list(threadId) }),
    todos_counts: () => ({ counts: store.allCounts() }),
    todos_add: ({ threadId, texts }) => {
      store.add(threadId, texts, "user");
      announce(threadId);
      return { todos: store.list(threadId) };
    },
    todos_set_status: ({ threadId, ids, status }) => {
      store.setStatus(threadId, ids, status);
      announce(threadId);
      return { todos: store.list(threadId) };
    },
    todos_remove: ({ threadId, id }) => {
      store.remove(threadId, id);
      announce(threadId);
      return { todos: store.list(threadId) };
    },
    todos_clear_done: ({ threadId }) => {
      store.clearDone(threadId);
      announce(threadId);
      return { todos: store.list(threadId) };
    },
  });

  // A deleted thread's list is unreachable and would otherwise sit in the
  // database forever. Archiving is deliberately not a trigger: an archived
  // thread can come back, and its unfinished steps are the reason to look.
  bb.events.on("thread.deleted", ({ thread }) => {
    const dropped = store.dropThread(thread.id);
    if (dropped > 0) {
      bb.log.info(`dropped ${dropped} to-dos for deleted thread ${thread.id}`);
      announce(thread.id);
    }
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
