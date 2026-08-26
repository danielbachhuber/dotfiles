import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createStore } from "./sweep/store.js";
import plugin from "./server.js";

describe("server", () => {
  it("registers the rpc methods, the service, and the settings", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "pr-sweep" });
    await plugin(bb);

    expect(harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining(["listRows", "refresh", "workOnThis"]),
    );
    expect(harness.registrations.services.map((service) => service.name)).toContain("sweep");
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual(
      expect.arrayContaining(["syncIntervalMinutes", "ghPath"]),
    );
  });

  it("returns an empty list before the first sweep", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      sdk: { projects: { list: async () => [] } },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("listRows", null);
    expect(result).toMatchObject({ rows: [], sweptAt: null });
  });

  it("reports needs-configuration when gh is missing", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("refresh", null);
    expect(result.ok).toBe(false);
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
  });

  it("never reaches threads.spawn from the background sweep", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });
    await plugin(bb);

    const service = harness.behavior.runService("sweep");
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.controller.abort();
    await service.done;

    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("declines to spawn when no bb project matches the repository", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      sdk: { projects: { list: async () => [] } },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("workOnThis", {
      repo: "acme/widgets",
      number: 1,
    });
    expect(result.threadId).toBeNull();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
});

let spawnCount = 0;


describe("workOnThis is one thread per pull request", () => {
  async function seededHost() {
    spawnCount = 0;
    const fixture = createFakePluginHost({
      pluginId: "pr-sweep",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: {
          spawn: async () => {
            // Give a racing second call a window to slip through if the
            // in-flight guard is missing.
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { id: `thr_${++spawnCount}` };
          },
        },
      },
    });
    await plugin(fixture.bb);

    // Seed a row the way a sweep would, through the plugin's own database.
    const rows = [
      {
        repo: "acme/widgets",
        number: 42,
        title: "Add the widget endpoint",
        url: "https://github.com/acme/widgets/pull/42",
        isDraft: false,
        flags: ["conflict"],
        group: "needs-action",
        checks: { pass: 1, fail: 0, skip: 0, pending: 0, cancelled: 0, total: 1 },
        approvedBy: [],
        commentedBy: [],
        waitingOn: [],
        awaitingReReview: false,
      },
    ];
    createStore(fixture.bb.storage.database() as never).replaceRepoRows("acme/widgets", rows as never);
    return fixture;
  }

  it("spawns once and reuses the thread on a second click", async () => {
    const { harness } = await seededHost();

    const first = await harness.behavior.callRpc("workOnThis", {
      repo: "acme/widgets",
      number: 42,
    });
    const second = await harness.behavior.callRpc("workOnThis", {
      repo: "acme/widgets",
      number: 42,
    });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.threadId).toBe(first.threadId);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("spawns once when two clicks race before the first returns", async () => {
    const { harness } = await seededHost();

    const [first, second] = await Promise.all([
      harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 }),
      harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 }),
    ]);

    expect(second.threadId).toBe(first.threadId);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("reports the linked thread on the row", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.rows[0]).toMatchObject({ number: 42, threadId: "thr_1" });
  });

  it("frees the row again when its thread is deleted", async () => {
    const { bb, harness } = await seededHost();
    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });

    await harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "thr_1" }),
    });

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.rows[0]!.threadId).toBeNull();

    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
  });
});
