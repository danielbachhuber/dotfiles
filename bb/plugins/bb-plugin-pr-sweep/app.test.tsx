// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
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
    lastCommentBy: null,
    unresolvedThreads: 0,
    outdatedThreads: 0,
    notedBy: [],
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
    app.navPanels.find((panel) => panel.id === "prs")!,
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
    expect(app.navPanels.map((panel) => panel.id).sort()).toEqual(["open-pr", "prs"]);
    expect(app.navPanels.find((panel) => panel.id === "prs")!.path).toBe("prs");
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
    await slot.findByText(/Ready to Merge \(1\)/);
    await slot.findByText(/approved by hubber/i);
  });

  it("files an unflagged non-draft under Awaiting Review", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: [], group: "clean" })] }));
    await slot.findByText(/Awaiting Review \(1\)/);
    await slot.findByText(/Add the widget endpoint/);
  });

  it("files an unflagged draft under Draft, below Awaiting Review", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1, flags: [], group: "clean" }),
          rowFixture({ number: 2, flags: [], group: "clean", isDraft: true }),
        ],
      }),
    );
    const awaiting = await slot.findByText(/Awaiting Review \(1\)/);
    const draft = await slot.findByText(/^Draft \(1\)$/);
    expect(
      awaiting.compareDocumentPosition(draft) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("files a flagged draft under Draft, keeping its flags in Status", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: ["ci-failing"], isDraft: true })] }),
    );
    await slot.findByText(/^Draft \(1\)$/);
    expect(slot.queryByText(/Needs Action \(/)).toBeNull();
    // The draft state and the fault are both true, so both are shown.
    await slot.findByText("draft");
    await slot.findByText("CI failing");
  });

  it("capitalizes every section heading", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1, flags: ["conflict"] }),
          rowFixture({ number: 2, flags: ["merge-ready"], group: "ready-to-merge" }),
          rowFixture({ number: 3, flags: [], group: "clean", threadId: "thr_1" }),
          rowFixture({ number: 4, flags: [], group: "clean" }),
          rowFixture({ number: 5, flags: [], group: "clean", isDraft: true }),
        ],
      }),
    );
    for (const title of [
      "Needs Action",
      "In Progress",
      "Ready to Merge",
      "Awaiting Review",
      "Draft",
    ]) {
      await slot.findByText(new RegExp(`^${title} \\(`));
    }
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

  it("says Address issues on a row that needs more than one thing", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: ["conflict", "feedback"] })] }));
    await slot.findByRole("button", { name: /^Address issues$/i });
  });

  it("gives every flag its own badge, not just the worst one", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: ["conflict", "feedback"] })] }));
    const conflict = await slot.findByText("merge conflict");
    const feedback = await slot.findByText("reviewer feedback");
    // Both carry the badge chrome, so the second reads as a second problem
    // rather than as a caption on the first.
    for (const badge of [conflict, feedback]) {
      expect(badge.className).toMatch(/rounded-md/);
      expect(badge.className).toMatch(/bg-destructive/);
    }
  });

  it("names the action after the row's worst flag", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1, flags: ["ci-failing"] }),
          rowFixture({ number: 2, flags: ["conflict"] }),
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

  it("colours a merge-ready status green and an unflagged one blue", async () => {
    const ready = render(
      listing({ rows: [rowFixture({ flags: ["merge-ready"], group: "ready-to-merge" })] }),
    );
    expect((await ready.findByText("ready to merge")).className).toMatch(/emerald/);
    ready.lifecycle.unmount();

    const clean = render(listing({ rows: [rowFixture({ flags: [], group: "clean" })] }));
    expect((await clean.findByText("clean")).className).toMatch(/sky/);
  });

  it("says awaiting review when an unflagged row still has a reviewer out", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ flags: [], group: "clean", waitingOn: ["hubber"] })],
      }),
    );
    await slot.findByText("awaiting review");
    expect(slot.queryByText("clean")).toBeNull();
  });

  it("says awaiting review when a re-review is pending", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ flags: [], group: "clean", awaitingReReview: true })],
      }),
    );
    await slot.findByText("awaiting review");
  });

  it("offers Archive thread once an in-progress row has no flags left", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: [], group: "clean", threadId: "thr_1" })] }),
    );
    const archive = await slot.findByRole("button", { name: /archive thread/i });
    // Secondary: an icon button carrying its label as an accessible name, not
    // as visible text. Asserting the accessible name rather than opening the
    // tooltip, which Radix drives from events jsdom does not synthesize.
    expect(archive.textContent).toBe("");
    expect(archive).toHaveAttribute("aria-label", "Archive thread");

    // Open thread keeps its label, so the primary action does not change shape
    // as the work finishes.
    const open = await slot.findByRole("button", { name: /open thread/i });
    expect(open.textContent).toContain("Open thread");
  });

  it("does not offer Archive thread while the row still has flags", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    await slot.findByRole("button", { name: /open thread/i });
    expect(slot.queryByRole("button", { name: /archive thread/i })).toBeNull();
  });

  it("calls archiveThread when Archive thread is clicked", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: [], group: "clean", threadId: "thr_1" })] }),
      { archiveThread: () => ({ ok: true, reason: null }) },
    );
    (await slot.findByRole("button", { name: /archive thread/i })).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.inspection.rpcCalls.some((call) => call.method === "archiveThread")).toBe(true);
  });

  it("renders column headers", async () => {
    const slot = render(listing());
    await slot.findByText("Title");
    // No number column: the number rides the title so the table has one less
    // thing to align.
    expect(slot.queryByText("PR")).toBeNull();
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
    await slot.findByText(/Needs Action \(1\)/);
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
    const line = await slot.findByText("waiting on acme/reviewers");
    // Wrapped, not truncated: a team slug clipped at the column edge hides the
    // only part that says which team, and there is no link to click through.
    expect(line.className).not.toMatch(/truncate/);
    expect(line.className).toMatch(/break-words/);
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
    expect(secondary.className).toMatch(/text-destructive/);
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
    await slot.findByText(/Needs Action \(1\)/);
    await slot.findByText(/In Progress \(1\)/);
  });

  it("puts a merge-ready row with a thread in In progress too", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ flags: ["merge-ready"], group: "ready-to-merge", threadId: "thr_1" }),
        ],
      }),
    );
    await slot.findByText(/In Progress \(1\)/);
    // The row's own flag badge also reads "ready to merge", so assert on the
    // section heading, which carries a count.
    expect(slot.queryByText(/Ready to Merge \(/)).toBeNull();
  });

  it("shows no In progress section when nothing is being worked on", async () => {
    const slot = render(listing());
    await slot.findByText(/Needs Action \(1\)/);
    expect(slot.queryByText(/In Progress/)).toBeNull();
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

describe("thread header action", () => {
  const action = () => app.threadHeaderActions[0]!;

  function renderHeader(
    result: unknown,
    props: { threadId?: string; isCompactViewport?: boolean } = {},
  ) {
    const slot = renderSlot(
      action(),
      {
        threadId: props.threadId ?? "thr_1",
        projectId: "proj_a",
        isCompactViewport: props.isCompactViewport ?? false,
      },
      { rpc: { pullRequestForThread: () => result } },
    );
    mounted = slot;
    return slot;
  }

  it("registers one header action", () => {
    expect(app.threadHeaderActions).toHaveLength(1);
    expect(action().id).toBe("open-pull-request");
  });

  it("links to the pull request on a thread this plugin started", async () => {
    const slot = renderHeader({
      repo: "acme/widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      title: "Add the widget endpoint",
    });

    const link = await slot.findByRole("link", { name: /open acme\/widgets#42 on github/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.textContent).toContain("#42");
  });

  it("renders nothing on a thread this plugin did not start", async () => {
    // The server decides this by returning null; the component must not draw
    // a control on someone else's thread.
    const slot = renderHeader(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.queryByRole("link")).toBeNull();
  });

  it("drops the number on a compact viewport, keeping the accessible name", async () => {
    const slot = renderHeader(
      {
        repo: "acme/widgets",
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
        title: "Add the widget endpoint",
      },
      { isCompactViewport: true },
    );

    const link = await slot.findByRole("link", { name: /open acme\/widgets#42 on github/i });
    expect(link.textContent).toBe("");
  });

  it("asks the server about the thread it was mounted for", async () => {
    const slot = renderHeader(null, { threadId: "thr_specific" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const call = slot.inspection.rpcCalls.find((c) => c.method === "pullRequestForThread");
    expect(call?.input).toEqual({ threadId: "thr_specific" });
  });
});

describe("a run still in flight", () => {
  it("files it under Waiting on CI, not Needs Action", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: ["ci-pending"] })] }));
    await slot.findByText(/Waiting on CI \(1\)/);
    expect(slot.queryByText(/Needs Action \(/)).toBeNull();
  });

  it("offers no button, because the run decides", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: ["ci-pending"] })] }));
    await slot.findByText(/Waiting on CI \(1\)/);
    expect(slot.queryByRole("button", { name: /check on ci/i })).toBeNull();
  });

  it("does not colour the badge as a fault", async () => {
    const slot = render(listing({ rows: [rowFixture({ flags: ["ci-pending"] })] }));
    expect((await slot.findByText("CI running")).className).toMatch(/sky/);
  });

  it("keeps a row in Needs Action when something else is also wrong", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: ["ci-failing", "ci-pending"] })] }),
    );
    await slot.findByText(/Needs Action \(1\)/);
    expect(slot.queryByText(/Waiting on CI \(/)).toBeNull();
  });
});

