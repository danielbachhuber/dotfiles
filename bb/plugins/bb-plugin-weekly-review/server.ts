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
  readInterpretation,
  readWeek,
  weekDir,
  writeInterpretation,
} from "./review/store.js";
import { buildDigest } from "./review/digest.js";
import {
  DEFAULT_PROMPT,
  interpretationSchema,
  renderPrompt,
} from "./review/interpretation.js";
import { readFile } from "node:fs/promises";

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

  function describePrompt() {
    const prompt = sources.readPrompt(DEFAULT_PROMPT);
    return { prompt, isDefault: prompt === DEFAULT_PROMPT };
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

    const providerId = values.interpretProviderId.trim();
    const prompt = renderPrompt(
      sources.readPrompt(DEFAULT_PROMPT),
      buildDigest(week),
      `bb weekly-review interpret ${monday} --file <path-to-your-json>`,
    );

    const thread = await bb.sdk.threads.spawn({
      projectId,
      // A personal workspace, not a worktree: the thread reads a prompt and
      // runs one bb command. It has no business checking out a repository.
      environment: { type: "host", workspace: { type: "personal" } },
      ...(providerId === "" ? {} : { providerId }),
      prompt,
      title: `Weekly review — ${monday}`,
    });
    bb.log.info(`interpreting ${monday} in ${thread.id}`);
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
      const [week, interpretation] = await Promise.all([
        readWeek(weeksDir, monday),
        readInterpretation(weeksDir, monday),
      ]);
      return { week, interpretation, dir: weekDir(weeksDir, monday) };
    },
    week_interpret: ({ monday }) => interpret(monday),

    prompt_get: () => describePrompt(),
    prompt_set: ({ prompt }) => {
      sources.writePrompt(prompt.trim());
      return describePrompt();
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
    "  bb weekly-review interpret <monday> --file <path-to-json>",
    "  bb weekly-review prompt [show|reset]",
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
        name: "interpret",
        summary: "Record an agent's reading of a week from a JSON file",
        usage: "bb weekly-review interpret <monday> --file <path-to-json>",
      },
      {
        name: "prompt",
        summary: "Show or reset the prompt the interpretation thread is given",
        usage: "bb weekly-review prompt [show|reset]",
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
        case "prompt": {
          if (positional[0] === "reset") {
            sources.writePrompt("");
            return { exitCode: 0, stdout: "Restored the default prompt." };
          }
          const { prompt, isDefault } = describePrompt();
          return { exitCode: 0, stdout: isDefault ? prompt : prompt };
        }
        case "source":
          return runSourceCommand(args);
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
