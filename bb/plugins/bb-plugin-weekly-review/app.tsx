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
import type { SourceResult, WeekData } from "./review/types.js";
import { buildDaySlices, weekTotals } from "./review/week.js";
import { formatDayShort, fromDay } from "./review/dates.js";
import type { Feedback } from "./review/agents.js";
import type { TimeEntry } from "./review/time-sections.js";
import type { Theme } from "./review/themes.js";
import { buildThemes } from "./review/themes.js";
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

/**
 * Every number the week knows about, so an interpretation's `refs` and a time
 * entry's `#1234` can become links. A number the week has never heard of is
 * left unlinked rather than pointed at a guess.
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

type WeekEntry = { heading: string; text: string; url: string };

type MeetingNote = {
  day: string;
  entryNote: string;
  source: "doc" | "notes";
  label: string;
  url: string;
  heading: string;
  text: string;
};

/**
 * That the entry has been checked, and how much came back — nothing more.
 *
 * The findings themselves live in the thread, which is where they are useful:
 * an assessment is worth arguing with while the entry is being rewritten, and
 * a page cannot be argued with. This is the indication that there is something
 * to go and read.
 */
function FeedbackSummary({
  feedback,
  entry,
}: {
  feedback: Feedback;
  entry: WeekEntry | null;
}) {
  const stale =
    entry !== null &&
    feedback.entryHeading !== undefined &&
    feedback.entryHeading !== entry.heading;
  const counts = [
    feedback.missing.length === 0 ? null : `${feedback.missing.length} not in the entry`,
    feedback.expand.length === 0 ? null : `${feedback.expand.length} worth more detail`,
  ].filter((part): part is string => part !== null);

  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
      Checked{" "}
      {feedback.reviewedAt === undefined ? "at an unknown time" : relative(feedback.reviewedAt)}
      {counts.length === 0 ? " — nothing flagged" : ` — ${counts.join(", ")}`}. In the thread.
      {stale ? (
        <span className="ml-1 text-destructive">
          Given on "{feedback.entryHeading}", and the doc now shows "{entry.heading}".
        </span>
      ) : null}
    </div>
  );
}

