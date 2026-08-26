import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createStore } from "./review/store.js";
import type { ClassifiedRow } from "./review/types.js";
import plugin from "./server.js";

const PLUGIN_ID = "review-sweep";
const PROJECT = { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] };

let spawnCount = 0;

/** One classified row, as a sweep would have written it. */
function seedRow(overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/42",
    author: "octocat",
    isDraft: false,
    state: "first-look",
    requestedAt: Date.parse("2026-03-06T12:00:00Z"),
    lastReviewedAt: null,
    requestedReviewers: ["you"],
    size: { additions: 40, deletions: 6, changedFiles: 3 },
    ...overrides,
  };
}

/** A host with a matching project, a spawn stub, and one row already swept. */
async function seededHost(
  options: { settings?: Record<string, string>; row?: Partial<ClassifiedRow> } = {},
) {
  spawnCount = 0;
  const liveThreads: Array<{ id: string }> = [];
  const fixture = createFakePluginHost({
    pluginId: PLUGIN_ID,
    ...(options.settings ? { settings: options.settings } : {}),
    sdk: {
      projects: { list: async () => [PROJECT] },
      threads: {
        spawn: async () => {
          // Give a racing second call a window to slip through if the
          // in-flight guard is missing.
          await new Promise((resolve) => setTimeout(resolve, 20));
          const thread = { id: `thr_${++spawnCount}` };
          liveThreads.push(thread);
          return thread;
        },
        list: async () => [...liveThreads],
        archive: async () => ({}),
      },
    },
  });
  await plugin(fixture.bb);
  createStore(fixture.bb.storage.database() as never).replaceAll({
    rows: [seedRow(options.row)],
    truncated: false,
    sweptAt: Date.parse("2026-03-10T12:00:00Z"),
  });
  return { ...fixture, liveThreads };
}

describe("server", () => {
  it("registers the rpc methods, the service, and the settings", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: PLUGIN_ID });
    await plugin(bb);

    expect(harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining(["listRows", "refresh", "reviewThis", "archiveThread"]),
    );
    expect(harness.registrations.services.map((service) => service.name)).toContain("sweep");
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual(
      expect.arrayContaining(["syncIntervalMinutes", "ghPath", "staleAfterDays"]),
    );
  });

  it("returns an empty list before the first sweep", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: PLUGIN_ID,
      sdk: { projects: { list: async () => [] } },
    });
    await plugin(bb);

    expect(await harness.behavior.callRpc("listRows", null)).toMatchObject({
      rows: [],
      sweptAt: null,
      staleAfterDays: 2,
    });
  });

  it("reports needs-configuration when gh is missing", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: PLUGIN_ID,
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("refresh", null);
    expect(result.ok).toBe(false);
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
  });

  it("never reaches threads.spawn from the background sweep", async () => {
    // The sweep is deterministic and spends no model tokens. Only a click does.
    const { bb, harness } = createFakePluginHost({
      pluginId: PLUGIN_ID,
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });
    await plugin(bb);

    const service = harness.behavior.runService("sweep");
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.controller.abort();
    await service.done;

    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("resolves the stale threshold server-side so the panel does not re-parse it", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: PLUGIN_ID,
      settings: { staleAfterDays: "not a number" },
      sdk: { projects: { list: async () => [] } },
    });
    await plugin(bb);
    expect((await harness.behavior.callRpc("listRows", null)).staleAfterDays).toBe(2);
  });

  it("declines to spawn when no bb project matches the repository", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: PLUGIN_ID,
      sdk: { projects: { list: async () => [] } },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("reviewThis", {
      repo: "acme/widgets",
      number: 1,
    });
    expect(result.threadId).toBeNull();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("declines to spawn for a review no longer in the sweep", async () => {
    const { harness } = await seededHost();
    const result = await harness.behavior.callRpc("reviewThis", {
      repo: "acme/widgets",
      number: 999,
    });
    expect(result.reason).toMatch(/no longer in the sweep/);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
});

describe("reviewThis is one thread per review", () => {
  it("spawns once and reuses the thread on a second click", async () => {
    const { harness } = await seededHost();

    const first = await harness.behavior.callRpc("reviewThis", {
      repo: "acme/widgets",
      number: 42,
    });
    const second = await harness.behavior.callRpc("reviewThis", {
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
      harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 }),
      harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 }),
    ]);

    expect(second.threadId).toBe(first.threadId);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("titles the thread with the action and number, not the repository", async () => {
    const { harness } = await seededHost({ row: { state: "re-review" } });
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    // callsTo returns each call's argument list, so [0] is spawn's only arg.
    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[{ title: string }]];
    expect(args.title).toBe("Re-review #42");
    expect(args.title.length).toBeLessThanOrEqual(30);
  });

  it("pins the provider that can actually see the code-review skill", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { providerId?: string; model?: string },
    ]];
    expect(args.providerId).toBe("claude-code");
    // Blank model setting must not reach spawn as an empty string.
    expect(args.model).toBeUndefined();
  });

  it("honours a configured model", async () => {
    const { harness } = await seededHost({ settings: { model: " claude-sonnet-5 " } });
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[{ model?: string }]];
    expect(args.model).toBe("claude-sonnet-5");
  });

  it("carries the no-posting instruction into the spawned prompt", async () => {
    // This is the whole safety story for the action, so it is asserted at the
    // wire rather than only in the prompt unit test.
    const { harness } = await seededHost();
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[{ prompt: string }]];
    expect(args.prompt).toMatch(/Do NOT post anything to GitHub/);
    expect(args.prompt).toContain("acme/widgets#42");
  });

  it("reports the linked thread on the row", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.rows[0]).toMatchObject({ number: 42, threadId: "thr_1" });
  });

  it("frees the row when its thread is deleted", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    await harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "thr_1" }),
    });

    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBeNull();

    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
  });

  it("frees the row when a thread vanished with no event to witness it", async () => {
    // Lifecycle events only fire while the plugin is loaded, so a thread
    // deleted across a restart is invisible to them. Only reconciliation on the
    // next sweep can release the row.
    const { harness, liveThreads } = await seededHost({
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });

    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });
    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBe("thr_1");

    liveThreads.length = 0;
    // The sweep itself fails here; reconciliation must still run.
    await harness.behavior.callRpc("refresh", null);

    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBeNull();
  });
});

