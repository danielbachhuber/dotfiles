import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { daySchema, weekDataSchema } from "./schema.js";
import { feedbackSchema, interpretationSchema } from "./interpretation.js";
import { SCALAR_KEYS } from "./sources.js";

/** Which of the two agent steps a prompt belongs to. */
export const promptKindSchema = z.enum(["interpret", "notes", "feedback"]);
export type PromptKind = z.infer<typeof promptKindSchema>;

const sourceStatusSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  millis: z.number(),
});

/** A Monday, which is both a week's id and its directory name. */
const mondaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * A week reduced to what the title bar needs. The header and the body mount
 * separately, so the header gets this rather than fetching a whole week to
 * print one timestamp.
 */
const weekSummarySchema = z.object({
  monday: mondaySchema,
  to: daySchema,
  generatedAt: z.string(),
});

/**
 * A meeting's own notes, lifted out of the reference doc that holds them. The
 * doc and the heading travel with the text, so a match a day either side of
 * the meeting reads as what it is rather than as a claim about that day.
 */
const meetingNoteSchema = z.object({
  day: daySchema,
  /** The time entry this belongs to, matched on verbatim by the page. */
  entryNote: z.string(),
  /** Where it came from: a reference doc, or the day's own notes. */
  source: z.enum(["doc", "notes"]),
  label: z.string(),
  /** Empty for a source with nowhere to link to. */
  url: z.string(),
  /** The dated heading the text sat under; empty when there was none. */
  heading: z.string(),
  text: z.string(),
});

const docSourceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200),
});

const sourcesSchema = z.object({
  repo: z.string(),
  author: z.string(),
  harvestProjectId: z.string(),
  journalDocId: z.string(),
  docs: z.array(docSourceSchema),
});

export const rpcContract = defineRpcContract({
  /**
   * Everything the panel needs to draw its chrome before a week is chosen:
   * which weeks exist, which one is current, and whether the plugin can gather
   * a new one at all.
   */
  weeks_list: {
    input: z.null(),
    output: z.object({
      weeks: z.array(weekSummarySchema),
      /** The Monday the current week resolves to, gathered or not. */
      currentWeek: mondaySchema,
      /** The Monday before it, so "last week" is one click and not arithmetic. */
      previousWeek: mondaySchema,
      /** Source definitions this plugin needs and does not have. Empty when ready. */
      missingSources: z.array(z.string()),
      weeksDir: z.string(),
    }),
  },
  week_get: {
    input: z.object({ monday: mondaySchema }),
    output: z.object({
      week: weekDataSchema.nullable(),
      /** The agent's reading, when one has been recorded. */
      interpretation: interpretationSchema.nullable(),
      /** The agent's read of the hand-written entry, when one has been recorded. */
      feedback: feedbackSchema.nullable(),
      /** This week's entry as written, read fresh from the doc. Null when there is none. */
      entry: z.object({ heading: z.string(), text: z.string(), url: z.string() }).nullable(),
      meetingNotes: z.array(meetingNoteSchema),
      dir: z.string(),
    }),
  },
  /**
   * Hands the gathered week to an agent and returns the thread doing the
   * reading. The result arrives later, over the realtime signal, when the
   * agent records it with `bb weekly-review interpret`.
   */
  week_interpret: {
    input: z.object({ monday: mondaySchema }),
    output: z.object({
      threadId: z.string(),
    }),
  },
  /**
   * Sends an agent to collect the week's daily notes, which are reachable over
   * MCP and so cannot be gathered by the deterministic fetch. It also resolves
   * the meetings the name matching could not.
   */
  week_gather_notes: {
    input: z.object({ monday: mondaySchema }),
    output: z.object({ threadId: z.string() }),
  },
  /**
   * Sends an agent to check the hand-written entry against the week. It reads
   * the document and reports; it never writes to it.
   */
  week_feedback: {
    input: z.object({ monday: mondaySchema }),
    output: z.object({ threadId: z.string() }),
  },
  prompt_get: {
    input: z.object({ kind: promptKindSchema }),
    output: z.object({ prompt: z.string(), isDefault: z.boolean() }),
  },
  prompt_set: {
    input: z.object({
      kind: promptKindSchema,
      /** Blank restores the default. */
      prompt: z.string().max(20_000),
    }),
    output: z.object({ prompt: z.string(), isDefault: z.boolean() }),
  },
  /**
   * Re-gathers a week from its sources and writes it to disk. Slow — every
   * source is a CLI — so the panel drives it from an explicit button rather
   * than on load.
   */
  week_generate: {
    input: z.object({
      from: daySchema.optional(),
      to: daySchema.optional(),
    }),
    output: z.object({
      monday: mondaySchema,
      sources: z.array(sourceStatusSchema),
    }),
  },

  /** What a week is gathered from. Held in the database, never in a file. */
  sources_get: {
    input: z.null(),
    output: sourcesSchema,
  },
  sources_set: {
    input: z.object({
      repo: z.string().trim().max(200).optional(),
      author: z.string().trim().max(200).optional(),
      harvestProjectId: z.string().trim().max(50).optional(),
      journalDocId: z.string().trim().max(200).optional(),
      /** Present replaces the whole list, in the order given. */
      docs: z.array(docSourceSchema).max(100).optional(),
    }),
    output: sourcesSchema,
  },
});

export { SCALAR_KEYS };
