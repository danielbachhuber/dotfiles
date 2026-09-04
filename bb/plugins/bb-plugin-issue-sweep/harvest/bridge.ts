import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import type { PickerExternalReference } from "../components/timer-picker.js";

/**
 * Issue Sweep's link to the Harvest plugin.
 *
 * bb plugins cannot render each other's React components, but they can call
 * each other's RPC, so all Harvest knowledge stays in the Harvest plugin and
 * this file is only a transport. `callRpc` validates the response against a
 * schema supplied by the caller, so these are Issue Sweep's own copies of the
 * shapes the Harvest plugin promises.
 *
 * Every read degrades to an empty answer. Issue Sweep has to stay fully useful
 * on a machine with no Harvest plugin installed, so an absent, disabled, or
 * unconfigured Harvest is a state rather than an error. Writes are the
 * exception and propagate: a read that quietly returns nothing is fine, but a
 * write that quietly does nothing would leave the user believing time is being
 * tracked when it is not.
 */
const HARVEST_PLUGIN_ID = "harvest";

const externalReferenceSchema = z.object({
  id: z.string(),
  groupId: z.string().nullable(),
  accountId: z.string().nullable(),
  permalink: z.string().nullable(),
});

const entrySchema = z.object({
  id: z.number(),
  projectName: z.string(),
  taskName: z.string(),
  notes: z.string().nullable(),
  hours: z.number(),
  timerStartedAt: z.string().nullable(),
  externalReference: externalReferenceSchema.nullable(),
});

const statusSchema = z.object({
  configured: z.boolean(),
  user: z.object({ name: z.string(), accountName: z.string() }).nullable(),
  error: z.string().nullable(),
});

const assignmentsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      code: z.string().nullable(),
      clientName: z.string().nullable(),
      tasks: z.array(z.object({ id: z.number(), name: z.string() })),
    }),
  ),
});

const hoursSchema = z.object({ hours: z.number() });
const selectionSchema = z.object({ projectId: z.number(), taskId: z.number() }).nullable();
const runningSchema = z.object({ entry: entrySchema.nullable() });

/** Which issue the running timer is against, if any. */
export interface RunningReference {
  externalId: string;
  groupId: string | null;
}

export interface HarvestBridge {
  available(): Promise<boolean>;
  runningReference(): Promise<RunningReference | null>;
  assignments(): Promise<z.infer<typeof assignmentsSchema>>;
  trackedHours(input: { externalId: string; groupId?: string | null }): Promise<{ hours: number }>;
  lastSelection(input: { scope: string | null }): Promise<z.infer<typeof selectionSchema>>;
  startTimer(input: {
    projectId: number;
    taskId: number;
    notes: string;
    externalReference?: PickerExternalReference;
  }): Promise<z.infer<typeof runningSchema>>;
}

export function createHarvestBridge(bb: BbPluginApi): HarvestBridge {
  function call<T>(method: string, outputSchema: z.ZodType<T>, input?: unknown): Promise<T> {
    return bb.sdk.plugins.callRpc({
      pluginId: HARVEST_PLUGIN_ID,
      method,
      outputSchema,
      ...(input === undefined ? {} : { input: input as never }),
    });
  }

  return {
    async available() {
      try {
        const status = await call("status", statusSchema, null);
        if (!status.configured) return false;

        // A rejected token means the clock can only fail, so hide it. A busy
        // or briefly unreachable Harvest is worth still offering.
        return status.error !== "unauthenticated";
      } catch {
        return false;
      }
    },

    /**
     * Which reference the running timer is against, so the matching row's
     * clock can show it.
     *
     * This is read with the listing rather than followed live, because
     * realtime signals are scoped to the plugin that publishes them: Issue
     * Sweep cannot subscribe to the Harvest plugin's broadcast. The tint is
     * therefore accurate as of the last panel refresh.
     */
    async runningReference() {
      try {
        const { entry } = await call("runningTimer", runningSchema, null);
        const reference = entry?.externalReference ?? null;
        if (reference === null) return null;

        return { externalId: reference.id, groupId: reference.groupId };
      } catch (error) {
        bb.log.warn(`Could not read the running Harvest timer: ${messageOf(error)}`);
        return null;
      }
    },

    async assignments() {
      try {
        return await call("assignments", assignmentsSchema, null);
      } catch (error) {
        bb.log.warn(`Could not read Harvest assignments: ${messageOf(error)}`);
        return { projects: [] };
      }
    },

    async trackedHours({ externalId, groupId }) {
      try {
        return await call("trackedHours", hoursSchema, { externalId, groupId: groupId ?? null });
      } catch (error) {
        bb.log.warn(`Could not read Harvest hours for ${externalId}: ${messageOf(error)}`);
        return { hours: 0 };
      }
    },

    async lastSelection({ scope }) {
      try {
        return await call("lastSelection", selectionSchema, { scope });
      } catch (error) {
        bb.log.warn(`Could not read the remembered Harvest selection: ${messageOf(error)}`);
        return null;
      }
    },

    async startTimer(input) {
      return await call("startTimer", runningSchema, input);
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
