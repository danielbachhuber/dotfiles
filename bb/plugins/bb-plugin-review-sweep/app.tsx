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
  START_THREAD_LABEL,
  ageLabel,
  ageTone,
  displaySection,
  reviewersLabel,
  sizeLabel,
} from "./review/actions.js";
import type { rpcContract } from "./server.js";

type Row = {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  state: "first-look" | "re-review";
  requestedAt: number;
  lastReviewedAt: number | null;
  requestedReviewers: string[];
  size: { additions: number; deletions: number; changedFiles: number };
  canSpawn: boolean;
  threadId: string | null;
};

type Listing = {
  rows: Row[];
  sweptAt: number | null;
  truncated: boolean;
  lastError: string | null;
  staleAfterDays: number;
};

const STATE_LABELS: Record<Row["state"], string> = {
  "first-look": "first look",
  "re-review": "re-review",
};

const BADGE = "rounded-md px-1.5 py-0.5 text-xs font-medium";

/**
 * A shallow palette on purpose. Nothing in a review queue is an error, so the
 * loudest thing here is an overdue wait; a re-review is merely worth spotting,
 * because the author is blocked on you and it is usually the quickest to clear.
 */
const TONE_CLASSES = {
  quiet: "bg-muted text-muted-foreground",
  attention: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  stale: "bg-destructive/10 text-destructive",
} as const;

function useListing() {
  const rpc = useRpc<typeof rpcContract>();
  const [listing, setListing] = useState<Listing | null>(null);

  const load = useCallback(async () => {
    setListing((await rpc.call("listRows", null)) as Listing);
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("reviews-updated", () => {
    void load();
  });

  return { listing, reload: load, rpc };
}

/**
 * Three states, because a click that looks like nothing happened is what makes
 * someone click again: the action, an immediate "Starting…" while the thread is
 * created, then a link to the thread once one exists.
 */
function Action({
  row,
  isStarting,
  onReview,
  onOpen,
  onArchive,
}: {
  row: Row;
  isStarting: boolean;
  onReview: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
}) {
  if (row.threadId) {
    // Open thread stays the labelled action; archiving is the tidy-up, inline
    // as an icon rather than a second full-width button stacked below.
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
      </span>
    );
  }

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
        onClick={() => onReview(row)}
        className="whitespace-nowrap"
      >
        {isStarting ? "Starting…" : START_THREAD_LABEL}
      </Button>
    </span>
  );
}

/** Shared header cell styling, so every column is declared the same way. */
const HEAD = "text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground";

