import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./review/contract.js";
import { GhUnavailableError, createGhRunner, runSweep } from "./review/gh.js";
import { buildPrompt } from "./review/prompt.js";
import {
  parsePermissionMode,
  parseStaleAfterDays,
  snoozeUntil,
  threadTitle,
} from "./review/actions.js";
import { matchProjectForRepo, type ProjectCandidate } from "./review/spawn-target.js";
import { MIGRATIONS, createStore } from "./review/store.js";

export { rpcContract };

const REALTIME_CHANNEL = "reviews-updated";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    syncIntervalMinutes: {
      type: "select",
      label: "Sync interval (minutes)",
      options: ["2", "5", "15"],
      default: "5",
    },
    ghPath: {
      type: "string",
      label: "Path to the gh CLI",
      default: "gh",
    },
    staleAfterDays: {
      type: "string",
      label: "Stale after (days)",
      // How long a request may sit before its age is emphasised. A personal
      // number rather than a universal one, which is why it is a setting.
      default: "2",
    },
    model: {
      type: "string",
      label: "Model for review threads",
      // Blank takes the provider's default. There is only one action here, so
      // this is a single value rather than pr-sweep's model-by-action JSON.
      default: "",
    },
    permissionMode: {
      type: "select",
      label: "Permission mode for spawned threads",
      // auto keeps the workspace sandbox, which blocks network egress, so the
      // thread cannot reach GitHub to read the diff it was started for. full is
      // the only mode that lets a review happen unattended. Note what this does
      // NOT do: the sandbox cannot express "may read GitHub, may not write to
      // it", so the rule against posting lives in the prompt, not here.
      options: ["accept-edits", "auto", "full"],
      default: "full",
    },
    providerId: {
      type: "string",
      label: "Provider for spawned threads",
      // `code-review` is a Claude Code command, so it is invisible to a thread
      // running on any other provider, which would improvise a review instead
      // of following it. Blank falls back to bb's default.
      default: "claude-code",
    },
  });

  /** In-flight spawns, keyed repo#number, so racing clicks share one result. */
  const spawning = new Map<
    string,
    Promise<{ threadId: string | null; existing: boolean; reason: string | null }>
  >();

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = createStore(db as never);

  /**
   * Drops links whose thread no longer exists or has been archived.
   *
   * The thread.deleted / thread.archived handlers below cover the live case, but
   * lifecycle events only fire while this plugin is loaded. A thread deleted
   * while bb was stopped would otherwise stay linked forever, leaving the row
   * offering to open a thread that is gone. Reconciling on every sweep makes the
   * link self-healing rather than dependent on having witnessed the event.
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
    if (dropped > 0) bb.log.info(`released ${dropped} review(s) from missing threads`);
  }

  /**
   * Consecutive sweeps that could not reach gh, and how many it takes before
   * the plugin declares itself misconfigured. Three at the default interval is
   * about fifteen minutes of consistent failure.
   */
  let unavailableRuns = 0;
  const UNAVAILABLE_RUNS_BEFORE_CONFIG = 3;

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const outcome = await fetchAndStore();

    // Reconciliation runs whether or not gh succeeded: a missing gh says
    // nothing about whether a linked thread still exists, and a row stuck on
    // "Open thread" for a deleted thread should heal even while the sweep
    // itself is broken.
    try {
      await reconcileThreadLinks();
    } catch (error) {
      bb.log.warn(`could not reconcile thread links: ${String(error)}`);
    }

    // Expired deadlines are already ignored on read; this is only so the table
    // does not accumulate a row per review ever deferred.
    const pruned = store.pruneSnoozes(Date.now());
    if (pruned > 0) bb.log.info(`${pruned} ignored review(s) came back`);

    return outcome;
  }

  async function fetchAndStore(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath } = await settings.get();
    try {
      const result = await runSweep(createGhRunner(ghPath), () => Date.now());
      store.replaceAll(result);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: result.sweptAt });
      bb.log.info(`swept ${result.rows.length} review request(s)`);
      // Reset here, not just on the failure path: three failures spread over a
      // day are weather, and only an unbroken run means the configuration is
      // actually wrong.
      unavailableRuns = 0;
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    async listRows() {
      const meta = store.readMeta();
      const rows = store.readRows();
      const { staleAfterDays } = await settings.get();

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
      const snoozes = store.snoozesUntil(Date.now());

      return {
        rows: rows.map((row) => ({
          ...row,
          canSpawn: spawnable.has(row.repo),
          threadId: links.get(`${row.repo}#${row.number}`) ?? null,
          snoozedUntil: snoozes.get(`${row.repo}#${row.number}`) ?? null,
        })),
        sweptAt: meta.sweptAt,
        truncated: meta.truncated,
        lastError: meta.lastError,
        staleAfterDays: parseStaleAfterDays(staleAfterDays),
      };
    },

    async refresh() {
      return sweepNow();
    },

    /**
     * Scoped by construction: review_threads only holds threads this plugin
     * started, so a thread it does not know returns null and the header renders
     * nothing. What the frontend chooses to draw is not the authorization
     * decision — this lookup is.
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
        // The sweep may no longer carry the row — once you submit the review,
        // the request leaves your queue — so fall back to the canonical URL
        // shape rather than dropping the button on exactly the threads most
        // likely to still be open.
        url: row?.url ?? `https://github.com/${link.repo}/pull/${link.number}`,
        title: row?.title ?? "",
      };
    },

    async archiveThread({ repo, number }) {
      const threadId = store.threadFor(repo, number);
      if (!threadId) return { ok: false, reason: "That review has no thread." };

      await bb.sdk.threads.archive({ threadId });
      // The thread.archived handler unlinks too, but doing it here means the row
      // updates even if the event is lost.
      store.unlinkThread(threadId);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      bb.log.info(`archived ${threadId} for ${repo}#${number}`);
      return { ok: true, reason: null };
    },

    async snooze({ repo, number }) {
      const now = Date.now();
      const until = snoozeUntil(now);
      store.snooze(repo, number, until, now);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      bb.log.info(`ignoring ${repo}#${number} until ${new Date(until).toISOString()}`);
      return { until };
    },

    async unsnooze({ repo, number }) {
      store.unsnooze(repo, number);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      bb.log.info(`no longer ignoring ${repo}#${number}`);
      return { ok: true };
    },

    async reviewThis({ repo, number }) {
      const key = `${repo}#${number}`;

      // One thread per review, enforced on three levels: the durable link
      // below, this in-flight map for clicks that race before the first spawn
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
            reason: "That review request is no longer in the sweep.",
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

        const { providerId, model, permissionMode } = await settings.get();
        const mode = parsePermissionMode(permissionMode);
        const chosenModel = model.trim();

        const thread = await bb.sdk.threads.spawn({
          projectId,
          environment: { type: "project-default" },
          ...(providerId ? { providerId } : {}),
          ...(chosenModel ? { model: chosenModel } : {}),
          permissionMode: mode,
          prompt: buildPrompt(row, Date.now()),
          title: threadTitle(row.state, number, row.title),
        });
        bb.log.info(
          `started ${thread.id} for ${key}` +
            ` on ${providerId || "the default provider"}` +
            (chosenModel ? ` with ${chosenModel}` : "") +
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

  // A thread the user archived or deleted should not keep its review pinned to
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
