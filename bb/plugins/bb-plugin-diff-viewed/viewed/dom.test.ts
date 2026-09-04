// @vitest-environment jsdom
//
// The fixture below mirrors the DOM bb's GitDiffCardHeader actually renders.
// It is the contract this plugin depends on: if a bb upgrade changes the card
// header, these tests are where that shows up, and the fix is to re-read
// app/dist/assets/GitDiffCardHeader-*.js and update both the fixture and
// viewed/dom.ts together.
import { afterEach, describe, expect, it } from "vitest";
import {
  applyClicks,
  createControl,
  existingControl,
  findCards,
  findToolbar,
  paintCard,
  readToolbar,
  resolveCard,
  undecorate,
  OWNED_ATTR,
  VIEWED_ATTR,
} from "./dom";

interface CardOptions {
  path: string;
  stats?: string;
  collapsed?: boolean;
  /** Renders the card as a timeline diff instead of a changes-panel one. */
  timeline?: boolean;
  /** Renders bb's "nothing to expand" header, which has no aria-expanded. */
  inert?: boolean;
}

function renderCard(options: CardOptions): void {
  const {
    path,
    stats = "+8 -4",
    collapsed = false,
    timeline = false,
    inert = false,
  } = options;
  const toggleAttrs = inert
    ? `aria-label="${path} has no changes to expand" disabled`
    : `aria-label="${collapsed ? "Expand" : "Collapse"} ${path}" aria-expanded="${!collapsed}"`;
  const card = `
    <div class="flex w-full min-w-0 items-center justify-between gap-2">
      <span class="flex min-w-0 items-center">
        <button type="button" class="inline-flex w-8 shrink-0" ${toggleAttrs}></button>
        <span class="flex min-w-0 items-center gap-1.5 pl-[1ch]">
          <span class="font-mono font-medium text-foreground">${path}</span>
        </span>
      </span>
      <span class="flex shrink-0 items-center gap-1">
        <span class="text-xs">${stats}</span>
      </span>
    </div>`;
  const host = document.createElement("div");
  if (timeline) host.setAttribute("data-timeline-file-diff", "");
  host.innerHTML = card;
  document.body.append(host);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findCards", () => {
  it("finds a card and reads its path and fingerprint", () => {
    renderCard({ path: "client/app/_layout.tsx", stats: "+1 -1" });
    const cards = findCards(document);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.path).toBe("client/app/_layout.tsx");
    expect(cards[0]?.fingerprint).toBe("+1 -1");
    expect(cards[0]?.isCollapsed).toBe(false);
  });

  it("reports a collapsed card as collapsed", () => {
    renderCard({ path: "a.ts", collapsed: true });
    expect(findCards(document)[0]?.isCollapsed).toBe(true);
  });

  it("skips timeline diffs, which are a different file every message", () => {
    renderCard({ path: "a.ts", timeline: true });
    expect(findCards(document)).toHaveLength(0);
  });

  it("skips a card with nothing to expand", () => {
    renderCard({ path: "client/util/README.md", inert: true });
    expect(findCards(document)).toHaveLength(0);
  });

  it("ignores a disclosure button that is not a diff card header", () => {
    const stray = document.createElement("div");
    stray.innerHTML = `<button aria-expanded="true" aria-label="Collapse sidebar"></button>`;
    document.body.append(stray);
    expect(findCards(document)).toHaveLength(0);
  });

  it("ignores a two-child row that is not laid out like a card header", () => {
    const row = document.createElement("div");
    // Same button and shape, but no justify-between: not bb's card header.
    row.className = "flex items-center";
    row.innerHTML = `
      <span><button aria-expanded="true" aria-label="Collapse thing"></button></span>
      <span>+1 -1</span>`;
    document.body.append(row);
    expect(findCards(document)).toHaveLength(0);
  });

  it("finds a card that sits in no container of its own", () => {
    // Regression: an earlier version required the card to be inside
    // [data-secondary-panel-tab-content], which is bb's *tab strip*, not the
    // tab's content. Nothing matched, on any screen.
    renderCard({ path: "docs/architecture/api-v2-milestones.md", stats: "+3 -3" });
    expect(findCards(document).map((card) => card.path)).toEqual([
      "docs/architecture/api-v2-milestones.md",
    ]);
  });

  it("returns every card on the page", () => {
    renderCard({ path: "a.ts" });
    renderCard({ path: "b.ts" });
    expect(findCards(document).map((card) => card.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});

describe("resolveCard", () => {
  it("returns null for a non-button element", () => {
    const span = document.createElement("span");
    span.setAttribute("aria-expanded", "true");
    expect(resolveCard(span)).toBeNull();
  });
});

describe("the injected control", () => {
  it("reports the user's intent when toggled", () => {
    const seen: boolean[] = [];
    const control = createControl("a.ts", (viewed) => seen.push(viewed));
    // Connected, because a detached checkbox has no activation behavior.
    document.body.append(control);
    const input = control.querySelector("input") as HTMLInputElement;
    input.click();
    input.click();
    expect(seen).toEqual([true, false]);
  });

  it("toggles when the label text is clicked, not just the box", () => {
    const seen: boolean[] = [];
    const control = createControl("a.ts", (viewed) => seen.push(viewed));
    document.body.append(control);
    (control.querySelector("span") as HTMLSpanElement).click();
    expect(seen).toEqual([true]);
  });

  it("keeps its click out of bb's own header handlers", () => {
    renderCard({ path: "a.ts" });
    const card = findCards(document)[0]!;
    let leaked = 0;
    card.headerRow.addEventListener("click", () => {
      leaked += 1;
    });
    const control = createControl(card.path, () => {});
    card.actions.append(control);
    (control.querySelector("input") as HTMLInputElement).click();
    expect(leaked).toBe(0);
  });

  it("names the file it belongs to", () => {
    const control = createControl("src/a.ts", () => {});
    expect(control.querySelector("input")?.getAttribute("aria-label")).toBe(
      "Mark src/a.ts viewed",
    );
  });

  it("does not feed its own text back into the fingerprint", () => {
    renderCard({ path: "a.ts", stats: "+8 -4" });
    const card = findCards(document)[0]!;
    card.actions.append(createControl(card.path, () => {}));
    expect(findCards(document)[0]?.fingerprint).toBe("+8 -4");
  });
});

describe("paintCard", () => {
  it("marks the header row so the dimming rule applies", () => {
    renderCard({ path: "a.ts" });
    const card = findCards(document)[0]!;
    card.actions.append(createControl(card.path, () => {}));
    paintCard(card, true);
    expect(card.headerRow.getAttribute(VIEWED_ATTR)).toBe("true");
    expect(existingControl(card)?.querySelector("input")?.checked).toBe(true);
    paintCard(card, false);
    expect(card.headerRow.hasAttribute(VIEWED_ATTR)).toBe(false);
    expect(existingControl(card)?.querySelector("input")?.checked).toBe(false);
  });
});

describe("undecorate", () => {
  it("leaves bb's own DOM exactly as it found it", () => {
    renderCard({ path: "a.ts" });
    const before = document.body.innerHTML;
    const card = findCards(document)[0]!;
    card.actions.append(createControl(card.path, () => {}));
    paintCard(card, true);
    expect(document.body.innerHTML).not.toBe(before);

    undecorate(document.body);
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll(`[${OWNED_ATTR}]`)).toHaveLength(0);
  });
});

/**
 * The toolbar as bb renders it above the file cards, from
 * ThreadSecondaryPanel-*.js. `data-testid` and the accessible names are the
 * anchors; `aria-pressed` is the state.
 */
function renderToolbar(
  options: { wrap?: boolean; view?: "unified" | "split" } = {},
): HTMLElement {
  const { wrap = false, view = "unified" } = options;
  const toolbar = document.createElement("div");
  toolbar.setAttribute("data-testid", "git-diff-toolbar-actions");
  toolbar.innerHTML = `
    <button type="button" aria-label="Collapse all files"></button>
    <button type="button"
      aria-label="${wrap ? "Disable diff line wrap" : "Wrap diff lines"}"
      aria-pressed="${wrap}"></button>
    <div role="tablist" aria-label="Diff view mode">
      <button type="button" aria-label="Stacked diff view" aria-pressed="${view === "unified"}"></button>
      <button type="button" aria-label="Split diff view" aria-pressed="${view === "split"}"></button>
    </div>`;
  document.body.append(toolbar);
  return toolbar;
}

describe("readToolbar", () => {
  it("reads both controls from aria-pressed", () => {
    expect(readToolbar(renderToolbar({ wrap: true, view: "split" }))).toEqual({
      wrap: true,
      view: "split",
    });
  });

  it("reads the wrap button under either of its two labels", () => {
    expect(readToolbar(renderToolbar({ wrap: false })).wrap).toBe(false);
    expect(readToolbar(renderToolbar({ wrap: true })).wrap).toBe(true);
  });

  it("reports a control bb did not render as unknown, never as a default", () => {
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-testid", "git-diff-toolbar-actions");
    document.body.append(toolbar);
    expect(readToolbar(toolbar)).toEqual({ wrap: null, view: null });
  });
});

describe("findToolbar", () => {
  it("finds the toolbar", () => {
    renderToolbar();
    expect(findToolbar(document)).not.toBeNull();
  });

  it("returns null when there is no changes toolbar on the page", () => {
    expect(findToolbar(document)).toBeNull();
  });
});

describe("applyClicks", () => {
  it("clicks the buttons named, and only those", () => {
    const toolbar = renderToolbar({ wrap: false, view: "unified" });
    const clicked: string[] = [];
    for (const button of toolbar.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        clicked.push(button.getAttribute("aria-label") ?? "");
      });
    }

    applyClicks(toolbar, ["wrap", "split"]);
    expect(clicked).toEqual(["Wrap diff lines", "Split diff view"]);
  });

  it("never touches collapse all", () => {
    const toolbar = renderToolbar();
    let collapseAll = 0;
    toolbar
      .querySelector('button[aria-label="Collapse all files"]')
      ?.addEventListener("click", () => {
        collapseAll += 1;
      });

    applyClicks(toolbar, ["wrap", "stacked", "split"]);
    expect(collapseAll).toBe(0);
  });

  it("is a no-op for a control bb did not render", () => {
    const toolbar = document.createElement("div");
    document.body.append(toolbar);
    expect(() => applyClicks(toolbar, ["wrap", "split"])).not.toThrow();
  });
});
