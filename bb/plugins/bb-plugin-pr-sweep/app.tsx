import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  UrlLink,
  type NewThreadRequest,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyLink } from "@/components/ui/copy-link";
import { HarvestRowClock } from "bb-plugin-harvest/clock";
import type { HarvestTimerClient } from "bb-plugin-harvest/picker";
import { timerDefaultsForItem } from "bb-plugin-harvest/github";
import { SyncStatus } from "@/components/ui/sync-status";
import { TitleLink } from "@/components/ui/title-link";
import { OpenPullRequestPage } from "./sweep/open-panel.js";
import { Icon } from "@/components/ui/icon";
import {
  StartThreadDialog,
  type StartThreadSeed,
} from "@/components/start-thread-dialog";
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
import {
  DISPLAY_SECTIONS,
  SECTION_TITLES,
  actionSummary,
  commentsToRead,
  displaySection,
  isCounted,
  isOnlyWaitingOnCi,
  statusTone,
  unflaggedStatus,
  type StatusTone,
} from "./sweep/actions.js";
import type { rpcContract } from "./server.js";

type Row = {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  flags: string[];
  group: "needs-action" | "ready-to-merge" | "clean";
  checks: {
    pass: number;
    fail: number;
    skip: number;
    pending: number;
    cancelled: number;
    total: number;
  };
  approvedBy: string[];
  commentedBy: string[];
  waitingOn: string[];
  awaitingReReview: boolean;
  lastCommentBy: string | null;
  unresolvedThreads: number;
  outdatedThreads: number;
  notedBy: string[];
  canSpawn: boolean;
  threadId: string | null;
  threadIds: string[];
};

type Listing = {
  rows: Row[];
  sweptAt: number | null;
  failedRepos: string[];
  truncated: boolean;
  lastError: string | null;
  harvest: { available: boolean; running: RunningReference };
};

const FLAG_LABELS: Record<string, string> = {
  conflict: "merge conflict",
  "ci-failing": "CI failing",
  feedback: "reviewer feedback",
  "merge-blocked": "merge blocked",
  "mergeable-unknown": "mergeability unknown",
  "ci-cancelled": "CI cancelled",
  "ci-absent": "no CI",
  "no-reviewer": "no reviewer",
  "ci-pending": "CI running",
  "merge-ready": "ready to merge",
};

/** Checks, most consequential count first. Zeroes are omitted, not printed. */
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
 * Adapt this panel's proxy methods onto the picker's transport-agnostic
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


function checksLabel(checks: Row["checks"]): string {
  const parts: string[] = [];
  if (checks.fail) parts.push(`${checks.fail} fail`);
  if (checks.pending) parts.push(`${checks.pending} running`);
  if (checks.cancelled) parts.push(`${checks.cancelled} cancelled`);
  if (checks.pass) parts.push(`${checks.pass} pass`);
  if (checks.skip) parts.push(`${checks.skip} skip`);
  return parts.length ? parts.join(" · ") : "no checks";
}

/**
 * Approvals and outstanding requests are not alternatives, so the cell stacks
 * them instead of picking one. A merge decision needs both: an approval that
 * stands, and anyone who was asked and has not answered. Showing only the
 * latter hides the reason the row is merge-ready at all.
 *
 * Commenters are named only when they did NOT also approve, because
 * "commented, no approval" is the case worth seeing before a merge.
 */
