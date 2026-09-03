import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./issues/contract.js";
import { parseStatusOrder, shouldAutoApply } from "./issues/board.js";
import { GhUnavailableError, createGhRunner, runSweep } from "./issues/gh.js";
import {
  BoardUnavailableError,
  fetchBoardProject,
  ownerOf,
  // Aliased: the RPC handler below has the same name, and a bare call inside
  // it would read as recursion.
  setBoardStatus as applyBoardStatus,
  type BoardProject,
} from "./issues/project.js";
import { buildPrompt, threadTitle } from "./issues/prompt.js";
import { matchProjectForRepo, type ProjectCandidate } from "./issues/spawn-target.js";
import { MIGRATIONS, createStore } from "./issues/store.js";
import type { IssueRow } from "./issues/types.js";

export { rpcContract };

const REALTIME_CHANNEL = "issues-updated";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    syncIntervalMinutes: {
      type: "select",
      label: "Sync interval (minutes)",
      options: ["2", "5", "15"],
      default: "5",
    },
    projectBoard: {
      type: "string",
      label: "Project board",
      // The board's name, not its id, and a setting rather than a constant:
      // it identifies a private org project and this repository is public.
      // An issue commonly sits on several boards at once — a team one and
      // someone's personal project — so the status is read from this one and
      // the rest ignored. Blank takes the first status found anywhere.
      default: "",
    },
    statusOrder: {
      type: "string",
      label: "Status order",
      // The order the board's columns are listed in. A status the board
      // reports that is not named here still gets a section, after these, so a
      // new column shows up rather than vanishing.
      // In Review last of the four: the work is out of your hands there, so
      // it sits below the Backlog you could actually pick something up from.
      default: "Ready,In Progress,Backlog,In Review",
    },
    ghPath: {
      type: "string",
      label: "Path to the gh CLI",
      default: "gh",
    },
    model: {
      type: "string",
      label: "Model for issue threads",
      // Blank takes the provider's default. One action here, so one value
      // rather than pr-sweep's model-by-action JSON.
      default: "",
    },
    permissionMode: {
      type: "select",
      label: "Permission mode for spawned threads",
      // auto keeps the workspace sandbox, which blocks network egress, so the
      // thread could not reach GitHub to read the issue it was started for.
      options: ["accept-edits", "auto", "full"],
      default: "full",
    },
    providerId: {
      type: "string",
      label: "Provider for spawned threads",
      // Blank falls back to bb's default.
      default: "claude-code",
    },
    countedStatuses: {
      type: "string",
      label: "Statuses counted in the sidebar",
      // The badge answers "how much is on me right now", which is a smaller
      // question than "how much is assigned to me". Blank counts everything.
      default: "In Progress,Ready",
    },
    statusOnStart: {
      type: "string",
      label: "Board status when a thread starts",
      // Blank turns the move off. A name rather than a fixed constant because
      // a board is free to call this column whatever it likes.
      default: "In Progress",
    },
    statusOnPullRequest: {
      type: "string",
      label: "Board status when a closing pull request opens",
      default: "In Review",
    },
  });

  const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;
  type PermissionMode = (typeof PERMISSION_MODES)[number];

  /**
   * Narrows the stored setting, typed only as `string` by the SDK, to the
   * union `threads.spawn` accepts. An unrecognised value falls back to the
   * declared default rather than reaching the spawn call.
   */
  function parsePermissionMode(raw: string | undefined): PermissionMode {
    return (PERMISSION_MODES as readonly string[]).includes(raw ?? "")
      ? (raw as PermissionMode)
      : "full";
  }

  /**
   * One thread per issue, enforced on three levels: the durable link in the
   * store, this in-flight map for clicks that race before the first spawn
   * returns, and a disabled button in the panel. The link alone is not enough —
   * two clicks a few hundred ms apart both read "no link yet".
   */
  const spawning = new Map<string, Promise<{ threadId: string | null; existing: boolean; reason: string | null }>>();

  async function projectCandidates(): Promise<ProjectCandidate[]> {
    const projects = await bb.sdk.projects.list();
    return projects.map((project) => ({
      id: project.id,
      remoteUrls: project.gitRemoteUrl ? [project.gitRemoteUrl] : [],
    }));
  }

  /**
   * One board per owner, resolved on first use and kept for the process.
   *
   * A board's id and its Status options change far less often than its
   * contents, and resolving them costs two `gh project` calls. Keyed by owner
   * because the board belongs to the org that owns the repository, and the
   * board name is the same setting for all of them.
   */
  const boards = new Map<string, BoardProject>();

  async function boardFor(owner: string): Promise<BoardProject> {
    const cached = boards.get(owner);
    if (cached) return cached;
    const { ghPath, projectBoard } = await settings.get();
    const project = await fetchBoardProject(createGhRunner(ghPath), owner, projectBoard);
    boards.set(owner, project);
    return project;
  }

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = createStore(db as never);

  /**
   * Consecutive sweeps that could not reach gh, and how many it takes before
   * the plugin declares itself misconfigured. Three at the default interval is
   * about fifteen minutes of consistent failure.
   */
  let unavailableRuns = 0;
  const UNAVAILABLE_RUNS_BEFORE_CONFIG = 3;

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath, projectBoard } = await settings.get();
    try {
      const result = await runSweep(createGhRunner(ghPath), () => Date.now(), projectBoard);
      store.replaceAll(result);
      // Before the publish, so the panel's reload finds the options already
      // there and renders pickers on its first paint rather than its second.
      await warmBoards(result.rows);
      // Also before the publish. The rows it works from are the ones just
      // stored, so a promotion patches the stored row too and the moved cards
      // show their new status on this sweep rather than the next one.
      await promoteIssuesInReview(result.rows);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: result.sweptAt });
      bb.log.info(`swept ${result.rows.length} open issue(s)`);
      // Reset here, not just on the failure path: three failures spread over a
      // day are weather, and only an unbroken run means the configuration is
      // actually wrong.
      unavailableRuns = 0;
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The last good rows stay in the store, so a broken sweep degrades to a
      // stale panel with a banner rather than an empty one.
      store.recordFailure(message);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      if (error instanceof GhUnavailableError) {
        // Always logged. This is the branch that can hide the plugin's panels,
        // so it must never be the silent one — the first time it fired, the
        // only evidence was the panels being gone.
        unavailableRuns += 1;
        bb.log.warn(
          `gh unavailable (${unavailableRuns} in a row): ${message} — ${error.detail}`,
        );
        // needs-configuration is one-way: the SDK clears it on the next load
        // and offers no way back at runtime, so one blip would hide the panels
        // until someone thought to reload. Only a run of failures is a
        // configuration problem; one is weather.
        if (unavailableRuns >= UNAVAILABLE_RUNS_BEFORE_CONFIG) {
          bb.status.needsConfiguration(message);
        }
      } else {
        bb.log.warn(`sweep failed: ${message}`);
      }
      return { ok: false, error: message };
    }
  }

  /**
   * Resolves the board for every owner in the listing, ignoring failures.
   *
   * Called from the sweep rather than from `listRows` so the panel never waits
   * on it. Resolving costs two `gh project` calls, and doing that inline made
   * the first paint after a reload block for five seconds.
   */
  async function warmBoards(rows: readonly { repo: string }[]): Promise<void> {
    for (const owner of new Set(rows.map((row) => ownerOf(row.repo)))) {
      if (owner === "" || boards.has(owner)) continue;
      try {
        await boardFor(owner);
      } catch (error) {
        // A missing or misnamed board is a configuration matter, not a sweep
        // failure: the listing is still correct, it just has no picker.
        if (error instanceof BoardUnavailableError) continue;
        bb.log.warn(`could not read the board for ${owner}: ${String(error)}`);
      }
    }
  }

  /**
   * The board's Status options, for whichever owner the listing covers.
   *
   * Every repository in the listing is normally one org's, so the first owner
   * already resolved wins. Reads the cache only — an unwarmed cache yields no
   * options, which degrades to statuses as text with no picker.
   */
  function statusOptionsFor(rows: readonly { repo: string }[]): string[] {
    for (const owner of new Set(rows.map((row) => ownerOf(row.repo)))) {
      const project = boards.get(owner);
      if (project) return project.statusOptions.map((option) => option.name);
    }
    return [];
  }

  /**
   * Moves an issue's card on the board, on this plugin's own initiative rather
   * than because someone picked a status.
   *
   * Applied at most once per target, which is what `board_auto` records. The
   * sweep runs every few minutes and a pull request stays open for days, so
   * without that a card dragged back by hand would be dragged forward again
   * before you finished reading the row.
   *
   * Everything here fails quietly. These moves are a convenience on top of the
   * listing; a board that cannot be reached, or has no column by this name,
   * must not turn into an error banner over a listing that is perfectly good.
   */
  async function autoSetStatus(
    row: { repo: string; number: number; url: string; boardStatus: string | null },
    target: string,
  ): Promise<boolean> {
    const wanted = target.trim();
    const applied = store.autoAppliedStatus(row.repo, row.number);
    if (!shouldAutoApply(row.boardStatus, applied, wanted)) return false;

    try {
      const { ghPath } = await settings.get();
      const project = await boardFor(ownerOf(row.repo));
      const option = project.statusOptions.find(
        (candidate) => candidate.name.toLowerCase() === wanted.toLowerCase(),
      );
      if (!option) {
        bb.log.warn(`${project.title} has no "${wanted}" status; leaving ${row.repo}#${row.number}`);
        return false;
      }

      await applyBoardStatus(createGhRunner(ghPath), {
        project,
        repo: row.repo,
        number: row.number,
        url: row.url,
        option,
      });
      store.recordAutoStatus(row.repo, row.number, option.name, Date.now());
      // The board has the move; the stored row does not until the next sweep.
      // Patching it here is what lets a card show its new status on the paint
      // that follows the click, rather than up to five minutes later.
      store.setRowStatus(row.repo, row.number, option.name);
      bb.log.info(`moved ${row.repo}#${row.number} to ${option.name}`);
      return true;
    } catch (error) {
      if (error instanceof BoardUnavailableError) return false;
      bb.log.warn(`could not move ${row.repo}#${row.number} to ${wanted}: ${String(error)}`);
      return false;
    }
  }

  /**
   * Promotes every issue whose closing pull request is open.
   *
   * Driven from the sweep rather than from an event because nothing tells this
   * plugin that a pull request was opened — the "Fixes #n" link is a fact about
   * the issue, discovered by asking.
   */
  async function promoteIssuesInReview(rows: readonly IssueRow[]): Promise<boolean> {
    const { statusOnPullRequest } = await settings.get();
    if (statusOnPullRequest.trim() === "") return false;

    let moved = false;
    for (const row of rows) {
      if (row.closingPr === null) continue;
      if (await autoSetStatus(row, statusOnPullRequest)) moved = true;
    }
    return moved;
  }

  bb.rpc.register(rpcContract, {
    async listRows() {
      const meta = store.readMeta();
      const { statusOrder, projectBoard, countedStatuses } = await settings.get();
      const rows = store.readRows();

      let candidates: ProjectCandidate[] = [];
      try {
        candidates = await projectCandidates();
      } catch (error) {
        bb.log.warn(`could not resolve projects: ${String(error)}`);
      }
      const spawnable = new Set(
        rows.map((row) => row.repo).filter((repo) => matchProjectForRepo(repo, candidates)),
      );
      const links = store.threadLinks();

      return {
        // The panel groups by status but must not invent the order; the board's
        // columns are the user's, so their order is a setting.
        statusOrder: parseStatusOrder(statusOrder),
        // Offered options come from the board, not from statusOrder: that
        // setting is a display preference and can name a column that does not
        // exist, and the picker must only offer what `item-edit` will accept.
        statusOptions: statusOptionsFor(rows),
        countedStatuses: parseStatusOrder(countedStatuses),
        boardName: projectBoard,
        rows: rows.map((row) => ({
          ...row,
          canSpawn: spawnable.has(row.repo),
          threadId: links.get(`${row.repo}#${row.number}`) ?? null,
        })),
        sweptAt: meta.sweptAt,
        truncated: meta.truncated,
        lastError: meta.lastError,
      };
    },

    async startThread({ repo, number }) {
      const key = `${repo}#${number}`;

      const inFlight = spawning.get(key);
      if (inFlight) return inFlight;

      const attempt = (async () => {
        const existingThreadId = store.threadFor(repo, number);
        if (existingThreadId) {
          return { threadId: existingThreadId, existing: true, reason: null };
        }

        const row = store.readRows().find((entry) => entry.repo === repo && entry.number === number);
        if (!row) {
          return { threadId: null, existing: false, reason: `#${number} is no longer in the sweep.` };
        }

        const projectId = matchProjectForRepo(repo, await projectCandidates());
        if (!projectId) {
          return { threadId: null, existing: false, reason: `No bb project is checked out for ${repo}.` };
        }

        const { providerId, model, permissionMode } = await settings.get();
        const mode = parsePermissionMode(permissionMode);
        const chosenModel = model.trim();

        const thread = await bb.sdk.threads.spawn({
          projectId,
          // The project's own default rather than a worktree forced from here:
          // an issue has no branch to land on, so there is nothing this plugin
          // knows about the workspace that the project's setting does not.
          environment: { type: "project-default" },
          ...(providerId ? { providerId } : {}),
          ...(chosenModel ? { model: chosenModel } : {}),
          permissionMode: mode,
          prompt: buildPrompt(row),
          title: threadTitle(row.title),
        });

        bb.log.info(
          `started ${thread.id} for ${key}` +
            ` on ${providerId || "the default provider"}` +
            (chosenModel ? ` with ${chosenModel}` : "") +
            `, permission mode ${mode}`,
        );
        store.linkThread(repo, number, thread.id, Date.now());

        // Starting work is the one moment the plugin knows more than the board
        // does, so it says so. After the spawn deliberately: a board that
        // cannot be reached must not stop a thread from being created.
        const { statusOnStart } = await settings.get();
        await autoSetStatus(row, statusOnStart);

        bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
        return { threadId: thread.id, existing: false, reason: null };
      })();

      spawning.set(key, attempt);
      try {
        return await attempt;
      } finally {
        spawning.delete(key);
      }
    },

    async setBoardStatus({ repo, number, status }) {
      const row = store.readRows().find((entry) => entry.repo === repo && entry.number === number);
      if (!row) return { ok: false, added: false, error: `#${number} is not in this listing.` };

      try {
        const { ghPath } = await settings.get();
        const project = await boardFor(ownerOf(repo));
        const option = project.statusOptions.find(
          (candidate) => candidate.name.toLowerCase() === status.trim().toLowerCase(),
        );
        if (!option) {
          return { ok: false, added: false, error: `${project.title} has no "${status}" status.` };
        }

        const { added } = await applyBoardStatus(createGhRunner(ghPath), {
          project,
          repo,
          number,
          url: row.url,
          option,
        });

        // Shown first, reconciled second. The board is the source of truth and
        // a status change can trip its own automations, so the sweep still
        // runs and still wins — but it is a full gh round trip, and making the
        // panel sit on the old status for its duration reads as a failed
        // click.
        if (store.setRowStatus(repo, number, option.name)) {
          bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
        }
        await sweepNow();
        bb.log.info(`${repo}#${number} -> ${option.name}${added ? " (added)" : ""}`);
        return { ok: true, added, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bb.log.warn(`could not set ${repo}#${number} to ${status}: ${message}`);
        return { ok: false, added: false, error: message };
      }
    },

    async refresh() {
      return sweepNow();
    },
  });

  // A thread the user archived or deleted should not keep its issue pinned to
  // it, otherwise the row offers to open a thread that is gone.
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      store.unlinkThread(thread.id);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
    });
  }

  bb.background.service("sweep", {
    async start(signal) {
      while (!signal.aborted) {
        await sweepNow();
        if (signal.aborted) return;

        const { syncIntervalMinutes } = await settings.get();
        const delay = Number(syncIntervalMinutes) * 60_000;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });
}
