import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The one place any of the GitHub plugins spawns a process.
 *
 * This was byte-identical in pr-sweep, review-sweep and issue-sweep. What
 * each plugin does with the runner is not shared and should not be: their
 * fetch strategies genuinely differ, and their classifiers differ more.
 */
export const REPO_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface GhRunner {
  run(args: string[]): Promise<string>;
}

export class GhUnavailableError extends Error {
  constructor(
    message: string,
    /** What gh actually said, for a log that has to explain a hidden panel. */
    readonly detail: string,
  ) {
    super(message);
    this.name = "GhUnavailableError";
  }
}

/**
 * Phrases gh uses when the problem is genuinely the credentials.
 *
 * Deliberately specific. The previous test was /auth|logged in|credentials|
 * token/i against the whole error, and an execFile error message contains the
 * entire argv — so any future flag or GraphQL field containing "token" or
 * "auth" would classify a network blip as a broken login. The cost of a false
 * positive is not a wrong log line: it latches the plugin into
 * needs-configuration, which hides its panels until someone reloads it.
 */
const AUTH_PATTERNS = [
  /gh auth login/i,
  /not logged in/i,
  /bad credentials/i,
  /requires authentication/i,
  /authentication required/i,
  /HTTP 401/,
];

/** gh writes the useful part to stderr; the message is mostly the argv. */
function ghStderr(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  return typeof stderr === "string" ? stderr : "";
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
        const stderr = ghStderr(error);
        if (/ENOENT/.test(message)) {
          throw new GhUnavailableError(`\`${ghPath}\` was not found on PATH.`, message);
        }
        // Against stderr, not the message: the message carries the argv.
        if (AUTH_PATTERNS.some((pattern) => pattern.test(stderr))) {
          throw new GhUnavailableError(
            "`gh` is not authenticated. Run `gh auth login`.",
            stderr.trim(),
          );
        }
        throw error;
      }
    },
  };
}

