/**
 * What a week is gathered from, in the plugin's own database.
 *
 * Which repository, whose username, which Harvest project, which 1:1 documents
 * — all of it identifies a person and their employer, so none of it belongs in
 * a file under a checkout of this plugin. bb keeps the database under
 * <dataDir>/plugins/weekly-review/, which is never committed and is deleted
 * with the plugin.
 *
 * Only the paths to the CLIs stay in settings, because a path is not a fact
 * about anyone.
 */
import type { Database } from "better-sqlite3";

export const MIGRATIONS = [
  `CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE docs (
     id       TEXT PRIMARY KEY,
     label    TEXT NOT NULL,
     position INTEGER NOT NULL
   )`,
];

export interface DocSource {
  id: string;
  label: string;
}

export interface Sources {
  /** `owner/name`, the repository the GitHub queries are scoped to. */
  repo: string;
  /** The GitHub login whose authorship, reviews, and assignments are gathered. */
  author: string;
  /** Numeric Harvest project id, or blank to gather every project's entries. */
  harvestProjectId: string;
  docs: DocSource[];
}

/** The scalar keys, so a typo in a `set` is a failure rather than a new row. */
export const SCALAR_KEYS = ["repo", "author", "harvestProjectId"] as const;
export type ScalarKey = (typeof SCALAR_KEYS)[number];

export function isScalarKey(key: string): key is ScalarKey {
  return (SCALAR_KEYS as readonly string[]).includes(key);
}

/** Which of these a week cannot be gathered without. */
export function missingSources(sources: Sources): string[] {
  const missing: string[] = [];
  if (sources.repo.trim() === "") missing.push("GitHub repository");
  if (sources.author.trim() === "") missing.push("GitHub username");
  return missing;
}

export interface SourceStore {
  read(): Sources;
  setScalar(key: ScalarKey, value: string): void;
  addDoc(id: string, label: string): DocSource;
  removeDoc(needle: string): DocSource | null;
  /** Replaces the whole doc list, in the order given. */
  replaceDocs(docs: DocSource[]): void;
}

export function createSourceStore(db: Database): SourceStore {
  const statements = {
    readSettings: db.prepare("SELECT key, value FROM settings"),
    writeSetting: db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
    readDocs: db.prepare("SELECT id, label FROM docs ORDER BY position, label"),
    nextPosition: db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM docs"),
    writeDoc: db.prepare(
      `INSERT INTO docs (id, label, position) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label`,
    ),
    findDoc: db.prepare(
      "SELECT id, label FROM docs WHERE id = ? OR label LIKE ? ORDER BY position LIMIT 1",
    ),
    deleteDoc: db.prepare("DELETE FROM docs WHERE id = ?"),
    clearDocs: db.prepare("DELETE FROM docs"),
  };

  const replace = db.transaction((docs: DocSource[]) => {
    statements.clearDocs.run();
    docs.forEach((doc, index) => statements.writeDoc.run(doc.id, doc.label, index));
  });

  return {
    read() {
      const rows = statements.readSettings.all() as Array<{ key: string; value: string }>;
      const values = new Map(rows.map((row) => [row.key, row.value]));
      return {
        repo: (values.get("repo") ?? "").trim(),
        author: (values.get("author") ?? "").trim(),
        harvestProjectId: (values.get("harvestProjectId") ?? "").trim(),
        docs: statements.readDocs.all() as DocSource[],
      };
    },

    setScalar(key, value) {
      statements.writeSetting.run(key, value.trim());
    },

    addDoc(id, label) {
      const { next } = statements.nextPosition.get() as { next: number };
      // A doc with no label given gets its id as one, so a typo shows up on the
      // page instead of vanishing.
      const doc = { id: id.trim(), label: label.trim() === "" ? id.trim() : label.trim() };
      statements.writeDoc.run(doc.id, doc.label, next);
      return doc;
    },

    removeDoc(needle) {
      const found = statements.findDoc.get(needle, `%${needle}%`) as DocSource | undefined;
      if (found === undefined) return null;
      statements.deleteDoc.run(found.id);
      return found;
    },

    replaceDocs: replace,
  };
}
