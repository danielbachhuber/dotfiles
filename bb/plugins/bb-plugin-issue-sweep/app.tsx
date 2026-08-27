import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  UrlLink,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { commentsLabel, relativeTime } from "./issues/format.js";
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

const BADGE = "rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground";

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
const HEAD = "text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground";

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
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${statusDot(row.boardStatus)}`} />
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
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${statusDot(row.boardStatus)}`} />
      <select
        aria-label={`Board status for #${row.number}`}
        title={row.boardStatus ?? placeholder}
        value={row.boardStatus ?? ""}
        disabled={busy}
        onChange={(event) => onPick(event.target.value)}
        className="max-w-full appearance-none truncate bg-transparent pr-3.5 text-xs text-muted-foreground outline-none hover:text-foreground disabled:opacity-50"
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
      <Button
        size="sm"
        variant="outline"
        className="w-full whitespace-nowrap"
        onClick={() => onOpen(row.threadId!)}
      >
        Open
      </Button>
    );
  }

  return (
    // The title sits on the wrapper, not the Button: a disabled button fires
    // no pointer events, so a tooltip on it would never show.
    <span
      title={row.canSpawn ? undefined : `No bb project is checked out for ${row.repo}`}
      className="block"
    >
      <Button
        size="sm"
        variant="outline"
        className="w-full whitespace-nowrap"
        disabled={!row.canSpawn || isStarting}
        onClick={() => onStart(row)}
      >
        {isStarting ? "Starting…" : "Start"}
      </Button>
    </span>
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
}: {
  rows: Row[];
  showRepo: boolean;
  statusOptions: string[];
  busyKeys: ReadonlySet<string>;
  starting: ReadonlySet<string>;
  onPick: (row: Row, status: string) => void;
  onStart: (row: Row) => void;
  onOpen: (threadId: string) => void;
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
            {/*
              Sized for "Starting…", which is the widest thing this column ever
              holds — wider than either resting label.
            */}
            <TableHead className="w-[7rem]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const comments = commentsLabel(row.commentsCount);
            return (
              <TableRow key={`${row.repo}#${row.number}`}>
                <TableCell className="align-top">
                  {/*
                    An explicit target opts out of BB's in-app browser: BB uses
                    its URL preference only for ordinary activation and leaves
                    explicit targets to the browser. An issue belongs in a real
                    browser tab, where the session, extensions and history are.
                  */}
                  <UrlLink
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`${row.title} (#${row.number})`}
                    className="block truncate font-medium hover:underline"
                  >
                    {row.title} (#{row.number})
                  </UrlLink>
                  {/*
                    The age and comment count used to be their own column. The
                    action took that column, and they are context rather than
                    something to act on, so they read better under the title
                    than they did beside it.
                  */}
                  <span className="block truncate text-xs text-muted-foreground">
                    {[showRepo ? row.repo : null, relativeTime(row.updatedAt, now), comments]
                      .filter(Boolean)
                      .join(" · ")}
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

function Panel() {
  const { listing, reload, rpc } = useListing();
  const [busy, setBusy] = useState(false);
  // Per-row, not one flag: two statuses can be set in quick succession and a
  // single flag would lock the whole table for the first one.
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const navigate = useBbNavigate();

  const onOpen = useCallback((threadId: string) => navigate.toThread(threadId), [navigate]);

  const onStart = useCallback(
    (row: Row) => {
      const key = `${row.repo}#${row.number}`;
      // Marked before awaiting anything, so the button changes on the same tick
      // as the click rather than after the spawn returns.
      setStarting((keys) => new Set(keys).add(key));

      void (async () => {
        try {
          const result = await rpc.call("startThread", { repo: row.repo, number: row.number });
          if (!result.threadId) {
            toast.error(result.reason ?? "Could not start a thread.");
            return;
          }
          if (!result.existing) toast.success(`Started a thread for ${key}`);
          await reload();
        } finally {
          setStarting((keys) => {
            const next = new Set(keys);
            next.delete(key);
            return next;
          });
        }
      })();
    },
    [reload, rpc],
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

  if (!listing) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

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
    { status: NO_BOARD, rows: actionable.filter((row) => row.boardStatus === null) },
    { status: BLOCKED, rows: blocked },
  ].filter((section) => section.rows.length > 0);

  return (
    <div className="h-full overflow-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {listing.sweptAt
              ? `Last synced ${new Date(listing.sweptAt).toLocaleTimeString()}`
              : "Not synced yet"}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRefresh()}>
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {listing.lastError ? (
          <p className="rounded-lg border border-border p-3 text-sm text-destructive">
            {listing.lastError}
          </p>
        ) : null}

        {listing.truncated ? (
          <p className="text-xs text-muted-foreground">
            The sweep hit the 100 issue ceiling, so this list may be incomplete.
          </p>
        ) : null}

        {listing.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issues assigned to you.</p>
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
              />
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function AssignedCount() {
  const { listing } = useListing();
  // Not every assigned issue: the badge is a "how much is on me right now"
  // number, and a Backlog item three months out is not on you today.
  const count = listing ? countedRows(listing.rows, listing.countedStatuses).length : 0;
  if (count === 0) return null;
  return <span className="text-xs tabular-nums text-muted-foreground">{count}</span>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "issues",
    title: "Issues",
    icon: "ListTodo",
    path: "issues",
    component: Panel,
    experimental_sidebarAccessory: AssignedCount,
  });
});
