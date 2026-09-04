// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));

const DAY = 86_400_000;

/** Relative to the real clock, since the panel samples Date.now() per render. */
function daysAgo(days: number) {
  return Date.now() - days * DAY;
}

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    repo: "acme/widgets",
    number: 42,
    title: "Add the widget endpoint",
    url: "https://github.com/acme/widgets/pull/42",
    author: "octocat",
    isDraft: false,
    state: "first-look",
    requestedAt: daysAgo(4),
    lastReviewedAt: null,
    requestedReviewers: ["you"],
    size: { additions: 120, deletions: 8, changedFiles: 6 },
    canSpawn: true,
    threadId: null,
    snoozedUntil: null,
    ...overrides,
  };
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    rows: [rowFixture()],
    sweptAt: 1_700_000_000_000,
    truncated: false,
    lastError: null,
    staleAfterDays: 2,
    // Required by the contract, so the fixture carries it: the panel reads
    // listing.harvest to decide whether to draw a clock, and a fixture that
    // omits it renders nothing at all.
    harvest: { available: false, running: null },
    ...overrides,
  };
}

/**
 * Opens a row's kebab menu.
 *
 * Opened from the keyboard. Radix drives a dropdown from pointerdown, not
 * click, and jsdom synthesizes neither from `.click()` — both leave the menu
 * shut and every item query times out. Enter on the trigger is a real way a
 * user opens this menu, so the test exercises a path rather than faking one.
 */
async function openRowMenu(slot: {
  findByRole: (role: string, options?: Record<string, unknown>) => Promise<HTMLElement>;
}) {
  const trigger = await slot.findByRole("button", { name: /more actions/i });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
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
    expect(app.navPanels[0]!.path).toBe("reviews");
  });

  it("lists a requested review under Needs Review", async () => {
    const slot = render(listing());
    await slot.findByText(/Needs Review \(1\)/);
    await slot.findByText(/Add the widget endpoint/);
    await slot.findByText("first look");
  });

  it("sets a draft apart, below the queue", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ number: 1 }), rowFixture({ number: 2, isDraft: true })],
      }),
    );
    const queue = await slot.findByText(/Needs Review \(1\)/);
    const draft = await slot.findByText(/^Draft \(1\)$/);
    expect(queue.compareDocumentPosition(draft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves a row with a thread out of the queue and into In Progress", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ number: 1 }), rowFixture({ number: 2, threadId: "thr_1" })],
      }),
    );
    await slot.findByText(/Needs Review \(1\)/);
    await slot.findByText(/In Progress \(1\)/);
  });

  it("puts a draft with a thread in In Progress, not Draft", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ isDraft: true, threadId: "thr_1" })] }),
    );
    await slot.findByText(/In Progress \(1\)/);
    expect(slot.queryByText(/^Draft \(/)).toBeNull();
  });

  it("capitalizes every section heading", async () => {
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1 }),
          rowFixture({ number: 2, threadId: "thr_1" }),
          rowFixture({ number: 3, isDraft: true }),
        ],
      }),
    );
    for (const title of ["Needs Review", "In Progress", "Draft"]) {
      await slot.findByText(new RegExp(`^${title} \\(`));
    }
  });

  it("says so when nothing is waiting", async () => {
    const slot = render(listing({ rows: [] }));
    await slot.findByText("Nothing to review.");
    await slot.findByText(/New requests appear here as they arrive/i);
  });

  it("gives the empty-state art a label, since it is punctuation to a reader", async () => {
    // "@@ -0,0 +0,0 @@" read aloud is noise, so the art carries one label and
    // its characters are hidden.
    const slot = render(listing({ rows: [] }));
    const art = await slot.findByRole("img", { name: /empty diff/i });
    expect(art).toBeInTheDocument();
  });

  it("shows no empty state while rows are present", async () => {
    const slot = render(listing());
    await slot.findByText(/Widget rotation|Add the widget|#/);
    expect(slot.queryByText("Nothing to review.")).toBeNull();
  });

  it("surfaces a sweep error without blanking the rows", async () => {
    const slot = render(listing({ lastError: "`gh` is not authenticated. Run `gh auth login`." }));
    await slot.findByText(/gh auth login/);
    await slot.findByText(/Add the widget endpoint/);
  });

  it("warns when the sweep hit the search ceiling", async () => {
    const slot = render(listing({ truncated: true }));
    await slot.findByText(/search ceiling/i);
  });

  it("opens a pull request in a real browser tab, not the in-app one", async () => {
    const slot = render(listing());
    const link = await slot.findByRole("link", { name: /Add the widget endpoint/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/42");
  });

  it("names the author, since the PR is never mine", async () => {
    const slot = render(listing());
    await slot.findByText(/octocat/);
  });

  it("marks a draft on the row as well as in its own section", async () => {
    const slot = render(listing({ rows: [rowFixture({ isDraft: true })] }));
    await slot.findByText(/octocat · draft/);
  });

  it("renders column headers", async () => {
    const slot = render(listing());
    // "PR" is gone: the number rides the title instead of its own column.
    for (const header of ["Title", "Status", "Age", "Reviewers", "Size"]) {
      await slot.findByText(header);
    }
    // "Age" replaced "Waiting": the column measures how old the request is,
    // which is the thing the sort is built on.
    expect(slot.queryByText("Waiting")).toBeNull();
  });

  it("uses one fixed column layout so every section table lines up", async () => {
    const slot = render(
      listing({
        rows: [rowFixture({ number: 1 }), rowFixture({ number: 2, isDraft: true })],
      }),
    );
    await slot.findByText(/Needs Review \(1\)/);
    const tables = slot.container.querySelectorAll("table");
    expect(tables.length).toBe(2);
    for (const table of tables) {
      expect(table.className).toMatch(/table-fixed/);
    }

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
        rows: [rowFixture({ number: 1 }), rowFixture({ number: 2, repo: "acme/gadgets" })],
      }),
    );
    // It shares the line under the title with the author now, so match
    // within it rather than expecting a text node of its own.
    await slot.findByText(/^acme\/widgets · /);
    await slot.findByText(/^acme\/gadgets · /);
  });
});

