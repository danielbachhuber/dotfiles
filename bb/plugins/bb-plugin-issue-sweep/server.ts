import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./issues/contract.js";
import { parseStatusOrder } from "./issues/board.js";
import { GhUnavailableError, createGhRunner, runSweep } from "./issues/gh.js";
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
      default: "Ready for Dev,Needs Definition,In Progress,In Review",
    },
    ghPath: {
      type: "string",
      label: "Path to the gh CLI",
      default: "gh",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = createStore(db as never);

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath, projectBoard } = await settings.get();
    try {
      const result = await runSweep(createGhRunner(ghPath), () => Date.now(), projectBoard);
      store.replaceAll(result);
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

  bb.rpc.register(rpcContract, {
    async listRows() {
      const meta = store.readMeta();
      const { statusOrder } = await settings.get();
      return {
        // The panel groups by status but must not invent the order; the board's
        // columns are the user's, so their order is a setting.
        statusOrder: parseStatusOrder(statusOrder),
        rows: store.readRows(),
        sweptAt: meta.sweptAt,
        truncated: meta.truncated,
        lastError: meta.lastError,
      };
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
