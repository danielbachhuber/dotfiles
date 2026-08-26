/**
 * One store implementation for every domain. The three plugins this was merged
 * from each had their own copy over an identical schema — `rows(repo, number,
 * payload)` plus `meta` — differing only in the row type they parsed the
 * payload into. That difference is a type parameter, not a second file.
 */

/** The shape every domain's sweep produces. */
export interface StoredSweep<TRow> {
  rows: TRow[];
  /**
   * Optional because not every domain fans out per repository. The pull
   * request sweep does and reports which repositories failed; the review and
   * issue sweeps are a single search, so there is no breakdown to give.
   */
  repos?: string[];
  failedRepos?: string[];
  truncated: boolean;
  sweptAt: number;
}

/** A row must know which repository and number it belongs to; nothing else. */
export interface StoredRow {
  repo: string;
  number: number;
}

/**
 * APPEND-ONLY. Statement index is the migration id. Never edit or reorder a
 * shipped statement; only push new ones.
 */
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

export interface Store<TRow extends StoredRow> {
  replaceRepoRows(repo: string, rows: TRow[]): void;
  replaceAll(result: StoredSweep<TRow>): void;
  readRows(): TRow[];
  readMeta(): SweepMeta;
  recordFailure(message: string): void;
  /** Records the thread started for a PR. Re-linking the same PR replaces it. */
  linkThread(repo: string, number: number, threadId: string, createdAt: number): void;
  threadFor(repo: string, number: number): string | null;
  /** repo#number -> threadId, for stamping the whole listing in one read. */
  threadLinks(): Map<string, string>;
  /** Drops the link when its thread is archived or deleted. */
  unlinkThread(threadId: string): void;
  /** The pull request a thread was started for, or null if it is not ours. */
  pullRequestForThread(threadId: string): { repo: string; number: number } | null;
}

/**
 * Table names are namespaced by domain because all three live in one database
 * now. A bare `rows` table would have three writers.
 */
export function migrationsFor(prefix: string): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${prefix}_rows (
       repo TEXT NOT NULL,
       number INTEGER NOT NULL,
       payload TEXT NOT NULL,
       PRIMARY KEY (repo, number)
     )`,
    `CREATE TABLE IF NOT EXISTS ${prefix}_meta (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       swept_at INTEGER,
       failed_repos TEXT NOT NULL DEFAULT '[]',
       truncated INTEGER NOT NULL DEFAULT 0,
       last_error TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS ${prefix}_threads (
       repo TEXT NOT NULL,
       number INTEGER NOT NULL,
       thread_id TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (repo, number)
     )`,
  ];
}

/** APPEND-ONLY across releases, as `bb.storage.migrate` requires. */
export const MIGRATIONS = [
  ...migrationsFor("pr"),
  ...migrationsFor("review"),
  ...migrationsFor("issue"),
];

export function createStore<TRow extends StoredRow>(
  db: DatabaseLike,
  prefix: string,
): Store<TRow> {
  const deleteRepo = db.prepare(`DELETE FROM ${prefix}_rows WHERE repo = ?`);
  const insertRow = db.prepare(`INSERT INTO ${prefix}_rows (repo, number, payload) VALUES (?, ?, ?)`);
  const selectRows = db.prepare(`SELECT payload FROM ${prefix}_rows`);
  const selectMeta = db.prepare(
    `SELECT swept_at, failed_repos, truncated, last_error FROM ${prefix}_meta WHERE id = 1`,
  );
  const upsertMeta = db.prepare(
    `INSERT INTO ${prefix}_meta (id, swept_at, failed_repos, truncated, last_error)
     VALUES (1, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       swept_at = excluded.swept_at,
       failed_repos = excluded.failed_repos,
       truncated = excluded.truncated,
       last_error = NULL`,
  );
  const insertLink = db.prepare(
    `INSERT INTO ${prefix}_threads (repo, number, thread_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       thread_id = excluded.thread_id,
       created_at = excluded.created_at`,
  );
  const selectLink = db.prepare(`SELECT thread_id FROM ${prefix}_threads WHERE repo = ? AND number = ?`);
  const selectLinks = db.prepare(`SELECT repo, number, thread_id FROM ${prefix}_threads`);
  const deleteLink = db.prepare(`DELETE FROM ${prefix}_threads WHERE thread_id = ?`);
  const selectByThread = db.prepare(
    `SELECT repo, number FROM ${prefix}_threads WHERE thread_id = ?`,
  );
  const upsertFailure = db.prepare(
    `INSERT INTO ${prefix}_meta (id, swept_at, failed_repos, truncated, last_error)
     VALUES (1, NULL, '[]', 0, ?)
     ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error`,
  );

  const writeRepo = db.transaction(((repo: string, rows: TRow[]) => {
    deleteRepo.run(repo);
    for (const row of rows) insertRow.run(row.repo, row.number, JSON.stringify(row));
  }) as (repo: string, rows: TRow[]) => void);

  function readRows(): TRow[] {
    return (selectRows.all() as Array<{ payload: string }>).map(
      (entry) => JSON.parse(entry.payload) as TRow,
    );
  }

  return {
    replaceRepoRows(repo, rows) {
      writeRepo(repo, rows);
    },

    replaceAll(result) {
      const byRepo = new Map<string, TRow[]>();
      for (const repo of result.repos ?? []) {
        if (!(result.failedRepos ?? []).includes(repo)) byRepo.set(repo, []);
      }
      for (const row of result.rows) {
        byRepo.get(row.repo)?.push(row);
      }

      // Drop repositories that no longer appear at all, but keep the ones whose
      // detail call failed so a partial sweep never blanks their rows.
      const keep = new Set([...byRepo.keys(), ...(result.failedRepos ?? [])]);
      for (const repo of new Set(readRows().map((row) => row.repo))) {
        if (!keep.has(repo)) deleteRepo.run(repo);
      }
      for (const [repo, rows] of byRepo) writeRepo(repo, rows);

      upsertMeta.run(
        result.sweptAt,
        JSON.stringify(result.failedRepos ?? []),
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

    pullRequestForThread(threadId) {
      const link = selectByThread.get(threadId) as
        | { repo: string; number: number }
        | undefined;
      return link ?? null;
    },
  };
}
