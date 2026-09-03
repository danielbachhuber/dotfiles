// What every thread is told about its todo list.
//
// Kept tight on purpose: this rides on every turn of every thread, and a long
// block competes with the actual task for attention.
//
// It leads with the CLI, and that is the whole lesson of this file. The first
// version pointed at the native tools (`todo_add`, `todo_complete`) and was
// never used once. bb exposes plugin tools through its MCP bridge, where they
// arrive deferred and namespaced — the model sees `mcp__bb-bridge__todo_add`
// and holds no schema for it until it spends a tool-search round trip. It will
// not spend that on bookkeeping mid-task. A probe thread that wrote two files
// and ran five tests never touched the list. `bb todo` runs through Bash,
// which is a core tool that is never deferred, so the list costs nothing to
// reach. The native tools stay registered for harnesses that surface them
// directly, but they are mentioned last.
//
// The current list is embedded below, AND the agent is told to re-read it. The
// embed alone is not enough: `contributeInstructions` is re-run per turn, but
// the SDK is explicit that a live provider session keeps the instructions it
// was constructed with, so an item the user adds mid-session never reaches a
// working agent that way. The live `bb todo` read is what covers that case;
// the embed is what makes the list present from the first token.

import { orderForDisplay } from "./list.js";
import type { Todo } from "./types.js";

/**
 * The SDK truncates a contribution past 4096 characters. The static block is
 * around 1600, so this is what is left for the embedded list, with room to
 * spare — truncation would cut mid-item and leave the agent reading a
 * half-sentence as a task.
 */
const LIST_BUDGET = 1800;

const STATIC_BLOCK = [
  "## This thread's todo list",
  "",
  "This thread has a shared todo list, shown in bb's sidebar and panel. It is",
  "how the user sees what work is left here without reading the transcript.",
  "Keeping it current is part of the job, not optional bookkeeping.",
  "",
  "Use the `bb todo` CLI through your normal shell tool:",
  "",
  "```sh",
  "bb todo                                                   # read the list",
  'bb todo add "Write the parser" "Wire it into the panel"   # append steps',
  'bb todo done "Write the parser"                           # mark one done',
  'bb todo reopen "Write the parser"                         # undo a done',
  "```",
  "",
  "Items are matched by id or by their own text, so you can pass either.",
  "",
  "**Run `bb todo` at the start of each turn, before deciding what to do.**",
  "The user adds and checks off items while you work, and the copy below is",
  "only current as of when this session started. Anything open on the list is",
  "work this thread still owes, whether or not you put it there.",
  "",
  "- Before starting non-trivial work, run `bb todo add` with the steps you",
  "  plan to take — one item per step, in the order you will do them. A",
  "  one-line question or a single edit does not need a list.",
  "- Run `bb todo done` as each step actually lands, not in a batch at the end.",
  "  The list is only useful while the work is in flight.",
  "- Run `bb todo add` again whenever new work surfaces mid-task.",
  "- The list is append-only. You cannot delete or rewrite items, and you",
  "  should not try: when a step is superseded, mark it done and add what",
  "  replaced it.",
  "",
  "Equivalent tools (`todo_add`, `todo_complete`, `todo_reopen`, possibly",
  "namespaced as `mcp__bb-bridge__todo_add`) exist if your harness lists them",
  "directly. Prefer the CLI — it needs no schema loading.",
].join("\n");

/**
 * The list as the agent sees it in its instructions, capped at `LIST_BUDGET`.
 *
 * Open items come first and are never dropped in favour of completed ones:
 * what is still owed matters, and the done rows are context. When the budget
 * runs out the agent is told how many it is not seeing, so a truncated list
 * never reads as a complete one.
 */
export function renderListSection(todos: readonly Todo[]): string {
  if (todos.length === 0) {
    return [
      "### Current list",
      "",
      "Empty. If this thread involves more than one step, start by adding them.",
    ].join("\n");
  }

  const ordered = orderForDisplay(todos);
  const lines: string[] = [];
  let used = 0;
  let shown = 0;

  for (const todo of ordered) {
    const line = `${todo.status === "done" ? "[x]" : "[ ]"} ${todo.id}  ${todo.text}`;
    if (used + line.length + 1 > LIST_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }

  const open = ordered.filter((todo) => todo.status === "open").length;
  const omitted = ordered.length - shown;
  const tail =
    omitted > 0
      ? `\n\n${open} open of ${ordered.length}. ${omitted} not shown here — run \`bb todo\` for the full list.`
      : `\n\n${open} open of ${ordered.length}.`;

  return `### Current list (as of session start)\n\n${lines.join("\n")}${tail}`;
}

/**
 * Contributed via `bb.agents.contributeInstructions`, so it lands in the
 * thread instructions rather than the tool descriptions.
 */
export function threadInstructions(todos: readonly Todo[]): string {
  return `${STATIC_BLOCK}\n\n${renderListSection(todos)}`;
}

/** The invariant part, for tests and for anything that wants it without a list. */
export const INSTRUCTIONS_STATIC_BLOCK = STATIC_BLOCK;
