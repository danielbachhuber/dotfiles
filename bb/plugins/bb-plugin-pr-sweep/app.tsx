import { Fragment, useCallback, useEffect, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyLink } from "@/components/ui/copy-link";
import { SyncStatus } from "@/components/ui/sync-status";
import { TitleLink } from "@/components/ui/title-link";
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
  EVIDENCE_SHOWN,
  SECTION_TITLES,
  actionSummary,
  ageLabel,
  commentsToRead,
  displaySection,
  isCounted,
  isOnlyWaitingOnCi,
  rowEvidence,
  sizeLabel,
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
  updatedAt: number | null;
  size: { additions: number; deletions: number; changedFiles: number };
  failingChecks: string[];
  notes: Array<{ author: string; approved: boolean; body: string }>;
  threadComments: Array<{ author: string; path: string; body: string; outdated: boolean }>;
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
  // No line for the unresolved count and none for "wrote notes on their
  // review". Both used to be the only hint that something was written; the
  // evidence below now quotes it, and saying "1 unresolved comment" directly
  // above that comment is the row telling you twice.
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

  // One line, joined, rather than a stack. Each of these is a few words about
  // who is involved; stacked they cost a row of height each and turned four
  // pull requests into a page you had to scroll.
  //
  // break-words because a team slug is one unbroken token to the browser, and
  // "waiting on wearenewpublic/psi-co…" hides the part that says which team.
  return (
    <span className="break-words">
      {lines.map((line, index) => (
        <Fragment key={line.key}>
          {/* The separator sits outside the span so each line stays one text
              node — joined into it, the node reads " · waiting on mona". */}
          {index > 0 ? <span className="text-muted-foreground"> · </span> : null}
          <span className={line.strong ? "text-foreground" : "text-muted-foreground"}>
            {line.text}
          </span>
        </Fragment>
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

/**
 * What the row is actually being asked for, in the words of whoever asked.
 *
 * The panel used to say "5 unresolved comments" and "hubber wrote notes on
 * their review". Both are true of a typo nit and of a design objection, so the
 * only way to tell was to open GitHub — and that trip was the missing step.
 *
 * One line each, truncated by CSS rather than cut in the classifier: where to
 * stop is a question about the width of this column, which only the browser
 * knows. The first draft of this rendered whole paragraphs and turned a table
 * of four pull requests into a page — a row has to stay a row, and the point
 * of the quotation is to recognise the comment, not to read it here.
 */
function EvidenceList({ row }: { row: Row }) {
  const evidence = rowEvidence(row);
  if (evidence.length === 0) return null;

  const shown = evidence.slice(0, EVIDENCE_SHOWN);
  const rest = evidence.length - shown.length;

  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((item, index) => (
        // min-w-0 on both the row and the text: a flex child will not shrink
        // below its content without it, so truncate silently does nothing and
        // the paragraph renders in full. That is what happened here.
        <li key={`${item.kind}-${index}`} className="flex min-w-0 gap-1.5 text-xs">
          {item.kind === "check" ? (
            <span className="shrink-0 text-destructive" aria-label="failing check">
              ✗
            </span>
          ) : (
            <span className="shrink-0 text-muted-foreground">{item.who}</span>
          )}
          <span
            className={`min-w-0 truncate ${item.kind === "check" ? "text-destructive" : ""}`}
            title={item.text}
          >
            {item.where ? (
              <span className="text-muted-foreground">{shortPath(item.where)} </span>
            ) : null}
            {item.text}
            {/*
              An outdated comment is not one of N things to answer: one pull
              request here has 33 unresolved threads and all 33 sit on code
              that has since been rewritten, which is a different job.
            */}
            {item.outdated ? <span className="text-muted-foreground"> (outdated)</span> : null}
          </span>
        </li>
      ))}
      {rest > 0 ? <li className="text-xs text-muted-foreground">and {rest} more</li> : null}
    </ul>
  );
}

/**
 * The last two segments of a path. A full path is mostly directories shared
 * with every other comment on the pull request, and the filename is the part
 * that says where you are.
 */
function shortPath(path: string): string {
  const parts = path.split("/");
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}

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
        <OlderThreads row={row} onOpen={onOpen} />
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
        {isStarting ? "Starting…" : actionSummary(row.flags, commentsToRead(row))}
      </Button>
    </span>
  );
}

/** Shared header cell styling, so every column is declared the same way. */
const HEAD = "text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground";

function PrTable({
  rows,
  showRepo,
  now,
  starting,
  onWork,
  onOpen,
  onArchive,
}: {
  rows: Row[];
  showRepo: boolean;
  /** Sampled once per paint, so every age in one render shares an instant. */
  now: number;
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
            {/*
              One content column rather than four. Status, Checks and Review
              were each a summary of something, and reading a row meant
              assembling them into a decision by eye; stacked under the title
              they read as one statement of where the pull request stands.
            */}
            <TableHead className={HEAD}>Pull request</TableHead>
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
                <TitleLink href={row.url} text={`${row.title} (#${row.number})`} />
                {/*
                  Below the title, not above it: the title is what you scan for,
                  and a repository line above pushed it down a row and made the
                  eye land on the least distinguishing part of the row first.

                  Size and age join it because they are what size the job: a
                  one-line deletion sitting for a week and a 60-file change
                  opened this morning were the same row without them.
                */}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">
                    {[
                      showRepo ? row.repo : null,
                      sizeLabel(row.size),
                      ageLabel(row.updatedAt, now) || null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <CopyLink title={`${row.title} (#${row.number})`} url={row.url} />
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusCell row={row} />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {checksLabel(row.checks)}
                  </span>
                </span>
                <Review row={row} />
                <EvidenceList row={row} />
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
  now,
  starting,
  onWork,
  onOpen,
  onArchive,
}: {
  title: string;
  rows: Row[];
  showRepo: boolean;
  now: number;
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
        now={now}
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

  // Sampled once per render rather than read inside each row, so every age in
  // one paint is measured against the same instant.
  const now = Date.now();

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
            now={now}
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
