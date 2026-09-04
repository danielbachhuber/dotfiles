// bb-plugin-weekly-review — gathers a week of work onto one page.
//
// The page is a starting point for a weekly journal entry, not the entry
// itself: it puts everything with a date on a spine, and everything without
// one in a standing panel, so the highlights are easy to pick out.
//
// Two kinds of state, kept apart on purpose. The source definitions — which
// repository, whose username, which 1:1 documents — identify a person, so they
// live in the plugin's database. A gathered week is a JSON blob on disk, where
// an agent can read it directly. Only the paths to the CLIs are settings.
import { dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./review/contract.js";
import { fromDay, resolveRange, toDay, type Range } from "./review/dates.js";
import { generateWeek, type GatherConfig, type Tools } from "./review/generate.js";
import {
  MIGRATIONS,
  createSourceStore,
  isScalarKey,
  missingSources,
  SCALAR_KEYS,
  type SourceStore,
} from "./review/sources.js";
import {
  listWeeks,
  readFeedback,
  readInterpretation,
  readWeek,
  weekDir,
  writeFeedback,
  writeInterpretation,
} from "./review/store.js";
import { run } from "./review/fetch/shell.js";
import { buildDigest } from "./review/digest.js";
import {
  DEFAULT_FEEDBACK_PROMPT,
  DEFAULT_NOTES_PROMPT,
  DEFAULT_PROMPT,
  feedbackSchema,
  interpretationSchema,
  renderPrompt,
} from "./review/interpretation.js";
import type { PromptKind } from "./review/contract.js";
import { reflectNoteSchema } from "./review/schema.js";
import { datedSections, matchDoc, matchNote, sectionNear, entriesWithoutNotes } from "./review/meeting-notes.js";
import { readFile, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import type { WeekData } from "./review/types.js";

export { rpcContract };

/** Published after a week is written, so every open panel refetches. */
const WEEK_GENERATED = "week-generated";
/** Published after an agent records its reading of a week. */
const WEEK_INTERPRETED = "week-interpreted";

const MS_PER_DAY = 86_400_000;

/**
 * The plugin's own directory. `bb plugin build` emits the backend to dist/, so
 * the module can sit one level below the root or at it.
 */
const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = basename(moduleDir) === "dist" ? dirname(moduleDir) : moduleDir;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    gh: { type: "string", label: "Path to the gh CLI", default: "gh" },
    hrvst: { type: "string", label: "Path to the hrvst CLI", default: "hrvst" },
    td: { type: "string", label: "Path to the td CLI", default: "td" },
    fetchDocScript: {
      type: "string",
      label: "Script that prints a Google Doc as text",
      default: join(homedir(), ".claude", "scripts", "fetch-google-doc.ts"),
    },
    interpretProviderId: {
      type: "string",
      label: "Provider for the interpretation thread",
      // The interpretation thread runs `bb weekly-review interpret` to record
      // its answer, so it needs a provider that can run a shell command.
      // Blank falls back to bb's default, which may not be one.
      default: "claude-code",
    },
    interpretProjectId: {
      type: "string",
      label: "Project the interpretation thread is filed under",
      // Blank uses the first project bb lists, which is the right answer on a
      // single-project install and a coin toss otherwise.
      default: "",
    },
    weeksDir: {
      type: "string",
      label: "Where gathered weeks are written",
      // Blank means data/weeks/ inside the plugin, which is gitignored.
      default: "",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const sources: SourceStore = createSourceStore(db as never);

  async function tools(): Promise<{ tools: Tools; weeksDir: string }> {
    const values = await settings.get();
    return {
      tools: {
        gh: values.gh.trim() || "gh",
        hrvst: values.hrvst.trim() || "hrvst",
        td: values.td.trim() || "td",
        fetchDocScript: values.fetchDocScript.trim(),
      },
      weeksDir: values.weeksDir.trim() || join(PLUGIN_ROOT, "data", "weeks"),
    };
  }

  async function gatherConfig(): Promise<{ config: GatherConfig; weeksDir: string }> {
    const { tools: paths, weeksDir } = await tools();
    return { config: { ...sources.read(), ...paths }, weeksDir };
  }

  /**
   * Surfaces an unconfigured plugin as a prompt rather than as failed fetches.
   * The status clears on the next load, so this only ever has to set it.
   */
  function reportStatus(): string[] {
    const missing = missingSources(sources.read());
    if (missing.length > 0) {
      bb.status.needsConfiguration(
        `Set ${missing.join(" and ")} with \`bb weekly-review source set\`.`,
      );
    }
    return missing;
  }
  reportStatus();

  /**
   * The range to gather for a given Monday: the whole week, stopping at today.
   * Asking for a week that has not happened yet yields a one-day range rather
   * than an empty one.
   */
  function rangeForMonday(monday: string): Range {
    const today = toDay(new Date());
    const sunday = toDay(new Date(fromDay(monday).getTime() + 6 * MS_PER_DAY));
    return { from: monday, to: sunday < today ? sunday : today };
  }

  function previousMonday(monday: string): string {
    return toDay(new Date(fromDay(monday).getTime() - 7 * MS_PER_DAY));
  }

  /** The one path that gathers a week, shared by the panel and the CLI. */
  async function runGenerate(from?: string, to?: string) {
    const { config, weeksDir } = await gatherConfig();
    const missing = missingSources(config);
    if (missing.length > 0) throw new Error(`No source configured for: ${missing.join(", ")}.`);

    const range = from === undefined
      ? resolveRange()
      : { from, to: to ?? rangeForMonday(from).to };
    const result = await generateWeek(range, config, weeksDir);

    const failed = result.sources.filter((source) => !source.ok);
    bb.log.info(
      `gathered ${range.from}..${range.to}` +
        (failed.length === 0 ? "" : ` (${failed.map((f) => f.name).join(", ")} failed)`),
    );
    bb.realtime.publish(WEEK_GENERATED, { monday: result.week.from });
    return { monday: result.week.from, sources: result.sources };
  }

  /** A meeting's notes are long; a whole 1:1 doc is longer. */
  const MEETING_NOTE_MAX = 6_000;

  /**
   * Lifts each meeting's own notes out of the reference doc that holds them.
   *
   * Runs on the server because the doc text is cached on disk, and returns
   * only the matched sections rather than the documents: sending twelve 1:1
   * docs to the panel to display four paragraphs would be most of a megabyte
   * for the sake of a page that reads better.
   */
  async function meetingNotesFor(weeksDir: string, monday: string, week: WeekData) {
    const cached = week.docs.data.filter(
      (doc): doc is typeof doc & { cachedPath: string } => doc.cachedPath !== undefined,
    );
    const daily = week.reflect?.data ?? [];
    if (cached.length === 0 && daily.length === 0) return [];

    const dir = weekDir(weeksDir, monday);
    const sections = new Map<string, ReturnType<typeof datedSections>>();
    const notes: Array<{
      day: string;
      entryNote: string;
      source: "doc" | "notes";
      label: string;
      url: string;
      heading: string;
      text: string;
    }> = [];
    const seen = new Set<string>();

    for (const entry of week.harvest.data) {
      // The day's own notes first. They were written about the meeting, where a
      // reference doc is a running document the meeting is one entry in.
      const note = matchNote(entry, daily);
      if (note !== undefined && note !== null) {
        notes.push({
          day: entry.day,
          entryNote: entry.notes,
          source: "notes",
          label: note.title,
          url: "",
          heading: "",
          text: note.body.slice(0, MEETING_NOTE_MAX),
        });
      }

      const match = matchDoc(entry.notes, cached);
      // "mentioned" is an entry that names someone, not a meeting with them.
      // Attaching a 1:1's notes to it reads as a record of a conversation that
      // never happened.
      if (match === null || match.kind !== "met") continue;

      const key = `${entry.day}\u0000${entry.notes}`;
      if (seen.has(key)) continue;

      let parsed = sections.get(match.doc.id);
      if (parsed === undefined) {
        try {
          const text = await readFile(joinPath(dir, match.doc.cachedPath), "utf8");
          parsed = datedSections(text, week.from);
        } catch {
          parsed = [];
        }
        sections.set(match.doc.id, parsed);
      }

      const section = sectionNear(parsed, entry.day);
      if (section === null) continue;
      seen.add(key);
      notes.push({
        day: entry.day,
        entryNote: entry.notes,
        source: "doc",
        label: match.doc.label,
        url: match.doc.url,
        heading: section.heading,
        text: section.body.slice(0, MEETING_NOTE_MAX),
      });
    }
    return notes;
  }

  const DEFAULT_PROMPTS: Record<PromptKind, string> = {
    interpret: DEFAULT_PROMPT,
    notes: DEFAULT_NOTES_PROMPT,
    feedback: DEFAULT_FEEDBACK_PROMPT,
  };

  /**
   * This week's entry, as written, read fresh from the document every time.
   *
   * Not cached with the week: the whole point is that the entry is written
   * after the week is gathered, so a copy taken at gather time would always be
   * the empty template. Read only — nothing in this plugin writes to the doc.
   */
  async function readEntry(week: WeekData) {
    const { journalDocId } = sources.read();
    if (journalDocId === "") return null;

    const { tools: paths } = await tools();
    let text: string;
    try {
      text = await run(paths.fetchDocScript, [journalDocId]);
    } catch (error) {
      bb.log.warn(`could not read the entry doc: ${String(error)}`);
      return null;
    }

    // The entry for a week is dated within it, usually on the day it was
    // written up rather than the Monday. The last one inside the range wins.
    const inWeek = datedSections(text, week.from).filter(
      (section) => section.day >= week.from && section.day <= week.to,
    );
    const section = inWeek[inWeek.length - 1];
    if (section === undefined || section.body.trim() === "") return null;
    return {
      heading: section.heading,
      text: section.body,
      url: `https://docs.google.com/document/d/${journalDocId}/edit`,
    };
  }

  function describePrompt(kind: PromptKind) {
    const fallback = DEFAULT_PROMPTS[kind];
    const prompt = sources.readPrompt(kind, fallback);
    return { prompt, isDefault: prompt === fallback };
  }

  /**
   * Hands a gathered week to an agent.
   *
   * The interpretation is a judgment, not a fetch, so it is a separate step
   * with its own button: everything deterministic is already on the page
   * before a single token is spent, and a week can be read again with a
   * different prompt without re-hitting four APIs.
   */
  async function interpret(monday: string): Promise<{ threadId: string }> {
    const { weeksDir } = await tools();
    const week = await readWeek(weeksDir, monday);
    if (week === null) throw new Error(`No week gathered for ${monday}. Generate it first.`);

    const values = await settings.get();
    const projectId = values.interpretProjectId.trim() || (await firstProjectId());
    if (projectId === null) {
      throw new Error("No project to file the interpretation thread under.");
    }

    return spawnAgent(
      projectId,
      values.interpretProviderId.trim(),
      renderPrompt(describePrompt("interpret").prompt, {
        DIGEST: buildDigest(week),
        COMMAND: `bb weekly-review interpret ${monday} --file <path-to-your-json>`,
      }),
      `Weekly review — ${monday}`,
      `interpreting ${monday}`,
    );
  }

  /**
   * Sends an agent for the week's daily notes.
   *
   * Separate from the interpretation, and before it: the notes are evidence,
   * not a reading, and the digest the interpreter is handed should already
   * contain them.
   */
  async function gatherNotes(monday: string): Promise<{ threadId: string }> {
    const { weeksDir } = await tools();
    const week = await readWeek(weeksDir, monday);
    if (week === null) throw new Error(`No week gathered for ${monday}. Generate it first.`);

    const values = await settings.get();
    const projectId = values.interpretProjectId.trim() || (await firstProjectId());
    if (projectId === null) throw new Error("No project to file the notes thread under.");

    return spawnAgent(
      projectId,
      values.interpretProviderId.trim(),
      renderPrompt(describePrompt("notes").prompt, {
        FROM: week.from,
        TO: week.to,
        MEETINGS_COMMAND: `bb weekly-review meetings ${monday}`,
        COMMAND: `bb weekly-review notes ${monday} --file <path-to-your-json>`,
      }),
      `Weekly review notes — ${monday}`,
      `gathering notes for ${monday}`,
    );
  }

  /**
   * Sends an agent to check the hand-written entry against the week.
   *
   * The entry stays hand-written. This reports what the evidence says the
   * entry missed; it proposes no prose and writes nothing to the document.
   */
  async function reviewEntry(monday: string): Promise<{ threadId: string }> {
    const { weeksDir } = await tools();
    const week = await readWeek(weeksDir, monday);
    if (week === null) throw new Error(`No week gathered for ${monday}. Generate it first.`);

    const entry = await readEntry(week);
    if (entry === null) {
      throw new Error(
        sources.read().journalDocId === ""
          ? "No weekly entry doc configured. Set it in this plugin's settings."
          : `Nothing written for ${week.from} through ${week.to} yet.`,
      );
    }

    const values = await settings.get();
    const projectId = values.interpretProjectId.trim() || (await firstProjectId());
    if (projectId === null) throw new Error("No project to file the feedback thread under.");

    return spawnAgent(
      projectId,
      values.interpretProviderId.trim(),
      renderPrompt(describePrompt("feedback").prompt, {
        ENTRY: `### ${entry.heading}\n\n${entry.text}`,
        DIGEST: buildDigest(week),
        COMMAND: `bb weekly-review feedback ${monday} --file <path-to-your-json>`,
      }),
      `Weekly review feedback — ${monday}`,
      `reviewing the entry for ${monday}`,
    );
  }

  /** Validates and records the agent's read of the entry. */
  async function recordFeedback(monday: string, path: string): Promise<string> {
    const { weeksDir } = await tools();
    const parsed = feedbackSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) {
      throw new Error(
        `That is not valid feedback: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
      );
    }
    const week = await readWeek(weeksDir, monday);
    const entry = week === null ? null : await readEntry(week);
    const written = await writeFeedback(weeksDir, monday, {
      ...parsed.data,
      reviewedAt: new Date().toISOString(),
      ...(entry === null ? {} : { entryHeading: entry.heading }),
    });
    bb.realtime.publish(WEEK_INTERPRETED, { monday });
    return written;
  }

  async function spawnAgent(
    projectId: string,
    providerId: string,
    prompt: string,
    title: string,
    what: string,
  ): Promise<{ threadId: string }> {
    const thread = await bb.sdk.threads.spawn({
      projectId,
      // A personal workspace, not a worktree: the thread reads a prompt and
      // runs one bb command. It has no business checking out a repository.
      environment: { type: "host", workspace: { type: "personal" } },
      ...(providerId === "" ? {} : { providerId }),
      prompt,
      title,
    });
    bb.log.info(`${what} in ${thread.id}`);
    return { threadId: thread.id };
  }

  async function firstProjectId(): Promise<string | null> {
    try {
      const projects = await bb.sdk.projects.list({});
      return projects[0]?.id ?? null;
    } catch (error) {
      bb.log.warn(`could not list projects: ${String(error)}`);
      return null;
    }
  }

  /**
   * Validates and records the week's daily notes. Written beside the week
   * rather than into week.json, so re-gathering the scriptable sources never
   * discards what an agent had to go and fetch by hand.
   */
  async function recordNotes(monday: string, path: string): Promise<number> {
    const { weeksDir } = await tools();
    const parsed = reflectNoteSchema
      .array()
      .safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) {
      throw new Error(
        `That is not a valid notes file: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
      );
    }
    await writeFile(
      joinPath(weekDir(weeksDir, monday), "reflect.json"),
      JSON.stringify(parsed.data, null, 2),
      "utf8",
    );
    bb.realtime.publish(WEEK_GENERATED, { monday });
    return parsed.data.length;
  }

  /** Validates and records an agent's reading. Shared by the CLI and nothing else. */
  async function recordInterpretation(monday: string, path: string): Promise<string> {
    const { weeksDir } = await tools();
    const parsed = interpretationSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) {
      throw new Error(
        `That is not a valid interpretation: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
      );
    }
    const written = await writeInterpretation(weeksDir, monday, {
      ...parsed.data,
      interpretedAt: new Date().toISOString(),
    });
    bb.realtime.publish(WEEK_INTERPRETED, { monday });
    return written;
  }

  bb.rpc.register(rpcContract, {
    weeks_list: async () => {
      const { weeksDir } = await tools();
      const currentWeek = resolveRange().from;
      return {
        weeks: await listWeeks(weeksDir),
        currentWeek,
        previousWeek: previousMonday(currentWeek),
        missingSources: reportStatus(),
        weeksDir,
      };
    },
    week_get: async ({ monday }) => {
      const { weeksDir } = await tools();
      const [week, interpretation, feedback] = await Promise.all([
        readWeek(weeksDir, monday),
        readInterpretation(weeksDir, monday),
        readFeedback(weeksDir, monday),
      ]);
      const [meetingNotes, entry] = await Promise.all([
        week === null ? [] : meetingNotesFor(weeksDir, monday, week),
        week === null ? null : readEntry(week),
      ]);
      return { week, interpretation, feedback, entry, meetingNotes, dir: weekDir(weeksDir, monday) };
    },
    week_interpret: ({ monday }) => interpret(monday),
    week_gather_notes: ({ monday }) => gatherNotes(monday),
    week_feedback: ({ monday }) => reviewEntry(monday),

    prompt_get: ({ kind }) => describePrompt(kind),
    prompt_set: ({ kind, prompt }) => {
      sources.writePrompt(kind, prompt.trim());
      return describePrompt(kind);
    },
    week_generate: ({ from, to }) => runGenerate(from, to),

    sources_get: () => sources.read(),
    sources_set: (input) => {
      for (const key of SCALAR_KEYS) {
        const value = input[key];
        if (value !== undefined) sources.setScalar(key, value);
      }
      if (input.docs !== undefined) {
        sources.replaceDocs(
          input.docs.map((doc) => ({
            id: doc.id,
            label: doc.label === "" ? doc.id : doc.label,
          })),
        );
      }
      return sources.read();
    },
  });

  const usage = [
    "Usage:",
    "  bb weekly-review list",
    "  bb weekly-review generate [<monday>|--from YYYY-MM-DD --to YYYY-MM-DD]",
    "  bb weekly-review path [<monday>]",
    "  bb weekly-review digest <monday>",
    "  bb weekly-review meetings <monday>",
    "  bb weekly-review notes <monday> --file <path-to-json>",
    "  bb weekly-review entry <monday>",
    "  bb weekly-review interpret <monday> --file <path-to-json>",
    "  bb weekly-review feedback <monday> --file <path-to-json>",
    "  bb weekly-review prompt [interpret|notes|feedback] [reset]",
    "  bb weekly-review source list",
    `  bb weekly-review source set <${SCALAR_KEYS.join("|")}> <value>`,
    "  bb weekly-review source add-doc <google-doc-id> <label...>",
    "  bb weekly-review source remove-doc <google-doc-id|label>",
    "",
    "Weeks are identified by their Monday. `generate` with no argument does",
    "the current week. Source definitions live in the plugin's database, not",
    "in a file.",
  ].join("\n");

  function formatSources(): string {
    const current = sources.read();
    const lines = [
      `repo              ${current.repo || "(unset)"}`,
      `author            ${current.author || "(unset)"}`,
      `harvestProjectId  ${current.harvestProjectId || "(all projects)"}`,
      `journalDocId      ${current.journalDocId || "(unset)"}`,
      current.docs.length === 0
        ? "docs              (none)"
        : `docs              ${current.docs.length}`,
    ];
    for (const doc of current.docs) lines.push(`  ${doc.id}  ${doc.label}`);
    return lines.join("\n");
  }

  async function runSourceCommand(args: string[]) {
    const [action, ...rest] = args;
    switch (action) {
      case undefined:
      case "list":
        return { exitCode: 0, stdout: formatSources() };
      case "set": {
        const [key, ...value] = rest;
        if (key === undefined || !isScalarKey(key)) {
          return {
            exitCode: 1,
            stderr: `Unknown source key ${key ?? ""}. One of: ${SCALAR_KEYS.join(", ")}.`,
          };
        }
        sources.setScalar(key, value.join(" "));
        reportStatus();
        return { exitCode: 0, stdout: formatSources() };
      }
      case "add-doc": {
        const [id, ...label] = rest;
        if (id === undefined) return { exitCode: 1, stderr: "Usage: source add-doc <id> <label>" };
        const doc = sources.addDoc(id, label.join(" "));
        return { exitCode: 0, stdout: `Added ${doc.id}  ${doc.label}` };
      }
      case "remove-doc": {
        const needle = rest.join(" ");
        if (needle === "") return { exitCode: 1, stderr: "Usage: source remove-doc <id|label>" };
        const removed = sources.removeDoc(needle);
        if (removed === null) return { exitCode: 1, stderr: `No doc matching ${needle}.` };
        return { exitCode: 0, stdout: `Removed ${removed.id}  ${removed.label}` };
      }
    }
    return { exitCode: 1, stderr: usage };
  }

  bb.cli.register({
    name: "weekly-review",
    summary: "Gather a week of work into one reviewable page",
    commands: [
      { name: "list", summary: "List gathered weeks", usage: "bb weekly-review list" },
      {
        name: "generate",
        summary: "Gather a week from its sources",
        usage: "bb weekly-review generate [<monday>]",
      },
      {
        name: "path",
        summary: "Print a week's directory, for reading or writing its files",
        usage: "bb weekly-review path [<monday>]",
      },
      {
        name: "digest",
        summary: "Print the gathered week as the text an interpreter reads",
        usage: "bb weekly-review digest <monday>",
      },
      {
        name: "meetings",
        summary: "List the week's named time entries, flagging those with no notes",
        usage: "bb weekly-review meetings <monday>",
      },
      {
        name: "notes",
        summary: "Record the week's daily notes from a JSON file",
        usage: "bb weekly-review notes <monday> --file <path-to-json>",
      },
      {
        name: "entry",
        summary: "Print the week's hand-written entry as it stands in the doc",
        usage: "bb weekly-review entry <monday>",
      },
      {
        name: "interpret",
        summary: "Record an agent's reading of a week from a JSON file",
        usage: "bb weekly-review interpret <monday> --file <path-to-json>",
      },
      {
        name: "feedback",
        summary: "Record an agent's read of the written entry from a JSON file",
        usage: "bb weekly-review feedback <monday> --file <path-to-json>",
      },
      {
        name: "prompt",
        summary: "Show or reset the prompt an agent step is given",
        usage: "bb weekly-review prompt [interpret|notes|feedback] [reset]",
      },
      {
        name: "source",
        summary: "Show or edit what a week is gathered from",
        usage: "bb weekly-review source list | set <key> <value> | add-doc <id> <label> | remove-doc <id|label>",
      },
    ],
    async run(argv) {
      const [command, ...args] = argv;
      const flag = (name: string) => {
        const at = args.indexOf(`--${name}`);
        return at === -1 ? undefined : args[at + 1];
      };
      const positional = args.filter((arg) => !arg.startsWith("--"));

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list": {
          const { weeksDir } = await tools();
          const weeks = await listWeeks(weeksDir);
          return {
            exitCode: 0,
            stdout:
              weeks.length === 0
                ? "No weeks gathered yet."
                : weeks
                    .map((week) => `${week.monday}  gathered ${week.generatedAt}`)
                    .join("\n"),
          };
        }
        case "generate": {
          const result = await runGenerate(positional[0] ?? flag("from"), flag("to"));
          const lines = result.sources.map(
            (source) =>
              `  ${source.ok ? "ok  " : "FAIL"} ${source.name.padEnd(9)}` +
              ` ${(source.millis / 1000).toFixed(1)}s${source.error ? `  ${source.error}` : ""}`,
          );
          return { exitCode: 0, stdout: [`Gathered ${result.monday}`, ...lines].join("\n") };
        }
        case "path": {
          const { weeksDir } = await tools();
          return {
            exitCode: 0,
            stdout: weekDir(weeksDir, positional[0] ?? resolveRange().from),
          };
        }
        case "digest": {
          const { weeksDir } = await tools();
          const monday = positional[0] ?? resolveRange().from;
          const week = await readWeek(weeksDir, monday);
          if (week === null) {
            return { exitCode: 1, stderr: `No week gathered for ${monday}.` };
          }
          return { exitCode: 0, stdout: buildDigest(week) };
        }
        case "interpret": {
          const monday = positional[0];
          const file = flag("file");
          if (monday === undefined || file === undefined) {
            return {
              exitCode: 1,
              stderr: "Usage: bb weekly-review interpret <monday> --file <path-to-json>",
            };
          }
          try {
            const written = await recordInterpretation(monday, file);
            return { exitCode: 0, stdout: `Recorded the reading of ${monday} at ${written}` };
          } catch (error) {
            // The agent reads this and fixes its file, so the reason has to
            // survive as the whole message.
            return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
          }
        }
        case "entry": {
          const { weeksDir } = await tools();
          const monday = positional[0] ?? resolveRange().from;
          const week = await readWeek(weeksDir, monday);
          if (week === null) {
            return { exitCode: 1, stderr: `No week gathered for ${monday}.` };
          }
          const entry = await readEntry(week);
          if (entry === null) {
            return {
              exitCode: 1,
              stderr: `Nothing written for ${week.from} through ${week.to} yet.`,
            };
          }
          return { exitCode: 0, stdout: `### ${entry.heading}\n\n${entry.text}` };
        }
        case "feedback": {
          const monday = positional[0];
          const file = flag("file");
          if (monday === undefined || file === undefined) {
            return {
              exitCode: 1,
              stderr: "Usage: bb weekly-review feedback <monday> --file <path-to-json>",
            };
          }
          try {
            const written = await recordFeedback(monday, file);
            return { exitCode: 0, stdout: `Recorded feedback on ${monday} at ${written}` };
          } catch (error) {
            return {
              exitCode: 1,
              stderr: error instanceof Error ? error.message : String(error),
            };
          }
        }
        case "prompt": {
          const kind: PromptKind = positional.includes("notes")
            ? "notes"
            : positional.includes("feedback")
              ? "feedback"
              : "interpret";
          if (positional.includes("reset")) {
            sources.writePrompt(kind, "");
            return { exitCode: 0, stdout: `Restored the default ${kind} prompt.` };
          }
          return { exitCode: 0, stdout: describePrompt(kind).prompt };
        }
        case "meetings": {
          const { weeksDir } = await tools();
          const monday = positional[0] ?? resolveRange().from;
          const week = await readWeek(weeksDir, monday);
          if (week === null) {
            return { exitCode: 1, stderr: `No week gathered for ${monday}.` };
          }
          const matched = new Set(
            (await meetingNotesFor(weeksDir, monday, week)).map(
              (note) => `${note.day}\u0000${note.entryNote}`,
            ),
          );
          const pending = entriesWithoutNotes(
            week.harvest.data,
            (entry) => matched.has(`${entry.day}\u0000${entry.notes}`),
          );
          const lines = week.harvest.data
            .filter((entry) => entry.notes.trim() !== "" && !/^#\d+/.test(entry.notes.trim()))
            .sort((a, b) => a.day.localeCompare(b.day) || b.hours - a.hours)
            .map((entry) => {
              const needs = pending.includes(entry) ? "  needs notes" : "";
              return `${entry.day}  ${entry.hours.toFixed(2)}h  ${entry.task.padEnd(12)}  ${entry.notes}${needs}`;
            });
          return {
            exitCode: 0,
            stdout: lines.length === 0 ? "No named time entries this week." : lines.join("\n"),
          };
        }
        case "notes": {
          const monday = positional[0];
          const file = flag("file");
          if (monday === undefined || file === undefined) {
            return {
              exitCode: 1,
              stderr: "Usage: bb weekly-review notes <monday> --file <path-to-json>",
            };
          }
          try {
            const count = await recordNotes(monday, file);
            return { exitCode: 0, stdout: `Recorded ${count} notes for ${monday}` };
          } catch (error) {
            return {
              exitCode: 1,
              stderr: error instanceof Error ? error.message : String(error),
            };
          }
        }
        case "source":
          return runSourceCommand(args);
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
