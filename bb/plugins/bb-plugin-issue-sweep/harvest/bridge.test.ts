import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, test, vi } from "vitest";

import { createHarvestBridge } from "./bridge.js";

const PROJECTS = [
  {
    id: 11,
    name: "Internal",
    code: "INT",
    clientName: "Acme",
    tasks: [{ id: 22, name: "Development" }],
  },
];

// Async, because the real `bb.sdk.plugins.callRpc` returns a promise. A
// synchronous fake lets a bridge method leak a non-promise or a synchronous
// throw and still look correct.
function bridgeWith(callRpc: (args: { method: string; input?: unknown }) => Promise<unknown>) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "issue-sweep",
    sdk: { plugins: { callRpc } },
  });

  return { bridge: createHarvestBridge(bb), harness };
}

/** A Harvest plugin that is absent, disabled, or failing its own load. */
function unavailable() {
  return bridgeWith(async () => {
    throw new Error("plugin \"harvest\" is not installed");
  });
}

describe("availability", () => {
  test("is available when Harvest is installed and configured", async () => {
    const { bridge } = bridgeWith(async () => ({ configured: true, user: null, error: null }));
    await expect(bridge.available()).resolves.toBe(true);
  });

  test("is unavailable when Harvest has no credentials yet", async () => {
    const { bridge } = bridgeWith(async () => ({ configured: false, user: null, error: null }));
    await expect(bridge.available()).resolves.toBe(false);
  });

  test("is unavailable when the Harvest plugin is not installed", async () => {
    // Issue Sweep has to stay fully useful on a machine with no Harvest
    // plugin, so a missing plugin is a state rather than an error.
    await expect(unavailable().bridge.available()).resolves.toBe(false);
  });

  test("stays available when Harvest is merely rate limiting", async () => {
    // A rejected token is worth hiding the clock for; a busy Harvest is not.
    const { bridge } = bridgeWith(async () => ({
      configured: true,
      user: null,
      error: "rate_limited",
    }));
    await expect(bridge.available()).resolves.toBe(true);
  });

  test("is unavailable when Harvest rejects the stored credentials", async () => {
    const { bridge } = bridgeWith(async () => ({
      configured: true,
      user: null,
      error: "unauthenticated",
    }));
    await expect(bridge.available()).resolves.toBe(false);
  });

  test("asks the Harvest plugin by id", async () => {
    const callRpc = vi.fn(async () => ({ configured: true, user: null, error: null }));
    const { bridge } = bridgeWith(callRpc);

    await bridge.available();

    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "harvest", method: "status" }),
    );
  });
});

describe("reads", () => {
  test("passes the project list through", async () => {
    const { bridge } = bridgeWith(async () => ({ projects: PROJECTS }));
    await expect(bridge.assignments()).resolves.toEqual({ projects: PROJECTS });
  });

  test("reports no projects rather than failing when Harvest is gone", async () => {
    await expect(unavailable().bridge.assignments()).resolves.toEqual({ projects: [] });
  });

  test("passes tracked hours through", async () => {
    const { bridge } = bridgeWith(async () => ({ hours: 0.25 }));
    await expect(bridge.trackedHours({ externalId: "5515", groupId: "acme-widgets" })).resolves.toEqual({
      hours: 0.25,
    });
  });

  test("reports zero hours rather than failing when Harvest is gone", async () => {
    await expect(unavailable().bridge.trackedHours({ externalId: "5515" })).resolves.toEqual({
      hours: 0,
    });
  });

  test("forwards the group so the total excludes other repositories", async () => {
    const callRpc = vi.fn(async () => ({ hours: 0 }));
    const { bridge } = bridgeWith(callRpc);

    await bridge.trackedHours({ externalId: "5515", groupId: "acme-widgets" });

    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "trackedHours",
        input: { externalId: "5515", groupId: "acme-widgets" },
      }),
    );
  });

  test("reports nothing remembered rather than failing when Harvest is gone", async () => {
    await expect(unavailable().bridge.lastSelection({ scope: "acme-widgets" })).resolves.toBeNull();
  });

  test("passes a remembered selection through", async () => {
    const { bridge } = bridgeWith(async () => ({ projectId: 11, taskId: 22 }));
    await expect(bridge.lastSelection({ scope: "acme-widgets" })).resolves.toEqual({
      projectId: 11,
      taskId: 22,
    });
  });
});

describe("the running timer", () => {
  test("reports which reference the running timer is against", async () => {
    const { bridge } = bridgeWith(async () => ({
      entry: {
        id: 900,
        projectName: "Internal",
        taskName: "Development",
        notes: null,
        hours: 0,
        timerStartedAt: "2026-09-02T10:00:00Z",
        externalReference: {
          id: "5515",
          groupId: "acme-widgets",
          accountId: "octocat",
          permalink: null,
        },
      },
    }));

    await expect(bridge.runningReference()).resolves.toEqual({
      externalId: "5515",
      groupId: "acme-widgets",
    });
  });

  test("reports nothing when no timer is running", async () => {
    const { bridge } = bridgeWith(async () => ({ entry: null }));
    await expect(bridge.runningReference()).resolves.toBeNull();
  });

  test("reports nothing when the running timer is not linked to anything", async () => {
    // A timer started from the thread header has no issue behind it, so no
    // row should light up for it.
    const { bridge } = bridgeWith(async () => ({
      entry: {
        id: 900,
        projectName: "Internal",
        taskName: "Development",
        notes: null,
        hours: 0,
        timerStartedAt: "2026-09-02T10:00:00Z",
        externalReference: null,
      },
    }));

    await expect(bridge.runningReference()).resolves.toBeNull();
  });

  test("reports nothing rather than failing when Harvest is gone", async () => {
    await expect(unavailable().bridge.runningReference()).resolves.toBeNull();
  });
});

describe("starting a timer", () => {
  test("passes the started entry through", async () => {
    const entry = {
      id: 900,
      projectName: "Internal",
      taskName: "Development",
      notes: "#5515: Audit",
      hours: 0,
      timerStartedAt: "2026-09-02T10:00:00Z",
      externalReference: { id: "5515", groupId: "acme-widgets", accountId: "octocat", permalink: null },
    };
    const { bridge } = bridgeWith(async () => ({ entry }));

    await expect(
      bridge.startTimer({ projectId: 11, taskId: 22, notes: "#5515: Audit" }),
    ).resolves.toEqual({ entry });
  });

  test("reports the failure instead of swallowing it", async () => {
    // A read that quietly returns nothing is fine. A write that quietly does
    // nothing would leave the user believing time is being tracked.
    await expect(
      unavailable().bridge.startTimer({ projectId: 11, taskId: 22, notes: "x" }),
    ).rejects.toThrow();
  });

  test("forwards the external reference unchanged", async () => {
    const callRpc = vi.fn(async () => ({ entry: null }));
    const { bridge } = bridgeWith(callRpc);
    const externalReference = {
      id: "5515",
      groupId: "acme-widgets",
      accountId: "octocat",
      permalink: "https://github.com/octocat/acme-widgets/issues/5515",
    };

    await bridge.startTimer({ projectId: 11, taskId: 22, notes: "x", externalReference });

    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "startTimer",
        input: { projectId: 11, taskId: 22, notes: "x", externalReference },
      }),
    );
  });
});
