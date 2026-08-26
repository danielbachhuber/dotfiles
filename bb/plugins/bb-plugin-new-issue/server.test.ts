import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, { buildPrompt, deriveTitle } from "./server";

const NOTES = "Sidebar rows lose their pin state on reload.\n\nSeen twice today.";
const EXECUTION = {
  providerId: "claude-code",
  model: "claude-opus-5",
  reasoningLevel: "high" as const,
  serviceTier: "default" as const,
};

interface HostOptions {
  remembered?: unknown;
  providers?: unknown[];
  models?: unknown[];
}

function createHost(options: HostOptions = {}) {
  return createFakePluginHost({
    pluginId: "new-issue",
    sdk: {
      projects: {
        list: async () => [
          { id: "proj_a", name: "psi-product" },
          { id: "proj_b", name: "bugsink" },
        ],
        defaultExecutionOptions: async () => options.remembered ?? null,
      },
      providers: {
        list: async () =>
          options.providers ?? [
            {
              id: "codex",
              available: true,
              capabilities: { supportsServiceTier: true },
            },
            {
              id: "claude-code",
              available: true,
              capabilities: { supportsServiceTier: false },
            },
          ],
        models: async () => ({
          models: options.models ?? [
            { model: "claude-sonnet-5", isDefault: false },
            {
              model: "claude-opus-5",
              isDefault: true,
              defaultReasoningEffort: "high",
            },
          ],
        }),
      },
      threads: {
        spawn: async () => makeThreadResponse({ id: "thr_new" }),
        get: async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({
            id: threadId,
            originPluginId: threadId === "thr_ours" ? "new-issue" : null,
          }),
        send: async () => ({ ok: true }),
      },
    },
  });
}

describe("projects_list", () => {
  it("returns just the id and name of each project", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("projects_list", null);

    expect(result).toEqual({
      projects: [
        { id: "proj_a", name: "psi-product" },
        { id: "proj_b", name: "bugsink" },
      ],
    });
  });
});

describe("execution_defaults", () => {
  it("prefers BB's remembered defaults for the project", async () => {
    const { bb, harness } = createHost({
      remembered: {
        providerId: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
        serviceTier: "fast",
        permissionMode: "auto",
      },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("execution_defaults", {
      projectId: "proj_a",
    });

    // permissionMode is deliberately dropped — the picker does not own it.
    expect(result).toEqual({
      execution: {
        providerId: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
        serviceTier: "fast",
      },
    });
  });

  it("falls back to Claude Code's default model when the project has none", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("execution_defaults", {
      projectId: "proj_a",
    });

    // claude-code is preferred over the listed-first codex, and declares no
    // service tier support, so none is seeded.
    expect(result).toEqual({
      execution: {
        providerId: "claude-code",
        model: "claude-opus-5",
        reasoningLevel: "high",
      },
    });
  });

  it("falls back to the first available provider when Claude Code is absent", async () => {
    const { bb, harness } = createHost({
      providers: [
        {
          id: "codex",
          available: true,
          capabilities: { supportsServiceTier: true },
        },
      ],
      models: [{ model: "gpt-5.6-sol", isDefault: true }],
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("execution_defaults", {
      projectId: "proj_a",
    });

    expect(result).toEqual({
      execution: {
        providerId: "codex",
        model: "gpt-5.6-sol",
        // No defaultReasoningEffort on the model, so medium.
        reasoningLevel: "medium",
        serviceTier: "default",
      },
    });
  });

  it("returns null rather than a model that does not exist", async () => {
    const { bb, harness } = createHost({ providers: [], models: [] });
    await plugin(bb);

    expect(
      await harness.behavior.callRpc("execution_defaults", {
        projectId: "proj_a",
      }),
    ).toEqual({ execution: null });
  });
});

describe("issue_thread_create", () => {
  it("spawns a thread with the picked project and execution selection", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("issue_thread_create", {
      projectId: "proj_a",
      notes: NOTES,
      execution: EXECUTION,
    });

    expect(result).toEqual({ threadId: "thr_new" });
    const [spawnArgs] = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawnArgs?.[0]).toMatchObject({
      projectId: "proj_a",
      environment: { type: "project-default" },
      providerId: "claude-code",
      model: "claude-opus-5",
      reasoningLevel: "high",
      serviceTier: "default",
      title: "New issue: Sidebar rows lose their pin state on reload.",
    });
  });

  it("forwards a provider the skill cannot run on rather than overriding it", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    await harness.behavior.callRpc("issue_thread_create", {
      projectId: "proj_a",
      notes: NOTES,
      execution: { ...EXECUTION, providerId: "codex", model: "gpt-5.6-sol" },
    });

    const [spawnArgs] = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawnArgs?.[0]).toMatchObject({ providerId: "codex" });
  });

  it("names the skill and delimits the notes in the prompt", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    await harness.behavior.callRpc("issue_thread_create", {
      projectId: "proj_a",
      notes: NOTES,
      execution: EXECUTION,
    });

    const [spawnArgs] = harness.inspection.sdk.callsTo("threads.spawn");
    const { prompt } = spawnArgs?.[0] as { prompt: string };
    expect(prompt).toContain("draft-issue-description");
    expect(prompt).toContain(`<notes>\n${NOTES}\n</notes>`);
  });

  it("rejects empty notes at the wire boundary", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("issue_thread_create", {
        projectId: "proj_a",
        notes: "   ",
        execution: EXECUTION,
      }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("rejects an incomplete execution selection", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("issue_thread_create", {
        projectId: "proj_a",
        notes: NOTES,
        execution: { providerId: "claude-code", model: "claude-opus-5" },
      }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
});

describe("deriveTitle", () => {
  it("skips leading blank lines", () => {
    expect(deriveTitle("\n\n  Fix the flake  \nmore")).toBe(
      "New issue: Fix the flake",
    );
  });

  it("elides a long first line", () => {
    const title = deriveTitle("x".repeat(200));
    expect(title.length).toBeLessThanOrEqual("New issue: ".length + 72);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("buildPrompt", () => {
  it("trims the notes it embeds", () => {
    expect(buildPrompt("  hello  \n")).toContain("<notes>\nhello\n</notes>");
  });
});

describe("thread_is_ours", () => {
  it("recognizes a thread this plugin spawned", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    expect(
      await harness.behavior.callRpc("thread_is_ours", {
        threadId: "thr_ours",
      }),
    ).toEqual({ isOurs: true });
  });

  it("rejects a thread started anywhere else", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    expect(
      await harness.behavior.callRpc("thread_is_ours", {
        threadId: "thr_other",
      }),
    ).toEqual({ isOurs: false });
  });
});

describe("issue_create_send", () => {
  it("sends the confirmation into one of our threads", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("issue_create_send", {
      threadId: "thr_ours",
    });

    expect(result).toEqual({ sent: true });
    const [sendArgs] = harness.inspection.sdk.callsTo("threads.send");
    expect(sendArgs?.[0]).toMatchObject({
      threadId: "thr_ours",
      mode: "auto",
      input: [{ type: "text", text: "Create the issue.", mentions: [] }],
    });
  });

  it("refuses to post into a thread this plugin did not start", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("issue_create_send", {
      threadId: "thr_other",
    });

    expect(result).toEqual({ sent: false });
    expect(harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  });
});