function Review({ row }: { row: Row }) {
  const approvers = row.approvedBy;
  const commentedOnly = row.commentedBy.filter((login) => !approvers.includes(login));

  const lines: Array<{ key: string; text: string; strong?: boolean }> = [];
  if (approvers.length) {
    lines.push({ key: "approved", text: `approved by ${approvers.join(", ")}`, strong: true });
  }
  if (commentedOnly.length) {
    lines.push({ key: "commented", text: `comments from ${commentedOnly.join(", ")}` });
  }
  if (row.waitingOn.length) {
    lines.push({ key: "waiting", text: `waiting on ${row.waitingOn.join(", ")}` });
  }
  if (row.awaitingReReview) {
    lines.push({ key: "re-review", text: "awaiting re-review" });
  }
  if (row.unresolvedThreads > 0) {
    // Inline threads are the case an approval hides: hubber can approve
    // #5801 and still have left three comments on the diff.
    const outdated = row.outdatedThreads > 0 ? `, ${row.outdatedThreads} outdated` : "";
    lines.push({
      key: "threads",
      text: `${row.unresolvedThreads} unresolved comment${row.unresolvedThreads === 1 ? "" : "s"}${outdated}`,
      strong: true,
    });
  }
  if (row.notedBy.length) {
    // An approval with a written body reads as unqualified agreement
    // everywhere else on the row: it is APPROVED, it leaves no unresolved
    // thread, and it is not an issue comment.
    lines.push({
      key: "notes",
      text: `${row.notedBy.join(", ")} wrote notes on their review`,
      strong: true,
    });
  }
  if (row.lastCommentBy) {
    // Last word belongs to someone else, so the pull request is probably
    // waiting on a reply even when every review has approved.
    lines.push({
      key: "last-comment",
      text: `${row.lastCommentBy} commented last`,
      strong: true,
    });
  }

  if (lines.length === 0) return <span className="text-muted-foreground">no reviews yet</span>;

  return (
    <span className="flex flex-col gap-0.5">
      {lines.map((line) => (
        // Wraps rather than truncates. A team slug is long enough that
        // "waiting on wearenewpublic/psi-co…" hid the only part that
        // distinguishes one team from another, and unlike a title there is no
        // link to click through to. break-words because a slug is one
        // unbroken token to the browser, so wrapping alone would not fit it.
        <span
          key={line.key}
          className={`break-words ${line.strong ? "text-foreground" : "text-muted-foreground"}`}
        >
          {line.text}
        </span>
      ))}
    </span>
  );
}

function useListing() {
  const rpc = useRpc<typeof rpcContract>();
  const [listing, setListing] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    setListing((await rpc.call("listRows", null)) as Listing);
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("prs-updated", () => {
    void load();
  });

  return { listing, reload: load, rpc };
}

/**
 * The flags, worst first. The leading flag gets the filled badge because it is
 * the one that decides the row's action; the rest are context, so they stay
 * quiet. This is the one place in the table that raises its voice.
 */
/**
 * Badge colours per tone. The palette is deliberately shallow — a problem, a
 * good outcome, and a neutral state — so the eye can sort a long table at a
 * glance. Each tone carries its own dark variant, because a single mid tone
 * that reads well on white washes out on a dark background.
 */
