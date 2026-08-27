// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
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
    onBoard: false,
    blockedBy: 0,
    closingPr: null,
    threadId: null,
    canSpawn: true,
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    rows: [rowFixture()],
    statusOrder: [],
    statusOptions: [],
    countedStatuses: [],
    boardName: "Acme Board",
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

  it("shows the age and comment count under the title", async () => {
    // Both used to be their own column; the action took it, so they moved to
    // the title cell rather than being dropped.
    const slot = render(listing());
    expect(await slot.findByText(/3h ago · 2 comments/)).toBeInTheDocument();
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
    // The title cell also carries the age line now, so read the link itself.
    const titles = Array.from(
      slot.container.querySelectorAll("tbody tr td:first-child a"),
      (link) => link.textContent,
    );
    expect(titles).toEqual(["Newer issue (#7)", "Older issue (#3)"]);
  });

  it("names the repository only when more than one is in play", async () => {
    const one = render(listing());
    await one.findByText(/Widget rotation/i);
    expect(one.queryByText(/acme\/widgets/)).not.toBeInTheDocument();
    one.lifecycle.unmount();

    const many = render(
      listing({
        rows: [rowFixture(), rowFixture({ repo: "acme/gadgets", number: 8, title: "Other" })],
      }),
    );
    // The repository now shares its line with the age, so match within it.
    expect(await many.findByText(/^acme\/widgets · /)).toBeInTheDocument();
    expect(await many.findByText(/^acme\/gadgets · /)).toBeInTheDocument();
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

describe("blocked section", () => {
  it("files a blocked issue last, under its own heading", async () => {
    const slot = render(
      listing({
        statusOrder: ["Ready", "In Progress"],
        rows: [
          rowFixture({ number: 1, title: "Ready one", boardStatus: "Ready" }),
          rowFixture({ number: 2, title: "Blocked one", boardStatus: "Ready", blockedBy: 1 }),
        ],
      }),
    );

    const headings = (await slot.findAllByRole("heading")).map((node) => node.textContent);
    expect(headings).toEqual(["Ready (1)", "Blocked (1)"]);
  });

  it("takes a blocked issue out of its board section", async () => {
    // The board says where the work stands; the dependency says it cannot
    // proceed. Leaving it in "In Progress" would overstate what is moving.
    const slot = render(
      listing({
        statusOrder: ["In Progress"],
        rows: [rowFixture({ boardStatus: "In Progress", blockedBy: 2 })],
      }),
    );
    const headings = (await slot.findAllByRole("heading")).map((node) => node.textContent);
    expect(headings).toEqual(["Blocked (1)"]);
  });

  it("sits below the issues on no board, not just below the board columns", async () => {
    const slot = render(
      listing({
        statusOrder: ["Ready"],
        rows: [
          rowFixture({ number: 1, boardStatus: "Ready" }),
          rowFixture({ number: 2, boardStatus: null }),
          rowFixture({ number: 3, boardStatus: null, blockedBy: 1 }),
        ],
      }),
    );
    const headings = (await slot.findAllByRole("heading")).map((node) => node.textContent);
    expect(headings).toEqual(["Ready (1)", "No board status (1)", "Blocked (1)"]);
  });

  it("shows no Blocked section when nothing is blocked", async () => {
    const slot = render(
      listing({ statusOrder: ["Ready"], rows: [rowFixture({ boardStatus: "Ready" })] }),
    );
    await slot.findByText("Ready (1)");
    expect(slot.queryByText(/^Blocked/)).toBeNull();
  });

  it("still keeps a board column that only blocked issues carry in the order", async () => {
    // Otherwise unblocking the issue would move it to a section that has since
    // lost its configured position and drifted to the end.
    const slot = render(
      listing({
        statusOrder: ["Ready"],
        rows: [
          rowFixture({ number: 1, boardStatus: "Ready" }),
          rowFixture({ number: 2, boardStatus: "In Review", blockedBy: 1 }),
        ],
      }),
    );
    const headings = (await slot.findAllByRole("heading")).map((node) => node.textContent);
    expect(headings).toEqual(["Ready (1)", "Blocked (1)"]);
  });
});

describe("sidebar badge", () => {
  function renderBadge(result: Record<string, unknown>) {
    const slot = renderSlot(
      { component: app.navPanels[0]!.experimental_sidebarAccessory! },
      {},
      { rpc: { listRows: () => result } },
    );
    mounted = slot;
    return slot;
  }

  const board = (boardStatus: string | null, extra: Record<string, unknown> = {}) =>
    rowFixture({ boardStatus, ...extra });

  it("counts only the statuses it was told to", async () => {
    const slot = renderBadge(
      listing({
        countedStatuses: ["In Progress", "Ready"],
        rows: [
          board("In Progress", { number: 1 }),
          board("Ready", { number: 2 }),
          board("Backlog", { number: 3 }),
          board("In Review", { number: 4 }),
          board(null, { number: 5 }),
        ],
      }),
    );
    expect(await slot.findByText("2")).toBeInTheDocument();
  });

  it("leaves out a blocked issue that would otherwise count", async () => {
    // Its row is filed under Blocked, not under In Progress, so counting it
    // would put a number on the badge no visible section accounts for.
    const slot = renderBadge(
      listing({
        countedStatuses: ["In Progress"],
        rows: [
          board("In Progress", { number: 1 }),
          board("In Progress", { number: 2, blockedBy: 1 }),
        ],
      }),
    );
    expect(await slot.findByText("1")).toBeInTheDocument();
  });

  it("shows nothing rather than a zero", async () => {
    const slot = renderBadge(
      listing({ countedStatuses: ["In Progress"], rows: [board("Backlog")] }),
    );
    await waitFor(() => expect(slot.container.textContent).toBe(""));
  });
});

describe("thread action", () => {
  it("offers to start a thread when the issue has none", async () => {
    const slot = render(listing());
    expect(await slot.findByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("offers to open the thread once one exists", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    expect(await slot.findByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(slot.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("will not offer to start one for a repository with no checkout", async () => {
    // The spawn would fail on the server; a disabled button says so up front.
    const slot = render(listing({ rows: [rowFixture({ canSpawn: false })] }));
    expect(await slot.findByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("starts one thread for the issue that was clicked", async () => {
    const calls: unknown[] = [];
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1, title: "First" }),
          rowFixture({ number: 2, title: "Second" }),
        ],
      }),
      {
        startThread: (input: unknown) => {
          calls.push(input);
          return { threadId: "thr_new", existing: false, reason: null };
        },
      },
    );

    const buttons = await slot.findAllByRole("button", { name: "Start" });
    fireEvent.click(buttons[1]!);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ repo: "acme/widgets", number: 2 });
  });

  it("disables the button while the spawn is in flight", async () => {
    // A second click before the first returns is how two threads got created
    // for one row in pr-sweep.
    let release: (() => void) | null = null;
    const slot = render(listing(), {
      startThread: () =>
        new Promise((resolve) => {
          release = () => resolve({ threadId: "thr_new", existing: false, reason: null });
        }),
    });

    const button = await slot.findByRole("button", { name: "Start" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(slot.getByRole("button", { name: "Starting…" })).toBeDisabled(),
    );
    release?.();
  });

  it("keeps the age line, which the action column replaced", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    await slot.findByRole("button", { name: "Open" });
    expect(slot.getByText(/3h ago/)).toBeInTheDocument();
  });
});

const OPTIONS = ["Backlog", "Ready", "In Progress", "In Review"];

describe("status column", () => {
  it("offers the board's own options, in the board's order", async () => {
    const slot = render(
      listing({ statusOptions: OPTIONS, rows: [rowFixture({ boardStatus: "Ready", onBoard: true })] }),
    );
    const picker = (await slot.findByLabelText("Board status for #42")) as HTMLSelectElement;
    expect(picker.value).toBe("Ready");
    // The placeholder leads, then the board's options untouched.
    expect([...picker.options].slice(1).map((option) => option.text)).toEqual(OPTIONS);
  });

  it("offers to add an issue that is on no board", async () => {
    const slot = render(
      listing({ statusOptions: OPTIONS, rows: [rowFixture({ onBoard: false, boardStatus: null })] }),
    );
    expect(await slot.findByText("Add to board")).toBeInTheDocument();
  });

  it("does not offer to add an issue already on the board with no status", async () => {
    // Adding it again would be a no-op, and the label would be a lie.
    const slot = render(
      listing({ statusOptions: OPTIONS, rows: [rowFixture({ onBoard: true, boardStatus: null })] }),
    );
    expect(await slot.findByText("No status")).toBeInTheDocument();
    expect(slot.queryByText("Add to board")).toBeNull();
  });

  it("keeps showing a status the board no longer offers", async () => {
    // Otherwise the picker selects nothing and the row reads as unfiled.
    const slot = render(
      listing({
        statusOptions: OPTIONS,
        rows: [rowFixture({ boardStatus: "Retired column", onBoard: true })],
      }),
    );
    const picker = (await slot.findByLabelText("Board status for #42")) as HTMLSelectElement;
    expect(picker.value).toBe("Retired column");
  });

  it("falls back to plain text when the board could not be read", async () => {
    // No options means no picker, but the status is still worth showing.
    const slot = render(
      listing({ statusOptions: [], rows: [rowFixture({ boardStatus: "Ready", onBoard: true })] }),
    );
    await slot.findByText("Ready");
    expect(slot.queryByLabelText("Board status for #42")).toBeNull();
  });

  it("sends the picked status, by name, for that row", async () => {
    const calls: unknown[] = [];
    const slot = render(
      listing({
        statusOptions: OPTIONS,
        rows: [rowFixture({ number: 42, boardStatus: "Backlog", onBoard: true })],
      }),
      {
        setBoardStatus: (input: unknown) => {
          calls.push(input);
          return { ok: true, added: false, error: null };
        },
      },
    );

    const picker = (await slot.findByLabelText("Board status for #42")) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "In Review" } });

    await waitFor(() => expect(calls).toHaveLength(1));
    // By name, never by option id: the ids are the board's private node ids
    // and the panel never sees them.
    expect(calls[0]).toEqual({ repo: "acme/widgets", number: 42, status: "In Review" });
  });
});