describe("the draft badge", () => {
  it("marks an unflagged draft without inventing a fault", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: [], group: "clean", isDraft: true })] }),
    );
    const badge = await slot.findByText("draft");
    // A state, not a verdict: it stays out of the red/green/blue vocabulary.
    expect(badge.className).toMatch(/bg-muted/);
  });

  it("does not repeat the marker under the title", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ flags: [], group: "clean", isDraft: true })] }),
    );
    expect(await slot.findAllByText("draft")).toHaveLength(1);
  });

  it("says nothing about drafting on a pull request that is open", async () => {
    const slot = render(listing({ rows: [rowFixture({ isDraft: false })] }));
    await slot.findByText(/Add the widget endpoint/);
    expect(slot.queryByText("draft")).toBeNull();
  });
});

describe("the Open pull request page", () => {
  const page = () => app.navPanels.find((panel) => panel.id === "open-pr")!;

  function renderPage(rpc: Record<string, unknown>) {
    const slot = renderSlot(page(), { subPath: "" }, { rpc });
    mounted = slot;
    return slot;
  }

  const resolved = {
    pr: {
      repo: "acme/widgets",
      number: 42,
      title: "Add the widget endpoint",
      headRef: "feat/widgets",
      url: "https://github.com/acme/widgets/pull/42",
      isDraft: false,
    },
    error: null,
  };

  it("has its own sidebar entry", () => {
    expect(page().title).toBe("Open pull request");
    expect(page().path).toBe("open-pr");
  });

  it("will not open anything until a pull request resolves", async () => {
    const slot = renderPage({ resolvePullRequest: () => ({ pr: null, error: null }) });
    const button = await slot.findByRole("button", { name: /^Open pull request$/ });
    expect(button).toBeDisabled();
  });

  it("confirms the title and branch before offering to open it", async () => {
    // The branch is the point of the page, so it is shown before committing.
    const slot = renderPage({ resolvePullRequest: () => resolved });
    const field = await slot.findByLabelText(/pull request/i);
    fireEvent.change(field, { target: { value: "42" } });
    fireEvent.blur(field);
    await slot.findByText(/Add the widget endpoint/);
    await slot.findByText(/feat\/widgets/);
    expect(await slot.findByRole("button", { name: /^Open pull request$/ })).not.toBeDisabled();
  });

  it("reports a bad reference in the form rather than opening", async () => {
    const slot = renderPage({
      resolvePullRequest: () => ({ pr: null, error: "Not a pull request number or URL: nope" }),
    });
    const field = await slot.findByLabelText(/pull request/i);
    fireEvent.change(field, { target: { value: "42" } });
    fireEvent.blur(field);
    await slot.findByText(/Not a pull request number or URL/);
    expect(await slot.findByRole("button", { name: /^Open pull request$/ })).toBeDisabled();
  });

  it("opens the thread it started", async () => {
    const slot = renderPage({
      resolvePullRequest: () => resolved,
      openPullRequest: () => ({
        threadId: "thr_1",
        worktree: "/Users/me/projects/widgets-pr-42",
        error: null,
      }),
    });
    const field = await slot.findByLabelText(/pull request/i);
    fireEvent.change(field, { target: { value: "42" } });
    fireEvent.blur(field);
    (await slot.findByRole("button", { name: /^Open pull request$/ })).click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(slot.inspection.rpcCalls.some((call) => call.method === "openPullRequest")).toBe(true);
    expect(slot.inspection.navigateCalls.length).toBeGreaterThan(0);
  });

  it("says the worktree outlives the thread", async () => {
    // bb does not delete an unmanaged worktree on archive, so the page says so
    // rather than leaving it to be discovered later.
    const slot = renderPage({ resolvePullRequest: () => resolved });
    const field = await slot.findByLabelText(/pull request/i);
    fireEvent.change(field, { target: { value: "42" } });
    fireEvent.blur(field);
    await slot.findByText(/not removed when the thread is archived/i);
  });
});

