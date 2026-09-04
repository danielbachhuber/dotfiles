import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  UrlLink,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyLink } from "@/components/ui/copy-link";
import { SyncStatus } from "@/components/ui/sync-status";
import { TitleLink } from "@/components/ui/title-link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LoadingGraphic,
  usePrefersReducedMotion,
} from "@/components/ui/loading-graphic";
import { Icon } from "@/components/ui/icon";
import {
  StartThreadDialog,
  type StartThreadSeed,
} from "@/components/start-thread-dialog";
import { HarvestRowClock } from "bb-plugin-harvest/clock";
import type { HarvestTimerClient } from "bb-plugin-harvest/picker";
import { timerDefaultsForItem } from "bb-plugin-harvest/github";
import { commentsLabel, relativeTime, subtasksLabel } from "./issues/format.js";
import type { rpcContract } from "./server.js";
import { countedRows, sectionOrder } from "./issues/board.js";

type Row = {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  boardStatus: string | null;
  onBoard: boolean;
  blockedBy: number;
  subtasks?: { completed: number; total: number; source: "sub-issues" | "tasks" } | null;
  threadId: string | null;
  canSpawn: boolean;
  createdAt: number;
  updatedAt: number;
  commentsCount: number;
};

type Listing = {
  rows: Row[];
  statusOrder: string[];
  statusOptions: string[];
  countedStatuses: string[];
  boardName: string;
  sweptAt: number | null;
  truncated: boolean;
  lastError: string | null;
  harvest: { available: boolean; running: RunningReference };
};

function useListing() {
  const rpc = useRpc<typeof rpcContract>();
  const [listing, setListing] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    setListing((await rpc.call("listRows", null)) as Listing);
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("issues-updated", () => {
    void load();
  });

  return { listing, reload: load, rpc };
}

const BADGE =
  "rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground";

/** Where an issue lands when it is on no board, or on a different one. */
const NO_BOARD = "No board status";

/**
 * Issues something else has to happen to first, via GitHub's own issue
 * dependencies rather than a label or a board column.
 *
 * Last, and out of its board section: an issue nobody can start does not
 * belong beside issues that are ready, whatever the board says about it. The
 * board tracks where work stands, not whether it can proceed, so these two
 * facts genuinely disagree and the blocking one wins.
 */
const BLOCKED = "Blocked";

/** Shared header cell styling, so every column is declared the same way. */
const HEAD =
  "text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground";

/** What the picker offers when an issue has no status to show. */
const ADD_TO_BOARD = "Add to board";
const NO_STATUS = "No status";

/**
 * The dot beside a status, coloured by what the status means rather than by
 * its exact name, so a board that calls its first column "Ready" and one that
 * calls it "Ready for Dev" read the same. Anything unrecognised stays muted:
 * a wrong colour is worse than no colour.
 */
function statusDot(status: string | null): string {
  const name = (status ?? "").toLowerCase();
  if (name.includes("progress")) return "bg-sky-500";
  if (name.includes("review")) return "bg-amber-500";
  if (name.includes("ready")) return "bg-emerald-500";
  return "bg-muted-foreground/40";
}

/**
 * The board's Status column for one issue, as a picker.
 *
 * A plain label would only repeat the section heading above it. The value of
 * the column is that it is a control: it is the one place an issue can be
 * moved along the board, or put on it in the first place.
 *
 * An issue that is not on the board gets the same control with "Add to board"
 * as its placeholder, because adding and setting a status are one gesture —
 * adding alone would drop the issue into the board's "No Status" column, which
 * is the state this panel exists to get issues out of.
 */
