import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
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

type Row = {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  commentsCount: number;
};

type Listing = {
  rows: Row[];
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

/** Shared header cell styling, so every column is declared the same way. */
const HEAD = "text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground";

function IssueTable({ rows, showRepo }: { rows: Row[]; showRepo: boolean }) {
  // One clock for the whole render, so two rows updated a second apart never
  // disagree about what "now" is.
  const now = Date.now();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className={HEAD}>Title</TableHead>
            <TableHead className={`hidden w-[14rem] lg:table-cell ${HEAD}`}>Labels</TableHead>
            <TableHead className={`w-[7rem] ${HEAD}`}>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const comments = commentsLabel(row.commentsCount);
            return (
              <TableRow key={`${row.repo}#${row.number}`}>
                <TableCell className="align-top">
                  {showRepo ? (
                    <span className="block truncate text-xs text-muted-foreground">{row.repo}</span>
                  ) : null}
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
                </TableCell>
                <TableCell className="hidden align-top lg:table-cell">
                  {row.labels.length ? (
                    <span className="flex flex-wrap items-center gap-1">
                      {row.labels.map((label) => (
                        <span key={label} className={BADGE}>
                          {label}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  <span
                    className="block whitespace-nowrap"
                    title={new Date(row.updatedAt).toLocaleString()}
                  >
                    {relativeTime(row.updatedAt, now)}
                  </span>
                  {comments ? <span className="block whitespace-nowrap">{comments}</span> : null}
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
          <IssueTable rows={listing.rows} showRepo={showRepo} />
        )}
      </div>
    </div>
  );
}

function AssignedCount() {
  const { listing } = useListing();
  const count = listing?.rows.length ?? 0;
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