describe("unresolved review threads", () => {
  it("reports them even on a pull request that is otherwise ready", async () => {
    // #5801's shape: approved, green, and three inline comments to address.
    const slot = render(
      listing({
        rows: [
          rowFixture({
            flags: ["merge-ready"],
            group: "ready-to-merge",
            approvedBy: ["robennals"],
            unresolvedThreads: 3,
          }),
        ],
      }),
    );
    await slot.findByText("approved by robennals");
    await slot.findByText("3 unresolved comments");
  });

  it("names how many sit on code that has since changed", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ unresolvedThreads: 3, outdatedThreads: 1 })] }),
    );
    await slot.findByText("3 unresolved comments, 1 outdated");
  });

  it("uses the singular for one", async () => {
    const slot = render(listing({ rows: [rowFixture({ unresolvedThreads: 1 })] }));
    await slot.findByText("1 unresolved comment");
  });

  it("says nothing when every thread is resolved", async () => {
    const slot = render(listing({ rows: [rowFixture({ unresolvedThreads: 0 })] }));
    await slot.findByText(/Add the widget endpoint/);
    expect(slot.queryByText(/unresolved comment/)).toBeNull();
  });
});

describe("the merge button when comments are outstanding", () => {
  it("says it will read them first", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({
            flags: ["merge-ready"],
            group: "ready-to-merge",
            unresolvedThreads: 3,
          }),
        ],
      }),
    );
    await slot.findByRole("button", { name: /^Review and merge$/ });
    expect(slot.queryByRole("button", { name: /^Merge$/ })).toBeNull();
  });

  it("still says Merge when nothing is outstanding", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ flags: ["merge-ready"], group: "ready-to-merge" })],
      }),
    );
    await slot.findByRole("button", { name: /^Merge$/ });
  });
});

