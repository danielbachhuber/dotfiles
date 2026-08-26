// bb-plugin-new-issue — backend entry.
//
// One job: take a few lines about what an issue should cover, plus the project
// and execution selection it should run under, and spawn a thread that runs
// the draft-issue-description skill against that project's repo. The skill
// itself owns the drafting workflow — this plugin only writes the brief and
// hands it over.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const projectSchema = z.object({ id: z.string(), name: z.string() });

/** Mirrors the SDK's ReasoningLevel and ServiceTier enums at the wire boundary. */
const reasoningLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);
const serviceTierSchema = z.enum(["default", "fast"]);

/**
 * The shape BB's own provider/model picker resolves, forwarded verbatim from
 * the form to threads.spawn.
 */
const executionSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: reasoningLevelSchema,
    serviceTier: serviceTierSchema.optional(),
  })
  .strict();
export type Execution = z.infer<typeof executionSchema>;

// Both schemas run at the wire boundary. Handler input/output are inferred
// from the shared contract; app.tsx imports only its type.
export const rpcContract = defineRpcContract({
  projects_list: {
    input: z.null(),
    output: z.object({ projects: z.array(projectSchema) }),
  },
  execution_defaults: {
    input: z.object({ projectId: z.string().min(1) }).strict(),
    output: z.object({ execution: executionSchema.nullable() }),
  },
  thread_is_ours: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ isOurs: z.boolean() }),
  },
  issue_create_send: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ sent: z.boolean() }),
  },
  issue_thread_create: {
    input: z
      .object({
        projectId: z.string().min(1),
        notes: z.string().trim().min(1).max(20_000),
        execution: executionSchema,
      })
      .strict(),
    output: z.object({ threadId: z.string() }),
  },
});

/**
 * draft-issue-description is a user-level Claude Code skill, so a thread on
 * another provider cannot resolve it by name. It is only a seed — the picker
 * lets you choose anything — but it is the one worth landing on by default.
 */
const PREFERRED_PROVIDER_ID = "claude-code";

/**
 * What the "Create issue" button sends. The draft-issue-description skill ends
 * by waiting for confirmation before it files anything, so this is that
 * confirmation — the button exists to save typing it, not to change the flow.
 */
const CREATE_MESSAGE = "Create the issue.";

/** Longest thread title we'll derive from the notes before eliding. */
const TITLE_MAX = 72;

/**
 * The first non-empty line of the notes, elided — enough to recognize the
 * thread in the sidebar before the agent renames it.
 */
export function deriveTitle(notes: string): string {
  const firstLine =
    notes
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  const title =
    firstLine.length > TITLE_MAX
      ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : firstLine;
  return `New issue: ${title}`;
}

/**
 * The brief handed to the agent. The notes go in a delimited block so the
 * agent can tell them from the instruction around them.
 */
export function buildPrompt(notes: string): string {
  return [
    "Use the draft-issue-description skill to draft a GitHub issue for this repository.",
    "",
    "Here is what the issue should cover, in my own words:",
    "",
    "<notes>",
    notes.trim(),
    "</notes>",
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  /**
   * What the picker opens on for a project: BB's own remembered defaults when
   * it has them, otherwise the preferred provider's default model. Null when
   * no provider has a usable catalog, which leaves the picker unmounted rather
   * than seeded with a model that does not exist.
   */
  async function resolveDefaults(projectId: string): Promise<Execution | null> {
    const remembered = await bb.sdk.projects.defaultExecutionOptions({
      projectId,
    });
    if (remembered !== null) {
      return {
        providerId: remembered.providerId,
        model: remembered.model,
        reasoningLevel: remembered.reasoningLevel,
        serviceTier: remembered.serviceTier,
      };
    }

    const providers = await bb.sdk.providers.list();
    const available = providers.filter((provider) => provider.available);
    const provider =
      available.find(({ id }) => id === PREFERRED_PROVIDER_ID) ?? available[0];
    if (provider === undefined) return null;

    const { models } = await bb.sdk.providers.models({
      providerId: provider.id,
    });
    const model = models.find((candidate) => candidate.isDefault) ?? models[0];
    if (model === undefined) return null;

    return {
      providerId: provider.id,
      model: model.model,
      reasoningLevel: model.defaultReasoningEffort ?? "medium",
      ...(provider.capabilities.supportsServiceTier
        ? { serviceTier: "default" as const }
        : {}),
    };
  }

  /**
   * Whether this plugin spawned the thread. threads.spawn stamps
   * originPluginId automatically, so this is the whole check — and it is what
   * keeps the button out of every unrelated thread's composer.
   */
  async function isOurThread(threadId: string): Promise<boolean> {
    const thread = await bb.sdk.threads.get({ threadId });
    return thread.originPluginId === bb.pluginId;
  }

  bb.rpc.register(rpcContract, {
    projects_list: async () => {
      const projects = await bb.sdk.projects.list();
      return {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      };
    },
    execution_defaults: async ({ projectId }) => ({
      execution: await resolveDefaults(projectId),
    }),
    thread_is_ours: async ({ threadId }) => ({
      isOurs: await isOurThread(threadId),
    }),
    issue_create_send: async ({ threadId }) => {
      // Re-checked server-side: the frontend decides what to render, not what
      // this plugin is allowed to post into.
      if (!(await isOurThread(threadId))) return { sent: false };
      await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: CREATE_MESSAGE, mentions: [] }],
      });
      bb.log.info(`sent the create-issue confirmation to ${threadId}`);
      return { sent: true };
    },
    issue_thread_create: async ({ projectId, notes, execution }) => {
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        ...execution,
        title: deriveTitle(notes),
        prompt: buildPrompt(notes),
      });
      bb.log.info(
        `spawned issue thread ${thread.id} in ${projectId} on ${execution.providerId}/${execution.model}`,
      );
      return { threadId: thread.id };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
