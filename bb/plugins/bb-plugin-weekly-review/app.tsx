// bb-plugin-weekly-review — the Weekly review page.
//
// Two halves, because the sources split that way. Everything with a date goes
// on the week spine, one section per day. Everything without one — assigned
// issues, the task backlog, the reference docs — goes in standing context
// underneath it, where it informs next week's priorities rather than
// pretending to be something that happened on Tuesday.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, UrlLink, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type {
  DocRef,
  Issue,
  Review,
  SourceResult,
  Task,
  WeekData,
} from "./review/types.js";
import type { DaySlice, PrEvent } from "./review/week.js";
import {
  buildDaySlices,
  hoursByCategory,
  isStale,
  splitBacklog,
  weekTotals,
  STALE_DAYS,
} from "./review/week.js";
import { formatDayLong, fromDay, toDay } from "./review/dates.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SourcesSection } from "./review/sources-section.js";

type Listing = {
  weeks: string[];
  currentWeek: string;
  previousWeek: string;
  missingSources: string[];
  weeksDir: string;
};

/* -------------------------------------------------------------------------- */
/* Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {title}
        {count === undefined ? null : (
          <span className="text-xs font-normal text-muted-foreground">{count}</span>
        )}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

/** A count with its label, sized so the number reads first. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li className={cn("flex items-start gap-2 py-1.5 text-sm", className)}>{children}</li>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card px-3">
      {children}
    </ul>
  );
}

/** `#123` linking out, kept narrow so titles line up. */
function Ref({ number, href }: { number: number; href: string }) {
  return (
    <UrlLink
      href={href}
      className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      #{number}
    </UrlLink>
  );
}

