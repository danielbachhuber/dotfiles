// What every thread is told about its to-do list.
//
// Kept short on purpose: this rides on every turn of every thread, and a long
// block competes with the actual task for attention. It says what the list is
// for, that it is append-only, and that a human is also editing it — the three
// things a model cannot infer from the tool schemas alone.

/**
 * Contributed via `bb.agents.contributeInstructions`, so it lands in the
 * thread instructions rather than the tool descriptions. Under 4096 characters
 * by a wide margin; the SDK truncates past that.
 */
export const THREAD_INSTRUCTIONS = [
  "## This thread's to-do list",
  "",
  "This thread has a shared to-do list, shown in bb's sidebar and panel. It is",
  "how the user sees what work is left here without reading the transcript.",
  "",
  "- Before starting non-trivial work, call `todo_add` with the steps you plan",
  "  to take — one item per step, in the order you will do them. A one-line",
  "  question or a single edit does not need a list.",
  "- Call `todo_complete` as each step actually lands, not in a batch at the",
  "  end. The list is only useful while the work is in flight.",
  "- Call `todo_add` again whenever new work surfaces mid-task.",
  "- The list is append-only. You cannot delete or rewrite items, and you",
  "  should not try: when a step is superseded, complete it and add what",
  "  replaced it.",
  "- The user edits this list too, and adds items you did not propose. Treat",
  "  anything open on it as work this thread still owes.",
].join("\n");
