import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { createStore } from "./sweep/store.js";
import plugin from "./server.js";

describe("server", () => {
  it("registers the rpc methods, the service, and the settings", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "pr-sweep" });
    await plugin(bb);

    expect(harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining([
        "listRows",
        "refresh",
        "workOnThisDraft",
        "workOnThisSubmit",
      ]),
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
    // Through the contract, not the store: a field missing from the zod schema
    // is stripped here rather than erroring, and the panel just goes blank.
    expect(result.skippedRepos).toEqual([]);
  });

  it("does not hide itself over a single unreachable gh", async () => {
    // needs-configuration is one-way — the SDK clears it on the next load and
    // offers no way back — so latching on one blip takes the plugin's panels
    // out of the sidebar until someone thinks to reload it. That happened.
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("refresh", null);
    expect(result.ok).toBe(false);
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("reports needs-configuration once gh is consistently unreachable", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "pr-sweep",
      settings: { ghPath: "/nonexistent/gh-does-not-exist" },
    });
    await plugin(bb);

    // Three consecutive failures is a configuration problem rather than
    // weather, and by then the message is worth acting on.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await harness.behavior.callRpc("refresh", null);
    }
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
    expect(harness.needsConfigurationMessages[0]).toMatch(/not found on PATH/i);
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

    // The refusal lands on the draft, before the composer ever opens: there
    // is no project to compose into, so there is nothing to show.
    const result = await harness.behavior.callRpc("workOnThisDraft", {
      repo: "acme/widgets",
      number: 1,
    });
    expect(result.seed).toBeNull();
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("never spawns for a pull request that left the sweep while the composer was open", async () => {
    // The composer can sit open for as long as the user likes, so the row is
    // re-read at submit rather than trusted from the draft.
    const { bb, harness } = createFakePluginHost({ pluginId: "pr-sweep" });
    await plugin(bb);

    const result = await harness.behavior.callRpc("workOnThisSubmit", {
      repo: "acme/widgets",
      number: 1,
      request: {
        projectId: "proj_a",
        input: [{ type: "text", text: "Work on it.", mentions: [] }],
      },
    });
    expect(result.reason).toMatch(/no longer in the sweep/);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
});

let spawnCount = 0;

/** One classified row, as a sweep would have written it. */
/**
 * The whole panel gesture in one call: fetch the seeds, then submit them back
 * untouched, which is what happens when the user accepts BB's composer as it
 * opens. Tests that care about the seeds call `workOnThisDraft` directly;
 * tests that care about the spawn go through here.
 */
async function workOnThis(
  harness: { behavior: { callRpc: (method: string, input: unknown) => Promise<any> } },
  { repo, number }: { repo: string; number: number },
) {
  const draft = await harness.behavior.callRpc("workOnThisDraft", { repo, number });
  if (draft.existingThreadId) {
    return { threadId: draft.existingThreadId, existing: true, reason: null };
  }
  if (!draft.seed) return { threadId: null, existing: false, reason: draft.reason };

  // Stands in for what BB's composer resolves from those seeds. Only the
  // fields the plugin's own schema reads are asserted anywhere; the rest is
  // forwarded verbatim, so a faithful shape is enough.
  return await harness.behavior.callRpc("workOnThisSubmit", {
    repo,
    number,
    request: {
      projectId: draft.seed.projectId,
      ...(draft.seed.providerId ? { providerId: draft.seed.providerId } : {}),
      ...(draft.seed.model ? { model: draft.seed.model } : {}),
      permissionMode: draft.seed.permissionMode,
      environment: { type: "project-default" },
      input: [{ type: "text", text: draft.seed.prompt, mentions: [] }],
    },
  });
}

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
    lastCommentBy: null,
    unresolvedThreads: 0,
    outdatedThreads: 0,
    notedBy: [],
  };
}


