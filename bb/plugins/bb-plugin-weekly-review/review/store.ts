/**
 * Weeks on disk. One directory per Monday:
 *
 *   <weeksDir>/2026-08-31/week.json      everything the gather produced
 *   <weeksDir>/2026-08-31/docs/*.txt     cached text of the reference docs
 *   <weeksDir>/2026-08-31/overview.json  the agent's reading of the week (optional)
 *   <weeksDir>/2026-08-31/feedback.json  the agent's read of the written entry (optional)
 *   <weeksDir>/2026-08-31/reflect.json   written by the agent step (optional)
 *   <weeksDir>/2026-08-31/slack.json     written by the agent step (optional)
 *
 * Kept as files rather than rows so an agent can read a week without going
 * through this plugin, and so a bad parse costs one week rather than the store.
 * The source definitions that decide what a week contains are the opposite
 * case — personally identifying, and small — and live in the database instead.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import type { Day, SourceResult, WeekData } from "./types.js";
import { reflectNoteSchema, slackThreadSchema, sourceResult, weekDataSchema } from "./schema.js";
import {
  feedbackSchema,
  interpretationSchema,
  type Feedback,
  type Interpretation,
} from "./interpretation.js";

const MONDAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

export function weekDir(weeksDir: string, monday: Day): string {
  // Guards the path join: `monday` reaches here from an RPC argument.
  if (!MONDAY_DIR.test(monday)) throw new Error(`Not a week id: ${monday}`);
  return join(weeksDir, monday);
}

/** A gathered week, reduced to what a chooser needs to label it. */
export interface WeekSummary {
  monday: Day;
  to: Day;
  generatedAt: string;
}

/**
 * Every gathered week, newest first. Each summary costs one file read, which is
 * fine at the scale of a working life: a decade of weeks is five hundred small
 * local reads, and the listing is not on a hot path.
 */
export async function listWeeks(weeksDir: string): Promise<WeekSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(weeksDir);
  } catch {
    return [];
  }
  const mondays = entries.filter((name) => MONDAY_DIR.test(name)).sort().reverse();
  const summaries = await Promise.all(
    mondays.map(async (monday) => {
      const week = await readJson(join(weeksDir, monday, "week.json"), weekDataSchema);
      return week === null
        ? null
        : { monday, to: week.to, generatedAt: week.generatedAt };
    }),
  );
  return summaries.filter((summary): summary is WeekSummary => summary !== null);
}

export async function readWeek(weeksDir: string, monday: Day): Promise<WeekData | null> {
  const dir = weekDir(weeksDir, monday);
  const week = await readJson(join(dir, "week.json"), weekDataSchema);
  if (week === null) return null;

  // Slack and Reflect arrive as separate files from the agent step, so a
  // re-gather of the scriptable sources never has to discard them. Left absent
  // rather than set to undefined: an explicit undefined is not a JSON value,
  // and this object goes out over RPC.
  const reflect = week.reflect ?? (await readSidecar(dir, "reflect.json", reflectNoteSchema));
  const slack = week.slack ?? (await readSidecar(dir, "slack.json", slackThreadSchema));
  if (reflect === undefined) delete week.reflect;
  else week.reflect = reflect;
  if (slack === undefined) delete week.slack;
  else week.slack = slack;
  return week;
}

export async function writeWeek(weeksDir: string, week: WeekData): Promise<string> {
  const dir = weekDir(weeksDir, week.from);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "week.json"), JSON.stringify(week, null, 2), "utf8");
  return dir;
}

/**
 * Accepts either a bare array — easiest for an agent to write — or a full
 * SourceResult envelope.
 */
async function readSidecar<T extends z.ZodTypeAny>(
  dir: string,
  name: string,
  item: T,
): Promise<SourceResult<Array<z.infer<T>>> | undefined> {
  const parsed = await readJson(join(dir, name), sourceResult(item.array()).or(item.array()));
  if (parsed === null) return undefined;
  if (Array.isArray(parsed)) {
    return { ok: true, fetchedAt: new Date().toISOString(), data: parsed };
  }
  return parsed;
}

/** A malformed or missing file reads as absent rather than throwing. */
async function readJson<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
): Promise<z.infer<T> | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The agent's reading of a week, or null when it has not been asked for one. */
export async function readInterpretation(
  weeksDir: string,
  monday: Day,
): Promise<Interpretation | null> {
  return readJson(join(weekDir(weeksDir, monday), "overview.json"), interpretationSchema);
}

export async function writeInterpretation(
  weeksDir: string,
  monday: Day,
  interpretation: Interpretation,
): Promise<string> {
  const dir = weekDir(weeksDir, monday);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "overview.json");
  await writeFile(path, JSON.stringify(interpretation, null, 2), "utf8");
  return path;
}

/** The agent's read of the hand-written entry, or null when none was asked for. */
export async function readFeedback(weeksDir: string, monday: Day): Promise<Feedback | null> {
  return readJson(join(weekDir(weeksDir, monday), "feedback.json"), feedbackSchema);
}

export async function writeFeedback(
  weeksDir: string,
  monday: Day,
  feedback: Feedback,
): Promise<string> {
  const dir = weekDir(weeksDir, monday);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "feedback.json");
  await writeFile(path, JSON.stringify(feedback, null, 2), "utf8");
  return path;
}
