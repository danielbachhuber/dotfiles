import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createStore } from "./shared/store.js";
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

/** One classified row, as a sweep would have written it. */
function seedRow() {
  return {
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
  };
}


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
    createStore(fixture.bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      seedRow(),
    ] as never);
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

  it("titles the thread with the action and number, not the repository", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });

    // callsTo returns each call's argument list, so [0] is spawn's only arg.
    const [[spawnArgs]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { title: string },
    ]];
    expect(spawnArgs.title).toBe("Resolve conflict #42");
    expect(spawnArgs.title.length).toBeLessThanOrEqual(30);
  });

  it("spawns a conflict thread on the cheap model, and others on the default", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });

    const [[spawnArgs]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { model?: string; providerId?: string },
    ]];
    expect(spawnArgs.model).toBe("claude-sonnet-5");
    expect(spawnArgs.providerId).toBe("claude-code");
  });

  it("takes the provider default model for an action with none configured", async () => {
    spawnCount = 0;
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: { spawn: async () => ({ id: `thr_${++spawnCount}` }), list: async () => [] },
      },
    });
    await plugin(bb);
    createStore(bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      { ...seedRow(), flags: ["ci-failing"] },
    ] as never);

    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });
    const [[spawnArgs]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { model?: string },
    ]];
    expect(spawnArgs.model).toBeUndefined();
  });

  it("spawns anyway when the model setting is malformed", async () => {
    spawnCount = 0;
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      settings: { modelByAction: "{not json" },
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: { spawn: async () => ({ id: `thr_${++spawnCount}` }), list: async () => [] },
      },
    });
    await plugin(bb);
    createStore(bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      seedRow(),
    ] as never);

    const result = await harness.behavior.callRpc("workOnThis", {
      repo: "acme/widgets",
      number: 42,
    });
    expect(result.threadId).toBe("thr_1");
    expect(harness.logEntries.some((entry) => /Model by action/.test(entry.message))).toBe(true);
  });

  it("reports the linked thread on the row", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.rows[0]).toMatchObject({ number: 42, threadId: "thr_1" });
  });

  it("frees the row when a thread vanished with no event to witness it", async () => {
    // Lifecycle events only fire while the plugin is loaded, so a thread
    // deleted across a restart is invisible to them. Only reconciliation on
    // the next sweep can release the row.
    spawnCount = 0;
    const liveThreads: Array<{ id: string }> = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: {
          spawn: async () => {
            const thread = { id: `thr_${++spawnCount}` };
            liveThreads.push(thread);
            return thread;
          },
          list: async () => [...liveThreads],
        },
      },
    });
    await plugin(bb);
    createStore(bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      seedRow(),
    ] as never);

    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });
    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBe("thr_1");

    // The thread disappears. No event fires.
    liveThreads.length = 0;
    await harness.behavior.callRpc("refresh", null);

    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBeNull();
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

describe("permission mode", () => {
  async function hostWithSettings(settings: Record<string, string>) {
    spawnCount = 0;
    const fixture = createFakePluginHost({
      pluginId: "pr-sweep",
      settings,
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: { spawn: async () => ({ id: `thr_${++spawnCount}` }), list: async () => [] },
      },
    });
    await plugin(fixture.bb);
    createStore(fixture.bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      seedRow(),
    ] as never);
    return fixture;
  }

  async function spawnedWith(settings: Record<string, string>) {
    const { harness } = await hostWithSettings(settings);
    await harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });
    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { permissionMode?: string },
    ]];
    return args.permissionMode;
  }

  it("defaults to full, the only mode that reaches the remote", async () => {
    // accept-edits stops at the first shell command; auto keeps the workspace
    // sandbox, which blocks network egress, so the commit lands and the push
    // fails. Only full carries a resolution through to the PR.
    expect(await spawnedWith({})).toBe("full");
  });

  it("honours a configured mode", async () => {
    expect(await spawnedWith({ permissionMode: "accept-edits" })).toBe("accept-edits");
    expect(await spawnedWith({ permissionMode: "auto" })).toBe("auto");
  });

  it("never passes a mode bb would reject", async () => {
    expect(await spawnedWith({ permissionMode: "bypass-everything" })).toBe("full");
  });
});

describe("archiveThread", () => {
  async function hostWithThread(link: boolean) {
    spawnCount = 0;
    const archived: string[] = [];
    const fixture = createFakePluginHost({
      pluginId: "pr-sweep",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: {
          spawn: async () => ({ id: `thr_${++spawnCount}` }),
          list: async () => [],
          archive: async ({ threadId }: { threadId: string }) => {
            archived.push(threadId);
            return {};
          },
        },
      },
    });
    await plugin(fixture.bb);
    createStore(fixture.bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      { ...seedRow(), flags: [], group: "clean" },
    ] as never);

    if (link) {
      await fixture.harness.behavior.callRpc("workOnThis", { repo: "acme/widgets", number: 42 });
    }
    return { ...fixture, archived };
  }

  it("archives the linked thread and frees the row", async () => {
    const { harness } = await hostWithThread(true);

    const result = await harness.behavior.callRpc("archiveThread", {
      repo: "acme/widgets",
      number: 42,
    });

    expect(result.ok).toBe(true);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.rows[0]!.threadId).toBeNull();
  });

  it("declines when the pull request has no thread", async () => {
    const { harness } = await hostWithThread(false);
    const result = await harness.behavior.callRpc("archiveThread", {
      repo: "acme/widgets",
      number: 42,
    });
    expect(result.ok).toBe(false);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
  });
});

describe("pullRequestForThread", () => {
  async function host() {
    spawnCount = 0;
    const fixture = createFakePluginHost({
      pluginId: "pr-sweep",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
        threads: { spawn: async () => ({ id: `thr_${++spawnCount}` }), list: async () => [] },
      },
    });
    await plugin(fixture.bb);
    createStore(fixture.bb.storage.database() as never).replaceRepoRows("acme/widgets", [
      seedRow(),
    ] as never);
    return fixture;
  }

  it("returns the pull request for a thread this plugin started", async () => {
    const { harness } = await host();
    const spawn = await harness.behavior.callRpc("workOnThis", {
      repo: "acme/widgets",
      number: 42,
    });

    const result = await harness.behavior.callRpc("pullRequestForThread", {
      threadId: spawn.threadId!,
    });
    expect(result).toMatchObject({
      repo: "acme/widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
    });
  });

  it("returns null for a thread it did not start", async () => {
    // This is the authorization boundary for the header action: an unknown
    // thread gets nothing, so the control never appears elsewhere.
    const { harness } = await host();
    expect(
      await harness.behavior.callRpc("pullRequestForThread", { threadId: "thr_someone_else" }),
    ).toBeNull();
  });

  it("still resolves a URL after the pull request leaves the sweep", async () => {
    const { bb, harness } = await host();
    const spawn = await harness.behavior.callRpc("workOnThis", {
      repo: "acme/widgets",
      number: 42,
    });

    // The PR merges, so the next sweep drops its row while the link remains.
    createStore(bb.storage.database() as never).replaceRepoRows("acme/widgets", []);

    const result = await harness.behavior.callRpc("pullRequestForThread", {
      threadId: spawn.threadId!,
    });
    expect(result?.url).toBe("https://github.com/acme/widgets/pull/42");
  });
});
