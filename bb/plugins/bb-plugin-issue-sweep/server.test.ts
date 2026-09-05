import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { createStore } from "./issues/store.js";

/** A gh that is guaranteed not to exist, so a sweep fails the way it would. */
const MISSING_GH = { ghPath: "/nonexistent/gh-does-not-exist" };

describe("server", () => {
  it("registers the rpc methods, the service, and the settings", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "issue-sweep" });
    await plugin(bb);

    expect(harness.registrations.rpcMethods).toEqual(
      expect.arrayContaining(["listRows", "refresh"]),
    );
    expect(harness.registrations.services.map((service) => service.name)).toContain("sweep");
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual(
      expect.arrayContaining(["syncIntervalMinutes", "ghPath"]),
    );
  });

  /** A host with one issue in the sweep and a project it can spawn into. */
  async function seededHost() {
    const fixture = createFakePluginHost({
      pluginId: "issue-sweep",
      sdk: {
        projects: {
          list: async () => [
            {
              id: "proj_a",
              gitRemoteUrl: "git@github.com:acme/widgets.git",
              sources: [{ hostId: "host_1", path: "/checkout", isDefault: true }],
            },
          ],
        },
        threads: { spawn: async () => ({ id: "thr_1" }), list: async () => [] },
      },
    });
    await plugin(fixture.bb);
    createStore(fixture.bb.storage.database() as never).replaceAll({
      rows: [
        {
          repo: "acme/widgets",
          number: 42,
          title: "Add the widget endpoint",
          url: "https://github.com/acme/widgets/issues/42",
          labels: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          commentsCount: 0,
          blockedBy: 0,
          closingPr: null,
          subtasks: null,
          boardStatus: "Ready",
          onBoard: true,
        },
      ],
      truncated: false,
      failedRepos: [],
      skippedRepos: [],
      sweptAt: Date.now(),
    });
    return fixture;
  }

  it("opens the composer on a new worktree, not the main checkout", async () => {
    // An issue has no branch to land on, so the thread gets its own worktree
    // rather than the checkout everything else is using.
    const { harness } = await seededHost();

    const draft = await harness.behavior.callRpc("startThreadDraft", {
      repo: "acme/widgets",
      number: 42,
    });

    expect(draft.seed).not.toBeNull();
    // hostId included deliberately. bb's schema declares it optional and then
    // refuses the environment without it — "hostId is required unless
    // workspace.type is personal" — and in the composer that refusal is
    // silent: the picker just falls back to the local checkout.
    expect(draft.seed!.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
    expect(draft.seed!.projectId).toBe("proj_a");
    // Still a draft: nothing is created until the composer is submitted.
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("still opens the composer when the project reports no host", async () => {
    // hostId is best-effort: a project bb has not resolved a checkout host for
    // must not cost you the dialog. The composer falls back to its own default
    // environment, which is what it did before any of this was seeded.
    const fixture = createFakePluginHost({
      pluginId: "issue-sweep",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_a", gitRemoteUrl: "git@github.com:acme/widgets.git", sources: [] },
          ],
        },
      },
    });
    await plugin(fixture.bb);
    createStore(fixture.bb.storage.database() as never).replaceAll({
      rows: [
        {
          repo: "acme/widgets",
          number: 42,
          title: "Add the widget endpoint",
          url: "https://github.com/acme/widgets/issues/42",
          labels: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          commentsCount: 0,
          blockedBy: 0,
          closingPr: null,
          subtasks: null,
          boardStatus: "Ready",
          onBoard: true,
        },
      ],
      truncated: false,
      failedRepos: [],
      skippedRepos: [],
      sweptAt: Date.now(),
    });

    const draft = await fixture.harness.behavior.callRpc("startThreadDraft", {
      repo: "acme/widgets",
      number: 42,
    });

    expect(draft.seed).not.toBeNull();
    expect(draft.seed!.environment).not.toHaveProperty("hostId");
  });

  it("shows the issue as a card and offers only the steer for editing", async () => {
    const { harness } = await seededHost();
    const draft = await harness.behavior.callRpc("startThreadDraft", {
      repo: "acme/widgets",
      number: 42,
    });

    // The identifiers are the card, not the first paragraph of the prompt.
    expect(draft.seed!.preview).toMatchObject({
      title: "Add the widget endpoint",
      number: 42,
      url: "https://github.com/acme/widgets/issues/42",
    });
    expect(draft.seed!.prompt).not.toContain("https://github.com");
    expect(draft.seed!.prompt).not.toMatch(/Do not commit unless I ask/);
  });

  it("puts the commit rules back even when the composer's box was emptied", async () => {
    // The composer only ever holds the middle of the prompt, so the standing
    // rule against committing without an ask cannot depend on anyone leaving
    // the seeded text alone.
    const { harness } = await seededHost();

    await harness.behavior.callRpc("startThreadSubmit", {
      repo: "acme/widgets",
      number: 42,
      request: {
        projectId: "proj_a",
        input: [{ type: "text", text: "have a look first", mentions: [] }],
      },
    });

    const [[args]] = harness.inspection.sdk.callsTo("threads.spawn") as [[
      { input: { type: string; text?: string }[] },
    ]];
    // Joined with nothing, which is how bb concatenates a message's text
    // items. The blank lines have to already be in them.
    const sent = args.input.map((item) => item.text ?? "").join("");
    expect(sent).toMatch(/Do not commit unless I ask/);
    // No seam: the URL ending the header, and the last word typed, each get
    // their own blank line rather than running into what follows.
    expect(sent).toContain("issues/42\n\nhave a look first");
    expect(sent).toContain("have a look first\n\nRead it first");
    expect(sent).toContain("acme/widgets#42");
    // And what was typed survives, between the two ends.
    expect(sent).toContain("have a look first");
  });

  it("refuses a draft for an issue the sweep does not have", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "issue-sweep" });
    await plugin(bb);

    expect(await harness.behavior.callRpc("startThreadDraft", {
      repo: "acme/widgets",
      number: 41,
    })).toEqual({
      existingThreadId: null,
      reason: "#41 is no longer in the sweep.",
      seed: null,
    });
  });

  it("never spawns for an issue that left the sweep between draft and submit", async () => {
    // The composer can sit open for as long as the user likes, so the row is
    // re-read at submit rather than trusted from the draft.
    const { bb, harness } = createFakePluginHost({ pluginId: "issue-sweep" });
    await plugin(bb);

    const result = await harness.behavior.callRpc("startThreadSubmit", {
      repo: "acme/widgets",
      number: 41,
      request: {
        projectId: "proj_widgets",
        input: [{ type: "text", text: "Work on it.", mentions: [] }],
      },
    });

    expect(result).toMatchObject({ threadId: null, existing: false });
    expect(harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("returns an empty list before the first sweep", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "issue-sweep" });
    await plugin(bb);

    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing).toMatchObject({
      rows: [],
      sweptAt: null,
      truncated: false,
      lastError: null,
    });
    // Through the contract, not the store: a field missing from the zod schema
    // is stripped here rather than erroring, and the panel just goes blank.
    expect(listing.skippedRepos).toEqual([]);
  });

  it("does not hide itself over a single unreachable gh", async () => {
    // needs-configuration is one-way — the SDK clears it on the next load and
    // offers no way back — so latching on one blip takes the plugin's panels
    // out of the sidebar until someone thinks to reload it. That happened.
    const { bb, harness } = createFakePluginHost({
      pluginId: "issue-sweep",
      settings: MISSING_GH,
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("refresh", null);
    expect(result.ok).toBe(false);
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("reports needs-configuration once gh is consistently unreachable", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "issue-sweep",
      settings: MISSING_GH,
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

  it("surfaces a failed sweep to the panel instead of throwing", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "issue-sweep",
      settings: MISSING_GH,
    });
    await plugin(bb);

    await harness.behavior.callRpc("refresh", null);
    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.lastError).toContain("gh-does-not-exist");
  });

  it("keeps sweeping until its service is aborted", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "issue-sweep",
      settings: MISSING_GH,
    });
    await plugin(bb);

    const service = harness.behavior.runService("sweep");
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.controller.abort();
    await service.done;

    // A failing sweep must not take the service down with it, or the panel
    // would never recover once gh came back.
    const listing = await harness.behavior.callRpc("listRows", null);
    expect(listing.lastError).not.toBeNull();
  });
});
