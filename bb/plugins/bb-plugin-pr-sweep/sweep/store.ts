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
  `CREATE TABLE IF NOT EXISTS thread_scan (
     thread_id TEXT PRIMARY KEY,
     scanned_at INTEGER NOT NULL
   )`,
  // Keyed by thread, not by pull request: one pull request genuinely has
  // several threads over its life — a conflict thread, then a CI thread, then
  // a merge thread — and `pr_threads`, keyed (repo, number), could only ever
  // remember the newest. Every earlier thread silently stopped being linked
  // to anything, which is how three unarchived threads ended up on #5840 with
  // nothing recording what any of them was for.
  `CREATE TABLE IF NOT EXISTS pr_thread_links (
     thread_id TEXT PRIMARY KEY,
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     reason TEXT
   )`,
  // Carries over whatever the old table still held. `pr_threads` is left in
  // place: these statements are append-only, and a dropped table cannot be
  // consulted if this migration turns out to have lost something.
  `INSERT OR IGNORE INTO pr_thread_links (thread_id, repo, number, created_at, reason)
     SELECT thread_id, repo, number, created_at, reason FROM pr_threads`,
  // Repositories the sweep found but did not fetch, because no bb project on
  // this machine has their remote. Stored so the panel can say why it is
  // empty instead of reading as "you have no open pull requests".
  `ALTER TABLE meta ADD COLUMN skipped_repos TEXT NOT NULL DEFAULT '[]'`,
  // Every reason the thread was started for, as a JSON array, superseding the
  // single `reason`. One click starts one thread on all of a row's findings,
  // so the one flag that named the button was never the whole job — and a
  // thread archived when that flag cleared still had the rest of its list.
  `ALTER TABLE pr_thread_links ADD COLUMN reasons TEXT`,
  // Carries the old single reason over, so a thread linked before this column
  // existed keeps auto-archiving on the flag it was started for. It is the
  // right answer for those rows: they predate multi-reason prompts only in
  // what was recorded, and the flag is the best account of them there is.
  `UPDATE pr_thread_links SET reasons = json_array(reason)
     WHERE reasons IS NULL AND reason IS NOT NULL`,
];

export interface SweepMeta {
  sweptAt: number | null;
  failedRepos: string[];
  skippedRepos: string[];
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
  /**
   * Records a thread started for a pull request. Keyed by thread, so a second
   * thread on the same pull request is added rather than replacing the first.
   * Re-linking the same thread updates it.
   */
  linkThread(
    repo: string,
    number: number,
    threadId: string,
    createdAt: number,
    reasons?: readonly string[],
  ): void;
  /** Every link with the work it was started for, for the archive sweep. */
  threadReasons(): Array<{
    repo: string;
    number: number;
    threadId: string;
    reasons: string[];
  }>;
  /**
   * The pull request's newest thread, which is the one its row acts on.
   *
   * Newest rather than first: the older threads are the finished work, and the
   * one you want to open is the one started most recently.
   */
  threadFor(repo: string, number: number): string | null;
  /** repo#number -> newest threadId, for stamping the whole listing in one read. */
  threadLinks(): Map<string, string>;
  /** repo#number -> every threadId, newest first. */
  allThreadLinks(): Map<string, string[]>;
  /** Drops the link when its thread is archived or deleted. */
  unlinkThread(threadId: string): void;
  /** The pull request a thread was started for, or null if it is not ours. */
  pullRequestForThread(threadId: string): { repo: string; number: number } | null;
  /**
   * Threads already examined for a pull request link, so a sweep reads each
   * one's first prompt once rather than every five minutes.
   *
   * A first prompt never changes, so a thread that named no pull request then
   * will not name one later. The set is not pruned: a row per thread ever seen
   * is cheaper than the read it saves, and a thread id is never reused.
   */
  scannedThreads(): Set<string>;
  markThreadScanned(threadId: string, scannedAt: number): void;
}