describe("age column", () => {
  it("reddens a wait at or past the threshold and leaves a fresh one quiet", async () => {
    const stale = render(listing({ rows: [rowFixture({ requestedAt: daysAgo(6) })] }));
    expect((await stale.findByText("6 days")).className).toMatch(/text-destructive/);
    stale.lifecycle.unmount();

    const fresh = render(listing({ rows: [rowFixture({ requestedAt: daysAgo(1) })] }));
    expect((await fresh.findByText("24 hours")).className).toMatch(/text-muted-foreground/);
  });

  it("honours the configured threshold rather than a hard-coded one", async () => {
    const slot = render(
      listing({ staleAfterDays: 14, rows: [rowFixture({ requestedAt: daysAgo(6) })] }),
    );
    expect((await slot.findByText("6 days")).className).toMatch(/text-muted-foreground/);
  });

  it("counts hours for a request younger than two days", async () => {
    // "today" hid the difference between a request that arrived this morning
    // and one that had already sat overnight.
    const slot = render(
      listing({ rows: [rowFixture({ requestedAt: Date.now() - 3_600_000 * 5 })] }),
    );
    await slot.findByText("5 hours");
  });
});

describe("reviewers column", () => {
  it("names everyone whose review is still outstanding", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ requestedReviewers: ["you", "mona", "platform"] })] }),
    );
    await slot.findByText("you, mona, platform");
  });

  it("shows only the team when the ask reached me through one", async () => {
    const slot = render(listing({ rows: [rowFixture({ requestedReviewers: ["platform"] })] }));
    await slot.findByText("platform");
  });

  it("falls back to an em dash rather than claiming nobody was asked", async () => {
    const slot = render(listing({ rows: [rowFixture({ requestedReviewers: [] })] }));
    await slot.findByText("—");
  });

  it("carries the full list as a title, since the cell truncates", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ requestedReviewers: ["you", "mona", "platform"] })] }),
    );
    expect(await slot.findByText("you, mona, platform")).toHaveAttribute(
      "title",
      "you, mona, platform",
    );
  });
});

