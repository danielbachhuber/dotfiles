// Pure list logic: normalizing incoming text, deciding what an "add" actually
// creates, resolving the loose references a model passes to complete/reopen,
// and deriving what the sidebar and header show.
//
// Same input, same output. No database, no clock, no bb API — the store passes
// the current rows in and applies whatever comes back.

import { TEXT_MAX, type Todo, type TodoCounts, type TodoStatus } from "./types.js";

/**
 * Collapse whitespace and elide. Models like to hand back items with leading
 * bullets and trailing periods from their own prose; stripping the bullet
 * keeps the panel from rendering "- - Fix the parser".
 */
export function normalizeText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const unbulleted = collapsed.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
  return unbulleted.length > TEXT_MAX
    ? `${unbulleted.slice(0, TEXT_MAX - 1).trimEnd()}…`
    : unbulleted;
}

/** Case- and punctuation-insensitive key, for deciding "we already have this". */
function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Which of the proposed texts are genuinely new for this thread.
 *
 * The list is append-only, so an agent re-stating its plan on a later turn
 * would otherwise double every item. Matching ignores items already marked
 * done: re-adding something you finished is a legitimate way to say it came
 * back, and silently swallowing it would lose work.
 */
export function newTexts(existing: readonly Todo[], proposed: readonly string[]): string[] {
  const taken = new Set(
    existing.filter((todo) => todo.status === "open").map((todo) => dedupeKey(todo.text)),
  );
  const added: string[] = [];
  for (const raw of proposed) {
    const text = normalizeText(raw);
    const key = dedupeKey(text);
    // An entry with no alphanumeric content is not a step — a stray bullet or
    // a row of dashes from a model's own formatting. Dropping it here also
    // keeps every such entry from sharing the empty dedupe key.
    if (key === "") continue;
    if (taken.has(key)) continue;
    taken.add(key);
    added.push(text);
  }
  return added;
}

/**
 * Resolve the references a model passes to `todo_complete` / `todo_reopen`.
 *
 * Ids are what the tools hand back, but models routinely echo the item's text
 * instead, so both work: exact id, then exact normalized text, then a unique
 * prefix. Ambiguous prefixes resolve to nothing rather than guessing — marking
 * the wrong step done is worse than reporting that the reference missed.
 */
export function resolveRefs(
  todos: readonly Todo[],
  refs: readonly string[],
): { matched: Todo[]; unmatched: string[] } {
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const byText = new Map<string, Todo[]>();
  for (const todo of todos) {
    const key = dedupeKey(todo.text);
    byText.set(key, [...(byText.get(key) ?? []), todo]);
  }

  const matched: Todo[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const todo = resolveOne(ref);
    if (!todo) {
      unmatched.push(ref);
      continue;
    }
    if (seen.has(todo.id)) continue;
    seen.add(todo.id);
    matched.push(todo);
  }
  return { matched, unmatched };

  function resolveOne(ref: string): Todo | null {
    const direct = byId.get(ref.trim());
    if (direct) return direct;

    const key = dedupeKey(normalizeText(ref));
    if (key === "") return null;

    const exact = byText.get(key);
    if (exact?.length === 1) return exact[0]!;
    if (exact && exact.length > 1) return null;

    const prefixed = todos.filter((todo) => dedupeKey(todo.text).startsWith(key));
    return prefixed.length === 1 ? prefixed[0]! : null;
  }
}

/** Open first, then done; each group oldest-first, so new work lands at the end. */
export function orderForDisplay(todos: readonly Todo[]): Todo[] {
  const rank = (status: TodoStatus) => (status === "open" ? 0 : 1);
  return [...todos].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.position - b.position,
  );
}

export function countsFor(threadId: string, todos: readonly Todo[]): TodoCounts {
  let open = 0;
  let done = 0;
  for (const todo of todos) {
    if (todo.status === "open") open += 1;
    else done += 1;
  }
  return { threadId, open, done };
}

/** The header button's label. Null when there is nothing worth showing. */
export function headerLabel(counts: TodoCounts): string | null {
  if (counts.open === 0 && counts.done === 0) return null;
  if (counts.open === 0) return "All done";
  return `${counts.open} left`;
}

/**
 * The sidebar row glyph, or null to clear it. A thread with nothing open goes
 * quiet on purpose: the point of the indicator is to find the threads that
 * still owe you something, so a finished thread that keeps a badge is noise.
 */
export function rowStatusFor(
  counts: TodoCounts,
): { icon: string; label: string; tone: "default" } | null {
  if (counts.open === 0) return null;
  const steps = counts.open === 1 ? "step" : "steps";
  return {
    icon: "ListTodo",
    label: `${counts.open} ${steps} remaining`,
    tone: "default",
  };
}

/** What a tool call reports back, so the model sees ids and current state. */
export function renderForAgent(todos: readonly Todo[]): string {
  const ordered = orderForDisplay(todos);
  if (ordered.length === 0) return "The to-do list is empty.";
  const lines = ordered.map(
    (todo) => `${todo.status === "done" ? "[x]" : "[ ]"} ${todo.id}  ${todo.text}`,
  );
  const open = ordered.filter((todo) => todo.status === "open").length;
  return `${lines.join("\n")}\n\n${open} open of ${ordered.length}.`;
}
