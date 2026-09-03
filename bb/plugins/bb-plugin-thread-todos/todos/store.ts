// The only module that touches SQLite. Everything it decides, it decides by
// calling into list.ts with rows it just read — so the interesting behaviour
// stays testable without a database.

import type { Database } from "better-sqlite3";
import { countsFor, newTexts, resolveRefs } from "./list.js";
import type { Todo, TodoCounts, TodoSource } from "./types.js";

/**
 * Append-only in the sense that matters: there is no statement here that
 * deletes an item on the agent's behalf. `remove` exists for the panel, where
 * a human is looking at the row they are deleting.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS todos (
     id TEXT PRIMARY KEY,
     threadId TEXT NOT NULL,
     text TEXT NOT NULL,
     status TEXT NOT NULL,
     source TEXT NOT NULL,
     position INTEGER NOT NULL,
     createdAt INTEGER NOT NULL,
     updatedAt INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS todos_thread ON todos (threadId, position)`,
];

type Row = {
  id: string;
  threadId: string;
  text: string;
  status: string;
  source: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

function toTodo(row: Row): Todo {
  return {
    ...row,
    status: row.status === "done" ? "done" : "open",
    source: row.source === "user" ? "user" : "agent",
  };
}

/**
 * `now` is injected rather than read from the clock so tests can assert
 * timestamps, and `newId` so ids are predictable in them. Both default to the
 * real thing.
 */
export type StoreOptions = {
  now?: () => number;
  newId?: () => string;
};

export class TodoStore {
  private readonly db: Database;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(db: Database, options: StoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID().slice(0, 8));
  }

  list(threadId: string): Todo[] {
    const rows = this.db
      .prepare(`SELECT * FROM todos WHERE threadId = ? ORDER BY position`)
      .all(threadId) as Row[];
    return rows.map(toTodo);
  }

  counts(threadId: string): TodoCounts {
    return countsFor(threadId, this.list(threadId));
  }

  /** Open counts for every thread that has any, for the sidebar decorator. */
  allCounts(): TodoCounts[] {
    const rows = this.db
      .prepare(
        `SELECT threadId,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
         FROM todos GROUP BY threadId`,
      )
      .all() as { threadId: string; open: number; done: number }[];
    return rows.map((row) => ({
      threadId: row.threadId,
      open: Number(row.open),
      done: Number(row.done),
    }));
  }

  /**
   * Append the proposed texts that are not already open on this thread.
   * Returns what was actually created, which is what the agent needs to hear:
   * silently deduping without saying so leads it to re-add forever.
   */
  add(threadId: string, texts: readonly string[], source: TodoSource): Todo[] {
    const existing = this.list(threadId);
    const fresh = newTexts(existing, texts);
    if (fresh.length === 0) return [];

    const at = this.now();
    let position = existing.reduce((max, todo) => Math.max(max, todo.position), 0);
    const created: Todo[] = fresh.map((text) => {
      position += 1;
      return {
        id: this.newId(),
        threadId,
        text,
        status: "open" as const,
        source,
        position,
        createdAt: at,
        updatedAt: at,
      };
    });

    const insert = this.db.prepare(
      `INSERT INTO todos (id, threadId, text, status, source, position, createdAt, updatedAt)
       VALUES (@id, @threadId, @text, @status, @source, @position, @createdAt, @updatedAt)`,
    );
    this.db.transaction((items: Todo[]) => {
      for (const item of items) insert.run(item);
    })(created);

    return created;
  }

  /**
   * Mark items done or open again. `refs` are ids or item text — see
   * `resolveRefs`. Unmatched references come back rather than throwing, so the
   * agent can correct itself against the list it is handed in the same result.
   */
  setStatus(
    threadId: string,
    refs: readonly string[],
    status: "open" | "done",
  ): { changed: Todo[]; unmatched: string[] } {
    const { matched, unmatched } = resolveRefs(this.list(threadId), refs);
    const changing = matched.filter((todo) => todo.status !== status);
    if (changing.length > 0) {
      const at = this.now();
      const update = this.db.prepare(
        `UPDATE todos SET status = ?, updatedAt = ? WHERE id = ? AND threadId = ?`,
      );
      this.db.transaction((items: Todo[]) => {
        for (const item of items) update.run(status, at, item.id, threadId);
      })(changing);
    }
    return { changed: this.list(threadId).filter((todo) =>
      changing.some((item) => item.id === todo.id),
    ), unmatched };
  }

  /** Panel-only. The agent has no tool that reaches this. */
  remove(threadId: string, id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM todos WHERE id = ? AND threadId = ?`)
      .run(id, threadId);
    return result.changes > 0;
  }

  /** Panel-only: clear the finished items once they stop being useful. */
  clearDone(threadId: string): number {
    return this.db
      .prepare(`DELETE FROM todos WHERE threadId = ? AND status = 'done'`)
      .run(threadId).changes;
  }

  /** Called when bb tells us a thread is gone. */
  dropThread(threadId: string): number {
    return this.db.prepare(`DELETE FROM todos WHERE threadId = ?`).run(threadId)
      .changes;
  }
}
