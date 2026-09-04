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
import { listWeeks, readWeek, weekDir } from "./review/store.js";

export { rpcContract };

/** Published after a week is written, so every open panel refetches. */
const WEEK_GENERATED = "week-generated";

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
      return { week: await readWeek(weeksDir, monday), dir: weekDir(weeksDir, monday) };
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
            stdout: weeks.length === 0 ? "No weeks gathered yet." : weeks.join("\n"),
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
        case "source":
          return runSourceCommand(args);
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
