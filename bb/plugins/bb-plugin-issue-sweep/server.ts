import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createHarvestBridge } from "bb-plugin-harvest/bridge";
import { isAdoptable, soleIssueReference } from "./issues/adopt.js";
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
import {
  buildPromptParts,
  headerItem,
  trailerItem,
  threadTitle,
} from "./issues/prompt.js";
import {
  buildRepoFilter,
  matchProjectTargetForRepo,
  matchProjectForRepo,
  type ProjectCandidate,
  type RepoFilter,
} from "./issues/spawn-target.js";
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
    filterToProjects: {
      type: "select",
      label: "Only sweep repositories checked out here",
      // On: a repository is swept only when a bb project on this machine has
      // its git remote. bb's project list is per-installation, so this is the
      // difference between the computer a repository is checked out on and
      // every other one. Off sweeps every repository with an issue assigned to
      // you.
      options: ["on", "off"],
      default: "on",
    },
    extraRepositories: {
      type: "string",
      label: "Also sweep these repositories",
      // Comma or newline separated owner/name, for a repository worth
      // watching without a checkout here. Ignored when the filter is off.
      default: "",
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
    adoptHandStartedThreads: {
      type: "select",
      label: "Adopt threads started by hand",
      // On: a thread typed into the composer whose prompt links exactly one
      // issue in the sweep gets this plugin's title, the issue's link, and the
      // board move a thread started from the panel would have made.
      //
      // It renames a title someone may have chosen, which is why it can be
      // turned off. In practice the title it replaces is bb's own reading of
      // the prompt ("Work on issue 5837"), not a typed one.
      options: ["on", "off"],
      default: "on",
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
    return projects.map((project) => {
      // The default checkout's host, or the first with one. Needed because a
      // seeded worktree environment is rejected without it — see
      // ProjectCandidate.hostId.
      const sources = (project.sources ?? []).filter((entry) => entry.hostId);
      const source = sources.find((entry) => entry.isDefault) ?? sources[0];
      return {
        id: project.id,
        remoteUrls: project.gitRemoteUrl ? [project.gitRemoteUrl] : [],
        ...(source ? { hostId: source.hostId } : {}),
      };
    });
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

  /**
   * The repository filter for one sweep, rebuilt each time so a project added
   * since the last sweep is picked up without a reload.
   *
   * A failure to resolve projects leaves the filter unscoped rather than
   * empty: an unreachable project list is not evidence that nothing is checked
   * out here, and treating it as such would blank the panel over a blip.
   */
  async function repoFilter(): Promise<RepoFilter> {
    const { filterToProjects, extraRepositories } = await settings.get();
    if (filterToProjects !== "on") {
      return buildRepoFilter({ enabled: false, candidates: [], extras: "" });
    }
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

  async function sweepNow(): Promise<{ ok: boolean; error: string | null }> {
    const { ghPath, projectBoard } = await settings.get();
    try {
      const result = await runSweep(
        createGhRunner(ghPath),
        () => Date.now(),
        projectBoard,
        await repoFilter(),
      );
      store.replaceAll(result);
      // Before the publish, so the panel's reload finds the options already
      // there and renders pickers on its first paint rather than its second.
      await warmBoards(result.rows);
      // Also before the publish. The rows it works from are the ones just
      // stored, so a promotion patches the stored row too and the moved cards
      // show their new status on this sweep rather than the next one.
      await promoteIssuesInReview(result.rows);
      // Last, and inside the try: it reads every unscanned thread's first
      // prompt, and a failure there must not lose the sweep that succeeded.
      try {
        await adoptHandStartedThreads(result.rows);
      } catch (error) {
        bb.log.warn(`could not adopt hand-started threads: ${String(error)}`);
      }
      bb.realtime.publish(REALTIME_CHANNEL, { sweptAt: result.sweptAt });
      bb.log.info(
        `swept ${result.rows.length} open issue(s)` +
          (result.skippedRepos.length
            ? `, skipped ${result.skippedRepos.length} repo(s) outside this machine's projects` +
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

  /** Pages threads.list, which caps a page however large a limit is asked for. */
  async function everyThread(): Promise<
    Array<{ id: string; title: string | null; originPluginId: string | null; archivedAt: number | null }>
  > {
    const all: Array<{
      id: string;
      title: string | null;
      originPluginId: string | null;
      archivedAt: number | null;
    }> = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const page = await bb.sdk.threads.list({ archived: false, limit: pageSize, offset });
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
   * mentions the issue after a sentence of context would have the URL cut off.
   */
  async function firstPromptText(threadId: string): Promise<string> {
    const events = await bb.sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      order: "asc",
      limit: "1",
    });
    const input = (events[0]?.data as { input?: Array<{ type?: string; text?: string }> } | undefined)
      ?.input;
    if (!Array.isArray(input)) return "";
    return input
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }

  /**
   * Adopts threads started from the composer for an issue this sweep knows.
   *
   * Runs at the end of a sweep, on the rows just stored, so the title it
   * writes is built from the same row the panel is about to render.
   *
   * Every thread's first prompt is read at most once ever, which is what makes
   * this affordable on a five-minute timer: the answer cannot change, so a
   * thread that named no issue is remembered as scanned and never read again.
   */
  async function adoptHandStartedThreads(rows: readonly IssueRow[]): Promise<boolean> {
    const { adoptHandStartedThreads: enabled, statusOnStart } = await settings.get();
    if (enabled !== "on" || rows.length === 0) return false;

    const scanned = store.scannedThreads();
    const linked = new Set([...store.allThreadLinks().values()].flat());
    const threads = await everyThread();
    // Every title currently in the sidebar, so a rename cannot manufacture a
    // duplicate. Mutated as titles are assigned, so two adoptions in one pass
    // cannot collide with each other either.
    const titlesInUse = new Set(threads.map((thread) => thread.title));
    let adopted = 0;

    for (const thread of threads) {
      if (scanned.has(thread.id) || linked.has(thread.id) || !isAdoptable(thread)) continue;

      const reference = soleIssueReference(await firstPromptText(thread.id));
      // Marked either way. A prompt that named no issue never will, and one
      // that named an issue is about to be linked, so neither needs re-reading.
      store.markThreadScanned(thread.id, Date.now());
      if (!reference) continue;

      const row = rows.find(
        (entry) => entry.repo.toLowerCase() === reference.repo && entry.number === reference.number,
      );
      // Not in the sweep means not an open issue assigned to me — someone
      // else's issue, or one already closed. Not this plugin's business.
      if (!row) continue;

      // Linked either way, because an issue may have several threads and the
      // store now keeps them all. The board move is guarded by its own
      // record, so a second thread on one issue does not move it twice.
      store.linkThread(row.repo, row.number, thread.id, Date.now());
      await autoSetStatus(row, statusOnStart);
      adopted += 1;

      const canonical = threadTitle(row.number, row.title);
      // Unlike pr-sweep there is no scope to fall back on: an issue carries no
      // flag saying what a particular thread is for. So when the canonical
      // title is already in the sidebar, the thread keeps its own. bb derived
      // that title from this thread's prompt, which makes it a description of
      // this thread's scope — the very thing the canonical title cannot
      // express twice.
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

    return adopted > 0;
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
        skippedRepos: meta.skippedRepos,
        truncated: meta.truncated,
        lastError: meta.lastError,
        harvest: await harvestListingState(),
      };
    },

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

    async startThreadDraft({ repo, number }) {
      const existingThreadId = store.threadFor(repo, number);
      if (existingThreadId) return { existingThreadId, reason: null, seed: null };

      const row = store.readRows().find((entry) => entry.repo === repo && entry.number === number);
      if (!row) {
        return {
          existingThreadId: null,
          reason: `#${number} is no longer in the sweep.`,
          seed: null,
        };
      }

      const target = matchProjectTargetForRepo(repo, await projectCandidates());
      if (!target) {
        return {
          existingThreadId: null,
          reason: `No bb project is checked out for ${repo}.`,
          seed: null,
        };
      }

      const { providerId, model, permissionMode } = await settings.get();
      const chosenModel = model.trim();

      return {
        existingThreadId: null,
        reason: null,
        seed: {
          projectId: target.id,
          providerId: providerId || null,
          model: chosenModel || null,
          permissionMode: parsePermissionMode(permissionMode),
          prompt: buildPromptParts(row).body,
          preview: {
            title: row.title,
            number: row.number,
            url: row.url,
            meta: [row.repo, row.boardStatus].filter(Boolean).join(" · "),
          },
          // A new worktree by default. An issue names work that has not
          // started, so there is no branch to land on and nothing to be gained
          // from sharing the main checkout with whatever else is going on
          // there. The composer still offers Work locally and Existing
          // worktree for the times that is not what you want.
          environment: {
            type: "host",
            workspace: {
              type: "managed-worktree",
              baseBranch: { kind: "default" },
            },
            ...(target.hostId ? { hostId: target.hostId } : {}),
          } as const,
        },
      };
    },

    async startThreadSubmit({ repo, number, request }) {
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

        // Everything the composer resolved — project, environment, provider,
        // model, reasoning, permission mode, execution provenance — is
        // forwarded untouched. Only the title is the plugin's business: the
        // composer has no field for one, and the sidebar should name the issue.
        // The composer only ever held the middle of the prompt, so the two
        // ends are put back here. Its own items sit between them untouched,
        // which is what keeps any @-mention or attachment that was added.
        const parts = buildPromptParts(row);
        const thread = await bb.sdk.threads.spawn({
          ...request,
          input: [
            { type: "text", text: headerItem(parts), mentions: [] },
            ...request.input,
            { type: "text", text: trailerItem(parts), mentions: [] },
          ],
          title: threadTitle(number, row.title),
        } as Parameters<typeof bb.sdk.threads.spawn>[0]);

        bb.log.info(`started ${thread.id} for ${key} in ${request.projectId}`);
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
