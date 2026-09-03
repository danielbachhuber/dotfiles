// The shape of a todo item, shared by the store, the RPC contract, and the
// panel. Nothing here touches SQLite, the network, or the clock.

/**
 * Open items are still owed; done items are finished. There is deliberately no
 * "in progress" — the agent already reports what it is doing in the timeline,
 * and a third state would only invite the panel to disagree with it.
 */
export type TodoStatus = "open" | "done";

/**
 * Who created the item. The list is append-only for both, so this drives
 * presentation and nothing else: it is useful to see at a glance which steps
 * you asked for and which the agent proposed.
 */
export type TodoSource = "agent" | "user";

export type Todo = {
  id: string;
  threadId: string;
  text: string;
  status: TodoStatus;
  source: TodoSource;
  /** Sort key within a thread. Monotonic, never reused, gaps are fine. */
  position: number;
  createdAt: number;
  updatedAt: number;
};

/** What the sidebar glyph and the header button need, per thread. */
export type TodoCounts = {
  threadId: string;
  open: number;
  done: number;
};

/** Longest item text we store. Longer arrives elided rather than rejected. */
export const TEXT_MAX = 500;

/**
 * The most items one `todo_add` call may create. A model that wants to add
 * more than this in one go is enumerating rather than planning, and the
 * resulting list is unreadable.
 */
export const ADD_MAX = 50;
