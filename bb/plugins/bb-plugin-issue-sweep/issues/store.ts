import { sortRows, type IssueRow, type SweepResult } from "./types.js";

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
  /** Swaps the whole listing in one transaction. The sweep is all-or-nothing. */
  replaceAll(result: SweepResult): void;
  readRows(): IssueRow[];
  readMeta(): SweepMeta;
  /** Notes why a sweep failed, leaving the last good rows in place. */
  recordFailure(message: string): void;
}

export function createStore(db: DatabaseLike): Store {
  const deleteRows = db.prepare(`DELETE FROM rows`);
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

  const writeAll = db.transaction(((result: SweepResult) => {
    deleteRows.run();
    for (const row of result.rows) insertRow.run(row.repo, row.number, JSON.stringify(row));
    upsertMeta.run(result.sweptAt, result.truncated ? 1 : 0);
  }) as (result: SweepResult) => void);

  return {
    replaceAll(result) {
      writeAll(result);
    },

    // Sorting on read rather than trusting insertion order: SQLite makes no
    // ordering promise without an ORDER BY, and the payload is opaque to it.
    readRows() {
      return sortRows(
        (selectRows.all() as Array<{ payload: string }>).map(
          (entry) => JSON.parse(entry.payload) as IssueRow,
        ),
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
  };
}
