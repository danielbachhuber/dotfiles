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
     failed_repos TEXT NOT NULL DEFAULT '[]',
     truncated INTEGER NOT NULL DEFAULT 0,
     last_error TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS pr_threads (
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     thread_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (repo, number)
   )`,
  // The flag the thread was started for, so the sweep can tell when that
  // particular piece of work is finished. Nullable: rows linked before this
  // column existed have no reason and are simply never auto-archived.
  `ALTER TABLE pr_threads ADD COLUMN reason TEXT`,
];

export interface SweepMeta {
  sweptAt: number | null;
  failedRepos: string[];
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
  replaceRepoRows(repo: string, rows: ClassifiedRow[]): void;
  replaceAll(result: SweepResult): void;
  readRows(): ClassifiedRow[];
  readMeta(): SweepMeta;
  recordFailure(message: string): void;
  /** Records the thread started for a PR. Re-linking the same PR replaces it. */
  linkThread(
    repo: string,
    number: number,
    threadId: string,
    createdAt: number,
    reason?: string | null,
  ): void;
  /** Every link with the flag it was started for, for the archive sweep. */
  threadReasons(): Array<{ repo: string; number: number; threadId: string; reason: string | null }>;
  threadFor(repo: string, number: number): string | null;
  /** repo#number -> threadId, for stamping the whole listing in one read. */
  threadLinks(): Map<string, string>;
  /** Drops the link when its thread is archived or deleted. */
  unlinkThread(threadId: string): void;
  /** The pull request a thread was started for, or null if it is not ours. */
  pullRequestForThread(threadId: string): { repo: string; number: number } | null;
}

export function createStore(db: DatabaseLike): Store {
  const deleteRepo = db.prepare(`DELETE FROM rows WHERE repo = ?`);
  const insertRow = db.prepare(`INSERT INTO rows (repo, number, payload) VALUES (?, ?, ?)`);
  const selectRows = db.prepare(`SELECT payload FROM rows`);
  const selectMeta = db.prepare(
    `SELECT swept_at, failed_repos, truncated, last_error FROM meta WHERE id = 1`,
  );
  const upsertMeta = db.prepare(
    `INSERT INTO meta (id, swept_at, failed_repos, truncated, last_error)
     VALUES (1, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       swept_at = excluded.swept_at,
       failed_repos = excluded.failed_repos,
       truncated = excluded.truncated,
       last_error = NULL`,
  );
  const insertLink = db.prepare(
    `INSERT INTO pr_threads (repo, number, thread_id, created_at, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       thread_id = excluded.thread_id,
       reason = excluded.reason,
       created_at = excluded.created_at`,
  );
  const selectLink = db.prepare(`SELECT thread_id FROM pr_threads WHERE repo = ? AND number = ?`);
  const selectLinks = db.prepare(`SELECT repo, number, thread_id FROM pr_threads`);
  const selectReasons = db.prepare(`SELECT repo, number, thread_id, reason FROM pr_threads`);
  const deleteLink = db.prepare(`DELETE FROM pr_threads WHERE thread_id = ?`);
  const selectByThread = db.prepare(
    `SELECT repo, number FROM pr_threads WHERE thread_id = ?`,
  );
  const upsertFailure = db.prepare(
    `INSERT INTO meta (id, swept_at, failed_repos, truncated, last_error)
     VALUES (1, NULL, '[]', 0, ?)
     ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error`,
  );

  const writeRepo = db.transaction(((repo: string, rows: ClassifiedRow[]) => {
    deleteRepo.run(repo);
    for (const row of rows) insertRow.run(row.repo, row.number, JSON.stringify(row));
  }) as (repo: string, rows: ClassifiedRow[]) => void);

  function readRows(): ClassifiedRow[] {
    return (selectRows.all() as Array<{ payload: string }>).map(
      (entry) => JSON.parse(entry.payload) as ClassifiedRow,
    );
  }

  return {
    replaceRepoRows(repo, rows) {
      writeRepo(repo, rows);
    },

    replaceAll(result) {
      const byRepo = new Map<string, ClassifiedRow[]>();
      for (const repo of result.repos) {
        if (!result.failedRepos.includes(repo)) byRepo.set(repo, []);
      }
      for (const row of result.rows) {
        byRepo.get(row.repo)?.push(row);
      }

      // Drop repositories that no longer appear at all, but keep the ones whose
      // detail call failed so a partial sweep never blanks their rows.
      const keep = new Set([...byRepo.keys(), ...result.failedRepos]);
      for (const repo of new Set(readRows().map((row) => row.repo))) {
        if (!keep.has(repo)) deleteRepo.run(repo);
      }
      for (const [repo, rows] of byRepo) writeRepo(repo, rows);

      upsertMeta.run(
        result.sweptAt,
        JSON.stringify(result.failedRepos),
        result.truncated ? 1 : 0,
      );
    },

    readRows,

    readMeta() {
      const meta = selectMeta.get() as
        | {
            swept_at: number | null;
            failed_repos: string;
            truncated: number;
            last_error: string | null;
          }
        | undefined;
      if (!meta) return { sweptAt: null, failedRepos: [], truncated: false, lastError: null };
      return {
        sweptAt: meta.swept_at,
        failedRepos: JSON.parse(meta.failed_repos) as string[],
        truncated: meta.truncated === 1,
        lastError: meta.last_error,
      };
    },

    recordFailure(message) {
      upsertFailure.run(message);
    },

    linkThread(repo, number, threadId, createdAt, reason = null) {
      insertLink.run(repo, number, threadId, createdAt, reason);
    },

    threadReasons() {
      return (
        selectReasons.all() as Array<{
          repo: string;
          number: number;
          thread_id: string;
          reason: string | null;
        }>
      ).map((link) => ({
        repo: link.repo,
        number: link.number,
        threadId: link.thread_id,
        reason: link.reason,
      }));
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

    pullRequestForThread(threadId) {
      const link = selectByThread.get(threadId) as
        | { repo: string; number: number }
        | undefined;
      return link ?? null;
    },
  };
}
