// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));

const HOUR = 60 * 60_000;

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Widget rotation drifts after a resize",
    url: "https://github.com/acme/widgets/issues/42",
    labels: ["bug"],
    createdAt: Date.now() - 48 * HOUR,
    updatedAt: Date.now() - 3 * HOUR,
    commentsCount: 2,
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    rows: [rowFixture()],
    sweptAt: 1_700_000_000_000,
    truncated: false,
    lastError: null,
    ...overrides,
  };
}

let mounted: { lifecycle: { unmount: () => void } } | null = null;

afterEach(() => {
  mounted?.lifecycle.unmount();
  mounted = null;
});

function render(result: Record<string, unknown>, extraRpc: Record<string, unknown> = {}) {
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        listRows: () => result,
        refresh: () => ({ ok: true, error: null }),
        ...extraRpc,
      },
    },
  );
  mounted = slot;
  return slot;
}

describe("panel", () => {
  it("registers one nav panel", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]!.path).toBe("issues");
  });

  it("lists an assigned issue, linked out to GitHub", async () => {
    const slot = render(listing());
    const link = await slot.findByRole("link", {
      name: /Widget rotation drifts after a resize/i,
    });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/issues/42");
    // An explicit target keeps the issue out of BB's in-app browser.
    expect(link).toHaveAttribute("target", "_blank");
    expect(await slot.findByText("#42")).toBeInTheDocument();
  });

  it("shows the labels and the comment count", async () => {
    const slot = render(listing());
    expect(await slot.findByText("bug")).toBeInTheDocument();
    expect(await slot.findByText("2 comments")).toBeInTheDocument();
  });

  it("keeps its own order, since the server already sorted", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 7, title: "Newer issue", updatedAt: Date.now() - HOUR }),
          rowFixture({ number: 3, title: "Older issue", updatedAt: Date.now() - 90 * HOUR }),
        ],
      }),
    );
    await slot.findByText("Newer issue");
    const numbers = Array.from(
      slot.container.querySelectorAll("tbody tr td:first-child"),
      (cell) => cell.textContent,
    );
    expect(numbers).toEqual(["#7", "#3"]);
  });

  it("names the repository only when more than one is in play", async () => {
    const one = render(listing());
    await one.findByText(/Widget rotation/i);
    expect(one.queryByText("acme/widgets")).not.toBeInTheDocument();
    one.lifecycle.unmount();

    const many = render(
      listing({
        rows: [rowFixture(), rowFixture({ repo: "acme/gadgets", number: 8, title: "Other" })],
      }),
    );
    expect(await many.findByText("acme/widgets")).toBeInTheDocument();
    expect(await many.findByText("acme/gadgets")).toBeInTheDocument();
  });

  it("says so when nothing is assigned", async () => {
    const slot = render(listing({ rows: [] }));
    expect(await slot.findByText(/No issues assigned to you/i)).toBeInTheDocument();
  });

  it("surfaces the last sweep error above the table", async () => {
    const slot = render(listing({ lastError: "`gh` was not found on PATH." }));
    expect(await slot.findByText(/was not found on PATH/i)).toBeInTheDocument();
    // The stale rows stay visible underneath rather than being replaced.
    expect(await slot.findByText(/Widget rotation/i)).toBeInTheDocument();
  });

  it("warns when the search hit its ceiling", async () => {
    const slot = render(listing({ truncated: true }));
    expect(await slot.findByText(/may be incomplete/i)).toBeInTheDocument();
  });

  it("refreshes on demand", async () => {
    let refreshes = 0;
    const slot = render(listing(), {
      refresh: () => {
        refreshes += 1;
        return { ok: true, error: null };
      },
    });

    (await slot.findByRole("button", { name: /Refresh/i })).click();
    await slot.findByRole("button", { name: /Refresh/i });
    expect(refreshes).toBe(1);
  });
});