function StatusCell({
  row,
  options,
  busy,
  onPick,
}: {
  row: Row;
  options: string[];
  busy: boolean;
  onPick: (status: string) => void;
}) {
  const placeholder = row.onBoard ? NO_STATUS : ADD_TO_BOARD;

  // No options means the board could not be read. The status is still worth
  // showing; only the ability to change it is lost.
  if (options.length === 0) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${statusDot(row.boardStatus)}`}
        />
        <span className="truncate">{row.boardStatus ?? placeholder}</span>
      </span>
    );
  }

  // A status the board no longer offers would otherwise select nothing and
  // render the row as blank, which reads as "not on the board".
  const offered =
    row.boardStatus && !options.includes(row.boardStatus)
      ? [row.boardStatus, ...options]
      : options;

  // Shrink-wrapped, not stretched to the column: a full-width select pins the
  // caret to the column's right edge, a long way from the text it belongs to.
  return (
    <span className="relative inline-flex max-w-full items-center gap-1.5">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${statusDot(row.boardStatus)}`}
      />
      <select
        aria-label={`Board status for #${row.number}`}
        title={row.boardStatus ?? placeholder}
        value={row.boardStatus ?? ""}
        disabled={busy}
        onChange={(event) => onPick(event.target.value)}
        className="max-w-full cursor-pointer appearance-none truncate bg-transparent pr-3.5 text-xs text-muted-foreground outline-none hover:text-foreground disabled:cursor-default disabled:opacity-50"
      >
        <option value="" disabled>
          {busy ? "Saving…" : placeholder}
        </option>
        {offered.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 text-[0.6rem] text-muted-foreground"
      >
        ▾
      </span>
    </span>
  );
}


type RunningReference =
  | {
      externalId: string;
      groupId: string | null;
      entryId: number;
      startedAt: string | null;
      projectName: string;
      taskName: string;
    }
  | null;

interface HarvestPanelState {
  available: boolean;
  running: RunningReference;
  client: HarvestTimerClient;
  onStarted: () => void;
}

/**
 * Whether the running timer belongs to this row.
 *
 * The group is part of the comparison because Harvest can only filter
 * references by id: without it, every repository's #42 would light up
 * together.
 */
function isRunningFor(running: RunningReference, row: Row): boolean {
  if (running === null) return false;
  if (running.externalId !== String(row.number)) return false;

  const { groupId } = timerDefaultsForItem(row).externalReference;
  return running.groupId === null || running.groupId === groupId;
}

/**
 * Adapt Issue Sweep's proxy methods onto the picker's transport-agnostic
 * client, which is what lets the picker source be shared verbatim with the
 * Harvest plugin.
 */
function useHarvestClient(rpc: ReturnType<typeof useRpc<typeof rpcContract>>): HarvestTimerClient {
  return useMemo(
    () => ({
      assignments: () => rpc.call("harvestAssignments", null),
      trackedHours: (input) =>
        rpc.call("harvestTrackedHours", {
          externalId: input.externalId,
          groupId: input.groupId ?? null,
        }),
      startTimer: (input) => rpc.call("harvestStartTimer", input),
      lastSelection: (input) => rpc.call("harvestLastSelection", input),
      stopTimer: async (input) => {
        await rpc.call("harvestStopTimer", input);
      },
    }),
    [rpc],
  );
}


/**
 * Start or open the thread for one issue.
 *
 * This column replaced "Updated", which is the right trade: the age of an
 * issue is context, and context belongs under the title, while starting work
 * is the thing you came to the panel to do.
 */
function ThreadAction({
  row,
  isStarting,
  onStart,
  onOpen,
}: {
  row: Row;
  isStarting: boolean;
  onStart: (row: Row) => void;
  onOpen: (threadId: string) => void;
}) {
  if (row.threadId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="size-8 shrink-0 p-0"
            aria-label={`Open the thread for #${row.number}`}
            onClick={() => onOpen(row.threadId!)}
          >
            <Icon name="MessageSquare" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open the thread</TooltipContent>
      </Tooltip>
    );
  }

  const label = isStarting ? "Starting…" : `Start a thread for #${row.number}`;

  return (
    // The tooltip hangs off the wrapper, not the Button: a disabled button
    // fires no pointer events, so one on the button itself would never show.
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">
          <Button
            size="sm"
            variant="ghost"
            className="size-8 shrink-0 p-0"
            disabled={!row.canSpawn || isStarting}
            aria-label={label}
            onClick={() => onStart(row)}
          >
            <Icon
              name={isStarting ? "Spinner" : "MessageSquarePlus"}
              className={`size-4${isStarting ? " animate-spin" : ""}`}
            />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {row.canSpawn ? label : `No bb project is checked out for ${row.repo}`}
      </TooltipContent>
    </Tooltip>
  );
}

