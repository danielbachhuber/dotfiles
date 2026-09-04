/**
 * How much of an issue's own checklist is finished.
 *
 * Two things count as a checklist, and they are mutually exclusive in
 * practice: GitHub's sub-issues, which have their own summary, and a markdown
 * task list written into the body. `source` is kept so the panel can name what
 * it is counting rather than calling a body checklist "sub-issues".
 */
export interface SubtaskProgress {
  completed: number;
  total: number;
  source: "sub-issues" | "tasks";
}

/** ```fenced``` and ~~~fenced~~~ blocks, which hold examples rather than work. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * A markdown task list item: a list bullet, then a checkbox. Anchored to the
 * bullet because GitHub only renders a checkbox in that position — prose
 * containing "[x]" is not a task.
 */
const TASK_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/;

/**
 * The task list in an issue body, or null when it has none.
 *
 * Fenced code is skipped: an issue explaining how to write a checklist should
 * not read as one.
 */
export function parseTaskList(body: string | null | undefined): SubtaskProgress | null {
  if (!body) return null;

  let completed = 0;
  let total = 0;
  let fence: string | null = null;

  for (const line of body.split("\n")) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const task = TASK_ITEM.exec(line);
    if (!task) continue;
    total += 1;
    if (task[1] !== " ") completed += 1;
  }

  return total > 0 ? { completed, total, source: "tasks" } : null;
}

/**
 * Sub-issues if the issue has any, otherwise its body checklist. Sub-issues
 * win because an issue that has both is tracking the real work in the
 * sub-issues and leaving a stale checklist behind.
 */
export function resolveSubtasks(
  summary: { total?: number; completed?: number } | null | undefined,
  body: string | null | undefined,
): SubtaskProgress | null {
  const total = summary?.total ?? 0;
  if (total > 0) {
    return { completed: summary?.completed ?? 0, total, source: "sub-issues" };
  }
  return parseTaskList(body);
}