describe("workOnThisSubmit is one thread per pull request", () => {
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

    const first = await workOnThis(harness, { repo: "acme/widgets", number: 42 });
    const second = await workOnThis(harness, { repo: "acme/widgets", number: 42 });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.threadId).toBe(first.threadId);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("spawns once when two clicks race before the first returns", async () => {
    const { harness } = await seededHost();

    const [first, second] = await Promise.all([
      workOnThis(harness, { repo: "acme/widgets", number: 42 }),
      workOnThis(harness, { repo: "acme/widgets", number: 42 }),
    ]);

    expect(second.threadId).toBe(first.threadId);
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("puts the worktree rules back even when the composer's box was emptied", async () => {
    // The composer only ever holds the middle of the prompt. These rules are
    // in the trailer precisely so they hold whatever gets typed — an agent
    // that builds its worktree in /tmp leaves work bb cannot see.
    const { harness } = await seededHost();

    const draft = await harness.behavior.callRpc("workOnThisDraft", {
      repo: "acme/widgets",
      number: 42,
    });
    expect(draft.seed!.prompt).not.toMatch(/You already have a git worktree/);

    await harness.behavior.callRpc("workOnThisSubmit", {
      repo: "acme/widgets",
      number: 42,
      request: {
        projectId: "proj_a",
        input: [{ type: "text", text: "just the conflict please", mentions: [] }],
      },
    });

    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { input: { type: string; text?: string }[] },
    ]];
    // Joined with nothing, which is how bb concatenates a message's text
    // items. The blank lines have to already be in them.
    const sent = args.input.map((item) => item.text ?? "").join("");
    expect(sent).toMatch(/You already have a git worktree/);
    // No seam: the URL ending the header, and the last word typed, each get
    // their own blank line rather than running into what follows.
    expect(sent).toContain("pull/42\n\njust the conflict please");
    expect(sent).toContain("just the conflict please\n\nI started this");
    expect(sent).toMatch(/my explicit request for this work/);
    expect(sent).toContain("acme/widgets#42");
    // And what was typed survives, between the two ends.
    expect(sent).toContain("just the conflict please");
  });

  it("titles the thread with the number and PR gist, not the repository or the flag", async () => {
    const { harness } = await seededHost();
    await workOnThis(harness, { repo: "acme/widgets", number: 42 });

    // callsTo returns each call's argument list, so [0] is spawn's only arg.
    const [[spawnArgs]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { title: string },
    ]];
    expect(spawnArgs.title).toBe("Refine #42: Add the widget endpoint");
    expect(spawnArgs.title.length).toBeLessThanOrEqual(40);
  });

  it("spawns a conflict thread on the cheap model, and others on the default", async () => {
    const { harness } = await seededHost();
    await workOnThis(harness, { repo: "acme/widgets", number: 42 });

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

    await workOnThis(harness, { repo: "acme/widgets", number: 42 });
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

    const result = await workOnThis(harness, { repo: "acme/widgets", number: 42 });
    expect(result.threadId).toBe("thr_1");
    expect(harness.logEntries.some((entry) => /Model by action/.test(entry.message))).toBe(true);
  });

  it("reports the linked thread on the row", async () => {
    const { harness } = await seededHost();
    await workOnThis(harness, { repo: "acme/widgets", number: 42 });

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

    await workOnThis(harness, { repo: "acme/widgets", number: 42 });
    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBe("thr_1");

    // The thread disappears. No event fires.
    liveThreads.length = 0;
    await harness.behavior.callRpc("refresh", null);

    expect((await harness.behavior.callRpc("listRows", null)).rows[0]!.threadId).toBeNull();
  });

  it("frees the row again when its thread is deleted", async () => {
    const { bb, harness } = await seededHost();
    await workOnThis(harness, { repo: "acme/widgets", number: 42 });

    await harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "thr_1" }),
    });

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.rows[0]!.threadId).toBeNull();

    await workOnThis(harness, { repo: "acme/widgets", number: 42 });
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
    await workOnThis(harness, { repo: "acme/widgets", number: 42 });
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
      await workOnThis(fixture.harness, { repo: "acme/widgets", number: 42 });
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
    const spawn = await workOnThis(harness, { repo: "acme/widgets", number: 42 });

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
    const spawn = await workOnThis(harness, { repo: "acme/widgets", number: 42 });

    // The PR merges, so the next sweep drops its row while the link remains.
    createStore(bb.storage.database() as never).replaceRepoRows("acme/widgets", []);

    const result = await harness.behavior.callRpc("pullRequestForThread", {
      threadId: spawn.threadId!,
    });
    expect(result?.url).toBe("https://github.com/acme/widgets/pull/42");
  });
});
