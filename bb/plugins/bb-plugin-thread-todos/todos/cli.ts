// Argv parsing for `bb todo …`, kept pure so the grammar is testable without
// a server. server.ts owns the effects; this only decides what was asked.
//
// The CLI exists because bb exposes plugin tools through its MCP bridge as
// deferred, namespaced entries (`mcp__bb-bridge__todo_add`). A model will not
// spend a tool-search round trip on bookkeeping mid-task, so in practice the
// tools went unused. Bash is never deferred, so this is the path that actually
// gets taken.

/** Every shape `bb todo …` accepts. */
export type TodoCommand =
  | { kind: "list" }
  | { kind: "add"; texts: string[] }
  | { kind: "status"; refs: string[]; status: "open" | "done" }
  | { kind: "help" }
  | { kind: "error"; message: string };

const USAGE = [
  "Usage:",
  "  bb todo                      Show this thread's list",
  '  bb todo add "step" ["step"]  Append one or more steps',
  '  bb todo done "step or id"    Mark items done',
  '  bb todo reopen "step or id"  Mark items open again',
  "",
  "Items are matched by id or by their own text. The list is append-only:",
  "a superseded step is completed, not deleted.",
].join("\n");

export function usage(): string {
  return USAGE;
}

/**
 * `argv` is everything after `bb todo`. An empty argv lists, which makes the
 * cheapest possible call the most useful one.
 */
export function parseCommand(argv: readonly string[]): TodoCommand {
  const [verb, ...rest] = argv;
  if (verb === undefined) return { kind: "list" };

  switch (verb) {
    case "list":
      return { kind: "list" };
    case "help":
    case "--help":
    case "-h":
      return { kind: "help" };
    case "add": {
      const texts = rest.filter((item) => item.trim() !== "");
      return texts.length === 0
        ? { kind: "error", message: 'add needs at least one step, e.g. bb todo add "Write the parser"' }
        : { kind: "add", texts };
    }
    case "done":
    case "complete": {
      const refs = rest.filter((item) => item.trim() !== "");
      return refs.length === 0
        ? { kind: "error", message: `${verb} needs at least one item id or text` }
        : { kind: "status", refs, status: "done" };
    }
    case "reopen": {
      const refs = rest.filter((item) => item.trim() !== "");
      return refs.length === 0
        ? { kind: "error", message: "reopen needs at least one item id or text" }
        : { kind: "status", refs, status: "open" };
    }
    default:
      return {
        kind: "error",
        message: `Unknown command "${verb}". Run bb todo help.`,
      };
  }
}
