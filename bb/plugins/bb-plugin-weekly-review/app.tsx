// bb-plugin-weekly-review — the Weekly review page.
//
// Two halves, because the sources split that way. Everything with a date goes
// on the week spine, one section per day. Everything without one — assigned
// issues, the task backlog, the reference docs — goes in standing context
// underneath it, where it informs next week's priorities rather than
// pretending to be something that happened on Tuesday.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  UrlLink,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
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
  isStale,
  splitBacklog,
  weekTotals,
  STALE_DAYS,
} from "./review/week.js";
import { formatDayLong, fromDay, toDay } from "./review/dates.js";
import type { BodyOfWork, Interpretation, NextItem } from "./review/interpretation.js";
import type { CategoryHours, RefKind, WorkItem } from "./review/overview.js";
import { attributeTime, categories as timeCategories, inFlight } from "./review/overview.js";
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
import { PromptSection } from "./review/prompt-section.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";

type WeekSummary = { monday: string; to: string; generatedAt: string };

type Listing = {
  weeks: WeekSummary[];
  currentWeek: string;
  previousWeek: string;
  missingSources: string[];
  weeksDir: string;
};

/** The panel's route segment, and the prefix its deep links are built on. */
const PANEL_PATH = "weekly-review";
const MONDAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The listing, shared by the title bar and the body. They mount separately, so
 * each runs its own copy rather than passing one down; both refetch on the
 * server's signal, so they cannot disagree for long.
 */
