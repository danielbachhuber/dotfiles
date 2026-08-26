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
    boardStatus: null,
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    rows: [rowFixture()],
    statusOrder: [],
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
    expect(await slot.findByText(/\(#42\)$/)).toBeInTheDocument();
  });

  it("shows the comment count", async () => {
    const slot = render(listing());
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
    await slot.findByText(/^Newer issue \(#/);
    // The first cell is now the title, which carries the number.
    const titles = Array.from(
      slot.container.querySelectorAll("tbody tr td:first-child"),
      (cell) => cell.textContent,
    );
    expect(titles).toEqual(["Newer issue (#7)", "Older issue (#3)"]);
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

describe("board sections", () => {
  it("groups by the board's column, in the configured order", async () => {
    const slot = render(
      listing({
        statusOrder: ["Ready for Dev", "Needs Definition", "In Progress", "In Review"],
        rows: [
          rowFixture({ number: 1, title: "A", boardStatus: "In Review" }),
          rowFixture({ number: 2, title: "B", boardStatus: "Ready for Dev" }),
          rowFixture({ number: 3, title: "C", boardStatus: "In Progress" }),
        ],
      }),
    );
    const ready = await slot.findByText(/^Ready for Dev \(1\)$/);
    const progress = await slot.findByText(/^In Progress \(1\)$/);
    const review = await slot.findByText(/^In Review \(1\)$/);
    expect(ready.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(progress.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("omits a configured status nothing is in", async () => {
    const slot = render(
      listing({
        statusOrder: ["Ready for Dev", "In Progress"],
        rows: [rowFixture({ boardStatus: "In Progress" })],
      }),
    );
    await slot.findByText(/^In Progress \(1\)$/);
    expect(slot.queryByText(/^Ready for Dev/)).toBeNull();
  });

  it("still shows a status the board has that the setting does not name", async () => {
    // A new column on the board should appear rather than vanish.
    const slot = render(
      listing({
        statusOrder: ["In Progress"],
        rows: [rowFixture({ boardStatus: "Blocked" })],
      }),
    );
    await slot.findByText(/^Blocked \(1\)$/);
  });

  it("files an issue on no board under its own heading", async () => {
    const slot = render(
      listing({ statusOrder: ["In Progress"], rows: [rowFixture({ boardStatus: null })] }),
    );
    await slot.findByText(/^No board status \(1\)$/);
  });
});
