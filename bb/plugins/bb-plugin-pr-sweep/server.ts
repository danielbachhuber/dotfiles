import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  buildOpenPrompt,
  parsePullRequestInput,
  resolvePullRequest as resolvePr,
  worktreePath,
} from "./sweep/open-pr.js";
import { parseRemoteSlug } from "./sweep/spawn-target.js";
import { rpcContract } from "./sweep/contract.js";
import { GhUnavailableError, createGhRunner, runSweep } from "./sweep/gh.js";
import { buildPrompt } from "./sweep/prompt.js";
import {
  modelForFlags,
  parseModelByAction,
  parsePermissionMode,
  threadTitle,
} from "./sweep/actions.js";
import { matchProjectForRepo, type ProjectCandidate } from "./sweep/spawn-target.js";
import { MIGRATIONS, createStore } from "./sweep/store.js";

export { rpcContract };

const REALTIME_CHANNEL = "prs-updated";

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
    modelByAction: {
      type: "string",
      label: "Model by action",
      experimental_multiline: true,
      // A JSON object keyed by flag: {"conflict": "claude-sonnet-5"}.
      // An unlisted flag takes the provider's default model. Blank restores
      // the defaults.
      default: '{\n  "conflict": "claude-sonnet-5"\n}',
    },
    permissionMode: {
      type: "select",
      label: "Permission mode for spawned threads",
      // accept-edits sandboxes the workspace and routes every escalation to
      // the user, so a thread stops at its first shell command. auto keeps
      // that same sandbox with automatic approval, which is enough to do the
      // work but not to finish it: the sandbox blocks network egress, so the
      // commit lands and the push fails with a proxy authentication error.
      // full bypasses the sandbox and the approval, and is the only mode that
      // carries a resolution through to the PR unattended.
      options: ["accept-edits", "auto", "full"],
      default: "full",
    },
    providerId: {
      type: "string",
      label: "Provider for spawned threads",
      // The skills these prompts route to (resolve-merge-conflicts,
      // address-code-review, pr-sweep) are Claude Code user skills, so they
      // are invisible to a thread running on any other provider. Spawning on
      // bb's default provider produced threads that reported the skill "was
      // not installed" and improvised the workflow instead. Blank falls back
      // to bb's default.
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

  /** The repository a bare "#123" should be read against: the only one swept. */
  async function defaultRepo(): Promise<string> {
    const repos = new Set(store.readRows().map((row) => row.repo));
    return repos.size === 1 ? [...repos][0]! : "";
  }

  /** The project checked out for a repository, with its local path. */
  async function projectForRepo(repo: string): Promise<{ id: string; path: string } | null> {
    const projects = await bb.sdk.projects.list();
    for (const project of projects) {
      if (!project.gitRemoteUrl) continue;
      if (parseRemoteSlug(project.gitRemoteUrl)?.toLowerCase() !== repo.toLowerCase()) continue;
      const source = (project.sources ?? []).find((entry) => entry.path);
      if (source?.path) return { id: project.id, path: source.path };
    }
    return null;
  }

  /**
   * Creates the worktree on the pull request's branch, or reuses one already
   * there. Argument-array spawn, never a shell string.
   */
  async function addWorktree(repoPath: string, path: string, branch: string): Promise<void> {
    const git = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        execFile("git", ["-C", repoPath, ...args], (error) =>
          error ? reject(error) : resolve(),
        );
      });

    if (existsSync(path)) return;
    await git(["fetch", "origin", branch]);
    await git(["worktree", "add", path, branch]);
  }

  bb.rpc.register(rpcContract, {
    async listRows() {
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

    async refresh() {
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

    /**
     * Resolves what the user typed, so the form can confirm the title and
     * branch before anything is created. A typo fails here rather than in a
     * spawned thread.
     */
    async resolvePullRequest({ input }) {
      const { ghPath } = await settings.get();
      const parsed = parsePullRequestInput(input, await defaultRepo());
      if ("error" in parsed) return { pr: null, error: parsed.error };

      try {
        const pr = await resolvePr(createGhRunner(ghPath), parsed.repo, parsed.number);
        return { pr, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof GhUnavailableError) bb.status.needsConfiguration(message);
        return { pr: null, error: `Could not read ${parsed.repo}#${parsed.number}.` };
      }
    },

    /**
     * Creates a worktree on the pull request's own branch and attaches a
     * thread to it as an unmanaged environment.
     *
     * bb's managed worktree always cuts a fresh `bb/<thread>` branch off the
     * base, so a thread on one is not on the pull request and a push does not
     * update it. Attaching to a worktree we made ourselves puts the thread on
     * the branch — and bb then reports the pull request, its checks and its
     * review state on the thread, which it cannot do for a branch that has no
     * pull request.
     *
     * The cost is bb's rule, not ours: it does not delete an unmanaged
     * worktree when the thread is archived. It stays until removed by hand.
     */
    async openPullRequest({ input, instructions }) {
      const { ghPath, providerId, permissionMode } = await settings.get();
      const parsed = parsePullRequestInput(input, await defaultRepo());
      if ("error" in parsed) return { threadId: null, worktree: null, error: parsed.error };

      let pr;
      try {
        pr = await resolvePr(createGhRunner(ghPath), parsed.repo, parsed.number);
      } catch {
        return {
          threadId: null,
          worktree: null,
          error: `Could not read ${parsed.repo}#${parsed.number}.`,
        };
      }

      const project = await projectForRepo(pr.repo);
      if (!project) {
        return {
          threadId: null,
          worktree: null,
          error: `No bb project is checked out for ${pr.repo}.`,
        };
      }

      const path = worktreePath(project.path, pr.number);
      try {
        await addWorktree(project.path, path, pr.headRef);
      } catch (error) {
        return {
          threadId: null,
          worktree: null,
          error: `Could not create a worktree at ${path}: ${String(error)}`,
        };
      }

      const thread = await bb.sdk.threads.spawn({
        projectId: project.id,
        environment: {
          type: "host",
          workspace: {
            type: "unmanaged",
            path,
            branch: { kind: "existing", name: pr.headRef },
          },
        },
        ...(providerId ? { providerId } : {}),
        permissionMode: parsePermissionMode(permissionMode),
        prompt: buildOpenPrompt(pr, instructions),
        title: `PR #${pr.number}`,
      });

      store.linkThread(pr.repo, pr.number, thread.id, Date.now());
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
      bb.log.info(`opened ${pr.repo}#${pr.number} at ${path} as ${thread.id}`);
      return { threadId: thread.id, worktree: path, error: null };
    },

    async archiveThread({ repo, number }) {
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

    async workOnThis({ repo, number }) {
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