describe("permission mode", () => {
  async function spawnedWith(settings: Record<string, string>) {
    const { harness } = await seededHost({ settings });
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });
    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { permissionMode?: string },
    ]];
    return args.permissionMode;
  }

  it("defaults to full, the only mode that can reach GitHub to read the diff", async () => {
    // auto keeps the workspace sandbox, which blocks network egress, so the
    // thread could not fetch the diff it was started for.
    expect(await spawnedWith({})).toBe("full");
  });

  it("honours a configured mode", async () => {
    expect(await spawnedWith({ permissionMode: "auto" })).toBe("auto");
  });

  it("never passes a mode bb would reject", async () => {
    expect(await spawnedWith({ permissionMode: "bypass-everything" })).toBe("full");
  });
});

describe("archiveThread", () => {
  it("archives the linked thread and frees the row", async () => {
    const { harness } = await seededHost();
    await harness.behavior.callRpc("reviewThis", { repo: "acme/widgets", number: 42 });

    const result = await harness.behavior.callRpc("archiveThread", {
      repo: "acme/widgets",
      number: 42,
    });

    expect(result.ok).toBe(true);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(1);
    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBeNull();
  });

  it("declines when the review has no thread", async () => {
    const { harness } = await seededHost();
    const result = await harness.behavior.callRpc("archiveThread", {
      repo: "acme/widgets",
      number: 42,
    });
    expect(result.ok).toBe(false);
    expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
  });
});

describe("pullRequestForThread", () => {
  it("returns the pull request for a thread this plugin started", async () => {
    const { harness } = await seededHost();
    const spawn = await harness.behavior.callRpc("reviewThis", {
      repo: "acme/widgets",
      number: 42,
    });

    expect(
      await harness.behavior.callRpc("pullRequestForThread", { threadId: spawn.threadId! }),
    ).toMatchObject({
      repo: "acme/widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
    });
  });

  it("returns null for a thread it did not start", async () => {
    // This is the authorization boundary for the header action: an unknown
    // thread gets nothing, so the control never appears elsewhere.
    const { harness } = await seededHost();
    expect(
      await harness.behavior.callRpc("pullRequestForThread", { threadId: "thr_someone_else" }),
    ).toBeNull();
  });

  it("still resolves a URL after the review leaves the queue", async () => {
    // Submitting the review drops the request out of the sweep, which is
    // exactly when the thread is most likely to still be open.
    const { bb, harness } = await seededHost();
    const spawn = await harness.behavior.callRpc("reviewThis", {
      repo: "acme/widgets",
      number: 42,
    });

    createStore(bb.storage.database() as never).replaceAll({
      rows: [],
      truncated: false,
      sweptAt: Date.now(),
    });

    const result = await harness.behavior.callRpc("pullRequestForThread", {
      threadId: spawn.threadId!,
    });
    expect(result?.url).toBe("https://github.com/acme/widgets/pull/42");
  });
});
