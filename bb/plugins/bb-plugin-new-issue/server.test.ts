import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, {
  ISSUE_INSTRUCTION,
  deriveTitle,
  extractNotes,
} from "./server";

const NOTES = "Sidebar rows lose their pin state on reload.";

/** A NewThreadRequest as BB's composer submits one. */
function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj_a",
    providerId: "claude-code",
    model: "claude-opus-5",
    reasoningLevel: "high",
    permissionMode: "auto",
    serviceTier: "default",
    executionInputSources: { model: "explicit" },
    environment: { type: "host", workspace: { type: "managed-worktree" } },
    input: [{ type: "text", text: NOTES, mentions: [] }],
    ...overrides,
  };
}

function createHost() {
  return createFakePluginHost({
    pluginId: "new-issue",
    sdk: {
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

describe("issue_thread_create", () => {
  it("forwards every selection the composer resolved, untouched", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    const result = await harness.behavior.callRpc("issue_thread_create", {
      request: makeRequest(),
    });

    expect(result).toEqual({ threadId: "thr_new" });
    const [spawnArgs] = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawnArgs?.[0]).toMatchObject({
      projectId: "proj_a",
      providerId: "claude-code",
      model: "claude-opus-5",
      reasoningLevel: "high",
      permissionMode: "auto",
      serviceTier: "default",
      executionInputSources: { model: "explicit" },
      environment: { type: "host", workspace: { type: "managed-worktree" } },
      title: "New issue: Sidebar rows lose their pin state on reload.",
    });
  });

  it("prepends the skill instruction and keeps the composed prompt intact", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);
    const mention = {
      type: "text",
      text: "See @src/sidebar.ts",
      mentions: [{ start: 4, end: 19, resource: { kind: "project" } }],
    };

    await harness.behavior.callRpc("issue_thread_create", {
      request: makeRequest({
        input: [{ type: "text", text: NOTES, mentions: [] }, mention],
      }),
    });

    const [spawnArgs] = harness.inspection.sdk.callsTo("threads.spawn");
    const { input } = spawnArgs?.[0] as { input: unknown[] };
    expect(input[0]).toEqual({
      type: "text",
      text: ISSUE_INSTRUCTION,
      mentions: [],
    });
    // The user's own items follow verbatim, mentions and all.
    expect(input.slice(1)).toEqual([
      { type: "text", text: NOTES, mentions: [] },
      mention,
    ]);
  });

  it("passes non-text prompt items through", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);
    const image = { type: "localImage", path: "shot.png" };

    await harness.behavior.callRpc("issue_thread_create", {
      request: makeRequest({
        input: [{ type: "text", text: NOTES, mentions: [] }, image],
      }),
    });

    const [spawnArgs] = harness.inspection.sdk.callsTo("threads.spawn");
    const { input } = spawnArgs?.[0] as { input: unknown[] };
    expect(input).toContainEqual(image);
  });

  it("refuses a prompt with no typed text", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("issue_thread_create", {
        request: makeRequest({
          input: [{ type: "localImage", path: "shot.png" }],
        }),
      }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("rejects an empty prompt at the wire boundary", async () => {
    const { bb, harness } = createHost();
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("issue_thread_create", {
        request: makeRequest({ input: [] }),
      }),
    ).rejects.toThrow();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
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

describe("extractNotes", () => {
  it("joins every text item and ignores the rest", () => {
    expect(
      extractNotes([
        { type: "text", text: " one " },
        { type: "localImage" },
        { type: "text", text: "two" },
      ] as { type: string }[]),
    ).toBe("one \ntwo");
  });

  it("is empty when nothing was typed", () => {
    expect(extractNotes([{ type: "localImage" }])).toBe("");
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
