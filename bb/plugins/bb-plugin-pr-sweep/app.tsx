import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  UrlLink,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyLink } from "@/components/ui/copy-link";
import { OpenPullRequestPage } from "./sweep/open-panel.js";
import { Icon } from "@/components/ui/icon";
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
  DISPLAY_SECTIONS,
  SECTION_TITLES,
  actionSummary,
  displaySection,
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
  if (row.unresolvedThreads > 0) {
    // Inline threads are the case an approval hides: robennals can approve
    // #5801 and still have left three comments on the diff.
    const outdated = row.outdatedThreads > 0 ? `, ${row.outdatedThreads} outdated` : "";
    lines.push({
      key: "threads",
      text: `${row.unresolvedThreads} unresolved comment${row.unresolvedThreads === 1 ? "" : "s"}${outdated}`,
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
    // Open thread stays the labelled action on every in-progress row, so it
    // does not change shape as the work finishes. Archiving is the tidy-up
    // that appears once the pull request has no flags left, and it sits
    // inline as an icon rather than a second full-width button stacked below.
    const isDone = row.flags.length === 0;
    return (
      <span className="flex items-center justify-end gap-1">
        <Button
          size="sm"
          variant="outline"
          className="whitespace-nowrap"
          onClick={() => onOpen(row.threadId!)}
        >
          Open thread
        </Button>
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
      </span>
    );
  }

  // Nothing to offer on a row that is only waiting for a run to finish, the
  // same as a clean one.
  if (row.group === "clean" || isOnlyWaitingOnCi(row.flags)) return null;

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
        className="whitespace-nowrap"
      >
        {isStarting ? "Starting…" : actionSummary(row.flags, row.unresolvedThreads)}
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
  onArchive,
}: {
  rows: Row[];
  showRepo: boolean;
  starting: Set<string>;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
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
            <TableHead className="w-[11.5rem]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.repo}#${row.number}`}>
              <TableCell className="align-top">
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
                  title={`${row.title} (#${row.number})`}
                  className="block truncate font-medium hover:underline"
                >
                  {row.title} (#{row.number})
                </UrlLink>
                {/*
                  Below the title, not above it: the title is what you scan for,
                  and a repository line above pushed it down a row and made the
                  eye land on the least distinguishing part of the row first.
                */}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {showRepo ? <span className="truncate">{row.repo}</span> : null}
                  <CopyLink title={`${row.title} (#${row.number})`} url={row.url} />
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
}: {
  title: string;
  rows: Row[];
  showRepo: boolean;
  starting: Set<string>;
  onWork: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
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
        onArchive={onArchive}
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

  if (!listing) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

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

        {DISPLAY_SECTIONS.map((section) => (
          <Section
            key={section}
            title={SECTION_TITLES[section]}
            rows={inSection(section)}
            showRepo={showRepo}
            starting={starting}
            onWork={onWork}
            onOpen={onOpen}
            onArchive={onArchive}
          />
        ))}
      </div>
      </div>
    </TooltipProvider>
  );
}

function NeedsActionCount() {
  const { listing } = useListing();
  const count =
    listing?.rows.filter(
      (row) =>
        displaySection(
          row.group,
          Boolean(row.threadId),
          row.isDraft,
          row.waitingOn.length,
          row.flags,
        ) === "needs-action",
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
    experimental_sidebarAccessory: NeedsActionCount,
  });

  app.slots.experimental_threadHeaderAction({
    id: "open-pull-request",
    title: "Open pull request",
    component: OpenPullRequest,
  });
});
