import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { daySchema, weekDataSchema } from "./schema.js";
import { SCALAR_KEYS } from "./sources.js";

const sourceStatusSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  millis: z.number(),
});

/** A Monday, which is both a week's id and its directory name. */
const mondaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const docSourceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200),
});

const sourcesSchema = z.object({
  repo: z.string(),
  author: z.string(),
  harvestProjectId: z.string(),
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
      weeks: z.array(mondaySchema),
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
      dir: z.string(),
    }),
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
      /** Present replaces the whole list, in the order given. */
      docs: z.array(docSourceSchema).max(100).optional(),
    }),
    output: sourcesSchema,
  },
});

export { SCALAR_KEYS };
