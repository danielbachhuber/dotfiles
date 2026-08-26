import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract.js";
import { GhUnavailableError, createGhRunner } from "../shared/gh.js";
import { runSweep } from "./sweep.js";
import { buildPrompt } from "./prompt.js";
import {
  modelForFlags,
  parseModelByAction,
  parsePermissionMode,
  threadTitle,
} from "./actions.js";
import { matchProjectForRepo, type ProjectCandidate } from "../shared/spawn-target.js";
import { createStore } from "../shared/store.js";
import type { ClassifiedRow } from "./types.js";

/** The subset of the settings accessor this domain reads. */
type PluginSettings = {
  get(): Promise<{
    ghPath: string;
    syncIntervalMinutes: string;
    modelByAction: string;
    permissionMode: string;
    providerId: string;
  }>;
};
/** better-sqlite3 handle, typed opaquely so only the store knows its shape. */
type DatabaseHandle = Parameters<typeof createStore>[0];


export { rpcContract };

const REALTIME_CHANNEL = "prs-updated";

/**
 * Everything the pull-request domain contributes: its sweep, its rpc methods,
 * and the thread links it owns. server.ts calls one of these per domain and
 * holds no domain logic itself.
 */
export function registerPullRequests(
  bb: BbPluginApi,
  settings: PluginSettings,
  db: DatabaseHandle,
) {

  /** In-flight spawns, keyed repo#number, so racing clicks share one result. */
  const spawning = new Map<
    string,
    Promise<{ threadId: string | null; existing: boolean; reason: string | null }>
  >();
  const store = createStore<ClassifiedRow>(db as never, "pr");

  /**
   * Drops links whose thread no longer exists or has been archived.
   *
   * The thread.deleted / thread.archived handlers below cover the live case,
   * but lifecycle events only fire while this plugin is loaded. A thread
   * deleted while bb was stopped, or while the plugin was disabled, would
   * otherwise stay linked forever and leave the row offering to open a thread
   * that is gone. Reconciling on every sweep makes the link self-healing
   * rather than dependent on having witnessed the event.
   */
  async function reconcileThreadLinks(): Promise<void> {
    const links = store.threadLinks();
    if (links.size === 0) return;

    const live = new Set<string>();
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const threads = await bb.sdk.threads.list({
        originPluginId: bb.pluginId,
        includeHidden: true,
        archived: false,
        limit: pageSize,
        offset,
      });
      for (const thread of threads) live.add(thread.id);
      if (threads.length < pageSize) break;
    }

    let dropped = 0;
    for (const threadId of links.values()) {
      if (!live.has(threadId)) {
        store.unlinkThread(threadId);
        dropped += 1;
      }
    }
    if (dropped > 0) bb.log.info(`released ${dropped} pull request(s) from missing threads`);
  }

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const outcome = await fetchAndStore();

    // Reconciliation runs whether or not gh succeeded. The two are unrelated:
    // a missing gh says nothing about whether a linked thread still exists,
    // and a row stuck on "Open thread" for a deleted thread should heal even
    // while the sweep itself is broken.
    try {
      await reconcileThreadLinks();
    } catch (error) {
      bb.log.warn(`could not reconcile thread links: ${String(error)}`);
    }

    return outcome;
  }

  async function fetchAndStore(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath } = await settings.get();
    try {
      const result = await runSweep(createGhRunner(ghPath), () => Date.now());
      store.replaceAll(result);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: result.sweptAt });
      bb.log.info(
        `swept ${result.repos.length} repo(s), ${result.rows.length} open PR(s)` +
          (result.failedRepos.length ? `, ${result.failedRepos.length} failed` : ""),
      );
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
   * ProjectResponse carries `gitRemoteUrl` directly, so matching a PR's
   * repository to a project needs no filesystem read.
   */
  async function projectCandidates(): Promise<ProjectCandidate[]> {
    const projects = await bb.sdk.projects.list();
    return projects.map((project) => ({
      id: project.id,
      remoteUrls: project.gitRemoteUrl ? [project.gitRemoteUrl] : [],
    }));
  }

  bb.rpc.register(rpcContract, {
    async listPullRequests() {
      const meta = store.readMeta();
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
        rows: rows.map((row) => ({
          ...row,
          canSpawn: spawnable.has(row.repo),
          threadId: links.get(`${row.repo}#${row.number}`) ?? null,
        })),
        sweptAt: meta.sweptAt,
        failedRepos: meta.failedRepos,
        truncated: meta.truncated,
        lastError: meta.lastError,
      };
    },

    async refreshPullRequests() {
      return sweepNow();
    },

    /**
     * Scoped by construction: pr_threads only holds threads this plugin
     * started, so a thread it does not know returns null and the header
     * renders nothing. What the frontend chooses to draw is not the
     * authorization decision — this lookup is.
     */
    async pullRequestForThread({ threadId }) {
      const link = store.pullRequestForThread(threadId);
      if (!link) return null;

      const row = store
        .readRows()
        .find((entry) => entry.repo === link.repo && entry.number === link.number);

      return {
        repo: link.repo,
        number: link.number,
        // The sweep may no longer carry the row (merged, closed, or beyond the
        // 100 ceiling), so fall back to the canonical URL shape rather than
        // dropping the button.
        url: row?.url ?? `https://github.com/${link.repo}/pull/${link.number}`,
        title: row?.title ?? "",
      };
    },

    async archivePullRequestThread({ repo, number }) {
      const threadId = store.threadFor(repo, number);
      if (!threadId) return { ok: false, reason: "That pull request has no thread." };

      await bb.sdk.threads.archive({ threadId });
      // The thread.archived handler unlinks too, but doing it here means the
      // row updates even if the event is lost, and makes the rpc's effect
      // complete on its own.
      store.unlinkThread(threadId);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      bb.log.info(`archived ${threadId} for ${repo}#${number}`);
      return { ok: true, reason: null };
    },

    async workOnPullRequest({ repo, number }) {
      const key = `${repo}#${number}`;

      // One thread per PR, enforced on three levels: the durable link below,
      // this in-flight map for clicks that race before the first spawn
      // returns, and a disabled button in the panel. The link alone is not
      // enough — two clicks a few hundred ms apart both read "no link yet".
      const inFlight = spawning.get(key);
      if (inFlight) return inFlight;

      const attempt = (async () => {
        const existingThreadId = store.threadFor(repo, number);
        if (existingThreadId) {
          return { threadId: existingThreadId, existing: true, reason: null };
        }

        const row = store
          .readRows()
          .find((entry) => entry.repo === repo && entry.number === number);
        if (!row) {
          return {
            threadId: null,
            existing: false,
            reason: "That pull request is no longer in the sweep.",
          };
        }

        const projectId = matchProjectForRepo(repo, await projectCandidates());
        if (!projectId) {
          return {
            threadId: null,
            existing: false,
            reason: `No bb project is checked out for ${repo}.`,
          };
        }

        const { providerId, modelByAction, permissionMode } = await settings.get();
        const mode = parsePermissionMode(permissionMode);
        const { models, error } = parseModelByAction(modelByAction);
        if (error) bb.log.warn(`"Model by action" setting: ${error}`);
        const model = modelForFlags(row.flags, models);

        const thread = await bb.sdk.threads.spawn({
          projectId,
          environment: { type: "project-default" },
          ...(providerId ? { providerId } : {}),
          ...(model ? { model } : {}),
          permissionMode: mode,
          prompt: buildPrompt(row),
          title: threadTitle(row.flags, number),
        });
        bb.log.info(
          `started ${thread.id} for ${key}` +
            ` on ${providerId || "the default provider"}` +
            (model ? ` with ${model}` : "") +
            `, permission mode ${mode}`,
        );
        store.linkThread(repo, number, thread.id, Date.now());
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
  });

  // A thread the user archived or deleted should not keep its PR pinned to it,
  // otherwise the row offers to open a thread that is gone.
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      store.unlinkThread(thread.id);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
    });
  }

  bb.background.service("pull-request-sweep", {
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
