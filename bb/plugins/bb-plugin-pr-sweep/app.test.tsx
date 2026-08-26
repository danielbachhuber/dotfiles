// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/42",
    isDraft: false,
    flags: ["conflict"],
    group: "needs-action",
    checks: { pass: 3, fail: 0, skip: 1, pending: 0, cancelled: 0, total: 4 },
    approvedBy: [],
    commentedBy: [],
    waitingOn: [],
    awaitingReReview: false,
    canSpawn: true,
    threadId: null,
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    rows: [rowFixture()],
    sweptAt: 1_700_000_000_000,
    failedRepos: [],
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
    expect(app.navPanels[0]!.path).toBe("prs");
  });

  it("shows a flagged PR under Needs action", async () => {
    const slot = render(listing());
    await slot.findByText(/Needs action/i);
    await slot.findByText(/Add the widget endpoint/);
    await slot.findByText(/merge conflict/i);
  });

  it("shows a merge-ready PR under Ready to merge", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ flags: ["merge-ready"], group: "ready-to-merge", approvedBy: ["hubber"] }),
        ],
      }),
    );
    await slot.findByText(/Ready to merge \(1\)/i);
    await slot.findByText(/approved by hubber/i);
  });

  it("shows the Clean group's rows with its count", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: [], group: "clean" })] }));
    await slot.findByText(/Clean \(1\)/i);
    await slot.findByText(/Add the widget endpoint/);
  });

  it("gives a clean row no action button", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: [], group: "clean" })] }));
    await slot.findByText(/Add the widget endpoint/);
    expect(slot.queryByRole("button", { name: /resolve conflict|work on this/i })).toBeNull();
  });

  it("says so when nothing is open", async () => {
    const slot = render(listing({ rows: [] }));
    await slot.findByText(/No open pull requests/i);
  });

  it("surfaces a sweep error without blanking the rows", async () => {
    const slot = render(
      listing({ lastError: "`gh` is not authenticated. Run `gh auth login`." }),
    );
    await slot.findByText(/gh auth login/);
    await slot.findByText(/Add the widget endpoint/);
  });

  it("warns when the sweep hit the 100-PR ceiling", async () => {
    const slot = render(listing({ truncated: true }));
    await slot.findByText(/100 pull request ceiling/i);
  });

  it("names a repository it could not refresh", async () => {
    const slot = render(listing({ failedRepos: ["acme/gadgets"] }));
    await slot.findByText(/acme\/gadgets/);
  });

  it("disables Work on this when no project matches", async () => {
    const slot = render(listing({ rows: [rowFixture({ canSpawn: false })] }));
    const button = await slot.findByRole("button", { name: /resolve conflict/i });
    expect(button).toBeDisabled();
  });

  it("names the action after the row's worst flag", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1, flags: ["ci-failing"] }),
          rowFixture({ number: 2, flags: ["conflict", "feedback"] }),
          rowFixture({ number: 3, flags: ["no-reviewer"] }),
        ],
      }),
    );
    await slot.findByRole("button", { name: /fix failing ci/i });
    await slot.findByRole("button", { name: /resolve conflict/i });
    await slot.findByRole("button", { name: /add a reviewer/i });
    expect(slot.queryByRole("button", { name: /work on this/i })).toBeNull();
  });

  it("opens a pull request in a real browser tab, not the in-app one", async () => {
    const slot = render(listing());
    const link = await slot.findByRole("link", { name: /Add the widget endpoint/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/42");
  });

  it("renders column headers", async () => {
    const slot = render(listing());
    await slot.findByText("PR");
    await slot.findByText("Title");
    // "Status" rather than "Needs": the same header sits above Clean and
    // Ready to merge, where "needs" would be wrong.
    await slot.findByText("Status");
    expect(slot.queryByText("Needs")).toBeNull();
  });

  it("uses one fixed column layout so every section table lines up", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1 }),
          rowFixture({ number: 2, flags: [], group: "clean" }),
        ],
      }),
    );
    await slot.findByText(/Needs action \(1\)/i);
    const tables = slot.container.querySelectorAll("table");
    expect(tables.length).toBe(2);
    for (const table of tables) {
      expect(table.className).toMatch(/table-fixed/);
    }

    // Same widths declared in the same order in both tables.
    const widths = [...tables].map((table) =>
      [...table.querySelectorAll("thead th")].map(
        (cell) => (cell.className.match(/w-\[[^\]]+\]/) ?? ["auto"])[0],
      ),
    );
    expect(widths[0]).toEqual(widths[1]);
  });

  it("omits the repository when every row shares one", async () => {
    const slot = render(listing());
    await slot.findByText(/Add the widget endpoint/);
    expect(slot.queryByText("acme/widgets")).toBeNull();
  });

  it("shows the repository once the list spans more than one", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1 }),
          rowFixture({ number: 2, repo: "acme/gadgets" }),
        ],
      }),
    );
    await slot.findByText("acme/widgets");
    await slot.findByText("acme/gadgets");
  });

  it("leads the checks column with the counts that matter", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({
            checks: { pass: 20, fail: 1, skip: 7, pending: 0, cancelled: 0, total: 28 },
          }),
        ],
      }),
    );
    await slot.findByText("1 fail · 20 pass · 7 skip");
  });

  it("shows an approval alongside an outstanding reviewer, not instead of it", async () => {
    // A merge-ready PR with a reviewer still pending: the approval is the
    // reason it is mergeable, so it must not be hidden by the pending request.
    const slot = render(
      listing({
        rows: [
          rowFixture({
            flags: ["merge-ready"],
            group: "ready-to-merge",
            approvedBy: ["hubber"],
            waitingOn: ["acme/reviewers"],
          }),
        ],
      }),
    );
    await slot.findByText("approved by hubber");
    await slot.findByText("waiting on acme/reviewers");
  });

  it("emphasizes the approval over the pending request", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ approvedBy: ["hubber"], waitingOn: ["mona"] })],
      }),
    );
    expect((await slot.findByText("approved by hubber")).className).toMatch(/text-foreground/);
    expect((await slot.findByText("waiting on mona")).className).toMatch(
      /text-muted-foreground/,
    );
  });

  it("names a commenter only when they did not also approve", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ approvedBy: ["hubber"], commentedBy: ["hubber", "mona"] })],
      }),
    );
    await slot.findByText("approved by hubber");
    await slot.findByText("comments from mona");
  });

  it("reports awaiting re-review", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({
            flags: [],
            group: "clean",
            awaitingReReview: true,
            waitingOn: ["hubber"],
          }),
        ],
      }),
    );
    await slot.findByText("awaiting re-review");
    await slot.findByText("waiting on hubber");
  });

  it("says so when a PR has no reviews at all", async () => {
    const slot = render(listing({ rows: [rowFixture()] }));
    await slot.findByText("no reviews yet");
  });

  it("marks the leading flag as the one driving the action", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: ["conflict", "feedback"] })] }));
    const primary = await slot.findByText("merge conflict");
    const secondary = await slot.findByText("reviewer feedback");
    expect(primary.className).toMatch(/text-destructive/);
    expect(secondary.className).toMatch(/text-muted-foreground/);
  });

  it("moves a row with a thread out of Needs action and into In progress", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1 }),
          rowFixture({ number: 2, threadId: "thr_1" }),
        ],
      }),
    );
    await slot.findByText(/Needs action \(1\)/i);
    await slot.findByText(/In progress \(1\)/i);
  });

  it("puts a merge-ready row with a thread in In progress too", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ flags: ["merge-ready"], group: "ready-to-merge", threadId: "thr_1" }),
        ],
      }),
    );
    await slot.findByText(/In progress \(1\)/i);
    // The row's own flag badge also reads "ready to merge", so assert on the
    // section heading, which carries a count.
    expect(slot.queryByText(/Ready to merge \(/i)).toBeNull();
  });

  it("shows no In progress section when nothing is being worked on", async () => {
    const slot = render(listing());
    await slot.findByText(/Needs action \(1\)/i);
    expect(slot.queryByText(/In progress/i)).toBeNull();
  });

  it("shows Open thread once a thread exists, in place of the action", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    await slot.findByRole("button", { name: /open thread/i });
    expect(slot.queryByRole("button", { name: /resolve conflict/i })).toBeNull();
  });

  it("navigates to the thread when Open thread is clicked", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    (await slot.findByRole("button", { name: /open thread/i })).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.inspection.navigateCalls.length).toBeGreaterThan(0);
  });

  it("offers Open thread even for a clean row that has one", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: [], group: "clean", threadId: "thr_1" })] }),
    );
    await slot.findByRole("button", { name: /open thread/i });
  });

  it("disables the button and says Starting while the thread is created", async () => {
    let release: (() => void) | undefined;
    const slot = render(listing(), {
      workOnThis: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { threadId: "thr_1", existing: false, reason: null };
      },
    });

    const button = await slot.findByRole("button", { name: /resolve conflict/i });
    button.click();

    const starting = await slot.findByRole("button", { name: /starting/i });
    expect(starting).toBeDisabled();

    release?.();
  });

  it("does not fire a second call when the button is clicked twice", async () => {
    let release: (() => void) | undefined;
    const slot = render(listing(), {
      workOnThis: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { threadId: "thr_1", existing: false, reason: null };
      },
    });

    const button = await slot.findByRole("button", { name: /resolve conflict/i });
    button.click();
    await slot.findByRole("button", { name: /starting/i });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "workOnThis"),
    ).toHaveLength(1);

    release?.();
  });

  it("calls workOnThis when the button is clicked", async () => {
    const slot = render(listing(), {
      workOnThis: () => ({ threadId: "thr_1", existing: false, reason: null }),
    });
    const button = await slot.findByRole("button", { name: /resolve conflict/i });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.inspection.rpcCalls.some((call) => call.method === "workOnThis")).toBe(true);
  });
});