const TONE_CLASSES: Record<StatusTone, string> = {
  negative: "bg-destructive/10 text-destructive",
  // A state rather than a verdict, so it stays out of the colour vocabulary
  // the other three use.
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

const BADGE = "rounded-md px-1.5 py-0.5 text-xs font-medium";

function StatusCell({ row }: { row: Row }) {
  // Draft leads, then whatever else is true of the row.
  const draft = row.isDraft ? (
    <span className={`${BADGE} ${TONE_CLASSES.neutral}`}>draft</span>
  ) : null;

  if (row.flags.length === 0) {
    // "clean" is true but uninformative: most unflagged rows are sitting with
    // a reviewer rather than idle.
    return (
      <span className="flex flex-wrap items-center gap-1">
        {draft}
        <span className={`${BADGE} ${TONE_CLASSES.info}`}>
          {unflaggedStatus({ waitingOn: row.waitingOn, awaitingReReview: row.awaitingReReview })}
        </span>
      </span>
    );
  }

  // Every flag gets a badge. A second one rendered as plain text read as a
  // caption on the first rather than a second thing wrong with the PR.
  return (
    <span className="flex flex-wrap items-center gap-1">
      {draft}
      {row.flags.map((flag) => (
        <span key={flag} className={`${BADGE} ${TONE_CLASSES[statusTone(flag)]}`}>
          {FLAG_LABELS[flag] ?? flag}
        </span>
      ))}
    </span>
  );
}

/**
 * The pull request's earlier threads, when it has any.
 *
 * One pull request has several threads over its life — a conflict thread, then
 * a CI thread, then a merge thread — and the row's button can only open one of
 * them. It opens the newest, which is the work in progress; this is how the
 * finished ones stay reachable instead of being visible only in the sidebar.
 *
 * Renders nothing on the common single-thread row, so the cell keeps its shape
 * unless there is genuinely something more to offer.
 */
function OlderThreads({ row, onOpen }: { row: Row; onOpen: (threadId: string) => void }) {
  const older = row.threadIds.slice(1);
  if (older.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          aria-label={`${older.length} earlier thread${older.length === 1 ? "" : "s"}`}
        >
          {/* Upright, matching review-sweep: the registry has no vertical
              twin and components/ui is vendored byte-identical from bb, so the
              glyph is turned rather than swapped. */}
          <Icon name="MoreHorizontal" className="size-4 rotate-90" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {older.map((threadId, index) => (
          <DropdownMenuItem key={threadId} onSelect={() => onOpen(threadId)}>
            {/* Numbered from the newest backwards, because "earlier thread 1"
                is the one before the one the button opens. The thread's own
                title is not on the row, so a position is all this can say. */}
            Earlier thread {index + 1}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Three states, because a click that looks like nothing happened is what makes
 * someone click again: the action, an immediate "Starting…" while the thread is
 * being created, then a link to the thread once one exists.
 */
function Action({
  row,
  isStarting,
  onWork,
  onOpen,
  onArchive,
}: {
  row: Row;
  isStarting: boolean;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
}) {
  if (row.threadId) {
    // The open action stays on every in-progress row, so the cell does not
    // change shape as the work finishes. Archiving is the tidy-up that appears
    // once the pull request has no flags left.
    const isDone = row.flags.length === 0;
    return (
      <span className="flex items-center justify-end gap-1">
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
        {isDone ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="size-8 shrink-0 p-0"
                aria-label="Archive thread"
                onClick={() => onArchive(row)}
              >
                <Icon name="Archive" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Archive thread</TooltipContent>
          </Tooltip>
        ) : null}
        <OlderThreads row={row} onOpen={onOpen} />
      </span>
    );
  }

  // Nothing to offer on a row that is only waiting for a run to finish, the
  // same as a clean one.
  if (row.group === "clean" || isOnlyWaitingOnCi(row.flags)) return null;

  // Which work the click starts — "Resolve conflict", "Review and merge". It
  // named the button before the button became an icon; now it is the tooltip
  // and the accessible name, so the sentence survives for anyone who hovers or
  // listens. The Status column carries the flags themselves.
  const action = actionSummary(row.flags, commentsToRead(row));

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
            aria-label={isStarting ? "Starting…" : `${action} on #${row.number}`}
            onClick={() => onWork(row)}
          >
            <Icon
              name={isStarting ? "Spinner" : "MessageSquarePlus"}
              className={`size-4${isStarting ? " animate-spin" : ""}`}
            />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {row.canSpawn ? action : `No bb project is checked out for ${row.repo}`}
      </TooltipContent>
    </Tooltip>
  );
}

/** Shared header cell styling, so every column is declared the same way. */
const HEAD = "text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground";

function PrTable({
  rows,
  showRepo,
  starting,
  onWork,
  onOpen,
  onArchive,
  harvest,
}: {
  rows: Row[];
  showRepo: boolean;
  starting: Set<string>;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
  harvest: HarvestPanelState;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/*
        table-fixed with an explicit width per column, so the four section
        tables line up with each other. Auto layout sizes each table to its own
        contents, which made Clean's narrow "clean" status column pull every
        other column out of step with Needs action's stacked badges.
      */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className={HEAD}>Title</TableHead>
            <TableHead className={`w-[9rem] ${HEAD}`}>Status</TableHead>
            <TableHead className={`hidden w-[9rem] lg:table-cell ${HEAD}`}>Checks</TableHead>
            <TableHead className={`hidden w-[15rem] xl:table-cell ${HEAD}`}>Review</TableHead>
            {/*
              11.5rem, not 11: the cell padding went from px-2 to px-3 to match
              the bundled GitHub plugin, and the extra 0.5rem has to come from
              somewhere. The button does not wrap, so taking it out of the
              content box is what put a horizontal scrollbar on this table once
              before.
            */}
            <TableHead className="w-[8rem]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.repo}#${row.number}`}>
              <TableCell className="align-top">
                <TitleLink href={row.url} text={`${row.title} (#${row.number})`} />
                {/*
                  Below the title, not above it: the title is what you scan for,
                  and a repository line above pushed it down a row and made the
                  eye land on the least distinguishing part of the row first.
                */}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {showRepo ? <span className="truncate">{row.repo}</span> : null}
                  <CopyLink title={`${row.title} (#${row.number})`} url={row.url} />
                  {harvest.available ? (
                    <HarvestRowClock
                      surface="pull-requests"
                      row={row}
                      running={isRunningFor(harvest.running, row) ? harvest.running : null}
                      client={harvest.client}
                      onChanged={harvest.onStarted}
                    />
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="align-top">
                <StatusCell row={row} />
              </TableCell>
              <TableCell className="hidden align-top text-xs tabular-nums text-muted-foreground lg:table-cell">
                {checksLabel(row.checks)}
              </TableCell>
              <TableCell className="hidden align-top text-xs xl:table-cell">
                <Review row={row} />
              </TableCell>
              <TableCell className="align-top text-right">
                <Action
                  row={row}
                  isStarting={starting.has(`${row.repo}#${row.number}`)}
                  onWork={onWork}
                  onOpen={onOpen}
                  onArchive={onArchive}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Section({
  title,
  rows,
  showRepo,
  starting,
  onWork,
  onOpen,
  onArchive,
  harvest,
}: {
  title: string;
  rows: Row[];
  showRepo: boolean;
  starting: Set<string>;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
  harvest: HarvestPanelState;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {title} ({rows.length})
      </h2>
      <PrTable
        harvest={harvest}
        rows={rows}
        showRepo={showRepo}
        starting={starting}
        onWork={onWork}
        onOpen={onOpen}
        onArchive={onArchive}
      />
    </section>
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
 * What this panel is waiting for, drawn as the thing it is waiting on.
 *
 * A pull request is a branch that leaves the trunk, collects commits and comes
 * back, so that is what the wait shows: the branch draws itself, three commits
 * land on it in turn, and the merge point arrives last and in colour. The one
 * accent in the whole panel-load is the merge — the moment every row in the
 * table below is working toward.
 *
 * Timings are fractions of a single 2.4s cycle rather than separate durations,
 * so every part of the glyph restarts together and the loop has no seam.
 */
function SweepingPullRequests() {
  const still = usePrefersReducedMotion();

  return (
    <LoadingGraphic caption="Sweeping your open pull requests">
      <svg
        role="img"
        aria-label="A branch leaving the trunk, gathering commits, and merging back"
        viewBox="0 0 132 64"
        className="h-[4.5rem] w-[9.5rem] text-muted-foreground"
        fill="none"
      >
        {/* The trunk, which is always there and never animates. */}
        <path
          d="M8 46H124"
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={2.5}
          strokeLinecap="round"
        />

        {/* Where the branch leaves. */}
        <circle cx={30} cy={46} r={3.5} fill="currentColor" fillOpacity={0.7} opacity={still ? 1 : 0}>
          {still ? null : (
            <animate
              attributeName="opacity"
              dur="2.4s"
              repeatCount="indefinite"
              values="0;0;1;1;0;0"
              keyTimes="0;0.02;0.06;0.86;0.96;1"
            />
          )}
        </circle>

        <path
          d="M30 46C44 46 44 22 58 22H82C96 22 96 46 110 46"
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={92}
          strokeDashoffset={still ? 0 : 92}
        >
          {still ? null : (
            <>
              <animate
                attributeName="stroke-dashoffset"
                dur="2.4s"
                repeatCount="indefinite"
                values="92;92;0;0;0"
                keyTimes="0;0.05;0.42;0.86;1"
              />
              <animate
                attributeName="opacity"
                dur="2.4s"
                repeatCount="indefinite"
                values="1;1;0;0"
                keyTimes="0;0.86;0.96;1"
              />
            </>
          )}
        </path>

        {/* The commits, landing in the order they would be pushed. */}
        {[
          { cx: 58, at: "0.3;0.34" },
          { cx: 70, at: "0.38;0.42" },
          { cx: 82, at: "0.46;0.5" },
        ].map(({ cx, at }) => (
          <circle
            key={cx}
            cx={cx}
            cy={22}
            r={3.5}
            fill="currentColor"
            fillOpacity={0.7}
            opacity={still ? 1 : 0}
          >
            {still ? null : (
              <animate
                attributeName="opacity"
                dur="2.4s"
                repeatCount="indefinite"
                values="0;0;1;1;0;0"
                keyTimes={`0;${at};0.86;0.96;1`}
              />
            )}
          </circle>
        ))}

        {/* The merge: the only colour, and the last thing to arrive. */}
        <circle cx={110} cy={46} r={4.5} className="fill-emerald-500" opacity={still ? 1 : 0}>
          {still ? null : (
            <>
              <animate
                attributeName="opacity"
                dur="2.4s"
                repeatCount="indefinite"
                values="0;0;1;1;0;0"
                keyTimes="0;0.58;0.63;0.86;0.96;1"
              />
              <animate
                attributeName="r"
                dur="2.4s"
                repeatCount="indefinite"
                values="1;1;5.5;4.5;4.5;4.5"
                keyTimes="0;0.58;0.63;0.7;0.96;1"
              />
            </>
          )}
        </circle>
      </svg>
    </LoadingGraphic>
  );
}

function Panel() {
  const { listing, reload, rpc } = useListing();
  const harvestClient = useHarvestClient(rpc);
  const harvest: HarvestPanelState = {
    available: listing?.harvest.available === true,
    running: listing?.harvest.running ?? null,
    // Starting a timer changes which row is lit, and that state arrives with
    // the listing, so the listing is what has to be re-read.
    client: harvestClient,
    onStarted: reload,
  };

  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<Set<string>>(() => new Set());

  const onOpen = useCallback(
    (threadId: string) => {
      navigate.toThread(threadId);
    },
    [navigate],
  );

  // The pull request whose composer is open, with the seeds the backend
  // resolved for it. Null when the dialog is closed.
  const [draft, setDraft] = useState<{ row: Row; seed: StartThreadSeed } | null>(
    null,
  );

  const onWork = useCallback(
    (row: Row) => {
      const key = `${row.repo}#${row.number}`;
      // Mark it starting before awaiting anything, so the button changes on
      // the same tick as the click.
      setStarting((current) => new Set(current).add(key));

      void (async () => {
        try {
          const result = await rpc.call("workOnThisDraft", {
            repo: row.repo,
            number: row.number,
          });
          // A pull request that already has a thread never composes a second one.
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
          setStarting((current) => {
            const next = new Set(current);
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
      const result = await rpc.call("workOnThisSubmit", {
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

  const onArchive = useCallback(
    (row: Row) => {
      void (async () => {
        const result = await rpc.call("archiveThread", {
          repo: row.repo,
          number: row.number,
        });
        if (result.ok) toast.success(`Archived the thread for ${row.repo}#${row.number}`);
        else toast.error(result.reason ?? "Could not archive the thread.");
        await reload();
      })();
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

  if (!listing) return <SweepingPullRequests />;

  const inSection = (section: string) =>
    listing.rows.filter(
      (row) => displaySection(
        row.group,
        Boolean(row.threadId),
        row.isDraft,
        row.waitingOn.length,
        row.flags,
      ) === section,
    );

  // The repository only earns a column when it actually varies.
  const showRepo = new Set(listing.rows.map((row) => row.repo)).size > 1;

  return (
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
            The sweep hit the 100 pull request ceiling, so this list may be incomplete.
          </p>
        ) : null}

        {listing.failedRepos.length ? (
          <p className="text-xs text-muted-foreground">
            Could not refresh {listing.failedRepos.join(", ")}. Showing the last known rows.
          </p>
        ) : null}

        {listing.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open pull requests.</p>
        ) : null}

        {DISPLAY_SECTIONS.map((section) => (
          <Section
            key={section}
            title={SECTION_TITLES[section]}
            rows={inSection(section)}
            showRepo={showRepo}
            starting={starting}
            harvest={harvest}
            onWork={onWork}
            onOpen={onOpen}
            onArchive={onArchive}
          />
        ))}
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
        draftKey={draft ? `pr-sweep:${draft.row.repo}#${draft.row.number}` : ""}
        seed={draft?.seed ?? null}
        onSubmit={onSubmitDraft}
      />
    </TooltipProvider>
  );
}

function NeedsActionCount() {
  const { listing } = useListing();
  const count =
    listing?.rows.filter((row) =>
      isCounted(
        displaySection(
          row.group,
          Boolean(row.threadId),
          row.isDraft,
          row.waitingOn.length,
          row.flags,
        ),
      ),
    ).length ?? 0;
  if (count === 0) return null;
  return <span className="text-xs tabular-nums text-muted-foreground">{count}</span>;
}

/**
 * The thread header's action row, on threads this plugin started. A thread
 * spends its life away from the panel that spawned it, and the pull request is
 * the thing you want next from inside it.
 *
 * Renders nothing when the lookup returns null, which is every thread this
 * plugin did not create — the server decides that, not this component.
 */
function OpenPullRequest({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [pr, setPr] = useState<{ number: number; url: string; repo: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await rpc.call("pullRequestForThread", { threadId });
      if (live) setPr(result);
    })();
    return () => {
      live = false;
    };
  }, [rpc, threadId]);

  if (!pr) return null;

  const label = `Open ${pr.repo}#${pr.number} on GitHub`;

  return (
    // Its own provider: this slot mounts in the host header, outside the
    // panel's provider.
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <UrlLink
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Icon name="GitPullRequest" className="size-3.5" />
            {isCompactViewport ? null : <span>#{pr.number}</span>}
          </UrlLink>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "open-pr",
    title: "Open pull request",
    icon: "FolderGit",
    path: "open-pr",
    component: OpenPullRequestPage,
  });

  app.slots.navPanel({
    id: "prs",
    title: "Pull requests",
    icon: "GitPullRequest",
    path: "prs",
    component: Panel,
    headerContent: SyncHeader,
    experimental_sidebarAccessory: NeedsActionCount,
  });

  app.slots.experimental_threadHeaderAction({
    id: "open-pull-request",
    title: "Open pull request",
    component: OpenPullRequest,
  });
});
