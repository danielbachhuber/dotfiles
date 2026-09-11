/**
 * Gathers one week. Every source is captured rather than awaited bare, so a
 * missing credential is reported on the page instead of failing the run.
 */
import { comingUpWindow, type Range } from "./dates.js";
import type { Sources } from "./sources.js";
import type { CalendarEvent, SourceResult, WeekData } from "./types.js";
import { capture } from "./fetch/shell.js";
import { fetchCalendar } from "./fetch/calendar.js";
import { fetchDocs } from "./fetch/docs.js";
import { fetchGithub } from "./fetch/github.js";
import { fetchHarvest } from "./fetch/harvest.js";
import { fetchTodoist } from "./fetch/todoist.js";
import { readWeek, weekDir, writeWeek } from "./store.js";

/** Where the CLIs are. Paths identify nobody, so these stay in settings. */
export interface Tools {
  gh: string;
  hrvst: string;
  td: string;
  /** The Google Workspace CLI, which is how the calendar is read. */
  gws: string;
  /** Script that prints a Google Doc as plain text, given its id. */
  fetchDocScript: string;
}

export type GatherConfig = Sources & Tools;

export interface SourceStatus {
  name: string;
  ok: boolean;
  error?: string;
  millis: number;
}

export interface GenerateResult {
  week: WeekData;
  dir: string;
  sources: SourceStatus[];
}

export async function generateWeek(
  range: Range,
  config: GatherConfig,
  weeksDir: string,
): Promise<GenerateResult> {
  const dir = weekDir(weeksDir, range.from);
  const sources: SourceStatus[] = [];

  const timed = async <T>(name: string, fn: () => Promise<SourceResult<T>>) => {
    const started = Date.now();
    const result = await fn();
    sources.push({ name, ok: result.ok, error: result.error, millis: Date.now() - started });
    return result;
  };

  // What is still ahead, from today rather than from the range: a week that
  // has already finished says nothing about next week. Gathered here so the
  // page has it without a second round trip, even though it is not part of
  // the week's own record.
  const ahead = comingUpWindow();

  // The scriptable CLIs run concurrently; docs are sequential inside their fetcher.
  const [harvest, github, todoist, calendar] = await Promise.all([
    timed("Harvest", () => capture([], () => fetchHarvest(range, config))),
    timed("GitHub", () =>
      capture(
        { authored: [], reviewed: [], issuesCreated: [], issuesAssigned: [] },
        () => fetchGithub(range, config),
      )),
    timed("Todoist", () =>
      capture({ completed: [], incomplete: [] }, () => fetchTodoist(range, config))),
    timed("Calendar", () =>
      capture<CalendarEvent[]>([], () => fetchCalendar(ahead, config))),
  ]);

  const docs =
    config.docs.length === 0
      ? skipped<[]>([], "No reference docs configured.")
      : await timed("Docs", () => capture([], () => fetchDocs(dir, config)));

  // Preserved across re-gathers: these come from the agent step, not from here.
  // Assigned only when present — an explicit `undefined` is not a JSON value,
  // and the RPC layer rejects the whole response over one.
  const existing = await readWeek(weeksDir, range.from);
  const week: WeekData = {
    from: range.from,
    to: range.to,
    generatedAt: new Date().toISOString(),
    harvest,
    github,
    todoist,
    docs,
    calendar,
    ...(existing?.slack === undefined ? {} : { slack: existing.slack }),
    ...(existing?.reflect === undefined ? {} : { reflect: existing.reflect }),
  };

  return { week, dir: await writeWeek(weeksDir, week), sources };
}

function skipped<T>(fallback: T, reason: string): SourceResult<T> {
  return { ok: false, fetchedAt: new Date().toISOString(), error: reason, data: fallback };
}
