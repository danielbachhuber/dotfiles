// @vitest-environment jsdom
//
// The sync loop driven against a DOM shaped like bb's, with a fake bb standing
// in for React: clicking a collapse control flips `aria-expanded` and the
// label, the way bb's own button does. That is enough to catch the failures
// that only show up once the pieces are wired together.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startEngine, type Engine } from "./engine";
import { OWNED_ATTR, VIEWED_ATTR } from "./dom";

const THREAD = "/projects/proj_x/threads/thr_a";

/** A card header plus the bit of bb behavior that responds to a click. */
function renderCard(path: string, stats = "+2 -2"): HTMLButtonElement {
  const host = document.createElement("div");
  host.innerHTML = `
    <div class="flex w-full min-w-0 items-center justify-between gap-2">
      <span class="flex min-w-0 items-center">
        <button type="button" aria-label="Collapse ${path}" aria-expanded="true"></button>
        <span><span class="font-mono">${path}</span></span>
      </span>
      <span class="flex shrink-0 items-center gap-1"><span>${stats}</span></span>
    </div>`;
  document.body.append(host);
  const toggle = host.querySelector("button") as HTMLButtonElement;
  // Stand in for bb's React handler: collapse state lives in aria-expanded,
  // and the accessible name flips with it.
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Expand" : "Collapse"} ${path}`);
  });
  return toggle;
}

function renderToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.setAttribute("data-testid", "git-diff-toolbar-actions");
  toolbar.innerHTML = `
    <button type="button" aria-label="Collapse all files"></button>
    <button type="button" aria-label="Wrap diff lines" aria-pressed="false"></button>
    <button type="button" aria-label="Stacked diff view" aria-pressed="true"></button>
    <button type="button" aria-label="Split diff view" aria-pressed="false"></button>`;
  document.body.prepend(toolbar);
  return toolbar;
}

function checkboxFor(toggle: HTMLButtonElement): HTMLInputElement | null {
  const headerRow = toggle.parentElement?.parentElement;
  const input = headerRow?.querySelector(`label[${OWNED_ATTR}] input`);
  return input instanceof HTMLInputElement ? input : null;
}

function isCollapsed(toggle: HTMLButtonElement): boolean {
  return toggle.getAttribute("aria-expanded") === "false";
}

interface Harness {
  engine: Engine;
  calls: { method: string; input: unknown }[];
  record: Record<string, string>;
  /** Let queued promise callbacks run, then re-sync. */
  settle: () => Promise<void>;
}

let controller: AbortController;
let started: Engine[] = [];

function start(
  options: { record?: Record<string, string>; prefs?: unknown; pathname?: string } = {},
): Harness {
  const calls: { method: string; input: unknown }[] = [];
  const record: Record<string, string> = { ...(options.record ?? {}) };

  const rpc = async <Result,>(method: string, input: unknown): Promise<Result> => {
    calls.push({ method, input });
    if (method === "prefs_get" || method === "prefs_set") {
      return { prefs: options.prefs ?? {} } as Result;
    }
    if (method === "viewed_set") {
      const { path, fingerprint, viewed } = input as {
        path: string;
        fingerprint: string;
        viewed: boolean;
      };
      if (viewed) record[path] = fingerprint;
      else delete record[path];
    }
    return { record: { ...record } } as Result;
  };

  const engine = startEngine({
    rpc,
    signal: controller.signal,
    doc: document,
    pathname: () => options.pathname ?? THREAD,
    // Run deferred passes immediately: the tests drive time explicitly.
    defer: (run) => {
      run();
      return () => {};
    },
    warn: (cause) => {
      throw cause;
    },
  });
  started.push(engine);

  return {
    engine,
    calls,
    record,
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      engine.syncNow();
    },
  };
}

beforeEach(() => {
  controller = new AbortController();
  started = [];
});