function useListing() {
  const rpc = useRpc<typeof rpcContract>();
  const [listing, setListing] = useState<Listing | null>(null);
  const refetch = useCallback(() => {
    rpc.call("weeks_list", null).then(setListing, () => undefined);
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("week-generated", refetch);
  return { listing, refetch };
}

/**
 * Which week the page is showing. The route holds it, so a week is linkable
 * and the back button walks the weeks you looked at. An empty or unparseable
 * subPath falls back to the newest gathered week, then to the current one,
 * which the empty state offers to gather.
 */
function selectedWeek(subPath: string, listing: Listing | null): string | null {
  const fromRoute = subPath.split("/")[0];
  if (MONDAY.test(fromRoute)) return fromRoute;
  if (listing === null) return null;
  return listing.weeks[0]?.monday ?? listing.currentWeek;
}

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
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

const REF_KIND_LABEL: Record<RefKind, string> = {
  authored: "pull request",
  reviewed: "reviewed",
  "issue-filed": "issue you filed",
  "issue-assigned": "assigned to you",
  unknown: "outside this week",
};

/**
 * Where the logged time went, by category, largest first. Text rather than a
 * bar: the ratio between the top two categories is the thing worth reading,
 * and two numbers side by side say it more precisely than two widths.
 */
function TimeBreakdown({
  categories,
  attributed,
  total,
}: {
  categories: CategoryHours[];
  attributed: number;
  total: number;
}) {
  if (categories.length === 0) return <EmptyState>No time logged this week.</EmptyState>;
  return (
    <div>
      <ul className="overflow-hidden rounded-lg border border-border bg-card px-3">
        {categories.map((category) => (
          <li
            key={category.task}
            className="flex items-baseline gap-3 py-1.5 text-sm tabular-nums"
          >
            <span className="w-14 shrink-0 text-right font-medium">
              {category.hours.toFixed(1)}h
            </span>
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
              {Math.round(category.share * 100)}%
            </span>
            <span className="min-w-0 flex-1 font-sans">{category.task}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {attributed.toFixed(1)}h of {total.toFixed(1)}h named a specific issue or pull
        request. The rest is logged to a category only.
      </p>
    </div>
  );
}

/**
 * Every number the week knows about, so an interpretation's `refs` can become
 * links. A number the week has never heard of is dropped rather than linked to
 * a guess at its URL.
 */
function urlsByNumber(week: WeekData): Map<number, string> {
  const github = week.github.data;
  const urls = new Map<number, string>();
  for (const group of [
    github.authored,
    github.issuesCreated,
    github.issuesAssigned,
    github.reviewed,
  ]) {
    for (const item of group) if (!urls.has(item.number)) urls.set(item.number, item.url);
  }
  return urls;
}

const STATUS_TONE: Record<BodyOfWork["status"], string> = {
  shipped: "border-transparent bg-primary/15 text-primary",
  "in progress": "border-border bg-transparent text-muted-foreground",
  blocked: "border-transparent bg-destructive/15 text-destructive",
  abandoned: "border-transparent bg-muted text-muted-foreground",
};

function RefLinks({ refs, urls }: { refs: number[]; urls: Map<number, string> }) {
  const linkable = refs.filter((ref) => urls.has(ref));
  if (linkable.length === 0) return null;
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
      {linkable.map((ref) => (
        <Ref key={ref} number={ref} href={urls.get(ref) as string} />
      ))}
    </p>
  );
}

function BodyOfWorkCard({
  body,
  urls,
}: {
  body: BodyOfWork;
  urls: Map<number, string>;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{body.title}</span>
        {body.hours === undefined ? null : (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {body.hours.toFixed(1)}h
          </span>
        )}
        <Badge className={cn("shrink-0 text-[10px] uppercase", STATUS_TONE[body.status])}>
          {body.status}
        </Badge>
      </div>
      {body.detail === "" ? null : (
        <p className="mt-1 text-sm text-muted-foreground">{body.detail}</p>
      )}
      <RefLinks refs={body.refs} urls={urls} />
    </li>
  );
}

function NextCard({ item, urls }: { item: NextItem; urls: Map<number, string> }) {
  return (
    <li className="py-2.5">
      <div className="text-sm font-medium">{item.title}</div>
      {item.why === "" ? null : (
        <p className="mt-1 text-sm text-muted-foreground">{item.why}</p>
      )}
      <RefLinks refs={item.refs} urls={urls} />
    </li>
  );
}

/** The hours that landed on something with a number, most first. */
function WorkItemRow({ item }: { item: WorkItem }) {
  return (
    <Row>
      <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
        {item.hours.toFixed(1)}h
      </span>
      {item.url === "" ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          #{item.number}
        </span>
      ) : (
        <Ref number={item.number} href={item.url} />
      )}
      <span className="min-w-0 flex-1">{item.title}</span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {REF_KIND_LABEL[item.kind]}
      </span>
    </Row>
  );
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

/**
 * The title bar: which week, regenerating it, and how fresh it is.
 *
 * Mounted separately from the body, so the two share the route rather than
 * React state. That is what makes a week linkable, and it means the browser's
 * back button walks the weeks you looked at.
 */
function WeeklyReviewHeader({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const compact = useIsCompactViewport();
  const { listing, refetch } = useListing();
  const [generating, setGenerating] = useState(false);

  const selected = selectedWeek(subPath, listing);
  const summary = listing?.weeks.find((week) => week.monday === selected) ?? null;

  // Weeks that exist, plus this week and last week even when they don't, so
  // generating either one is a selection rather than a date to work out.
  const options = useMemo(() => {
    if (listing === null) return [];
    const all = new Set([
      ...listing.weeks.map((week) => week.monday),
      listing.currentWeek,
      listing.previousWeek,
    ]);
    return [...all].sort().reverse();
  }, [listing]);

  const generate = async () => {
    if (selected === null || generating) return;
    setGenerating(true);
    try {
      const result = await rpc.call("week_generate", { from: selected });
      const failed = result.sources.filter((source) => !source.ok);
      // Raised here rather than in the body: a source that failed is a fact
      // about this run, and the body still has everything the others produced.
      if (failed.length === 0) {
        toast.success(`Gathered ${result.monday}`);
      } else {
        toast.warning(`${failed.map((source) => source.name).join(", ")} not gathered`, {
          description: failed.map((source) => source.error).join("; "),
        });
      }
      refetch();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {compact || summary === null ? null : (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          gathered {relative(summary.generatedAt)}
        </span>
      )}

      <Select
        value={selected ?? undefined}
        onValueChange={(value) => navigate.toPluginPanel(PANEL_PATH, { subPath: value })}
      >
        <SelectTrigger className="h-7 w-52" aria-label="Week">
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

      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={generate}
        disabled={generating || selected === null}
        aria-label={summary === null ? "Generate this week" : "Regenerate this week"}
      >
        <Icon
          name={generating ? "Spinner" : "ArrowReloadHorizontal"}
          className={cn("size-3.5", generating && "animate-spin")}
        />
        {compact ? null : summary === null ? "Generate" : "Regenerate"}
      </Button>
    </div>
  );
}

function WeeklyReviewPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { listing } = useListing();
  const [week, setWeek] = useState<WeekData | null>(null);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [interpreting, setInterpreting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const selected = selectedWeek(subPath, listing);
  // Part of the effect's key, so a regenerate in the title bar pulls the new
  // week down here without the two components having to know about each other.
  const generatedAt =
    listing?.weeks.find((summary) => summary.monday === selected)?.generatedAt ?? null;

  useEffect(() => {
    if (selected === null) return;
    let live = true;
    setLoading(true);
    rpc.call("week_get", { monday: selected }).then(
      (result) => {
        if (!live) return;
        setWeek(result.week);
        setInterpretation(result.interpretation);
        setDir(result.dir);
        setError(null);
        setLoading(false);
      },
      (cause) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [rpc, selected, generatedAt, reload]);

  // The agent records its reading through the CLI, so the page hears about it
  // the same way it hears about anything else: over the signal.
  useRealtime("week-interpreted", () => setReload((count) => count + 1));

  const askForInterpretation = async () => {
    if (selected === null || interpreting) return;
    setInterpreting(true);
    try {
      const { threadId } = await rpc.call("week_interpret", { monday: selected });
      toast.success("Reading the week", {
        description: `Thread ${threadId} is interpreting it; the overview appears here when it lands.`,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInterpreting(false);
    }
  };

  const slices = useMemo(() => (week === null ? [] : buildDaySlices(week)), [week]);
  const totals = useMemo(
    () => (week === null ? null : weekTotals(week, slices)),
    [week, slices],
  );
  const categories = useMemo(
    () => (week === null ? [] : timeCategories(week.harvest.data)),
    [week],
  );
  const time = useMemo(() => (week === null ? null : attributeTime(week)), [week]);
  const flight = useMemo(() => (week === null ? null : inFlight(week)), [week]);
  const backlog = useMemo(
    () =>
      week === null
        ? null
        : splitBacklog(week.todoist.data.incomplete, toDay(new Date())),
    [week],
  );

  const urls = useMemo(() => (week === null ? new Map<number, string>() : urlsByNumber(week)), [week]);
  const today = toDay(new Date());
  const assigned = week?.github.data.issuesAssigned ?? [];
  const populated = slices.filter((slice) => !slice.empty);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-16 pt-3 md:px-5 md:pt-4">
        {listing !== null && listing.missingSources.length > 0 ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Set {listing.missingSources.join(" and ")} in this plugin's settings before
            gathering a week.
          </p>
        ) : null}

        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && week === null ? (
          <EmptyState>Loading…</EmptyState>
        ) : week === null ? (
          <div>
            <EmptyState>
              Nothing gathered for this week yet. Generate it, or run{" "}
              <code>bb weekly-review generate {selected ?? ""}</code>.
            </EmptyState>
          </div>
        ) : (
          <>
            {interpretation === null ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Nothing has read this week yet. An agent can group the work into threads
                  and say where next week should go.
                </p>
                <Button
                  variant="outline"
                  onClick={askForInterpretation}
                  disabled={interpreting}
                >
                  <Icon
                    name={interpreting ? "Spinner" : "Zap"}
                    className={cn("size-4", interpreting && "animate-spin")}
                  />
                  Interpret
                </Button>
              </div>
            ) : (
              <p className="mb-4 text-sm leading-relaxed">{interpretation.summary}</p>
            )}

            {totals === null ? null : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Stat label="Hours" value={totals.hours} />
                <Stat label="PRs opened" value={totals.prsOpened} />
                <Stat label="PRs merged" value={totals.prsMerged} />
                <Stat label="Reviews" value={totals.reviews} />
                <Stat label="Issues filed" value={totals.issuesCreated} />
                <Stat label="Tasks done" value={totals.tasksCompleted} />
              </div>
            )}

            <p className="mt-2 text-xs text-muted-foreground">
              {week.from} – {week.to}
            </p>

            {interpretation === null || interpretation.bodiesOfWork.length === 0 ? null : (
              <Section title="Bodies of work" count={interpretation.bodiesOfWork.length}>
                <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card px-3">
                  {interpretation.bodiesOfWork.map((body, index) => (
                    <BodyOfWorkCard key={index} body={body} urls={urls} />
                  ))}
                </ul>
              </Section>
            )}

            {interpretation === null || interpretation.next.length === 0 ? null : (
              <Section title="Where next week should go" count={interpretation.next.length}>
                <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card px-3">
                  {interpretation.next.map((item, index) => (
                    <NextCard key={index} item={item} urls={urls} />
                  ))}
                </ul>
              </Section>
            )}

            {time === null ? null : (
              <Section title="Where the time went">
                <TimeBreakdown
                  categories={categories}
                  attributed={time.attributed}
                  total={time.total}
                />
              </Section>
            )}

            {time === null || time.items.length === 0 ? null : (
              <Section title="What the hours went into" count={time.items.length}>
                <List>
                  {time.items.map((item) => (
                    <WorkItemRow key={item.number} item={item} />
                  ))}
                </List>
              </Section>
            )}

            {flight === null || flight.openPullRequests.length === 0 ? null : (
              <Section
                title="Still open from this week"
                count={flight.openPullRequests.length}
              >
                <List>
                  {flight.openPullRequests.map((pr) => (
                    <Row key={pr.number}>
                      <Ref number={pr.number} href={pr.url} />
                      <span className="min-w-0 flex-1">{pr.title}</span>
                      {pr.isDraft ? (
                        <span className="shrink-0 text-xs text-muted-foreground">draft</span>
                      ) : null}
                    </Row>
                  ))}
                </List>
              </Section>
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

            {interpretation === null ? null : (
              <div className="mt-8 flex items-center gap-3 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">
                  Read{" "}
                  {interpretation.interpretedAt === undefined
                    ? "at an unknown time"
                    : relative(interpretation.interpretedAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={askForInterpretation}
                  disabled={interpreting}
                >
                  <Icon
                    name={interpreting ? "Spinner" : "Zap"}
                    className={cn("size-3.5", interpreting && "animate-spin")}
                  />
                  Read it again
                </Button>
              </div>
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

  app.slots.settingsSection({
    id: "prompt",
    title: "Interpretation prompt",
    description: "What the agent is asked when it reads a week.",
    component: PromptSection,
  });

  app.slots.navPanel({
    id: "weekly-review",
    title: "Weekly review",
    icon: "Calendar",
    path: PANEL_PATH,
    component: WeeklyReviewPage,
    headerContent: WeeklyReviewHeader,
  });
});
