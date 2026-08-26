// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const PROJECTS = [
  { id: "proj_a", name: "psi-product" },
  { id: "proj_b", name: "bugsink" },
];
const NOTES = "Pin state is lost on reload.";
const EXECUTION = {
  providerId: "claude-code",
  model: "claude-opus-5",
  reasoningLevel: "high",
  serviceTier: "default",
};

afterEach(cleanup);

// app.tsx binds the plugin runtime at module load, so the thunk matters:
// loadPluginApp installs the test runtime before importing it.
async function renderPage(
  overrides: { rpc?: Record<string, unknown>; projectId?: string | null } = {},
) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      context: {
        projectId: overrides.projectId === undefined ? "proj_b" : overrides.projectId,
        threadId: null,
      },
      rpc: {
        projects_list: () => ({ projects: PROJECTS }),
        execution_defaults: () => ({ execution: EXECUTION }),
        issue_thread_create: () => ({ threadId: "thr_new" }),
        ...overrides.rpc,
      },
    },
  );
}

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

  it("seeds the project picker from the project in view", async () => {
    const slot = await renderPage({ projectId: "proj_b" });
    await slot.findAllByText("bugsink");
    // The trigger shows the project in view, not merely the first one listed.
    expect(
      slot.getByRole("combobox", { name: "Project" }).textContent,
    ).toContain("bugsink");
  });

  it("keeps Submit disabled until the notes have content", async () => {
    const slot = await renderPage();
    await slot.findAllByText("bugsink");

    expect(slot.getByRole("button", { name: /submit/i })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.change(slot.getByLabelText("What the issue should cover"), {
      target: { value: NOTES },
    });
    expect(slot.getByRole("button", { name: /submit/i })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("spawns the thread for the picked project and navigates to it", async () => {
    const slot = await renderPage();
    await slot.findAllByText("bugsink");

    fireEvent.change(slot.getByLabelText("What the issue should cover"), {
      target: { value: `  ${NOTES}  ` },
    });
    fireEvent.click(slot.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toThread",
        threadId: "thr_new",
      });
    });
    // The notes are trimmed before they reach the backend.
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "issue_thread_create",
      input: { projectId: "proj_b", notes: NOTES, execution: EXECUTION },
    });
  });

  it("seeds the picker from the project the form is scoped to", async () => {
    const slot = await renderPage({ projectId: "proj_a" });
    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "execution_defaults",
        input: { projectId: "proj_a" },
      });
    });
    // Only the selected project is asked about.
    expect(slot.inspection.rpcCalls).not.toContainEqual({
      method: "execution_defaults",
      input: { projectId: "proj_b" },
    });
  });

  it("warns when the selection cannot load the skill", async () => {
    const slot = await renderPage({
      rpc: {
        execution_defaults: () => ({
          execution: { ...EXECUTION, providerId: "codex" },
        }),
      },
    });
    expect(
      await slot.findByText(/cannot load/i),
    ).toBeTruthy();
  });

  it("does not warn on Claude Code", async () => {
    const slot = await renderPage();
    await slot.findAllByText("bugsink");
    expect(slot.queryByText(/cannot load/i)).toBeNull();
  });

  it("keeps the notes when the spawn fails", async () => {
    const slot = await renderPage({
      rpc: {
        issue_thread_create: () => {
          throw new Error("no environment");
        },
      },
    });
    await slot.findAllByText("bugsink");

    const notes = slot.getByLabelText("What the issue should cover");
    fireEvent.change(notes, { target: { value: NOTES } });
    fireEvent.click(slot.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "issue_thread_create" }),
      );
    });
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    expect(notes).toHaveProperty("value", NOTES);
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