afterEach(() => {
  for (const engine of started) engine.dispose();
  controller.abort();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("marking a file viewed", () => {
  it("collapses the file", async () => {
    renderToolbar();
    const toggle = renderCard("client/system/demo.jest.tsx");
    const harness = start();
    await harness.settle();

    const checkbox = checkboxFor(toggle);
    expect(checkbox).not.toBeNull();
    expect(isCollapsed(toggle)).toBe(false);

    checkbox!.click();
    expect(isCollapsed(toggle)).toBe(true);
  });

  it("dims the header", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts");
    const harness = start();
    await harness.settle();

    checkboxFor(toggle)!.click();
    const headerRow = toggle.parentElement!.parentElement!;
    expect(headerRow.getAttribute(VIEWED_ATTR)).toBe("true");
  });

  it("persists the mark for the thread in the route", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts", "+8 -4");
    const harness = start();
    await harness.settle();

    checkboxFor(toggle)!.click();
    await harness.settle();

    expect(harness.calls).toContainEqual({
      method: "viewed_set",
      input: {
        threadId: "thr_a",
        path: "a.ts",
        fingerprint: "+8 -4",
        viewed: true,
      },
    });
    expect(harness.record).toEqual({ "a.ts": "+8 -4" });
  });

  it("collapses even after bb has re-rendered the header", async () => {
    // Regression: the click handler used to close over the card object from
    // the pass that injected it, so `isCollapsed` was a snapshot and `toggle`
    // could be a detached node.
    renderToolbar();
    const toggle = renderCard("a.ts");
    const harness = start();
    await harness.settle();

    // bb re-renders: the header's contents are rebuilt around the same button.
    const pathSpan = toggle.nextElementSibling as HTMLElement;
    pathSpan.innerHTML = `<span class="font-mono">a.ts</span>`;
    harness.engine.syncNow();

    checkboxFor(toggle)!.click();
    expect(isCollapsed(toggle)).toBe(true);
  });

  it("collapses after bb replaces the collapse button itself", async () => {
    // The harsher re-render: React swaps the button node rather than reusing
    // it. Anything holding the old element — a closure, or a lookup keyed on
    // it — is now pointing at a node that is not in the document.
    renderToolbar();
    const toggle = renderCard("a.ts");
    const harness = start();
    await harness.settle();

    const left = toggle.parentElement!;
    const replacement = toggle.cloneNode(true) as HTMLButtonElement;
    replacement.addEventListener("click", () => {
      const expanded = replacement.getAttribute("aria-expanded") === "true";
      replacement.setAttribute("aria-expanded", String(!expanded));
      replacement.setAttribute(
        "aria-label",
        `${expanded ? "Expand" : "Collapse"} a.ts`,
      );
    });
    left.replaceChild(replacement, toggle);
    harness.engine.syncNow();

    checkboxFor(replacement)!.click();
    expect(isCollapsed(replacement)).toBe(true);
  });

  it("does not re-expand the file on the next pass", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts");
    const harness = start();
    await harness.settle();

    checkboxFor(toggle)!.click();
    await harness.settle();
    harness.engine.syncNow();

    expect(isCollapsed(toggle)).toBe(true);
    expect(checkboxFor(toggle)!.checked).toBe(true);
  });
});

describe("unmarking a file", () => {
  it("expands it again", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts");
    const harness = start();
    await harness.settle();

    checkboxFor(toggle)!.click();
    await harness.settle();
    expect(isCollapsed(toggle)).toBe(true);

    checkboxFor(toggle)!.click();
    expect(isCollapsed(toggle)).toBe(false);
  });

  it("clears the stored mark", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts", "+8 -4");
    const harness = start({ record: { "a.ts": "+8 -4" } });
    await harness.settle();

    checkboxFor(toggle)!.click();
    await harness.settle();
    expect(harness.record).toEqual({});
  });
});

describe("restoring marks", () => {
  it("collapses a file that was already viewed", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts", "+8 -4");
    const harness = start({ record: { "a.ts": "+8 -4" } });
    await harness.settle();

    expect(isCollapsed(toggle)).toBe(true);
    expect(checkboxFor(toggle)!.checked).toBe(true);
  });

  it("leaves a file alone when its diff has changed since", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts", "+9 -4");
    const harness = start({ record: { "a.ts": "+8 -4" } });
    await harness.settle();

    expect(isCollapsed(toggle)).toBe(false);
    expect(checkboxFor(toggle)!.checked).toBe(false);
  });

  it("lets a viewed file be reopened without snapping shut again", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts", "+8 -4");
    const harness = start({ record: { "a.ts": "+8 -4" } });
    await harness.settle();
    expect(isCollapsed(toggle)).toBe(true);

    toggle.click(); // the user expands it to re-read
    harness.engine.syncNow();
    expect(isCollapsed(toggle)).toBe(false);
  });
});

describe("scope", () => {
  it("decorates nothing when the changes panel is not open", async () => {
    renderCard("a.ts");
    const harness = start();
    await harness.settle();

    expect(document.querySelectorAll(`[${OWNED_ATTR}]`)).toHaveLength(0);
  });

  it("decorates nothing off a thread route", async () => {
    renderToolbar();
    renderCard("a.ts");
    const harness = start({ pathname: "/projects/proj_x" });
    await harness.settle();

    expect(document.querySelectorAll(`[${OWNED_ATTR}]`)).toHaveLength(0);
  });

  it("removes its own decoration on dispose", async () => {
    renderToolbar();
    const toggle = renderCard("a.ts");
    const harness = start();
    await harness.settle();
    expect(checkboxFor(toggle)).not.toBeNull();

    harness.engine.dispose();
    expect(document.querySelectorAll(`[${OWNED_ATTR}]`)).toHaveLength(0);
    expect(document.querySelectorAll(`[${VIEWED_ATTR}]`)).toHaveLength(0);
  });
});