/** Tolerates a null column and anything that is not an array of strings. */
function parseReasons(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export function createStore(db: DatabaseLike): Store {
  const deleteRepo = db.prepare(`DELETE FROM rows WHERE repo = ?`);
  const insertRow = db.prepare(`INSERT INTO rows (repo, number, payload) VALUES (?, ?, ?)`);
  const selectRows = db.prepare(`SELECT payload FROM rows`);
  const selectMeta = db.prepare(
    `SELECT swept_at, failed_repos, skipped_repos, truncated, last_error FROM meta WHERE id = 1`,
  );
  const upsertMeta = db.prepare(
    `INSERT INTO meta (id, swept_at, failed_repos, skipped_repos, truncated, last_error)
     VALUES (1, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       swept_at = excluded.swept_at,
       failed_repos = excluded.failed_repos,
       skipped_repos = excluded.skipped_repos,
       truncated = excluded.truncated,
       last_error = NULL`,
  );
  // `reason` is written alongside `reasons` and holds its first entry, which
  // is the row's worst flag. Nothing reads it any more; it is kept current so
  // that anyone reading this table by hand is not looking at a stale column.
  const insertLink = db.prepare(
    `INSERT INTO pr_thread_links (repo, number, thread_id, created_at, reason, reasons)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       repo = excluded.repo,
       number = excluded.number,
       reason = excluded.reason,
       reasons = excluded.reasons,
       created_at = excluded.created_at`,
  );
  // Newest first, and by thread_id after that so a tie is at least stable
  // rather than left to SQLite's scan order.
  const selectLink = db.prepare(
    `SELECT thread_id FROM pr_thread_links WHERE repo = ? AND number = ?
     ORDER BY created_at DESC, thread_id DESC LIMIT 1`,
  );
  const selectLinks = db.prepare(
    `SELECT repo, number, thread_id FROM pr_thread_links
     ORDER BY created_at DESC, thread_id DESC`,
  );
  const selectReasons = db.prepare(
    `SELECT repo, number, thread_id, reasons FROM pr_thread_links`,
  );
  const deleteLink = db.prepare(`DELETE FROM pr_thread_links WHERE thread_id = ?`);
  const selectScans = db.prepare(`SELECT thread_id FROM thread_scan`);
  const insertScan = db.prepare(
    `INSERT INTO thread_scan (thread_id, scanned_at) VALUES (?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET scanned_at = excluded.scanned_at`,
  );
  const selectByThread = db.prepare(
    `SELECT repo, number FROM pr_thread_links WHERE thread_id = ?`,
  );
  const upsertFailure = db.prepare(
    `INSERT INTO meta (id, swept_at, failed_repos, skipped_repos, truncated, last_error)
     VALUES (1, NULL, '[]', '[]', 0, ?)
     ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error`,
  );

  /** Every link, grouped by pull request, newest thread first. */
  function groupedLinks(): Map<string, string[]> {
    const links = selectLinks.all() as Array<{ repo: string; number: number; thread_id: string }>;
    const byItem = new Map<string, string[]>();
    // The query is already newest-first, so pushing preserves that order.
    for (const link of links) {
      const key = `${link.repo}#${link.number}`;
      const existing = byItem.get(key);
      if (existing) existing.push(link.thread_id);
      else byItem.set(key, [link.thread_id]);
    }
    return byItem;
  }

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
        JSON.stringify(result.skippedRepos ?? []),
        result.truncated ? 1 : 0,
      );
    },

    readRows,

    readMeta() {
      const meta = selectMeta.get() as
        | {
            swept_at: number | null;
            failed_repos: string;
            skipped_repos: string;
            truncated: number;
            last_error: string | null;
          }
        | undefined;
      if (!meta) {
        return {
          sweptAt: null,
          failedRepos: [],
          skippedRepos: [],
          truncated: false,
          lastError: null,
        };
      }
      return {
        sweptAt: meta.swept_at,
        failedRepos: JSON.parse(meta.failed_repos) as string[],
        skippedRepos: JSON.parse(meta.skipped_repos ?? "[]") as string[],
        truncated: meta.truncated === 1,
        lastError: meta.last_error,
      };
    },

    recordFailure(message) {
      upsertFailure.run(message);
    },

    linkThread(repo, number, threadId, createdAt, reasons = []) {
      insertLink.run(
        repo,
        number,
        threadId,
        createdAt,
        reasons[0] ?? null,
        JSON.stringify(reasons),
      );
    },

    threadReasons() {
      return (
        selectReasons.all() as Array<{
          repo: string;
          number: number;
          thread_id: string;
          reasons: string | null;
        }>
      ).map((link) => ({
        repo: link.repo,
        number: link.number,
        threadId: link.thread_id,
        // A link with no reasons at all — adopted from the composer, or opened
        // rather than swept — is an empty list, which no caller can mistake
        // for finished work.
        reasons: parseReasons(link.reasons),
      }));
    },

    threadFor(repo, number) {
      const link = selectLink.get(repo, number) as { thread_id: string } | undefined;
      return link?.thread_id ?? null;
    },

    threadLinks() {
      // Not `this.allThreadLinks()`: a store method taken off the object and
      // called bare would lose `this`, and nothing stops a caller doing that.
      return new Map([...groupedLinks()].map(([key, threadIds]) => [key, threadIds[0]!]));
    },

    allThreadLinks() {
      return groupedLinks();
    },

    unlinkThread(threadId) {
      deleteLink.run(threadId);
    },

    scannedThreads() {
      return new Set(
        (selectScans.all() as Array<{ thread_id: string }>).map((entry) => entry.thread_id),
      );
    },

    markThreadScanned(threadId, scannedAt) {
      insertScan.run(threadId, scannedAt);
    },

    pullRequestForThread(threadId) {
      const link = selectByThread.get(threadId) as
        | { repo: string; number: number }
        | undefined;
      return link ?? null;
    },
  };
}