function relative(instant: string): string {
  const minutes = Math.round((Date.now() - new Date(instant).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* -------------------------------------------------------------------------- */
/* The week spine                                                             */
/* -------------------------------------------------------------------------- */

const PR_TONE: Record<PrEvent["kind"], string> = {
  merged: "border-transparent bg-primary/15 text-primary",
  opened: "border-border bg-transparent text-muted-foreground",
  closed: "border-transparent bg-destructive/15 text-destructive",
};

function PrRow({ event }: { event: PrEvent }) {
  const { pr, kind, openedSameDay } = event;
  return (
    <Row>
      <Badge className={cn("mt-0.5 shrink-0 text-[10px] uppercase", PR_TONE[kind])}>
        {openedSameDay ? `opened + ${kind}` : kind}
      </Badge>
      <Ref number={pr.number} href={pr.url} />
      <span className="min-w-0 flex-1">{pr.title}</span>
      {pr.isDraft ? (
        <span className="shrink-0 text-xs text-muted-foreground">draft</span>
      ) : null}
    </Row>
  );
}

function ReviewRow({ review }: { review: Review }) {
  return (
    <Row>
      <Icon name="Check" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <Ref number={review.number} href={review.url} />
      <span className="min-w-0 flex-1">{review.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{review.author}</span>
    </Row>
  );
}

function IssueRow({ issue, note }: { issue: Issue; note?: ReactNode }) {
  return (
    <Row>
      <Ref number={issue.number} href={issue.url} />
      <span className="min-w-0 flex-1">{issue.title}</span>
      {note}
    </Row>
  );
}

function DaySection({ slice }: { slice: DaySlice }) {
  if (slice.empty) return null;
  return (
    <section className="mt-4 border-t border-border pt-4 first:border-t-0">
      <h3 className="flex items-baseline justify-between text-sm font-semibold text-foreground">
        {formatDayLong(slice.day)}
        {slice.hours > 0 ? (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {slice.hours}h
          </span>
        ) : null}
      </h3>

      {slice.reflect.length === 0 ? null : (
        <div className="mt-2 space-y-2">
          {slice.reflect.map((note, index) => (
            <div
              key={index}
              className="rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm"
            >
              <div className="text-xs font-medium text-muted-foreground">{note.title}</div>
              <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
            </div>
          ))}
        </div>
      )}

      {slice.harvest.length === 0 ? null : (
        <ul className="mt-2 text-sm">
          {slice.harvest.map((entry, index) => (
            <Row key={index} className="py-1">
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {entry.hours}h
              </span>
              <span className="shrink-0 font-medium">{entry.task}</span>
              {entry.notes === "" ? null : (
                <span className="min-w-0 flex-1 text-muted-foreground">{entry.notes}</span>
              )}
            </Row>
          ))}
        </ul>
      )}

      {slice.prEvents.length === 0 ? null : (
        <ul className="mt-2">
          {slice.prEvents.map((event, index) => (
            <PrRow key={`${event.pr.number}-${event.kind}-${index}`} event={event} />
          ))}
        </ul>
      )}

      {slice.reviews.length === 0 ? null : (
        <ul className="mt-2">
          {slice.reviews.map((review) => (
            <ReviewRow key={review.number} review={review} />
          ))}
        </ul>
      )}

      {slice.issuesCreated.length === 0 ? null : (
        <ul className="mt-2">
          {slice.issuesCreated.map((issue) => (
            <IssueRow key={issue.number} issue={issue} />
          ))}
        </ul>
      )}

      {slice.slack.length === 0 ? null : (
        <ul className="mt-2">
          {slice.slack.map((thread, index) => (
            <Row key={index}>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                #{thread.channel}
              </span>
              <span className="min-w-0 flex-1">{thread.summary}</span>
              {thread.permalink === undefined ? null : (
                <UrlLink href={thread.permalink} className="shrink-0">
                  <Icon name="ExternalLink" className="size-3.5 text-muted-foreground" />
                </UrlLink>
              )}
            </Row>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Standing context                                                           */
/* -------------------------------------------------------------------------- */

function TaskRow({ task }: { task: Task }) {
  return (
    <Row>
      {task.url === "" ? (
        <span className="min-w-0 flex-1">{task.content}</span>
      ) : (
        <UrlLink href={task.url} className="min-w-0 flex-1 hover:underline">
          {task.content}
        </UrlLink>
      )}
      {task.dueString === null ? null : (
        <span className="shrink-0 text-xs text-muted-foreground">{task.dueString}</span>
      )}
    </Row>
  );
}

function DocRow({ doc, dir }: { doc: DocRef; dir: string }) {
  return (
    <Row>
      <Icon name="FileText" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <UrlLink href={doc.url} className="min-w-0 flex-1 hover:underline">
        {doc.label}
      </UrlLink>
      {doc.error === undefined ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {dir}/{doc.cachedPath}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-destructive">not cached</span>
      )}
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* Source status                                                              */
/* -------------------------------------------------------------------------- */

function SourceFooter({ week }: { week: WeekData }) {
  const sources: Array<[string, SourceResult<unknown> | undefined]> = [
    ["Harvest", week.harvest],
    ["GitHub", week.github],
    ["Todoist", week.todoist],
    ["Docs", week.docs],
    ["Slack", week.slack],
    ["Reflect", week.reflect],
  ];
  return (
    <div className="mt-8 border-t border-border pt-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {sources.map(([name, source]) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                source === undefined
                  ? "bg-muted-foreground/40"
                  : source.ok
                    ? "bg-primary"
                    : "bg-destructive",
              )}
            />
            {name}
            {source === undefined ? " — not gathered" : source.ok ? "" : ` — ${source.error}`}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/** `2026-08-31` → `Aug 31 – Sep 6`. */
function weekLabel(monday: string, listing: Listing | null): string {
  const start = fromDay(monday);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const short = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const suffix =
    listing === null
      ? ""
      : monday === listing.currentWeek
        ? "  ·  this week"
        : monday === listing.previousWeek
          ? "  ·  last week"
          : "";
  return `${short(start)} – ${short(end)}${suffix}`;
}

function WeeklyReviewPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [week, setWeek] = useState<WeekData | null>(null);
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetchListing = useCallback(() => {
    rpc.call("weeks_list", null).then((next) => {
      setListing(next);
      setError(null);
      // Land on the newest week that exists; failing that, the current one,
      // which the empty state then offers to generate.
      setSelected((current) => current ?? next.weeks[0] ?? next.currentWeek);
    }, report);
  }, [rpc, report]);

  useEffect(refetchListing, [refetchListing]);
  useRealtime("week-generated", refetchListing);

  useEffect(() => {
    if (selected === null) return;
    let live = true;
    setLoading(true);
    rpc.call("week_get", { monday: selected }).then(
      (result) => {
        if (!live) return;
        setWeek(result.week);
        setDir(result.dir);
        setLoading(false);
      },
      (cause) => {
        if (!live) return;
        report(cause);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [rpc, selected, report]);

  const generate = async () => {
    if (selected === null || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await rpc.call("week_generate", { from: selected });
      const failed = result.sources.filter((source) => !source.ok);
      if (failed.length > 0) {
        setError(
          `${failed.map((source) => `${source.name}: ${source.error}`).join("; ")}`,
        );
      }
      const fresh = await rpc.call("week_get", { monday: result.monday });
      setWeek(fresh.week);
      setDir(fresh.dir);
      refetchListing();
    } catch (cause) {
      report(cause);
    } finally {
      setGenerating(false);
    }
  };

  // Weeks that exist, plus this week and last week even when they don't, so
  // generating either one is a selection rather than a date to work out.
  const options = useMemo(() => {
    if (listing === null) return [];
    const all = new Set([...listing.weeks, listing.currentWeek, listing.previousWeek]);
    return [...all].sort().reverse();
  }, [listing]);

  const slices = useMemo(() => (week === null ? [] : buildDaySlices(week)), [week]);
  const totals = useMemo(
    () => (week === null ? null : weekTotals(week, slices)),
    [week, slices],
  );
  const categories = useMemo(
    () => (week === null ? [] : hoursByCategory(week.harvest.data)),
    [week],
  );
  const backlog = useMemo(
    () =>
      week === null
        ? null
        : splitBacklog(week.todoist.data.incomplete, toDay(new Date())),
    [week],
  );

  const today = toDay(new Date());
  const assigned = week?.github.data.issuesAssigned ?? [];
  const populated = slices.filter((slice) => !slice.empty);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-16 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selected ?? undefined}
            onValueChange={(value) => {
              setSelected(value);
              setError(null);
            }}
          >
            <SelectTrigger className="w-64" aria-label="Week">
              <SelectValue placeholder="Choose a week" />
            </SelectTrigger>
            <SelectContent>
              {options.map((monday) => (
                <SelectItem key={monday} value={monday}>
                  {weekLabel(monday, listing)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={generate} disabled={generating || selected === null}>
            <Icon
              name={generating ? "Spinner" : "ArrowReloadHorizontal"}
              className={cn("size-4", generating && "animate-spin")}
            />
            {week === null ? "Generate" : "Regenerate"}
          </Button>

          {week === null ? null : (
            <span className="text-xs text-muted-foreground">
              {week.from} – {week.to} · gathered {relative(week.generatedAt)}
            </span>
          )}
        </div>

        {listing !== null && listing.missingSources.length > 0 ? (
          <p role="alert" className="mt-3 text-sm text-muted-foreground">
            Set {listing.missingSources.join(" and ")} in this plugin's settings before
            gathering a week.
          </p>
        ) : null}

        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && week === null ? (
          <div className="mt-4">
            <EmptyState>Loading…</EmptyState>
          </div>
        ) : week === null ? (
          <div className="mt-4">
            <EmptyState>
              Nothing gathered for this week yet. Generate it, or run{" "}
              <code>bb weekly-review generate {selected ?? ""}</code>.
            </EmptyState>
          </div>
        ) : (
          <>
            {totals === null ? null : (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="Hours" value={totals.hours} />
                <Stat label="PRs opened" value={totals.prsOpened} />
                <Stat label="PRs merged" value={totals.prsMerged} />
                <Stat label="Reviews" value={totals.reviews} />
                <Stat label="Issues filed" value={totals.issuesCreated} />
                <Stat label="Tasks done" value={totals.tasksCompleted} />
              </div>
            )}

            {categories.length === 0 ? null : (
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {categories.map((category) => (
                  <span key={category.task}>
                    <span className="tabular-nums text-foreground">{category.hours}h</span>{" "}
                    {category.task}
                  </span>
                ))}
              </p>
            )}

            <Section title="The week">
              {populated.length === 0 ? (
                <EmptyState>No dated activity in this range.</EmptyState>
              ) : (
                <div>
                  {slices.map((slice) => (
                    <DaySection key={slice.day} slice={slice} />
                  ))}
                </div>
              )}
            </Section>

            {week.todoist.data.completed.length === 0 ? null : (
              <Section title="Tasks completed" count={week.todoist.data.completed.length}>
                {/* Todoist exposes no completion timestamp, so these sit at week
                    level rather than on a day. */}
                <List>
                  {week.todoist.data.completed.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </List>
              </Section>
            )}

            {assigned.length === 0 ? null : (
              <Section title="Assigned to me" count={assigned.length}>
                <List>
                  {assigned.map((issue) => (
                    <IssueRow
                      key={issue.number}
                      issue={issue}
                      note={
                        isStale(issue, today) ? (
                          <span className="shrink-0 text-xs text-destructive">
                            untouched {STALE_DAYS}d+
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </List>
              </Section>
            )}

            {backlog === null || backlog.overdue.length + backlog.upcoming.length === 0 ? null : (
              <Section
                title="Backlog"
                count={backlog.overdue.length + backlog.upcoming.length}
              >
                <List>
                  {[...backlog.overdue, ...backlog.upcoming].map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </List>
              </Section>
            )}

            {week.docs.data.length === 0 ? null : (
              <Section title="Reference docs" count={week.docs.data.length}>
                <List>
                  {week.docs.data.map((doc) => (
                    <DocRow key={doc.id} doc={doc} dir={dir} />
                  ))}
                </List>
              </Section>
            )}

            <SourceFooter week={week} />
          </>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "sources",
    title: "Sources",
    description: "What a week is gathered from. Held in this plugin's database, not in a file.",
    component: SourcesSection,
  });

  app.slots.navPanel({
    id: "weekly-review",
    title: "Weekly review",
    icon: "Calendar",
    path: "weekly-review",
    component: WeeklyReviewPage,
  });
});