describe("status and size", () => {
  it("gives a re-review the badge that stands out", async () => {
    // The author is blocked on you and it is usually the cheapest row to clear.
    const slot = render(listing({ rows: [rowFixture({ state: "re-review" })] }));
    const badge = await slot.findByText("re-review");
    expect(badge.className).toMatch(/sky/);
  });

  it("keeps a first look quiet", async () => {
    const slot = render(listing());
    expect((await slot.findByText("first look")).className).toMatch(/text-muted-foreground/);
  });

  it("states the diff size so a small one can be picked off", async () => {
    const slot = render(listing());
    await slot.findByText("+120 −8, 6 files");
  });
});

describe("action", () => {
  it("says what the click does, whatever kind of review it is", async () => {
    // The button used to read "Review"/"Re-review", which sounded like it
    // opened the diff. The thread title still carries that distinction.
    const slot = render(
      listing({
        rows: [
          rowFixture({ number: 1, state: "first-look" }),
          rowFixture({ number: 2, state: "re-review" }),
        ],
      }),
    );
    expect(await slot.findAllByRole("button", { name: /^Start thread for #/ })).toHaveLength(2);
    expect(slot.queryByRole("button", { name: /^Review$/ })).toBeNull();
    expect(slot.queryByRole("button", { name: /^Re-review$/ })).toBeNull();
  });

  it("offers an action on a draft too, since the request is still real", async () => {
    const slot = render(listing({ rows: [rowFixture({ isDraft: true })] }));
    await slot.findByRole("button", { name: /^Start thread for #/ });
  });

  it("disables the action when no project matches", async () => {
    const slot = render(listing({ rows: [rowFixture({ canSpawn: false })] }));
    expect(await slot.findByRole("button", { name: /^Start thread for #/ })).toBeDisabled();
  });

  it("swaps the start icon for the open icon once a thread exists", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    await slot.findByRole("button", { name: /^Open the thread for #/ });
    expect(slot.queryByRole("button", { name: /^Start thread for #/ })).toBeNull();
  });

  it("navigates to the thread when the open icon is clicked", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    (await slot.findByRole("button", { name: /^Open the thread for #/ })).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.inspection.navigateCalls.length).toBeGreaterThan(0);
  });

  it("puts Archive thread in the row menu, alongside the open action", async () => {
    // Unlike pr-sweep there is no flag to clear, so the tidy-up is always
    // available on an in-progress row. It lives in the menu rather than as its
    // own icon button, so every row's action cell has the same shape.
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    await slot.findByRole("button", { name: /^Open the thread for #/ });
    await openRowMenu(slot);
    await slot.findByRole("menuitem", { name: /archive thread/i });
  });

  it("calls archiveThread when Archive thread is chosen", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }), {
      archiveThread: () => ({ ok: true, reason: null }),
    });
    await openRowMenu(slot);
    (await slot.findByRole("menuitem", { name: /archive thread/i })).click();
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.some((call) => call.method === "archiveThread")).toBe(true),
    );
  });

  it("offers no way to ignore a review already being worked on", async () => {
    const slot = render(listing({ rows: [rowFixture({ threadId: "thr_1" })] }));
    await openRowMenu(slot);
    await slot.findByRole("menuitem", { name: /archive thread/i });
    expect(slot.queryByRole("menuitem", { name: /ignore/i })).toBeNull();
  });

  it("asks for a draft when the action is clicked, rather than spawning", async () => {
    const slot = render(listing(), {
      reviewThisDraft: () => ({ existingThreadId: null, reason: null, seed: SEED }),
    });
    (await slot.findByRole("button", { name: /^Start thread for #/ })).click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const call = slot.inspection.rpcCalls.find((entry) => entry.method === "reviewThisDraft");
    expect(call?.input).toEqual({ repo: "acme/widgets", number: 42 });
    expect(
      slot.inspection.rpcCalls.some((entry) => entry.method === "reviewThisSubmit"),
    ).toBe(false);
  });

  it("opens the composer naming the review", async () => {
    const slot = render(listing(), {
      reviewThisDraft: () => ({ existingThreadId: null, reason: null, seed: SEED }),
    });
    (await slot.findByRole("button", { name: /^Start thread for #/ })).click();
    expect(
      await slot.findByText("Start a review thread for #42"),
    ).toBeInTheDocument();
  });

  it("disables the button and says Starting while the draft is fetched", async () => {
    let release: (() => void) | undefined;
    const slot = render(listing(), {
      reviewThisDraft: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { existingThreadId: null, reason: null, seed: SEED };
      },
    });

    (await slot.findByRole("button", { name: /^Start thread for #/ })).click();
    expect(await slot.findByRole("button", { name: /starting/i })).toBeDisabled();

    release?.();
  });

  it("does not fire a second call when the button is clicked twice", async () => {
    let release: (() => void) | undefined;
    const slot = render(listing(), {
      reviewThisDraft: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { existingThreadId: null, reason: null, seed: SEED };
      },
    });

    const button = await slot.findByRole("button", { name: /^Start thread for #/ });
    button.click();
    await slot.findByRole("button", { name: /starting/i });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "reviewThisDraft"),
    ).toHaveLength(1);

    release?.();
  });
});

/** What `reviewThisDraft` hands the composer. */
const SEED = {
  projectId: "proj_widgets",
  providerId: "claude-code",
  model: null,
  permissionMode: "full" as const,
  prompt: "Review acme/widgets#42.",
  environment: {
    type: "host" as const,
    workspace: {
      type: "managed-worktree" as const,
      baseBranch: { kind: "default" as const },
    },
  },
};

describe("ignoring a review", () => {
  it("offers Ignore for 48 hours in the row menu", async () => {
    const slot = render(listing());
    await openRowMenu(slot);
    await slot.findByRole("menuitem", { name: /^Ignore for 48 hours$/ });
  });

  it("calls snooze when Ignore is chosen", async () => {
    const slot = render(listing(), { snooze: () => ({ until: Date.now() + 48 * 3_600_000 }) });
    await openRowMenu(slot);
    (await slot.findByRole("menuitem", { name: /^Ignore for 48 hours$/ })).click();
    await waitFor(() => {
      const call = slot.inspection.rpcCalls.find((entry) => entry.method === "snooze");
      expect(call?.input).toEqual({ repo: "acme/widgets", number: 42 });
    });
  });

  it("moves an ignored review out of the queue and into its own section", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ snoozedUntil: Date.now() + 41 * 3_600_000 })] }),
    );
    await slot.findByText("Ignored (1)");
    expect(slot.queryByText(/^Needs Review/)).toBeNull();
  });

  it("says when an ignored review comes back", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ snoozedUntil: Date.now() + 41 * 3_600_000 })] }),
    );
    expect(await slot.findByText(/returns in 41 hours/)).toBeInTheDocument();
  });

  it("offers to take back an ignored review rather than ignoring it again", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ snoozedUntil: Date.now() + 41 * 3_600_000 })] }),
    );
    await openRowMenu(slot);
    await slot.findByRole("menuitem", { name: /^Stop ignoring$/ });
    expect(slot.queryByRole("menuitem", { name: /^Ignore for 48 hours$/ })).toBeNull();
  });

  it("calls unsnooze when Stop ignoring is chosen", async () => {
    const slot = render(
      listing({ rows: [rowFixture({ snoozedUntil: Date.now() + 41 * 3_600_000 })] }),
      { unsnooze: () => ({ ok: true }) },
    );
    await openRowMenu(slot);
    (await slot.findByRole("menuitem", { name: /^Stop ignoring$/ })).click();
    await waitFor(() => {
      const call = slot.inspection.rpcCalls.find((entry) => entry.method === "unsnooze");
      expect(call?.input).toEqual({ repo: "acme/widgets", number: 42 });
    });
  });

  function renderCount(result: Record<string, unknown>) {
    const slot = renderSlot(
      { component: app.navPanels[0]!.experimental_sidebarAccessory! },
      { subPath: "" },
      { rpc: { listRows: () => result } },
    );
    mounted = slot;
    return slot;
  }

  it("counts a review that is waiting", async () => {
    const slot = renderCount(listing());
    await waitFor(() => expect(slot.container.textContent).toBe("1"));
  });

  it("keeps an ignored review out of the sidebar count", async () => {
    // The count is what says the queue is not empty, so an ignored review that
    // still counted would undo the point of ignoring it.
    const slot = renderCount(listing({ rows: [rowFixture({ snoozedUntil: Date.now() + DAY })] }));
    await waitFor(() => expect(slot.container.textContent).toBe(""));
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

  const pr = {
    repo: "acme/widgets",
    number: 42,
    url: "https://github.com/acme/widgets/pull/42",
    title: "Add the widget endpoint",
  };

  it("registers one header action", () => {
    expect(app.threadHeaderActions).toHaveLength(1);
    expect(action().id).toBe("open-reviewed-pull-request");
  });

  it("links to the pull request on a thread this plugin started", async () => {
    const slot = renderHeader(pr);
    const link = await slot.findByRole("link", { name: /open acme\/widgets#42 on github/i });
    expect(link).toHaveAttribute("href", pr.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.textContent).toContain("#42");
  });

  it("renders nothing on a thread this plugin did not start", async () => {
    // The server decides this by returning null; the component must not draw a
    // control on someone else's thread.
    const slot = renderHeader(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.queryByRole("link")).toBeNull();
  });

  it("drops the number on a compact viewport, keeping the accessible name", async () => {
    const slot = renderHeader(pr, { isCompactViewport: true });
    const link = await slot.findByRole("link", { name: /open acme\/widgets#42 on github/i });
    expect(link.textContent).toBe("");
  });

  it("asks the server about the thread it was mounted for", async () => {
    const slot = renderHeader(null, { threadId: "thr_specific" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const call = slot.inspection.rpcCalls.find((entry) => entry.method === "pullRequestForThread");
    expect(call?.input).toEqual({ threadId: "thr_specific" });
  });
});

describe("sync header", () => {
  function renderHeader(result: Record<string, unknown>, extraRpc: Record<string, unknown> = {}) {
    const slot = renderSlot(
      { component: app.navPanels[0]!.headerContent! },
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

describe("loading state", () => {
  // Never resolves, so the panel stays in the state it shows before its rows
  // arrive.
  const pending = () => new Promise<never>(() => {});

  it("counts in the same notation the empty state settles in", async () => {
    const slot = render({} as Record<string, unknown>, { listRows: pending });
    const frame = await slot.findByRole("status");
    expect(frame).toHaveAttribute("aria-busy", "true");
    // Six digits turning: two counts either side of the hunk header.
    expect(frame.querySelectorAll(".review-sweep-roll")).toHaveLength(6);
  });

  it("says what it is doing once, in the panel's own words", async () => {
    const slot = render({} as Record<string, unknown>, { listRows: pending });
    expect(
      await slot.findByText("Sweeping the reviews waiting on you"),
    ).toBeInTheDocument();
    expect(slot.queryByText("Loading…")).toBeNull();
  });
});

