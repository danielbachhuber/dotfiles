import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract.js";
import { GhUnavailableError, createGhRunner } from "../shared/gh.js";
import { runSweep } from "./sweep.js";
import { createStore } from "../shared/store.js";

export { rpcContract };

import type { IssueRow } from "./types.js";

/** The subset of the shared settings this domain reads. */
type PluginSettings = { get(): Promise<{ ghPath: string; syncIntervalMinutes: string }> };
type DatabaseHandle = Parameters<typeof createStore>[0];

const REALTIME_CHANNEL = "issues-updated";

/**
 * Issues assigned to Daniel. Read-only: unlike prs/ and reviews/ it starts no
 * threads, so it has no links, no spawn guard and no permission settings.
 */
export function registerIssues(
  bb: BbPluginApi,
  settings: PluginSettings,
  db: DatabaseHandle,
) {
  const store = createStore<IssueRow>(db as never, "issue");

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath } = await settings.get();
    try {
      const result = await runSweep(createGhRunner(ghPath), () => Date.now());
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
    async listIssues() {
      const meta = store.readMeta();
      return {
        rows: store.readRows(),
        sweptAt: meta.sweptAt,
        truncated: meta.truncated,
        lastError: meta.lastError,
      };
    },

    async refreshIssues() {
      return sweepNow();
    },
  });

  bb.background.service("issue-sweep", {
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
