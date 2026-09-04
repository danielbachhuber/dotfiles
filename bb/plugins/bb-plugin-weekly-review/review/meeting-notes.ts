/**
 * Joining a time entry to the notes someone actually took in that meeting.
 *
 * The reference docs are mostly running 1:1 documents — one per person, newest
 * entry at the top, each under a `## August 31st` heading. A time entry that
 * says `1:1 w/ Rob` on 2026-08-31 is that meeting, so the section that day is
 * what was discussed. Nothing here fetches: the doc text is already cached
 * beside the week, and this is the pure part that decides what belongs to what.
 */
import type { Day } from "./types.js";
import { fromDay, toDay } from "./dates.js";

export interface DatedSection {
  day: Day;
  heading: string;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * `August 31st`, `Sep 4`, `September 4, 2026`. The year is usually missing, so
 * a heading is read against the week being looked at, and a date that lands
 * more than a few weeks in the future is taken as last year's — which is what
 * makes a January week find its December headings.
 */
export function parseHeadingDate(heading: string, near: Day): Day | null {
  const match = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/.exec(
    heading.trim(),
  );
  if (match === null) return null;
  const [, monthName, dayOfMonth, year] = match;
  const month = MONTHS.findIndex((name) => name.startsWith(monthName.toLowerCase()));
  if (month === -1) return null;

  const reference = fromDay(near);
  if (year !== undefined) return toDay(new Date(Number(year), month, Number(dayOfMonth)));

  const sameYear = new Date(reference.getFullYear(), month, Number(dayOfMonth));
  const daysAhead = (sameYear.getTime() - reference.getTime()) / 86_400_000;
  if (daysAhead > 60) {
    return toDay(new Date(reference.getFullYear() - 1, month, Number(dayOfMonth)));
  }
  if (daysAhead < -300) {
    return toDay(new Date(reference.getFullYear() + 1, month, Number(dayOfMonth)));
  }
  return toDay(sameYear);
}

/**
 * Every dated section in a doc. A section runs to the next heading at the same
 * level or higher, so a `### Follow-ups` inside a day stays part of that day.
 */
export function datedSections(text: string, near: Day): DatedSection[] {
  const lines = text.split("\n");
  const sections: DatedSection[] = [];
  let current: { day: Day; heading: string; level: number; body: string[] } | null = null;

  const close = () => {
    if (current === null) return;
    sections.push({
      day: current.day,
      heading: current.heading,
      body: current.body.join("\n").trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match === null) {
      current?.body.push(line);
      continue;
    }
    const level = match[1].length;
    const heading = match[2];
    if (current !== null && level > current.level) {
      current.body.push(line);
      continue;
    }
    const day = parseHeadingDate(heading, near);
    close();
    if (day !== null) current = { day, heading, level, body: [] };
  }
  close();
  return sections;
}

/**
 * `1:1 — Rob` → `rob`. Null for a doc that is not about one person.
 *
 * Only an em or en dash separates a doc from its person. A plain hyphen would
 * read `PSI team check-in` as a document about someone called "in", which then
 * matched every note containing the word.
 */
export function personInLabel(label: string): string | null {
  const match = /[—–]\s*([^—–]+)$/.exec(label);
  if (match === null) return null;
  // A trailing parenthetical is a date or a qualifier, not part of the name.
  const person = match[1].trim().replace(/\s*\(.*\)\s*$/, "").trim();
  // Names are capitalized. Anything else is the tail of a title.
  if (!/^\p{Lu}/u.test(person)) return null;
  return person.toLowerCase();
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

const LEADING_REF = /^#\d+/;

/**
 * How an entry relates to a document: it was that meeting, or it merely names
 * the person the document is about.
 *
 * The distinction is the whole of the matching problem. `1:1 w/ Brendan` and
 * `Review Brendan's project plan` both name Brendan, and only the first one is
 * a meeting whose notes exist. Attaching the 1:1 notes to the second reads as
 * a record of a conversation that never happened.
 */
export type MatchKind = "met" | "mentioned";

export interface DocMatch<T> {
  doc: T;
  kind: MatchKind;
}

/** The words that make a time entry a meeting rather than work about someone. */
const MEETING_FORM =
  /\b(1:1|1-1|one[- ]on[- ]one|chat|call|sync|standup|stand-up|meeting|convo|conversation|catch[- ]?up|check[- ]?in|debrief|interview|coffee)\b/;

/**
 * Which doc, if any, holds the notes for a time entry.
 *
 * A doc whose label appears in the entry is that meeting. Otherwise a doc
 * about one person matches an entry naming that person as a whole word, and
 * whether that is a meeting turns on whether the entry reads like one.
 * `PSI standup` does not match `PSI team check-in`, which is the case that
 * made a looser rule useless.
 */
export function matchDoc<T extends { label: string }>(
  entryNote: string,
  docs: T[],
): DocMatch<T> | null {
  const note = normalize(entryNote);
  // An entry naming a pull request or an issue is that work, not a meeting.
  if (note === "" || LEADING_REF.test(note)) return null;

  for (const doc of docs) {
    if (note.includes(normalize(doc.label))) return { doc, kind: "met" };
  }
  for (const doc of docs) {
    const person = personInLabel(doc.label);
    if (person === null) continue;
    if (!new RegExp(`(^|\\W)${escapeRegExp(person)}(\\W|$)`).test(note)) continue;
    return { doc, kind: MEETING_FORM.test(note) ? "met" : "mentioned" };
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The section a meeting's notes were written under.
 *
 * Notes are routinely headed a day either side of when the time was logged —
 * a Tuesday 1:1 written up under Monday's heading — so the nearest section
 * within a few days wins, with the exact day preferred. The tolerance stays
 * well inside a weekly cadence, so a near miss can never reach into the
 * neighbouring week's entry.
 */
export function sectionNear(sections: DatedSection[], day: Day, toleranceDays = 3): DatedSection | null {
  let best: { section: DatedSection; distance: number } | null = null;
  const target = fromDay(day).getTime();
  for (const section of sections) {
    const distance = Math.abs(fromDay(section.day).getTime() - target) / 86_400_000;
    if (distance > toleranceDays) continue;
    if (best === null || distance < best.distance) best = { section, distance };
  }
  return best?.section ?? null;
}

/**
 * Which daily-note entry, if any, was written about a time entry.
 *
 * An explicit `meeting` wins: it is the agent saying these two records are the
 * same conversation under different names, which is the case no rule can
 * reach. Failing that, the note's own bullet is matched against the entry the
 * same way a document is — the same conversation is usually called nearly the
 * same thing in both places.
 */
export function matchNote<T extends { day: Day; title: string; meeting?: string }>(
  entry: { day: Day; notes: string },
  notes: T[],
): T | null {
  const wanted = normalize(entry.notes);
  if (wanted === "" || LEADING_REF.test(wanted)) return null;

  const sameDay = notes.filter((note) => note.day === entry.day);

  for (const note of sameDay) {
    if (note.meeting !== undefined && normalize(note.meeting) === wanted) return note;
  }
  for (const note of sameDay) {
    if (note.meeting !== undefined) continue;
    const title = normalize(note.title);
    if (title === "") continue;
    // Either name containing the other is the ordinary case: "Open Source
    // Roadmap w/ Marius" against "Open Source Roadmap w/ Marius Scheffel".
    if (title.includes(wanted) || wanted.includes(title)) return note;
  }
  return null;
}

/**
 * Named time entries nothing has been matched to yet.
 *
 * Deliberately not filtered by whether the entry reads like a meeting. That
 * test exists to stop a 1:1 document attaching itself to work merely naming
 * the person; using it here would hide the entries that need an agent most.
 * "Phase 3 review" and "Architecture Talk" are meetings and contain none of
 * the words, which is exactly why no rule found their notes.
 */
export function entriesWithoutNotes<T extends { day: Day; notes: string }>(
  entries: T[],
  matched: (entry: T) => boolean,
): T[] {
  return entries.filter((entry) => {
    const note = normalize(entry.notes);
    return note !== "" && !LEADING_REF.test(note) && !matched(entry);
  });
}
