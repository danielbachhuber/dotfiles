import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { VIEWED_CHANGED } from "./server";

async function start() {
  const host = createFakePluginHost({ pluginId: "diff-viewed" });
  await plugin(host.bb);
  return host;
}

const A = { threadId: "thr_a", path: "src/a.ts", fingerprint: "+8 -4" };

describe("viewed_set", () => {
  it("persists a mark and hands back the new record", async () => {
    const { harness } = await start();

    const set = await harness.behavior.callRpc("viewed_set", {
      ...A,
      viewed: true,
    });
    expect(set).toEqual({ record: { "src/a.ts": "+8 -4" } });

    const listed = await harness.behavior.callRpc("viewed_list", {
      threadId: "thr_a",
    });
    expect(listed).toEqual({ record: { "src/a.ts": "+8 -4" } });
  });

  it("clears a mark", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });

    const cleared = await harness.behavior.callRpc("viewed_set", {
      ...A,
      viewed: false,
    });
    expect(cleared).toEqual({ record: {} });
  });

  it("keeps marks in separate threads apart", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });

    const other = await harness.behavior.callRpc("viewed_list", {
      threadId: "thr_b",
    });
    expect(other).toEqual({ record: {} });
  });

  it("publishes so another window can refetch", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });

    expect(harness.inspection.realtimeSignals).toEqual([
      { channel: VIEWED_CHANGED, payload: { threadId: "thr_a" } },
    ]);
  });

  it("does not write or publish when the mark is already what was asked for", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });
    const before = harness.inspection.realtimeSignals.length;

    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });
    expect(harness.inspection.realtimeSignals).toHaveLength(before);
  });

  it("rejects an empty thread id at the wire boundary", async () => {
    const { harness } = await start();
    await expect(
      harness.behavior.callRpc("viewed_set", { ...A, threadId: "", viewed: true }),
    ).rejects.toThrow();
  });
});

describe("viewed_prune", () => {
  it("drops marks for files that left the diff", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });
    await harness.behavior.callRpc("viewed_set", {
      ...A,
      path: "src/b.ts",
      viewed: true,
    });

    const pruned = await harness.behavior.callRpc("viewed_prune", {
      threadId: "thr_a",
      presentPaths: ["src/a.ts"],
    });
    expect(pruned).toEqual({ record: { "src/a.ts": "+8 -4" } });
  });

  it("is a no-op when every mark is still present", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });
    const before = harness.inspection.realtimeSignals.length;

    await harness.behavior.callRpc("viewed_prune", {
      threadId: "thr_a",
      presentPaths: ["src/a.ts", "src/b.ts"],
    });
    expect(harness.inspection.realtimeSignals).toHaveLength(before);
  });
});

describe("toolbar prefs", () => {
  it("starts with no preference, so bb's own defaults stand", async () => {
    const { harness } = await start();
    expect(await harness.behavior.callRpc("prefs_get", null)).toEqual({
      prefs: {},
    });
  });

  it("round-trips a saved preference", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("prefs_set", { wrap: true, view: "split" });

    expect(await harness.behavior.callRpc("prefs_get", null)).toEqual({
      prefs: { wrap: true, view: "split" },
    });
  });

  it("is global, not scoped to a thread", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("viewed_set", { ...A, viewed: true });
    await harness.behavior.callRpc("prefs_set", { view: "split" });

    // Marks and prefs live in separate keys; neither write disturbs the other.
    expect(await harness.behavior.callRpc("prefs_get", null)).toEqual({
      prefs: { view: "split" },
    });
    expect(await harness.behavior.callRpc("viewed_list", { threadId: "thr_a" })).toEqual(
      { record: { "src/a.ts": "+8 -4" } },
    );
  });

  it("stores one control without inventing the other", async () => {
    const { harness } = await start();
    await harness.behavior.callRpc("prefs_set", { wrap: true });
    expect(await harness.behavior.callRpc("prefs_get", null)).toEqual({
      prefs: { wrap: true },
    });
  });

  it("rejects a view mode it does not know", async () => {
    const { harness } = await start();
    await expect(
      harness.behavior.callRpc("prefs_set", { view: "sidebyside" }),
    ).rejects.toThrow();
  });
});