/** A theme's anchor, so the summary above can jump to it. */
function themeAnchor(title: string): string {
  return `theme-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/**
 * The themes at a glance, before any of them is read in detail.
 *
 * Twelve themes is more than fits on a screen once each one has its days
 * underneath, so the shape of the week — which three things took half of it —
 * is otherwise only visible by scrolling and adding up. Each row jumps to its
 * section.
 */
function ThemeSummary({ themes, total }: { themes: Theme[]; total: number }) {
  const jump = (title: string) => {
    document.getElementById(themeAnchor(title))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  return (
    <ul className="mt-2 overflow-hidden rounded-lg border border-border bg-card px-3">
      {themes.map((theme) => (
        <li key={theme.title} className="border-t border-border/60 first:border-t-0">
          <button
            type="button"
            onClick={() => jump(theme.title)}
            // The row is a jump link, and only the title says so on hover:
            // underlining the whole row would drag the hours and the counts
            // into the affordance.
            className="group flex w-full items-baseline gap-3 py-1.5 text-left text-sm"
          >
            <span className="w-14 shrink-0 text-right font-medium tabular-nums">
              {theme.hours.toFixed(2)}h
            </span>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {total === 0 ? "" : `${Math.round((theme.hours / total) * 100)}%`}
            </span>
            <span className="min-w-0 flex-1 truncate underline-offset-2 group-hover:underline">
              {theme.title}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {theme.days.length}d · {theme.entryCount}{" "}
              {theme.entryCount === 1 ? "entry" : "entries"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A theme: what the work was about, day by day.
 *
 * Each day carries its own total, and each entry under it says how long, what
 * kind of time it was booked as, and what it was — plus the notes taken in it,
 * when there are any. A theme routinely crosses categories, which is the whole
 * reason it is not the categories being shown: "Architecture Talk" was
 * meetings, admin and planning, and reading it as three numbers on three lists
 * loses that it was one piece of work.
 */
function ThemeBlock({
  theme,
  urls,
  notesFor,
}: {
  theme: Theme;
  urls: Map<number, string>;
  notesFor: (entry: TimeEntry) => MeetingNote[];
}) {
  return (
    <section className="mt-6 scroll-mt-3" id={themeAnchor(theme.title)}>
      <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
        <span className="min-w-0 flex-1">{theme.title}</span>
        <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
          {theme.hours.toFixed(2)}h
        </span>
      </h2>

      {theme.tasks.length <= 1 ? null : (
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {theme.tasks.map((task) => (
            <span key={task.task}>
              <span className="tabular-nums">{task.hours.toFixed(2)}h</span> {task.task}
            </span>
          ))}
        </p>
      )}

      <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
        {theme.days.map((day) => (
          <div key={day.day} className="border-t border-border/60 px-3 py-2 first:border-t-0">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-foreground">{formatDayShort(day.day)}</span>
              <span className="tabular-nums text-muted-foreground">
                {day.hours.toFixed(2)}h
              </span>
            </div>
            <ul className="mt-1">
              {day.entries.map((entry, index) => (
                <ThemeEntryRow
                  key={`${entry.day}-${index}`}
                  entry={entry}
                  url={entry.reference === null ? undefined : urls.get(entry.reference)}
                  notes={notesFor(entry)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One entry inside a theme's day: how long, what kind, and what it was. */
function ThemeEntryRow({
  entry,
  url,
  notes,
}: {
  entry: TimeEntry;
  url: string | undefined;
  notes: MeetingNote[];
}) {
  return (
    <li className="py-1 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
          {entry.hours.toFixed(2)}h
        </span>
        <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
          {entry.task}
        </span>
        {entry.reference === null ? null : url === undefined ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            #{entry.reference}
          </span>
        ) : (
          <Ref number={entry.reference} href={url} />
        )}
        <span
          className={cn(
            "min-w-0 flex-1",
            entry.label === "" && "italic text-muted-foreground",
          )}
        >
          {entry.label === "" ? "no note" : entry.label}
        </span>
      </div>

      {notes.map((note, index) => {
        const attribution =
          note.heading === "" ? note.label : `${note.label} · ${note.heading}`;
        return (
          <div key={index} className="ml-14 mt-1.5 border-l-2 border-border pl-3">
            {note.url === "" ? (
              <span className="text-xs text-muted-foreground">{attribution}</span>
            ) : (
              <UrlLink
                href={note.url}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {attribution}
              </UrlLink>
            )}
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {note.text}
            </p>
          </div>
        );
      })}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* The week spine                                                             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Standing context                                                           */
/* -------------------------------------------------------------------------- */

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
  const navigate = useBbNavigate();
  const { listing } = useListing();
  const [week, setWeek] = useState<WeekData | null>(null);
  const [meetingNotes, setMeetingNotes] = useState<MeetingNote[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [threads, setThreads] = useState<Partial<Record<string, string>>>({});
  const [entry, setEntry] = useState<WeekEntry | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gatheringNotes, setGatheringNotes] = useState(false);
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
        setMeetingNotes(result.meetingNotes);
        setFeedback(result.feedback);
        setThreads(result.threads);
        setEntry(result.entry);
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
  useRealtime("week-reviewed", () => setReload((count) => count + 1));

  const askForNotes = async () => {
    if (selected === null || gatheringNotes) return;
    setGatheringNotes(true);
    try {
      const { threadId } = await rpc.call("week_gather_notes", { monday: selected });
      setThreads((current) => ({ ...current, notes: threadId }));
      navigate.toThread(threadId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGatheringNotes(false);
    }
  };

  const askForFeedback = async () => {
    if (selected === null || reviewing) return;
    setReviewing(true);
    try {
      const { threadId } = await rpc.call("week_feedback", { monday: selected });
      setThreads((current) => ({ ...current, feedback: threadId }));
      // Straight into the thread. The assessment is a conversation to have
      // while the entry is being rewritten, not a report to receive, and this
      // page is where it started rather than where it belongs.
      navigate.toThread(threadId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
      setReviewing(false);
    }
  };

  const slices = useMemo(() => (week === null ? [] : buildDaySlices(week)), [week]);
  const totals = useMemo(
    () => (week === null ? null : weekTotals(week, slices)),
    [week, slices],
  );
  // Themes, not Harvest categories: the notes already say what the work was
  // about, and no model is needed to read them.
  const grouping = useMemo(() => (week === null ? null : buildThemes(week)), [week]);

  const urls = useMemo(
    () => (week === null ? new Map<number, string>() : urlsByNumber(week)),
    [week],
  );
  const notesByEntry = useMemo(() => {
    const index = new Map<string, MeetingNote[]>();
    for (const note of meetingNotes) {
      const key = `${note.day}\u0000${note.entryNote}`;
      const existing = index.get(key);
      if (existing === undefined) index.set(key, [note]);
      else existing.push(note);
    }
    return index;
  }, [meetingNotes]);
  const EMPTY: MeetingNote[] = useMemo(() => [], []);
  // Only entries that named no issue or pull request are ever matched, so a
  // stripped label is the same string the server keyed on.
  const notesFor = useCallback(
    (entry: TimeEntry) => notesByEntry.get(`${entry.day}\u0000${entry.label}`) ?? EMPTY,
    [notesByEntry, EMPTY],
  );
  const hasNotes = (week?.reflect?.data.length ?? 0) > 0;

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
            {/* The entry is the point of the page: it is written by hand, and
                the agent's job is to say what it missed. */}
            <section className="mb-4">
              <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
                <span>
                  Your entry
                  {entry === null ? null : (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {entry.heading}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {entry === null ? null : (
                    <UrlLink
                      href={entry.url}
                      className="text-xs font-normal text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Open the doc
                    </UrlLink>
                  )}
                  {threads.feedback === undefined ? null : (
                    <button
                      type="button"
                      onClick={() => navigate.toThread(threads.feedback as string)}
                      className="text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Open the thread
                    </button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={askForFeedback}
                    disabled={reviewing || entry === null}
                  >
                    <Icon
                      name={reviewing ? "Spinner" : "Check"}
                      className={cn("size-3.5", reviewing && "animate-spin")}
                    />
                    {feedback === null ? "Check my entry" : "Check it again"}
                  </Button>
                </span>
              </h2>

              <div className="mt-2">
                {entry === null ? (
                  <EmptyState>
                    Nothing written for this week yet. Write it in the doc; this page
                    never does.
                  </EmptyState>
                ) : feedback === null ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                    {entry.text.split("\n").filter((line) => line.trim() !== "").length} lines
                    written. Check it against the week to see what it missed.
                  </div>
                ) : (
                  <FeedbackSummary feedback={feedback} entry={entry} />
                )}
              </div>

            </section>

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

            {grouping === null ? null : (
              <>
                <h2 className="mt-6 flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  Where the time went
                  {hasNotes ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs font-normal text-muted-foreground"
                      onClick={askForNotes}
                      disabled={gatheringNotes}
                    >
                      <Icon
                        name={gatheringNotes ? "Spinner" : "FileText"}
                        className={cn("size-3.5", gatheringNotes && "animate-spin")}
                      />
                      Collect notes
                    </Button>
                  )}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {grouping.total.toFixed(2)}h across {grouping.themes.length} themes,
                  grouped by what the work was rather than how it was booked.
                </p>

                <ThemeSummary
                  themes={
                    grouping.everythingElse === null
                      ? grouping.themes
                      : [...grouping.themes, grouping.everythingElse]
                  }
                  total={grouping.total}
                />

                {grouping.themes.map((theme) => (
                  <ThemeBlock
                    key={theme.title}
                    theme={theme}
                    urls={urls}
                    notesFor={notesFor}
                  />
                ))}

                {grouping.everythingElse === null ? null : (
                  <ThemeBlock
                    theme={grouping.everythingElse}
                    urls={urls}
                    notesFor={notesFor}
                  />
                )}
              </>
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
    id: "feedback-prompt",
    title: "Feedback prompt",
    description: "What an agent is asked when it checks your written entry against the week.",
    component: () => (
      <PromptSection
        kind="feedback"
        placeholders="Sent to the feedback thread. {{ENTRY}} becomes the entry as written, {{DIGEST}} the week, and {{COMMAND}} the command that records the result. Nothing in this plugin writes to the document."
      />
    ),
  });

  app.slots.settingsSection({
    id: "notes-prompt",
    title: "Notes prompt",
    description: "What an agent is asked when it collects the week's daily notes.",
    component: () => (
      <PromptSection
        kind="notes"
        placeholders="Sent to the notes thread. {{FROM}} and {{TO}} become the week's dates, {{MEETINGS_COMMAND}} the command that lists its meetings, and {{COMMAND}} the one that records the result."
      />
    ),
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
