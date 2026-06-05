// claude/scripts/lib/gws.ts
import { execFileSync } from 'child_process';

/** Remove the "Using keyring backend: ..." noise gws prints before its output. */
export function stripGwsNoise(raw: string): string {
  return raw.replace(/^Using keyring backend:.*\n/gm, '');
}

/** Run `gws` with the given argument vector (no shell). Returns cleaned stdout. */
export function runGws(args: string[]): string {
  const raw = execFileSync('gws', args, {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return stripGwsNoise(raw);
}

/** Run gws and JSON-parse the cleaned stdout. */
export function gwsJson(args: string[]): any {
  return JSON.parse(runGws(args));
}
