import type { ClassifiedRow, SweepResult } from "./types.js";

/**
 * APPEND-ONLY. Statement index is the migration id. Never edit or reorder a
 * shipped statement; only push new ones.
 */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS rows (
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     payload TEXT NOT NULL,
     PRIMARY KEY (repo, number)
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     swept_at INTEGER,
     truncated INTEGER NOT NULL DEFAULT 0,
     last_error TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS review_threads (
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     thread_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (repo, number)
   )`,
];

export interface SweepMeta {
  sweptAt: number | null;
  truncated: boolean;
  lastError: string | null;
}

interface StatementLike {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface DatabaseLike {
  prepare(sql: string): StatementLike;
  exec(sql: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

export interface Store {
  /**
   * The sweep is a single call, so it either returns the whole queue or fails.
   * There is no partial state to preserve: unlike pr-sweep, which keeps the
   * last known rows for a repository whose detail call failed, a failure here
   * leaves the previous rows untouched and records the error.
   */
  replaceAll(result: SweepResult): void;
  readRows(): ClassifiedRow[];
  readMeta(): SweepMeta;
  recordFailure(message: string): void;
  linkThread(repo: string, number: number, threadId: string, createdAt: number): void;
  threadFor(repo: string, number: number): string | null;
  /** repo#number -> threadId, for stamping the whole listing in one read. */
  threadLinks(): Map<string, string>;
  unlinkThread(threadId: string): void;
  /** The pull request a thread was started for, or null if it is not ours. */
  pullRequestForThread(threadId: string): { repo: string; number: number } | null;
}

export function createStore(db: DatabaseLike): Store {
  const deleteAllRows = db.prepare(`DELETE FROM rows`);
  const insertRow = db.prepare(`INSERT INTO rows (repo, number, payload) VALUES (?, ?, ?)`);
  const selectRows = db.prepare(`SELECT payload FROM rows`);
  const selectMeta = db.prepare(`SELECT swept_at, truncated, last_error FROM meta WHERE id = 1`);
  const upsertMeta = db.prepare(
    `INSERT INTO meta (id, swept_at, truncated, last_error)
     VALUES (1, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       swept_at = excluded.swept_at,
       truncated = excluded.truncated,
       last_error = NULL`,
  );
  const upsertFailure = db.prepare(
    `INSERT INTO meta (id, swept_at, truncated, last_error)
     VALUES (1, NULL, 0, ?)
     ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error`,
  );
  const insertLink = db.prepare(
    `INSERT INTO review_threads (repo, number, thread_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       thread_id = excluded.thread_id,
       created_at = excluded.created_at`,
  );
  const selectLink = db.prepare(
    `SELECT thread_id FROM review_threads WHERE repo = ? AND number = ?`,
  );
  const selectLinks = db.prepare(`SELECT repo, number, thread_id FROM review_threads`);
  const deleteLink = db.prepare(`DELETE FROM review_threads WHERE thread_id = ?`);
  const selectByThread = db.prepare(`SELECT repo, number FROM review_threads WHERE thread_id = ?`);

  const writeAll = db.transaction(((rows: ClassifiedRow[], sweptAt: number, truncated: number) => {
    deleteAllRows.run();
    for (const row of rows) insertRow.run(row.repo, row.number, JSON.stringify(row));
    upsertMeta.run(sweptAt, truncated);
  }) as (rows: ClassifiedRow[], sweptAt: number, truncated: number) => void);

  return {
    replaceAll(result) {
      writeAll(result.rows, result.sweptAt, result.truncated ? 1 : 0);
    },

    readRows() {
      return (selectRows.all() as Array<{ payload: string }>).map(
        (entry) => JSON.parse(entry.payload) as ClassifiedRow,
      );
    },

    readMeta() {
      const meta = selectMeta.get() as
        | { swept_at: number | null; truncated: number; last_error: string | null }
        | undefined;
      if (!meta) return { sweptAt: null, truncated: false, lastError: null };
      return {
        sweptAt: meta.swept_at,
        truncated: meta.truncated === 1,
        lastError: meta.last_error,
      };
    },

    recordFailure(message) {
      upsertFailure.run(message);
    },

    linkThread(repo, number, threadId, createdAt) {
      insertLink.run(repo, number, threadId, createdAt);
    },

    threadFor(repo, number) {
      const link = selectLink.get(repo, number) as { thread_id: string } | undefined;
      return link?.thread_id ?? null;
    },

    threadLinks() {
      const links = selectLinks.all() as Array<{
        repo: string;
        number: number;
        thread_id: string;
      }>;
      return new Map(links.map((link) => [`${link.repo}#${link.number}`, link.thread_id]));
    },

    unlinkThread(threadId) {
      deleteLink.run(threadId);
    },

    pullRequestForThread(threadId) {
      const link = selectByThread.get(threadId) as { repo: string; number: number } | undefined;
      return link ?? null;
    },
  };
}