function ReviewTable({
  rows,
  showRepo,
  staleAfterDays,
  now,
  starting,
  onReview,
  onOpen,
  onArchive,
}: {
  rows: Row[];
  showRepo: boolean;
  staleAfterDays: number;
  now: number;
  starting: Set<string>;
  onReview: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/*
        table-fixed with an explicit width per column, so the section tables
        line up with each other. Auto layout sizes each table to its own
        contents, which pulls the columns out of step between sections.
      */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className={HEAD}>Title</TableHead>
            <TableHead className={`w-[7rem] ${HEAD}`}>Status</TableHead>
            <TableHead className={`w-[5.5rem] ${HEAD}`}>Age</TableHead>
            <TableHead className={`hidden w-[10rem] xl:table-cell ${HEAD}`}>Reviewers</TableHead>
            <TableHead className={`hidden w-[10rem] lg:table-cell ${HEAD}`}>Size</TableHead>
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
          {rows.map((row) => {
            const tone = ageTone(row.requestedAt, now, staleAfterDays);
            return (
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
                    The repository joins the line that was already here rather
                    than taking one above the title. Below, because the title is
                    what you scan for; on this line, because a second muted line
                    would cost a row of height to say one more thing.
                  */}
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">
                      {[showRepo ? row.repo : null, row.author, row.isDraft ? "draft" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <CopyLink title={`${row.title} (#${row.number})`} url={row.url} />
                  </span>
                </TableCell>
                <TableCell className="align-top">
                  <span
                    className={`${BADGE} ${
                      row.state === "re-review" ? TONE_CLASSES.attention : TONE_CLASSES.quiet
                    }`}
                  >
                    {STATE_LABELS[row.state]}
                  </span>
                </TableCell>
                <TableCell className="align-top text-xs tabular-nums">
                  <span className={tone === "stale" ? "text-destructive" : "text-muted-foreground"}>
                    {ageLabel(row.requestedAt, now)}
                  </span>
                </TableCell>
                {/*
                  Wraps rather than truncates, the same as pr-sweep's Review
                  column and for the same reason: these are team slugs, and
                  clipping one hides the part that says which team.
                */}
                <TableCell
                  className="hidden break-words align-top text-xs text-muted-foreground xl:table-cell"
                  title={reviewersLabel(row.requestedReviewers)}
                >
                  {reviewersLabel(row.requestedReviewers)}
                </TableCell>
                <TableCell className="hidden align-top text-xs tabular-nums text-muted-foreground lg:table-cell">
                  {sizeLabel(row.size)}
                </TableCell>
                <TableCell className="align-top text-right">
                  <Action
                    row={row}
                    isStarting={starting.has(`${row.repo}#${row.number}`)}
                    onReview={onReview}
                    onOpen={onOpen}
                    onArchive={onArchive}
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

function Section({
  title,
  rows,
  ...rest
}: {
  title: string;
  rows: Row[];
  showRepo: boolean;
  staleAfterDays: number;
  now: number;
  starting: Set<string>;
  onReview: (row: Row) => void;
  onOpen: (threadId: string) => void;
  onArchive: (row: Row) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {title} ({rows.length})
      </h2>
      <ReviewTable rows={rows} {...rest} />
    </section>
  );
}

/**
 * The empty state, drawn in the vernacular of the thing it is about.
 *
 * A tray, an inbox or a checkmark would say "nothing here" for any panel in
 * any product. A diff hunk header with zero ranges says it in the only
 * notation that means anything to someone who reviews code, and `-0,0` and
 * `+0,0` carry the colours git itself gives them.
 *
 * Type rather than an illustration on purpose: grey rounded bars are the
 * universal loading-skeleton idiom, so an SVG of an empty diff would read as
 * "still fetching" — the opposite of what this panel has to say.
 */
function NothingToReview() {
  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <p
        role="img"
        aria-label="An empty diff: zero lines removed, zero lines added"
        className="font-mono text-2xl tracking-tight text-muted-foreground/60 sm:text-3xl"
      >
        <span aria-hidden="true">@@ </span>
        <span aria-hidden="true" className="text-rose-500">
          -0,0
        </span>{" "}
        <span aria-hidden="true" className="text-emerald-500">
          +0,0
        </span>
        <span aria-hidden="true"> @@</span>
      </p>
      <div className="space-y-1">
        <p className="text-sm font-medium">Nothing to review.</p>
        <p className="text-xs text-muted-foreground">
          New requests appear here as they arrive.
        </p>
      </div>
    </div>
  );
}

function Panel() {
  const { listing, reload, rpc } = useListing();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<Set<string>>(() => new Set());

  // Sampled once per render rather than read inside each row, so every wait in
  // one paint is measured against the same instant.
  const now = Date.now();

  const onOpen = useCallback(
    (threadId: string) => {
      navigate.toThread(threadId);
    },
    [navigate],
  );

  const onReview = useCallback(
    (row: Row) => {
      const key = `${row.repo}#${row.number}`;
      // Mark it starting before awaiting anything, so the button changes on the
      // same tick as the click.
      setStarting((current) => new Set(current).add(key));

      void (async () => {
        try {
          const result = await rpc.call("reviewThis", { repo: row.repo, number: row.number });
          if (result.threadId) {
            if (!result.existing) toast.success(`Started a review thread for ${key}`);
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
        const result = await rpc.call("archiveThread", { repo: row.repo, number: row.number });
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
    listing.rows.filter((row) => displaySection(Boolean(row.threadId), row.isDraft) === section);

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
              The sweep hit GitHub's search ceiling, so this list may be incomplete.
            </p>
          ) : null}

          {listing.rows.length === 0 ? <NothingToReview /> : null}

          {DISPLAY_SECTIONS.map((section) => (
            <Section
              key={section}
              title={SECTION_TITLES[section]}
              rows={inSection(section)}
              showRepo={showRepo}
              staleAfterDays={listing.staleAfterDays}
              now={now}
              starting={starting}
              onReview={onReview}
              onOpen={onOpen}
              onArchive={onArchive}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

function NeedsReviewCount() {
  const { listing } = useListing();
  const count =
    listing?.rows.filter(
      (row) => displaySection(Boolean(row.threadId), row.isDraft) === "needs-review",
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
            <Icon name="Eye" className="size-3.5" />
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
    id: "reviews",
    title: "Reviews",
    icon: "Eye",
    path: "reviews",
    component: Panel,
    experimental_sidebarAccessory: NeedsReviewCount,
  });

  app.slots.experimental_threadHeaderAction({
    id: "open-reviewed-pull-request",
    title: "Open pull request",
    component: OpenPullRequest,
  });
});
