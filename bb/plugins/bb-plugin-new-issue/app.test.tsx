// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

describe("the New issue nav panel", () => {
  it("registers a sidebar row at its own route", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "new-issue",
      title: "New issue",
      path: "new-issue",
    });
  });

  it("heads the page with Create new issue", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { context: { projectId: "proj_a", threadId: null } },
    );
    expect(
      slot.getByRole("heading", { name: "Create new issue" }),
    ).toBeTruthy();
  });
});

describe("the Create issue button", () => {
  async function renderHeaderAction(
    overrides: { isOurs?: boolean; onSend?: () => unknown } = {},
  ) {
    const app = await loadPluginApp(() => import("./app"));
    return renderSlot(
      app.threadHeaderActions[0]!,
      { threadId: "thr_ours", projectId: "proj_a", isCompactViewport: false },
      {
        rpc: {
          thread_is_ours: () => ({ isOurs: overrides.isOurs ?? true }),
          issue_create_send: overrides.onSend ?? (() => ({ sent: true })),
        },
      },
    );
  }

  it("registers in the composer and the thread header", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.composerCustomizations).toHaveLength(1);
    expect(app.composerCustomizations[0]).toMatchObject({
      id: "create-issue",
      scopes: ["thread"],
    });
    expect(app.composerCustomizations[0]!.actions).toHaveLength(1);
    expect(app.threadHeaderActions).toMatchObject([{ id: "create-issue" }]);
  });

  it("sends the confirmation in one click", async () => {
    const slot = await renderHeaderAction();
    fireEvent.click(await slot.findByRole("button", { name: /create issue/i }));

    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "issue_create_send",
        input: { threadId: "thr_ours" },
      });
    });
  });

  it("stays hidden in a thread this plugin did not start", async () => {
    const slot = await renderHeaderAction({ isOurs: false });
    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "thread_is_ours",
        input: { threadId: "thr_ours" },
      });
    });
    expect(slot.queryByRole("button", { name: /create issue/i })).toBeNull();
  });

  it("reads its thread from the composer scope it is mounted in", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.composerCustomizations[0]!.actions![0]!,
      {},
      {
        rpc: {
          thread_is_ours: () => ({ isOurs: true }),
          issue_create_send: () => ({ sent: true }),
        },
      },
    );
    await slot.behavior.setComposerScope({
      kind: "thread",
      threadId: "thr_scoped",
    });

    fireEvent.click(await slot.findByRole("button", { name: /create issue/i }));
    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "issue_create_send",
        input: { threadId: "thr_scoped" },
      });
    });
  });
});
