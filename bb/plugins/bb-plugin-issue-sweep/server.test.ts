import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

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

  it("returns an empty list before the first sweep", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "issue-sweep" });
    await plugin(bb);

    expect(await harness.behavior.callRpc("listRows", null)).toMatchObject({
      rows: [],
      sweptAt: null,
      truncated: false,
      lastError: null,
    });
  });

  it("reports needs-configuration when gh is missing", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "issue-sweep",
      settings: MISSING_GH,
    });
    await plugin(bb);

    const result = await harness.behavior.callRpc("refresh", null);
    expect(result.ok).toBe(false);
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
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
