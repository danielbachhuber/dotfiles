/**
 * The shapes here are taken from a live `gws calendar events list` payload and
 * then renamed: Google files a working-location marker as an event, an event
 * you declined still comes back, a focus block arrives marked "free", and an
 * all-day row uses `start.date` where a meeting uses `start.dateTime`. Every
 * one of those was in one ordinary fortnight, and each is a reason a naive
 * read of `items` puts something wrong on the page.
 */
import { describe, expect, it } from "vitest";
import { toEvent } from "./calendar.js";

const meeting = {
  id: "evt-1",
  status: "confirmed",
  eventType: "default",
  summary: "Acme / Octocat check-in",
  htmlLink: "https://www.google.com/calendar/event?eid=abc",
  start: { dateTime: "2026-09-15T07:30:00-07:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-09-15T08:00:00-07:00", timeZone: "America/Los_Angeles" },
  attendees: [
    { email: "octocat@acme.test", responseStatus: "accepted" },
    { email: "hubber@acme.test", organizer: true, responseStatus: "accepted", self: true },
  ],
};

describe("toEvent", () => {
  it("flattens a timed meeting onto its local day", () => {
    const event = toEvent(meeting);
    expect(event).toMatchObject({
      id: "evt-1",
      day: "2026-09-15",
      allDay: false,
      title: "Acme / Octocat check-in",
      minutes: 30,
      attendees: 2,
      response: "accepted",
      free: false,
      url: "https://www.google.com/calendar/event?eid=abc",
    });
  });

  it("drops a working-location marker", () => {
    // Six of these in a fortnight, one per working day, all titled "Home".
    expect(
      toEvent({
        id: "wl-1",
        eventType: "workingLocation",
        summary: "Home",
        status: "confirmed",
        transparency: "transparent",
        start: { date: "2026-09-15" },
        end: { date: "2026-09-16" },
      }),
    ).toBeNull();
  });

  it("drops an event you declined", () => {
    expect(
      toEvent({
        ...meeting,
        id: "evt-declined",
        attendees: [
          { email: "octocat@acme.test", responseStatus: "accepted" },
          { email: "hubber@acme.test", responseStatus: "declined", self: true },
        ],
      }),
    ).toBeNull();
  });

  it("drops a cancelled event", () => {
    expect(toEvent({ ...meeting, id: "evt-cancelled", status: "cancelled" })).toBeNull();
  });

  it("keeps an all-day marker, with no duration to print", () => {
    const event = toEvent({
      id: "allday-1",
      eventType: "default",
      status: "confirmed",
      summary: "Octocat owns the weekly release",
      transparency: "transparent",
      start: { date: "2026-09-16" },
      end: { date: "2026-09-17" },
      attendees: [{ email: "hubber@acme.test", responseStatus: "accepted", self: true }],
    });
    // Marked free, and kept anyway: it says who owns the release this week.
    expect(event).toMatchObject({ day: "2026-09-16", allDay: true, minutes: null, free: true });
    expect(event?.startsAt).toBeUndefined();
  });

  it("marks a focus block free and leaves it in", () => {
    const event = toEvent({
      id: "focus-1",
      eventType: "default",
      status: "confirmed",
      summary: "Focus time",
      transparency: "transparent",
      start: { dateTime: "2026-09-15T07:00:00-07:00" },
      end: { dateTime: "2026-09-15T09:00:00-07:00" },
    });
    expect(event).toMatchObject({ free: true, minutes: 120, attendees: 0 });
    expect(event?.response).toBeUndefined();
  });

  it("titles an event that has no summary", () => {
    const event = toEvent({ ...meeting, id: "evt-private", summary: undefined });
    expect(event?.title).toBe("(no title)");
  });

  it("keeps an unanswered invitation, with the response it carries", () => {
    const event = toEvent({
      ...meeting,
      id: "evt-pending",
      attendees: [
        { email: "octocat@acme.test", responseStatus: "accepted" },
        { email: "hubber@acme.test", responseStatus: "needsAction", self: true },
      ],
    });
    expect(event?.response).toBe("needsAction");
  });
});
