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
import { actionSummary, displaySection } from "./sweep/actions.js";
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
  canSpawn: boolean;
  threadId: string | null;
};

type Listing = {
  rows: Row[];
  sweptAt: number | null;
  failedRepos: string[];
  truncated: boolean;
  lastError: string | null;
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

  if (lines.length === 0) return <span className="text-muted-foreground">no reviews yet</span>;

  return (
    <span className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <span
          key={line.key}
          className={line.strong ? "truncate text-foreground" : "truncate text-muted-foreground"}
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
function Needs({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-muted-foreground">clean</span>;

  const [primary, ...rest] = flags;
  const isReady = primary === "merge-ready";

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={
          isReady
            ? "rounded-md bg-foreground/10 px-1.5 py-0.5 text-xs font-medium text-foreground"
            : "rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive"
        }
      >
        {FLAG_LABELS[primary!] ?? primary}
      </span>
      {rest.map((flag) => (
        <span key={flag} className="text-xs text-muted-foreground">
          {FLAG_LABELS[flag] ?? flag}
        </span>
      ))}
    </span>
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
}: {
  row: Row;
  isStarting: boolean;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
}) {
  if (row.threadId) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="whitespace-nowrap"
        onClick={() => onOpen(row.threadId!)}
      >
        Open thread
      </Button>
    );
  }

  if (row.group === "clean") return null;

  return (
    // The title sits on the wrapper, not the Button: a disabled button fires no
    // pointer events, so a tooltip on it would never show.
    <span
      title={row.canSpawn ? undefined : `No bb project is checked out for ${row.repo}`}
      className="inline-block"
    >
      <Button
        size="sm"
        variant="outline"
        disabled={!row.canSpawn || isStarting}
        onClick={() => onWork(row)}
        className="h-auto min-h-8 whitespace-normal py-1 text-left leading-snug"
      >
        {isStarting ? "Starting…" : actionSummary(row.flags)}
      </Button>
    </span>
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
}: {
  rows: Row[];
  showRepo: boolean;
  starting: Set<string>;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
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
            <TableHead className={`w-[5rem] ${HEAD}`}>PR</TableHead>
            <TableHead className={HEAD}>Title</TableHead>
            <TableHead className={`w-[9rem] ${HEAD}`}>Status</TableHead>
            <TableHead className={`hidden w-[9rem] lg:table-cell ${HEAD}`}>Checks</TableHead>
            <TableHead className={`hidden w-[15rem] xl:table-cell ${HEAD}`}>Review</TableHead>
            <TableHead className="w-[13rem]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.repo}#${row.number}`}>
              <TableCell className="align-top font-mono text-xs tabular-nums text-muted-foreground">
                #{row.number}
              </TableCell>
              <TableCell className="align-top">
                {showRepo ? (
                  <span className="block truncate text-xs text-muted-foreground">{row.repo}</span>
                ) : null}
                {/*
                  An explicit target opts out of BB's in-app browser: BB uses
                  its URL preference only for ordinary activation and leaves
                  explicit targets to the browser. A pull request belongs in a
                  real browser tab, where the session, extensions and history
                  are.
                */}
                <UrlLink
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium hover:underline"
                >
                  {row.title}
                </UrlLink>
                {row.isDraft ? (
                  <span className="text-xs text-muted-foreground">draft</span>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <Needs flags={row.flags} />
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
}: {
  title: string;
  rows: Row[];
  showRepo: boolean;
  starting: Set<string>;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {title} ({rows.length})
      </h2>
      <PrTable
        rows={rows}
        showRepo={showRepo}
        starting={starting}
        onWork={onWork}
        onOpen={onOpen}
      />
    </section>
  );
}

function Panel() {
  const { listing, reload, rpc } = useListing();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<Set<string>>(() => new Set());

  const onOpen = useCallback(
    (threadId: string) => {
      navigate.toThread(threadId);
    },
    [navigate],
  );

  const onWork = useCallback(
    (row: Row) => {
      const key = `${row.repo}#${row.number}`;
      // Mark it starting before awaiting anything, so the button changes on
      // the same tick as the click.
      setStarting((current) => new Set(current).add(key));

      void (async () => {
        try {
          const result = await rpc.call("workOnThis", { repo: row.repo, number: row.number });
          if (result.threadId) {
            if (!result.existing) toast.success(`Started a thread for ${key}`);
            await reload();
          } else {
            toast.error(result.reason ?? "Could not start a thread.");
          }
        } finally {
          setStarting((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
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

  if (!listing) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  const inSection = (section: string) =>
    listing.rows.filter((row) => displaySection(row.group, Boolean(row.threadId)) === section);

  const needsAction = inSection("needs-action");
  const inProgress = inSection("in-progress");
  const ready = inSection("ready-to-merge");
  const clean = inSection("clean");

  // The repository only earns a column when it actually varies.
  const showRepo = new Set(listing.rows.map((row) => row.repo)).size > 1;

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

        <Section
          title="Needs action"
          rows={needsAction}
          showRepo={showRepo}
          starting={starting}
          onWork={onWork}
          onOpen={onOpen}
        />
        <Section
          title="In progress"
          rows={inProgress}
          showRepo={showRepo}
          starting={starting}
          onWork={onWork}
          onOpen={onOpen}
        />
        <Section
          title="Ready to merge"
          rows={ready}
          showRepo={showRepo}
          starting={starting}
          onWork={onWork}
          onOpen={onOpen}
        />
        <Section
          title="Clean"
          rows={clean}
          showRepo={showRepo}
          starting={starting}
          onWork={onWork}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

function NeedsActionCount() {
  const { listing } = useListing();
  const count =
    listing?.rows.filter(
      (row) => displaySection(row.group, Boolean(row.threadId)) === "needs-action",
    ).length ?? 0;
  if (count === 0) return null;
  return <span className="text-xs tabular-nums text-muted-foreground">{count}</span>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "prs",
    title: "Pull requests",
    icon: "GitPullRequest",
    path: "prs",
    component: Panel,
    experimental_sidebarAccessory: NeedsActionCount,
  });
});
