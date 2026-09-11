/**
 * The calendar, for the part of the page that looks forward.
 *
 * Read through the `gws` CLI on the primary calendar, with `singleEvents` set
 * so a recurring meeting arrives as the instances it actually has rather than
 * as one rule the page would have to expand itself.
 *
 * Two filters, both taken from what the live payload contains rather than from
 * what the API documents. Google files working-location markers as events, so
 * a plain read of a fortnight returns a "Home" all-day entry per working day;
 * those carry `eventType: "workingLocation"` and are dropped. An event you have
 * declined is not a commitment, so it is dropped too. Everything else stays,
 * including the all-day markers that say who owns a release this week, and
 * including "free" blocks — those are marked rather than removed, because a
 * focus block is real time even though it is not a meeting.
 */
import type { CalendarEvent, Day } from "../types.js";
import { runJson } from "./shell.js";

/** A half-open window of days: `from` through `to`, both inclusive. */
export interface Window {
  from: Day;
  to: Day;
}

interface RawWhen {
  /** All-day events only. */
  date?: string;
  /** Timed events only, with the offset the event was created in. */
  dateTime?: string;
  timeZone?: string;
}

interface RawEvent {
  id?: string;
  status?: string;
  eventType?: string;
  summary?: string;
  htmlLink?: string;
  transparency?: string;
  start?: RawWhen;
  end?: RawWhen;
  attendees?: Array<{ email?: string; organizer?: boolean; self?: boolean; responseStatus?: string }>;
}

interface RawPage {
  items?: RawEvent[];
  nextPageToken?: string;
}

/** One local-midnight instant, which is what the API's bounds want. */
function midnight(day: Day, plusDays = 0): string {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + plusDays);
  return date.toISOString();
}

/**
 * A fortnight of one person's calendar is tens of events, not thousands, so a
 * page of 250 is normally the only one. The loop is here for the week someone
 * spends in a conference, and stops rather than following a token forever.
 */
const MAX_PAGES = 5;

export async function fetchCalendar(
  window: Window,
  config: { gws: string },
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: Record<string, unknown> = {
      calendarId: "primary",
      timeMin: midnight(window.from),
      // Exclusive, so the last day needs the midnight after it.
      timeMax: midnight(window.to, 1),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      ...(pageToken === undefined ? {} : { pageToken }),
    };
    const raw = await runJson<RawPage>(config.gws, [
      "calendar", "events", "list", "--params", JSON.stringify(params),
    ]);
    for (const item of raw.items ?? []) {
      const event = toEvent(item);
      if (event !== null) events.push(event);
    }
    pageToken = raw.nextPageToken;
    if (pageToken === undefined) break;
  }

  return events.sort(
    (a, b) =>
      a.day.localeCompare(b.day)
      // All-day markers lead the day they belong to; a day is not a time.
      || Number(b.allDay) - Number(a.allDay)
      || (a.startsAt ?? "").localeCompare(b.startsAt ?? "")
      || a.title.localeCompare(b.title),
  );
}

/** Null for anything that is not a commitment of yours. */
export function toEvent(raw: RawEvent): CalendarEvent | null {
  if (raw.status === "cancelled") return null;
  // `workingLocation`, and `birthday` on a calendar that has them: files kept
  // as events, not things on a schedule.
  if (raw.eventType !== undefined && raw.eventType !== "default") return null;

  const self = raw.attendees?.find((attendee) => attendee.self === true);
  if (self?.responseStatus === "declined") return null;

  const start = raw.start ?? {};
  const allDay = start.date !== undefined;
  const day = allDay ? (start.date as string) : localDay(start.dateTime);
  if (day === null) return null;

  return {
    id: raw.id ?? `${day}-${raw.summary ?? ""}`,
    day,
    ...(allDay || start.dateTime === undefined ? {} : { startsAt: start.dateTime }),
    allDay,
    // A private event on a shared calendar comes through with no summary at
    // all, and an untitled row is still a row on your day.
    title: raw.summary?.trim() === "" || raw.summary === undefined ? "(no title)" : raw.summary,
    minutes: allDay ? null : durationMinutes(start.dateTime, raw.end?.dateTime),
    attendees: raw.attendees?.length ?? 0,
    ...(self?.responseStatus === undefined ? {} : { response: self.responseStatus }),
    free: raw.transparency === "transparent",
    ...(raw.htmlLink === undefined ? {} : { url: raw.htmlLink }),
  };
}

/**
 * The local day an instant falls on. The API returns an offset per event, and
 * a meeting at 21:00 Pacific is a Thursday meeting to the person in it even
 * though it is Friday in UTC.
 */
function localDay(dateTime: string | undefined): Day | null {
  if (dateTime === undefined) return null;
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function durationMinutes(
  from: string | undefined,
  to: string | undefined,
): number | null {
  if (from === undefined || to === undefined) return null;
  const minutes = (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;
}
