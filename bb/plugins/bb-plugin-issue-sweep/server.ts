import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./issues/contract.js";
import { parseStatusOrder } from "./issues/board.js";
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
import { MIGRATIONS, createStore } from "./issues/store.js";

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
      default: "Ready,In Progress,In Review,Backlog",
    },
    ghPath: {
      type: "string",
      label: "Path to the gh CLI",
      default: "gh",
    },
  });

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

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath, projectBoard } = await settings.get();
    try {
      const result = await runSweep(createGhRunner(ghPath), () => Date.now(), projectBoard);
      store.replaceAll(result);
      // Before the publish, so the panel's reload finds the options already
      // there and renders pickers on its first paint rather than its second.
      await warmBoards(result.rows);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: result.sweptAt });
      bb.log.info(`swept ${result.rows.length} open issue(s)`);
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The last good rows stay in the store, so a broken sweep degrades to a
      // stale panel with a banner rather than an empty one.
      store.recordFailure(message);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      if (error instanceof GhUnavailableError) {
        bb.status.needsConfiguration(message);
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

  bb.rpc.register(rpcContract, {
    async listRows() {
      const meta = store.readMeta();
      const { statusOrder, projectBoard } = await settings.get();
      const rows = store.readRows();
      return {
        // The panel groups by status but must not invent the order; the board's
        // columns are the user's, so their order is a setting.
        statusOrder: parseStatusOrder(statusOrder),
        // Offered options come from the board, not from statusOrder: that
        // setting is a display preference and can name a column that does not
        // exist, and the picker must only offer what `item-edit` will accept.
        statusOptions: statusOptionsFor(rows),
        boardName: projectBoard,
        rows,
        sweptAt: meta.sweptAt,
        truncated: meta.truncated,
        lastError: meta.lastError,
      };
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

        // The board is the source of truth and a status change can trip its own
        // automations, so the row is re-read rather than patched in place.
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
