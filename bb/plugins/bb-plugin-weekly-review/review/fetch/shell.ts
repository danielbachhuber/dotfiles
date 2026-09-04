import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SourceResult } from '../types.js';

const exec = promisify(execFile);

export class CommandError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
  }
}

/**
 * Runs a CLI and returns stdout. Uses execFile rather than a shell so arguments
 * containing quotes or spaces can't be reinterpreted as shell syntax.
 */
export async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err: any) {
    const stderr = String(err?.stderr ?? '').trim();
    const detail = stderr || err?.message || 'unknown error';
    throw new CommandError(`\`${cmd} ${args.slice(0, 2).join(' ')}\` failed: ${bestErrorLine(detail)}`, stderr);
  }
}

export async function runJson<T>(cmd: string, args: string[]): Promise<T> {
  const raw = await run(cmd, args);
  return parseJsonOutput<T>(raw, cmd);
}

/**
 * Some of these CLIs print a keyring or auth notice on stdout ahead of the JSON.
 * Scanning for the first `[` or `{` anywhere is too eager — it will happily latch
 * onto a bracket inside a task name in a plain-text table — so only a line that
 * *begins* a JSON document counts.
 */
export function parseJsonOutput<T>(raw: string, cmd = 'command'): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to the notice-prefixed case
  }

  const lines = trimmed.split('\n');
  const start = lines.findIndex((line) => /^\s*[[{]/.test(line));
  if (start !== -1) {
    try {
      return JSON.parse(lines.slice(start).join('\n')) as T;
    } catch {
      // fall through to the error below
    }
  }
  throw new CommandError(
    `\`${cmd}\` did not return JSON (got ${describe(trimmed)})`,
    raw,
  );
}

function describe(text: string): string {
  if (!text) return 'empty output';
  const first = text.split('\n')[0].slice(0, 60);
  return `"${first}${text.length > first.length ? '…' : ''}"`;
}

/**
 * Picks the most informative line out of a failed command's stderr. Wrapper
 * scripts often lead with a Node stack header, so taking the first line yields
 * `node:internal/errors:999` instead of the actual cause.
 */
export function bestErrorLine(text: string): string {
  const noise = /^(node:internal|\^|at\s|const err\b|Error: Command failed|Using keyring)/;
  const all = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Drop the wrapper noise first. Otherwise "Error: Command failed" satisfies the
  // diagnostic pattern below and shadows the actual cause underneath it.
  const signal = all.filter((l) => !noise.test(l));

  const diagnostic = signal.find((l) =>
    /(^|\s)error(\[|:)|authentication failed|expired or invalid|not valid json|permission denied|not found/i.test(l));

  return diagnostic ?? signal[0] ?? all[0] ?? text;
}

/** Wraps a fetcher so a failure becomes a recorded error instead of a crash. */
export async function capture<T>(fallback: T, fn: () => Promise<T>): Promise<SourceResult<T>> {
  const fetchedAt = new Date().toISOString();
  try {
    return { ok: true, fetchedAt, data: await fn() };
  } catch (err: any) {
    return { ok: false, fetchedAt, error: err?.message ?? String(err), data: fallback };
  }
}
