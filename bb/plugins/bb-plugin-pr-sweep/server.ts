import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  buildOpenPrompt,
  parsePullRequestInput,
  resolvePullRequest as resolvePr,
  worktreePath,
  worktreePlan,
  type WorktreePlan,
} from "./sweep/open-pr.js";
import { parseRemoteSlug } from "./sweep/spawn-target.js";
import { isAdoptable, solePullRequestReference } from "./sweep/adopt.js";
import { createHarvestBridge } from "bb-plugin-harvest/bridge";
import { rpcContract } from "./sweep/contract.js";
import { GhUnavailableError, createGhRunner, runSweep } from "./sweep/gh.js";
import { buildPromptParts, headerItem, trailerItem } from "./sweep/prompt.js";
import {
  actionSummary,
  commentsToRead,
  isWorkFinished,
  worstFlag,
  modelForFlags,
  parseAutoArchiveActions,
  parseModelByAction,
  parsePermissionMode,
  scopedThreadTitle,
  threadTitle,
} from "./sweep/actions.js";
import {
  buildRepoFilter,
  matchProjectForRepo,
  type ProjectCandidate,
  type RepoFilter,
} from "./sweep/spawn-target.js";
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
    filterToProjects: {
      type: "select",
      label: "Only sweep repositories checked out here",
      // On: a repository is swept only when a bb project on this machine has
      // its git remote. bb's project list is per-installation, so this is the
      // difference between the computer a repository is checked out on and
      // every other one — the work computer's repositories stop filling the
      // laptop's panel. Off restores sweeping every repository you have an
      // open pull request in.
      options: ["on", "off"],
      default: "on",
    },
    extraRepositories: {
      type: "string",
      label: "Also sweep these repositories",
      // Comma or newline separated owner/name, for a repository worth watching
      // without a checkout here — a deploy repository you only ever open pull
      // requests against. Ignored when the filter is off.
      default: "",
    },
    autoArchiveActions: {
      type: "string",
      label: "Auto-archive threads for these actions",
      // Only conflicts by default. A conflict has an unambiguous finish line —
      // GitHub either reports the branch mergeable or it does not — so the
      // sweep can tell it is over without reading the thread. "Address
      // feedback" and "Fix failing CI" have no such line: CI can pass on a
      // change that missed the point, so those stay for you to close.
      default: "conflict",
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
    adoptHandStartedThreads: {
      type: "select",
      label: "Adopt threads started by hand",
      // On: a thread typed into the composer whose prompt links exactly one
      // pull request in the sweep gets this plugin's title, and its link when
      // the pull request has no thread yet.
      //
      // It renames a title someone may have chosen, which is why it can be
      // turned off. In practice the title it replaces is bb's own reading of
      // the prompt, not a typed one.
      options: ["on", "off"],
      default: "on",
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
  /** Pages threads.list, which caps a page however large a limit is asked for. */
  async function everyThread(options: { includeHidden?: boolean } = {}): Promise<
    Array<{
      id: string;
      title: string | null;
      originPluginId: string | null;
      archivedAt: number | null;
    }>
  > {
    const all: Array<{
      id: string;
      title: string | null;
      originPluginId: string | null;
      archivedAt: number | null;
    }> = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const page = await bb.sdk.threads.list({
        ...(options.includeHidden ? { includeHidden: true } : {}),
        archived: false,
        limit: pageSize,
        offset,
      });
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  /**
   * The text of a thread's first prompt, or "" when it has none.
   *
   * Read from the thread's own event log rather than its `titleFallback`,
   * which is the same text truncated to a sidebar's width — a prompt that
   * mentions the pull request after a sentence of context would have the URL
   * cut off.
   */
  async function firstPromptText(threadId: string): Promise<string> {
    const events = await bb.sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      order: "asc",
      limit: "1",
    });
    const input = (
      events[0]?.data as { input?: Array<{ type?: string; text?: string }> } | undefined
    )?.input;
    if (!Array.isArray(input)) return "";
    return input
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }

  /**
   * The title for a new thread on `row`, avoiding one a live thread already has.
   *
   * Checked against the world rather than against the link table, because the
   * link table is not the whole story: a thread whose link was dropped — by
   * the archive sweep, or by an archive later undone — is still in the
   * sidebar, still carrying its title, and still something a new thread can
   * collide with. That is exactly how #5840 came to have three unarchived
   * threads reading the same thing.
   *
   * Falls back to the canonical title if the threads cannot be listed. A
   * duplicate title is a much smaller problem than a thread that fails to
   * start.
   */
  async function titleForNewThread(
    row: { number: number; title: string; flags: readonly string[] },
    scope: string,
  ): Promise<string> {
    const canonical = threadTitle(row.number, row.title);
    try {
      const taken = new Set((await everyThread({ includeHidden: true })).map((t) => t.title));
      if (!taken.has(canonical)) return canonical;
      return scopedThreadTitle(row.number, scope);
    } catch (error) {
      bb.log.warn(`could not check existing thread titles: ${String(error)}`);
      return canonical;
    }
  }

  /**
   * Adopts threads started from the composer for a pull request this sweep
   * knows.
   *
   * Every thread's first prompt is read at most once ever, which is what makes
   * this affordable on a five-minute timer: the answer cannot change, so a
   * thread that named no pull request is remembered as scanned and never read
   * again.
   */
  async function adoptHandStartedThreads(): Promise<void> {
    const { adoptHandStartedThreads: enabled } = await settings.get();
    if (enabled !== "on") return;

    const rows = store.readRows();
    if (rows.length === 0) return;

    const scanned = store.scannedThreads();
    const linked = new Set([...store.allThreadLinks().values()].flat());
    const threads = await everyThread();
    // Every title currently in the sidebar, so a rename cannot manufacture a
    // duplicate. Mutated as titles are assigned, so two adoptions in one pass
    // cannot collide with each other either.
    const titlesInUse = new Set(threads.map((thread) => thread.title));

    for (const thread of threads) {
      if (scanned.has(thread.id) || linked.has(thread.id) || !isAdoptable(thread)) continue;

      const reference = solePullRequestReference(await firstPromptText(thread.id));
      // Marked either way. A prompt that named no pull request never will, and
      // one that named a pull request is about to be handled, so neither needs
      // re-reading.
      store.markThreadScanned(thread.id, Date.now());
      if (!reference) continue;

      const row = rows.find(
        (entry) => entry.repo.toLowerCase() === reference.repo && entry.number === reference.number,
      );
      // Not in the sweep means not an open pull request of mine. Not this
      // plugin's business.
      if (!row) continue;

      // Linked either way, because a pull request may have several threads and
      // the store now keeps them all. Renaming is the conditional part.
      //
      // No reason recorded: auto-archive fires when the flag a thread was
      // started for disappears, and this thread was not started for a flag.
      store.linkThread(row.repo, row.number, thread.id, Date.now(), null);

      const canonical = threadTitle(row.number, row.title);
      // The scope-based alternative needs a flag, and a thread started from
      // the composer has none — so when the canonical title is already in the
      // sidebar, the thread keeps its own. bb derived that title from this
      // thread's prompt, which makes it a description of this thread's scope:
      // the very thing the canonical title cannot express twice.
      if (thread.title === canonical) {
        bb.log.info(`adopted ${thread.id} for ${row.repo}#${row.number}, already titled`);
        continue;
      }
      if (titlesInUse.has(canonical)) {
        bb.log.info(
          `adopted ${thread.id} for ${row.repo}#${row.number}; kept "${thread.title}", ` +
            `since another thread is already "${canonical}"`,
        );
        continue;
      }

      await bb.sdk.threads.update({ threadId: thread.id, title: canonical });
      titlesInUse.add(canonical);
      bb.log.info(`adopted ${thread.id} for ${row.repo}#${row.number} as "${canonical}"`);
    }
  }

  async function reconcileThreadLinks(): Promise<void> {
    const links = store.threadLinks();
    if (links.size === 0) return;

    // Every thread, not just this plugin's own. A link can now point at a
    // thread someone started from the composer that the sweep adopted, and
    // filtering by originPluginId made every one of those look deleted — the
    // link would be dropped on the sweep after the one that created it, and
    // the row would go back to offering to start a thread for work underway.
    const live = new Set((await everyThread({ includeHidden: true })).map((thread) => thread.id));

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
    // Before reconciliation, so a link made here is seen as live rather than
    // being created and dropped within the same sweep.
    try {
      await adoptHandStartedThreads();
    } catch (error) {
      bb.log.warn(`could not adopt hand-started threads: ${String(error)}`);
    }

    try {
      await reconcileThreadLinks();
    } catch (error) {
      bb.log.warn(`could not reconcile thread links: ${String(error)}`);
    }

    // After reconciliation, so a link whose thread is already gone has been
    // dropped and is not archived a second time.
    try {
      await archiveFinishedThreads();
    } catch (error) {
      bb.log.warn(`could not archive finished threads: ${String(error)}`);
    }

    return outcome;
  }

  /**
   * Consecutive sweeps that could not reach gh, and how many it takes before
   * the plugin declares itself misconfigured. Three at the default interval is
   * about fifteen minutes of consistent failure.
   */
  let unavailableRuns = 0;
  const UNAVAILABLE_RUNS_BEFORE_CONFIG = 3;

  /**
   * The repository filter for one sweep, rebuilt each time so a project added
   * since the last sweep is picked up without a reload.
   *
   * A failure to resolve projects leaves the filter unscoped rather than
   * empty: an unreachable project list is not evidence that nothing is checked
   * out, and treating it as such would blank every panel over a transient
   * error.
   */
  async function repoFilter(): Promise<RepoFilter> {
    const { filterToProjects, extraRepositories } = await settings.get();
    const enabled = filterToProjects === "on";
    if (!enabled) return buildRepoFilter({ enabled: false, candidates: [], extras: "" });
    try {
      return buildRepoFilter({
        enabled: true,
        candidates: await projectCandidates(),
        extras: extraRepositories,
      });
    } catch (error) {
      bb.log.warn(`could not resolve projects, sweeping every repository: ${String(error)}`);
      return buildRepoFilter({ enabled: false, candidates: [], extras: "" });
    }
  }

  async function fetchAndStore(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath } = await settings.get();
    try {
      const scope = await repoFilter();
      const result = await runSweep(createGhRunner(ghPath), () => Date.now(), scope);
      store.replaceAll(result);
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: result.sweptAt });
      bb.log.info(
        `swept ${result.repos.length} repo(s), ${result.rows.length} open PR(s)` +
          (result.failedRepos.length ? `, ${result.failedRepos.length} failed` : "") +
          (result.skippedRepos.length
            ? `, ${result.skippedRepos.length} outside this machine's projects` +
              ` (${result.skippedRepos.join(", ")})`
            : ""),
      );
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

  /** The repository a bare "#123" should be read against: the only one swept. */
  async function defaultRepo(): Promise<string> {
    const repos = new Set(store.readRows().map((row) => row.repo));
    return repos.size === 1 ? [...repos][0]! : "";
  }

  /** The project checked out for a repository, with its local path. */
  /**
   * The checked-out project for a repository, with the host its source lives
   * on.
   *
   * The host matters: spawning into an unmanaged workspace is a request to use
   * a path on a specific machine, and bb rejects it outright without one
   * ("hostId is required unless workspace.type is personal"). The source that
   * gives us the path is the same source that names the host, so they are read
   * together and cannot drift.
   */
  async function projectForRepo(
    repo: string,
  ): Promise<{ id: string; path: string; hostId: string } | null> {
    const projects = await bb.sdk.projects.list();
    for (const project of projects) {
      if (!project.gitRemoteUrl) continue;
      if (parseRemoteSlug(project.gitRemoteUrl)?.toLowerCase() !== repo.toLowerCase()) continue;
      const sources = (project.sources ?? []).filter((entry) => entry.path && entry.hostId);
      // The default source first: a project with several checkouts means the
      // one bb itself would pick, not whichever came back first.
      const source = sources.find((entry) => entry.isDefault) ?? sources[0];
      if (source) return { id: project.id, path: source.path, hostId: source.hostId };
    }
    return null;
  }

  /**
   * Creates the worktree on the pull request's branch, or reuses one already
   * there. Argument-array spawn, never a shell string.
   */
  /**
   * A branch can only be checked out in one worktree, so `git worktree add`
   * fails while another holds it. Names that worktree, since git's own message
   * buries the path in a sentence about preparing a checkout.
   */
  function describeBranchInUse(message: string, branch: string): string | null {
    const held = /already used by worktree at '([^']+)'/.exec(message);
    if (!held) return null;
    return `${branch} is already checked out at ${held[1]}. Close or archive whatever is using it, then try again.`;
  }

  /** Runs git and reports the outcome, for the checks that expect to fail. */
  function git(
    repoPath: string,
    args: string[],
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile("git", ["-C", repoPath, ...args], (error, stdout, stderr) =>
        resolve({
          ok: !error,
          stdout: stdout ?? "",
          stderr: (stderr ?? "").trim() || (error ? error.message : ""),
        }),
      );
    });
  }

  /** The same, for the steps whose failure is the end of the attempt. */
  async function mustGit(repoPath: string, args: string[]): Promise<string> {
    const result = await git(repoPath, args);
    if (!result.ok) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
    return result.stdout;
  }

  async function remotesOf(repoPath: string): Promise<{ name: string; url: string }[]> {
    const result = await git(repoPath, ["remote", "-v"]);
    const remotes = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
      if (match) remotes.set(match[1]!, match[2]!);
    }
    return [...remotes].map(([name, url]) => ({ name, url }));
  }

  /**
   * Brings a fork's branch into a local branch of the same name.
   *
   * A fork's branch is not on origin, so fetching it by name fails with
   * "couldn't find remote ref" — the error this panel used to report for every
   * cross-repository pull request. GitHub keeps every pull request's head at
   * `refs/pull/<n>/head` on the base repository, which is reachable whatever
   * the fork does, including after the fork is deleted.
   */
  async function fetchForkBranch(
    repoPath: string,
    plan: Extract<WorktreePlan, { kind: "fork" }>,
  ): Promise<void> {
    await mustGit(repoPath, ["fetch", "origin", plan.prRef]);
    const head = (await mustGit(repoPath, ["rev-parse", "FETCH_HEAD"])).trim();

    const existing = await git(repoPath, ["rev-parse", "--verify", `refs/heads/${plan.branch}`]);
    if (!existing.ok) {
      await mustGit(repoPath, ["branch", plan.branch, head]);
      return;
    }

    const local = existing.stdout.trim();
    if (local === head) return;
    // Ahead of the pull request means an earlier thread committed here and has
    // not pushed. Overwriting that would throw the work away.
    if ((await git(repoPath, ["merge-base", "--is-ancestor", head, local])).ok) return;
    if ((await git(repoPath, ["merge-base", "--is-ancestor", local, head])).ok) {
      await mustGit(repoPath, ["branch", "--force", plan.branch, head]);
      return;
    }
    throw new Error(
      `A local branch ${plan.branch} already exists and has diverged from ${plan.repo}#${plan.number}. Rename or delete it, then try again.`,
    );
  }

  /**
   * Points the branch at the fork, so a push updates the pull request.
   *
   * This writes to the checkout's shared config rather than the worktree's,
   * which is what makes it visible in the worktree at all. It is the same
   * configuration `gh pr checkout` writes for a fork.
   */
  async function configurePush(
    repoPath: string,
    plan: Extract<WorktreePlan, { kind: "fork" }>,
  ): Promise<void> {
    if (!plan.pushTo) return;
    for (const [key, value] of [
      [`branch.${plan.branch}.remote`, plan.pushTo],
      [`branch.${plan.branch}.pushRemote`, plan.pushTo],
      [`branch.${plan.branch}.merge`, `refs/heads/${plan.branch}`],
    ] as const) {
      const result = await git(repoPath, ["config", key, value]);
      if (!result.ok) bb.log.warn(`could not set ${key}: ${result.stderr}`);
    }
  }

  async function addWorktree(repoPath: string, path: string, plan: WorktreePlan): Promise<void> {
    if (existsSync(path)) return;

    // Prune first. Threads spawned from this panel are told to nest their own
    // worktrees under the directory bb owns, and bb deletes that directory when
    // the thread is archived — but the registration in this repository outlives
    // it, and git keeps refusing the branch on behalf of a path that is no
    // longer there. Pruning is safe: it only drops registrations whose
    // directory has actually gone.
    await git(repoPath, ["worktree", "prune"]);

    if (plan.kind === "fork") await fetchForkBranch(repoPath, plan);
    else await mustGit(repoPath, ["fetch", "origin", plan.branch]);

    try {
      await mustGit(repoPath, ["worktree", "add", path, plan.branch]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const inUse = describeBranchInUse(message, plan.branch);
      throw inUse ? new Error(inUse) : error;
    }

    if (plan.kind === "fork") await configurePush(repoPath, plan);
  }

  /**
   * Closes threads whose work the sweep can see is done.
   *
   * The judgement comes from the pull request, never from the thread: a thread
   * announces success in prose, and the row is a fact recomputed from GitHub
   * on this very cycle. If the flag that justified the thread is gone, the
   * thread has nothing left to do.
   *
   * A thread still running is left alone even when the flag has cleared. It may
   * have pushed the fix and still be verifying, and archiving mid-run would
   * pull the worktree out from under it.
   */
  async function archiveFinishedThreads(): Promise<void> {
    const { autoArchiveActions } = await settings.get();
    const actions = parseAutoArchiveActions(autoArchiveActions);
    if (actions.size === 0) return;

    const links = store.threadReasons().filter((link) => link.reason && actions.has(link.reason));
    if (links.length === 0) return;

    const rows = store.readRows();
    for (const link of links) {
      const row = rows.find((entry) => entry.repo === link.repo && entry.number === link.number);
      // No row means the pull request left the sweep entirely — merged, closed,
      // or the listing failed. None of those are "the conflict was resolved",
      // so the thread stays and the user decides.
      if (!row) continue;
      if (!isWorkFinished(link.reason!, row.flags)) continue;

      const thread = await bb.sdk.threads.get({ threadId: link.threadId });
      if (thread.status !== "idle") continue;

      await bb.sdk.threads.archive({ threadId: link.threadId });
      store.unlinkThread(link.threadId);
      bb.log.info(
        `archived ${link.threadId}: ${link.repo}#${link.number} no longer reports ${link.reason}`,
      );
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: null });
    }
  }

  const harvest = createHarvestBridge(bb);

  /**
   * Harvest's contribution to the listing: whether the clock should render at
   * all, and which row it should be lit on.
   */
  async function harvestListingState() {
    if (!(await harvest.available())) return { available: false, running: null };
    return { available: true, running: await harvest.runningReference() };
  }

  bb.rpc.register(rpcContract, {
    harvestAssignments() {
      return harvest.assignments();
    },

    harvestTrackedHours({ externalId, groupId }) {
      return harvest.trackedHours({ externalId, groupId });
    },

    harvestLastSelection({ scope }) {
      return harvest.lastSelection({ scope });
    },

    harvestStartTimer(input) {
      return harvest.startTimer(input);
    },

    async harvestStopTimer(input) {
      await harvest.stopTimer(input);
      return null;
    },

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
      const links = store.allThreadLinks();

      return {
        rows: rows.map((row) => {
          const threadIds = links.get(`${row.repo}#${row.number}`) ?? [];
          return {
            ...row,
            canSpawn: spawnable.has(row.repo),
            threadId: threadIds[0] ?? null,
            threadIds,
          };
        }),
        sweptAt: meta.sweptAt,
        failedRepos: meta.failedRepos,
        skippedRepos: meta.skippedRepos,
        truncated: meta.truncated,
        lastError: meta.lastError,
        harvest: await harvestListingState(),
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
        await addWorktree(project.path, path, worktreePlan(pr, await remotesOf(project.path)));
      } catch (error) {
        // addWorktree already explains the one failure with a useful answer;
        // wrapping that in "Could not create a worktree at <path>" buries the
        // sentence that tells you what to do.
        const message = error instanceof Error ? error.message : String(error);
        const explained = message.includes("already checked out at");
        return {
          threadId: null,
          worktree: null,
          error: explained ? message : `Could not create a worktree at ${path}: ${message}`,
        };
      }

      let thread;
      try {
        thread = await bb.sdk.threads.spawn({
          projectId: project.id,
          environment: {
            type: "host",
            hostId: project.hostId,
            workspace: {
              type: "unmanaged",
              path,
              branch: { kind: "existing", name: pr.headRef },
            },
          },
          ...(providerId ? { providerId } : {}),
          permissionMode: parsePermissionMode(permissionMode),
          prompt: buildOpenPrompt(pr, instructions),
          // The same title the panel's own action produces. A thread opened
          // here does the same kind of work on the same pull request, so the
          // sidebar should not tell them apart by accident of which button
          // started them.
          title: threadTitle(pr.number, pr.title),
        });
      } catch (error) {
        // Reported rather than thrown: an unhandled rejection here reaches the
        // panel as a generic failure, and the worktree is already on disk, so
        // the one visible symptom is a button that does nothing.
        const message = error instanceof Error ? error.message : String(error);
        bb.log.warn(`could not open ${pr.repo}#${pr.number}: ${message}`);
        return {
          threadId: null,
          worktree: path,
          error: `The worktree at ${path} is ready, but the thread could not start: ${message}`,
        };
      }

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

    async workOnThisDraft({ repo, number }) {
      const existingThreadId = store.threadFor(repo, number);
      if (existingThreadId) return { existingThreadId, reason: null, seed: null };

      const row = store
        .readRows()
        .find((entry) => entry.repo === repo && entry.number === number);
      if (!row) {
        return {
          existingThreadId: null,
          reason: "That pull request is no longer in the sweep.",
          seed: null,
        };
      }

      const projectId = matchProjectForRepo(repo, await projectCandidates());
      if (!projectId) {
        return {
          existingThreadId: null,
          reason: `No bb project is checked out for ${repo}.`,
          seed: null,
        };
      }

      const { providerId, modelByAction, permissionMode } = await settings.get();
      const { models, error } = parseModelByAction(modelByAction);
      if (error) bb.log.warn(`"Model by action" setting: ${error}`);

      return {
        existingThreadId: null,
        reason: null,
        seed: {
          projectId,
          providerId: providerId || null,
          // Still per-flag: the setting picks the model the work deserves, and
          // the composer is where you disagree with it for one thread.
          model: modelForFlags(row.flags, models) || null,
          permissionMode: parsePermissionMode(permissionMode),
          prompt: buildPromptParts(row).body,
          preview: {
            title: row.title,
            number: row.number,
            url: row.url,
            meta: [row.repo, ...row.flags, row.isDraft ? "draft" : null]
              .filter(Boolean)
              .join(" · "),
          },
        },
      };
    },

    async workOnThisSubmit({ repo, number, request }) {
      const key = `${repo}#${number}`;

      // One thread per PR, enforced on three levels: the durable link below,
      // this in-flight map for submits that race before the first spawn
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

        // Everything the composer resolved — project, environment, provider,
        // model, reasoning, permission mode, execution provenance — is
        // forwarded untouched. Only the title is the plugin's business: the
        // composer has no field for one, and the sidebar should say what this
        // thread is for.
        // The composer only ever held the middle of the prompt, so the two
        // ends are put back here — including the worktree rules, which are in
        // the trailer precisely because they must not depend on anyone leaving
        // them in the box. Its own items sit between them untouched, which is
        // what keeps any @-mention or attachment that was added.
        const parts = buildPromptParts(row);
        const thread = await bb.sdk.threads.spawn({
          ...request,
          input: [
            { type: "text", text: headerItem(parts), mentions: [] },
            ...request.input,
            { type: "text", text: trailerItem(parts), mentions: [] },
          ],
          // The pull request's own words for its first thread; what this
          // thread is for once another thread already carries them.
          title: await titleForNewThread(row, actionSummary(row.flags, commentsToRead(row))),
        } as Parameters<typeof bb.sdk.threads.spawn>[0]);

        bb.log.info(`started ${thread.id} for ${key} in ${request.projectId}`);
        // The worst flag is what the button named and what the thread was sent
        // to do, so it is the one whose disappearance means "finished".
        store.linkThread(repo, number, thread.id, Date.now(), worstFlag(row.flags));
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
