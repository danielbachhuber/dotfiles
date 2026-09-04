import type { Task, TodoistData } from "../types.js";
import type { Range } from "../dates.js";
import { runJson } from "./shell.js";

interface RawTask {
  id?: string;
  content?: string;
  url?: string;
  priority?: number;
  labels?: string[];
  due?: { date?: string; string?: string; isRecurring?: boolean } | null;
}

const results = (raw: { results?: RawTask[] } | RawTask[]): RawTask[] =>
  Array.isArray(raw) ? raw : (raw.results ?? []);

export async function fetchTodoist(
  range: Range,
  config: { td: string },
): Promise<TodoistData> {
  const [completed, incomplete] = await Promise.all([
    runJson<any>(config.td, [
      "completed", "list", "--since", range.from, "--until", range.to, "--json",
    ]),
    runJson<any>(config.td, ["task", "list", "--json"]),
  ]);
  return {
    completed: results(completed).map(toTask),
    incomplete: results(incomplete).map(toTask),
  };
}

function toTask(raw: RawTask): Task {
  return {
    id: raw.id ?? "",
    content: raw.content ?? "",
    url: raw.url ?? "",
    priority: raw.priority ?? 1,
    due: raw.due?.date ?? null,
    dueString: raw.due?.string ?? null,
    recurring: Boolean(raw.due?.isRecurring),
    labels: raw.labels ?? [],
  };
}
