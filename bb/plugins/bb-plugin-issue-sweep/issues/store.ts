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
  `CREATE TABLE IF NOT EXISTS issue_threads (
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     thread_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (repo, number)
   )`,
  `CREATE TABLE IF NOT EXISTS board_auto (
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     status TEXT NOT NULL,
     applied_at INTEGER NOT NULL,
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
  /** Swaps the whole listing in one transaction. The sweep is all-or-nothing. */
  replaceAll(result: SweepResult): void;
  readRows(): IssueRow[];
  readMeta(): SweepMeta;
  /** Notes why a sweep failed, leaving the last good rows in place. */
  recordFailure(message: string): void;
  /** Records the thread started for an issue. Re-linking replaces it. */
  linkThread(repo: string, number: number, threadId: string, createdAt: number): void;
  threadFor(repo: string, number: number): string | null;
  /** repo#number -> threadId, for stamping the whole listing in one read. */
  threadLinks(): Map<string, string>;
  /** Drops the link when its thread is archived or deleted. */
  unlinkThread(threadId: string): void;
  /**
   * The last board status this plugin moved an issue to on its own, or null.
   *
   * The point is to move an issue at most once per target. Without it the
   * sweep would drag a card back to "In Review" every five minutes for as long
   * as the pull request stayed open, undoing any move made by hand.
   */
  autoAppliedStatus(repo: string, number: number): string | null;
  recordAutoStatus(repo: string, number: number, status: string, appliedAt: number): void;
  /**
   * Patches one row's board status in place, without a sweep.
   *
   * The board stays the source of truth; this only stops the panel from
   * contradicting a move it just made. A card dragged to "In Progress" that
   * still reads "Ready" until the next five-minute sweep looks like the click
   * failed, and invites a second one.
   *
   * Returns false when the row is not in the listing, which is how the caller
   * learns the patch went nowhere.
   */
  setRowStatus(repo: string, number: number, status: string): boolean;
}

export function createStore(db: DatabaseLike): Store {
  const deleteRows = db.prepare(`DELETE FROM rows`);
  const insertRow = db.prepare(`INSERT INTO rows (repo, number, payload) VALUES (?, ?, ?)`);
  const selectRows = db.prepare(`SELECT payload FROM rows`);
  const selectRow = db.prepare(`SELECT payload FROM rows WHERE repo = ? AND number = ?`);
  const updateRow = db.prepare(`UPDATE rows SET payload = ? WHERE repo = ? AND number = ?`);
  const selectMeta = db.prepare(`SELECT swept_at, truncated, last_error FROM meta WHERE id = 1`);
  const upsertMeta = db.prepare(
    `INSERT INTO meta (id, swept_at, truncated, last_error)
     VALUES (1, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       swept_at = excluded.swept_at,
       truncated = excluded.truncated,
       last_error = NULL`,
  );
  const insertLink = db.prepare(
    `INSERT INTO issue_threads (repo, number, thread_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       thread_id = excluded.thread_id,
       created_at = excluded.created_at`,
  );
  const selectLink = db.prepare(`SELECT thread_id FROM issue_threads WHERE repo = ? AND number = ?`);
  const selectLinks = db.prepare(`SELECT repo, number, thread_id FROM issue_threads`);
  const deleteLink = db.prepare(`DELETE FROM issue_threads WHERE thread_id = ?`);
  const selectAuto = db.prepare(`SELECT status FROM board_auto WHERE repo = ? AND number = ?`);
  const upsertAuto = db.prepare(
    `INSERT INTO board_auto (repo, number, status, applied_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       status = excluded.status,
       applied_at = excluded.applied_at`,
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

    linkThread(repo, number, threadId, createdAt) {
      insertLink.run(repo, number, threadId, createdAt);
    },

    threadFor(repo, number) {
      const link = selectLink.get(repo, number) as { thread_id: string } | undefined;
      return link?.thread_id ?? null;
    },

    threadLinks() {
      const links = selectLinks.all() as Array<{ repo: string; number: number; thread_id: string }>;
      return new Map(links.map((link) => [`${link.repo}#${link.number}`, link.thread_id]));
    },

    unlinkThread(threadId) {
      deleteLink.run(threadId);
    },

    autoAppliedStatus(repo, number) {
      const row = selectAuto.get(repo, number) as { status: string } | undefined;
      return row?.status ?? null;
    },

    setRowStatus(repo, number, status) {
      const stored = selectRow.get(repo, number) as { payload: string } | undefined;
      if (!stored) return false;
      const row = JSON.parse(stored.payload) as IssueRow;
      if (row.boardStatus === status) return false;
      updateRow.run(JSON.stringify({ ...row, boardStatus: status }), repo, number);
      return true;
    },

    recordAutoStatus(repo, number, status, appliedAt) {
      upsertAuto.run(repo, number, status, appliedAt);
    },
  };
}
