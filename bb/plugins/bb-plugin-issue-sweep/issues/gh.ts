import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sortRows, toRow, type IssueRow, type RawIssue, type SweepResult } from "./types.js";

const execFileAsync = promisify(execFile);

export const SEARCH_LIMIT = 100;

export const SEARCH_FIELDS = [
  "number", "title", "url", "repository", "labels",
  "createdAt", "updatedAt", "commentsCount", "isPullRequest",
].join(",");

export class GhUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhUnavailableError";
  }
}

export interface GhRunner {
  run(args: string[]): Promise<string>;
}

/** Argument-array spawn only. A shell string is never constructed. */
export function createGhRunner(ghPath: string): GhRunner {
  return {
    async run(args: string[]) {
      try {
        const { stdout } = await execFileAsync(ghPath, args, {
          maxBuffer: 32 * 1024 * 1024,
          timeout: 60_000,
        });
        return stdout;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT/.test(message)) {
          throw new GhUnavailableError(`\`${ghPath}\` was not found on PATH.`);
        }
        if (/auth|logged in|credentials|token/i.test(message)) {
          throw new GhUnavailableError("`gh` is not authenticated. Run `gh auth login`.");
        }
        throw error;
      }
    },
  };
}

/**
 * One search call covers every repository, so there is no per-repo fan-out and
 * no partial-failure state: the sweep either has the whole picture or it threw.
 */
export async function runSweep(gh: GhRunner, now: () => number): Promise<SweepResult> {
  const raw = await gh.run([
    "search", "issues",
    "--assignee=@me",
    "--state=open",
    "--limit", String(SEARCH_LIMIT),
    "--json", SEARCH_FIELDS,
  ]);

  const hits = JSON.parse(raw) as RawIssue[];
  const rows: IssueRow[] = [];
  for (const item of hits) {
    const row = toRow(item);
    if (row) rows.push(row);
  }

  return {
    rows: sortRows(rows),
    // Measured against the hits, not the rows: a page full of pull requests
    // still means the search was capped.
    truncated: hits.length >= SEARCH_LIMIT,
    sweptAt: now(),
  };
}