function IssueTable({
  rows,
  showRepo,
  statusOptions,
  busyKeys,
  starting,
  onPick,
  onStart,
  onOpen,
  harvest,
}: {
  rows: Row[];
  showRepo: boolean;
  statusOptions: string[];
  busyKeys: ReadonlySet<string>;
  starting: ReadonlySet<string>;
  onPick: (row: Row, status: string) => void;
  onStart: (row: Row) => void;
  onOpen: (threadId: string) => void;
  harvest: HarvestPanelState;
}) {
  // One clock for the whole render, so two rows updated a second apart never
  // disagree about what "now" is.
  const now = Date.now();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className={HEAD}>Title</TableHead>
            <TableHead className={`w-[10rem] ${HEAD}`}>Status</TableHead>
            {/* One 2rem icon button plus the cell's own px-3 padding. */}
            <TableHead className="w-[3.5rem]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const comments = commentsLabel(row.commentsCount);
            const subtasks = subtasksLabel(row.subtasks);
            return (
              <TableRow key={`${row.repo}#${row.number}`}>
                <TableCell className="align-top">
                  <TitleLink href={row.url} text={`${row.title} (#${row.number})`} />
                  {/*
                    The age and comment count used to be their own column. The
                    action took that column, and they are context rather than
                    something to act on, so they read better under the title
                    than they did beside it.
                  */}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">
                      {[
                        showRepo ? row.repo : null,
                        relativeTime(row.updatedAt, now),
                        comments,
                        subtasks,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <CopyLink
                      title={`${row.title} (#${row.number})`}
                      url={row.url}
                    />
                    {harvest.available ? (
                      <HarvestRowClock
                        surface="issues"
                        row={row}
                        running={isRunningFor(harvest.running, row) ? harvest.running : null}
                        client={harvest.client}
                        onChanged={harvest.onStarted}
                      />
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="align-top">
                  <StatusCell
                    row={row}
                    options={statusOptions}
                    busy={busyKeys.has(`${row.repo}#${row.number}`)}
                    onPick={(status) => onPick(row, status)}
                  />
                </TableCell>
                <TableCell className="align-top">
                  <ThreadAction
                    row={row}
                    isStarting={starting.has(`${row.repo}#${row.number}`)}
                    onStart={onStart}
                    onOpen={onOpen}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The sweep's freshness and its refresh control, in the panel's title bar
 * rather than at the top of its body.
 *
 * Mounted separately from the panel, so it runs its own listing subscription.
 * That is the cost of the slot; it is small, and both mounts reload from the
 * same realtime event, so a refresh started here updates the table too.
 */
function SyncHeader() {
  const { listing, reload, rpc } = useListing();
  const [busy, setBusy] = useState(false);

  const onRefresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await rpc.call("refresh", null);
      if (!result.ok) toast.error(result.error ?? "Sweep failed.");
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload, rpc]);

  return (
    <SyncStatus
      sweptAt={listing?.sweptAt ?? null}
      busy={busy}
      onRefresh={() => void onRefresh()}
    />
  );
}

/**
 * What this panel is waiting for, drawn as the board it is about to read.
 *
 * Three columns filling one at a time, which is what a sweep of the board
 * actually is: the plugin reads it stage by stage, it does not shuffle cards
 * around. The colours are not decoration — each card is the colour
 * `statusDot` gives that stage, ready then in progress then in review, so the
 * glyph is already teaching the legend the table below uses.
 *
 * Only the stage being read stays lit; the ones behind it dim rather than
 * disappear. Three chips at full strength at once would be a rainbow, and
 * would lose the sense of the sweep moving.
 *
 * One 2.4s cycle shared by every card, expressed as fractions of it, so the
 * loop restarts as a whole and nothing snaps back on its own.
 */
function SweepingBoard() {
  const still = usePrefersReducedMotion();

  // Where each card lands, and when it is the one being read. Held at 0.45
  // afterwards: read, not forgotten.
  const STAGES = [
    { fill: "fill-emerald-500", at: "0;0.1;0.15;0.3;0.35;0.86;0.96;1" },
    { fill: "fill-sky-500", at: "0;0.3;0.35;0.5;0.55;0.86;0.96;1" },
    { fill: "fill-amber-500", at: "0;0.5;0.55;0.7;0.8;0.86;0.96;1" },
  ];

  return (
    <LoadingGraphic caption="Sweeping your board">
      <svg
        role="img"
        aria-label="A board filling one column at a time"
        viewBox="0 0 168 60"
        className="h-[3.75rem] w-[10.5rem] text-muted-foreground"
        fill="none"
      >
        {STAGES.map((stage, index) => {
          const x = 4 + index * 56;
          const last = index === STAGES.length - 1;
          return (
            <g key={stage.fill}>
              <rect
                x={x}
                y={4}
                width={48}
                height={52}
                rx={7}
                stroke="currentColor"
                strokeOpacity={0.22}
              />
              <rect
                x={x + 8}
                y={16}
                width={32}
                height={14}
                rx={3}
                className={stage.fill}
                opacity={still ? (last ? 1 : 0.45) : 0}
              >
                {still ? null : (
                  <animate
                    attributeName="opacity"
                    dur="2.4s"
                    repeatCount="indefinite"
                    // The last card has no successor to dim for, so it holds
                    // full strength until the whole glyph fades.
                    values={
                      last
                        ? "0;0;1;1;1;1;0;0"
                        : "0;0;1;1;0.45;0.45;0;0"
                    }
                    keyTimes={stage.at}
                  />
                )}
              </rect>
            </g>
          );
        })}
      </svg>
    </LoadingGraphic>
  );
}

function Panel() {
  const { listing, reload, rpc } = useListing();
  const [busy, setBusy] = useState(false);
  // Per-row, not one flag: two statuses can be set in quick succession and a
  // single flag would lock the whole table for the first one.
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const navigate = useBbNavigate();

  const onOpen = useCallback(
    (threadId: string) => navigate.toThread(threadId),
    [navigate],
  );

  const harvestClient = useHarvestClient(rpc);
  const harvest: HarvestPanelState = {
    available: listing?.harvest.available === true,
    running: listing?.harvest.running ?? null,
    client: harvestClient,
    // Starting a timer changes which row is lit, and that state arrives with
    // the listing, so the listing is what has to be re-read.
    onStarted: reload,
  };

  // The issue whose composer is open, with the seeds the backend resolved for
  // it. Null when the dialog is closed.
  const [draft, setDraft] = useState<{ row: Row; seed: StartThreadSeed } | null>(
    null,
  );

  const onStart = useCallback(
    (row: Row) => {
      const key = `${row.repo}#${row.number}`;
      // Marked before awaiting anything, so the button changes on the same tick
      // as the click rather than after the draft returns.
      setStarting((keys) => new Set(keys).add(key));

      void (async () => {
        try {
          const result = await rpc.call("startThreadDraft", {
            repo: row.repo,
            number: row.number,
          });
          // An issue that already has a thread never composes a second one.
          if (result.existingThreadId) {
            navigate.toThread(result.existingThreadId);
            return;
          }
          if (result.seed === null) {
            toast.error(result.reason ?? "Could not start a thread.");
            return;
          }
          setDraft({ row, seed: result.seed });
        } finally {
          setStarting((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
        }
      })();
    },
    [navigate, rpc],
  );

  const onSubmitDraft = useCallback(
    async (request: NewThreadRequest) => {
      if (!draft) return;
      const { repo, number } = draft.row;
      const key = `${repo}#${number}`;
      const result = await rpc.call("startThreadSubmit", {
        repo,
        number,
        request: request as never,
      });
      if (!result.threadId) {
        toast.error(result.reason ?? "Could not start a thread.");
        // Thrown so the composer keeps the draft rather than clearing it.
        throw new Error(result.reason ?? "Could not start a thread.");
      }
      setDraft(null);
      if (!result.existing) toast.success(`Started a thread for ${key}`);
      await reload();
    },
    [draft, reload, rpc],
  );

  const onPick = useCallback(
    async (row: Row, status: string) => {
      const key = `${row.repo}#${row.number}`;
      setBusyKeys((keys) => new Set(keys).add(key));
      try {
        const result = await rpc.call("setBoardStatus", {
          repo: row.repo,
          number: row.number,
          status,
        });
        if (!result.ok) {
          toast.error(result.error ?? "Could not update the board.");
          return;
        }
        toast.success(
          result.added
            ? `Added #${row.number} to the board as ${status}.`
            : `#${row.number} is now ${status}.`,
        );
        await reload();
      } finally {
        setBusyKeys((keys) => {
          const next = new Set(keys);
          next.delete(key);
          return next;
        });
      }
    },
    [reload, rpc],
  );

  const onRefresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await rpc.call("refresh", null);
      if (!result.ok) toast.error(result.error ?? "Sweep failed.");
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload, rpc]);

  if (!listing) return <SweepingBoard />;

  // The repository only earns a column when it actually varies.
  const showRepo = new Set(listing.rows.map((row) => row.repo)).size > 1;

  // Grouped by the board's own column, in the board's own order. An issue that
  // is on no board, or on a different one, still has to appear somewhere.
  // Drawn from the blocked rows too, so a status that only blocked issues
  // carry does not silently lose its place in the order.
  const present = listing.rows
    .map((row) => row.boardStatus)
    .filter((status): status is string => status !== null);

  const blocked = listing.rows.filter((row) => row.blockedBy > 0);
  const actionable = listing.rows.filter((row) => row.blockedBy === 0);

  const sections = [
    ...sectionOrder(listing.statusOrder, present).map((status) => ({
      status,
      rows: actionable.filter((row) => row.boardStatus === status),
    })),
    {
      status: NO_BOARD,
      rows: actionable.filter((row) => row.boardStatus === null),
    },
    { status: BLOCKED, rows: blocked },
  ].filter((section) => section.rows.length > 0);

  return (
    // 300ms matches the other two panels, so a tooltip in any of them waits
    // the same beat before appearing.
    <TooltipProvider delayDuration={300}>
      <div className="h-full overflow-auto p-4 md:p-5">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          {listing.lastError ? (
            <p className="rounded-lg border border-border p-3 text-sm text-destructive">
              {listing.lastError}
            </p>
          ) : null}

          {listing.truncated ? (
            <p className="text-xs text-muted-foreground">
              The sweep hit the 100 issue ceiling, so this list may be
              incomplete.
            </p>
          ) : null}

          {listing.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No issues assigned to you.
            </p>
          ) : (
            sections.map(({ status, rows }) => (
              <section key={status} className="space-y-2">
                <h2 className="text-sm font-medium">
                  {status} ({rows.length})
                </h2>
                <IssueTable
                  rows={rows}
                  showRepo={showRepo}
                  statusOptions={listing.statusOptions}
                  busyKeys={busyKeys}
                  starting={starting}
                  onPick={(row, status) => void onPick(row, status)}
                  onStart={onStart}
                  onOpen={onOpen}
                  harvest={harvest}
                />
              </section>
            ))
          )}
        </div>
      </div>

      <StartThreadDialog
        open={draft !== null}
        onOpenChange={(next) => {
          if (!next) setDraft(null);
        }}
        heading={
          draft ? `Start a thread for #${draft.row.number}` : "Start a thread"
        }
        description={
          draft
            ? draft.row.title
            : "Edit the prompt and the execution options before starting."
        }
        draftKey={draft ? `issue-sweep:${draft.row.repo}#${draft.row.number}` : ""}
        seed={draft?.seed ?? null}
        onSubmit={onSubmitDraft}
      />
    </TooltipProvider>
  );
}

function AssignedCount() {
  const { listing } = useListing();
  // Not every assigned issue: the badge is a "how much is on me right now"
  // number, and a Backlog item three months out is not on you today.
  const count = listing
    ? countedRows(listing.rows, listing.countedStatuses).length
    : 0;
  if (count === 0) return null;
  return (
    <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "issues",
    title: "Issues",
    icon: "ListTodo",
    path: "issues",
    component: Panel,
    experimental_sidebarAccessory: AssignedCount,
    headerContent: SyncHeader,
  });
});