describe("copy link", () => {
  // This jsdom ships Blob without Blob.prototype.text, and Node's Response
  // does not recognise jsdom's Blob either — it stringifies it to
  // "[object Blob]". FileReader is jsdom's own, so it can read jsdom's Blob.
  // Worth the detour: without a working read the stub throws, the component's
  // catch swallows it, and the test reports "nothing was copied" about a
  // component that copied correctly.
  const readBlob = (blob: Blob): Promise<string> =>
    typeof blob.text === "function"
      ? blob.text()
      : new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(blob);
        });

  function stubClipboard() {
    const writes: Array<Record<string, string>> = [];
    // jsdom has neither, so both are stood up rather than spied on.
    (globalThis as Record<string, unknown>).ClipboardItem = class {
      constructor(public items: Record<string, Blob>) {}
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write(items: Array<{ items: Record<string, Blob> }>) {
          const entry: Record<string, string> = {};
          for (const [type, blob] of Object.entries(items[0]!.items)) {
            entry[type] = await readBlob(blob);
          }
          writes.push(entry);
        },
        async writeText(text: string) {
          writes.push({ "text/plain": text });
        },
      },
    });
    return writes;
  }

  it("offers one copy button per row, labelled Copy", async () => {
    const writes = stubClipboard();
    const slot = render(
      listing({ rows: [rowFixture({ number: 1 }), rowFixture({ number: 2 })] }),
    );
    expect(await slot.findAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(writes).toHaveLength(0);
  });

  it("copies the title and link as HTML, with plain text alongside", async () => {
    const writes = stubClipboard();
    const slot = render(
      listing({
        rows: [
          rowFixture({
            number: 42,
            title: "Add the widget endpoint",
            url: "https://github.com/acme/widgets/pull/42",
          }),
        ],
      }),
    );

    fireEvent.click(await slot.findByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!["text/html"]).toBe(
      '<a href="https://github.com/acme/widgets/pull/42">Add the widget endpoint (#42)</a>',
    );
    expect(writes[0]!["text/plain"]).toBe(
      "[Add the widget endpoint (#42)](https://github.com/acme/widgets/pull/42)",
    );
  });

  it("switches to a tick, then back", async () => {
    stubClipboard();
    const slot = render(listing());

    fireEvent.click(await slot.findByRole("button", { name: "Copy" }));
    await waitFor(() => expect(slot.getByRole("button", { name: "Copied" })).toBeInTheDocument());

    // The label is what a screen reader hears, so it has to carry the same
    // confirmation the icon gives everyone else — and it has to expire.
    await waitFor(() => expect(slot.getByRole("button", { name: "Copy" })).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("stays on Copy when the clipboard refuses", async () => {
    // A denied permission must not claim success.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => {
          throw new Error("denied");
        },
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    const slot = render(listing());
    fireEvent.click(await slot.findByRole("button", { name: "Copy" }));
    await waitFor(() => expect(slot.getByRole("button", { name: "Copy" })).toBeInTheDocument());
    expect(slot.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

describe("title tooltip", () => {
  const LONG = "refactor(profile): hide SRG profile toggles from per-instance menu";

  it("shows the full title on focus, for the part the column cut off", async () => {
    const slot = render(listing({ rows: [rowFixture({ number: 5840, title: LONG })] }));
    const link = await slot.findByRole("link", { name: /hide SRG profile toggles/i });

    fireEvent.focus(link);

    const tip = await slot.findByRole("tooltip");
    expect(tip).toHaveTextContent(`${LONG} (#5840)`);
  });

  it("keeps the link working, so the tooltip is not in the way of the click", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({
            number: 5840,
            title: LONG,
            url: "https://github.com/acme/widgets/pull/5840",
          }),
        ],
      }),
    );
    const link = await slot.findByRole("link", { name: /hide SRG profile toggles/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/5840");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("sync header", () => {
  function renderHeader(result: Record<string, unknown>, extraRpc: Record<string, unknown> = {}) {
    const slot = renderSlot(
      { component: app.navPanels.find((panel) => panel.path === "prs")!.headerContent! },
      { subPath: "" },
      { rpc: { listRows: () => result, refresh: () => ({ ok: true, error: null }), ...extraRpc } },
    );
    mounted = slot;
    return slot;
  }

  it("says how long ago the sweep landed, relatively", async () => {
    // Relative, because the question the header answers is "is this current",
    // not "what time is it".
    const slot = renderHeader(listing({ sweptAt: Date.now() - 4 * 60_000 }));
    expect(await slot.findByText("synced 4m ago")).toBeInTheDocument();
  });

  it("says so before the first sweep rather than showing a bogus age", async () => {
    const slot = renderHeader(listing({ sweptAt: null }));
    expect(await slot.findByText("not synced yet")).toBeInTheDocument();
  });

  it("refreshes on demand", async () => {
    let refreshes = 0;
    const slot = renderHeader(listing(), {
      refresh: () => {
        refreshes += 1;
        return { ok: true, error: null };
      },
    });

    fireEvent.click(await slot.findByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(refreshes).toBe(1));
  });
});

describe("sidebar count", () => {
  function renderBadge(result: Record<string, unknown>) {
    const panel = app.navPanels.find((entry) => entry.path === "prs")!;
    const slot = renderSlot(
      { component: panel.experimental_sidebarAccessory! },
      {},
      { rpc: { listRows: () => result } },
    );
    mounted = slot;
    return slot;
  }

  it("counts rows that need work and rows ready to merge", async () => {
    const slot = renderBadge(
      listing({
        rows: [
          rowFixture({ number: 1, flags: ["conflict"], group: "needs-action" }),
          rowFixture({ number: 2, flags: ["merge-ready"], group: "ready-to-merge" }),
          // Waiting on a machine, a reviewer, and nobody respectively.
          rowFixture({ number: 3, flags: ["ci-pending"], group: "needs-action" }),
          rowFixture({ number: 4, flags: [], group: "clean" }),
          rowFixture({ number: 5, flags: ["conflict"], group: "needs-action", isDraft: true }),
        ],
      }),
    );
    expect(await slot.findByText("2")).toBeInTheDocument();
  });

  it("stops counting a row once a thread is running on it", async () => {
    const slot = renderBadge(
      listing({
        rows: [rowFixture({ flags: ["conflict"], group: "needs-action", threadId: "thr_1" })],
      }),
    );
    await waitFor(() => expect(slot.container.textContent).toBe(""));
  });
});

