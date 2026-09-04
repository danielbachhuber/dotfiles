// Reading and decorating bb's diff card headers.
//
// bb owns this DOM. Everything here anchors on the most stable thing bb
// actually emits — the toolbar's `data-testid`, accessible names,
// `aria-expanded`/`aria-pressed`, and the header's two-child structure — and
// never on a minified class name. Read GitDiffCardHeader in
// app/dist/assets before changing an assumption here; the header renders as:
//
//   <div class="… items-center justify-between …">        <- headerRow
//     <span class="flex min-w-0 items-center">            <- left
//       <button aria-label="Collapse src/a.ts" aria-expanded="true">…</button>
//       <span>… path link, copy, open-in-editor …</span>
//     </span>
//     <span class="flex shrink-0 items-center gap-1">     <- right
//       {actionSlot}{+12 -3}
//     </span>
//   </div>
import {
  fingerprintFromStats,
  pathFromToggleLabel,
  type FileMarkTarget,
} from "./marks";
import type { ToolbarClick, ToolbarState } from "./prefs";

/** Marks a node this plugin created, so cleanup can find every one of them. */
export const OWNED_ATTR = "data-diff-viewed-owned";
/** Set on a header row whose file is marked viewed. Drives the dimming. */
export const VIEWED_ATTR = "data-diff-viewed";
/** Timeline diffs, which are deliberately out of scope: the same path recurs
 * once per message there, so one mark could not mean anything useful. */
const TIMELINE_SELECTOR = "[data-timeline-file-diff]";

/** One diff card header, resolved to the parts this plugin touches. */
export interface DiffCard extends FileMarkTarget {
  headerRow: HTMLElement;
  /** Where the checkbox goes: the header's right-hand action group. */
  actions: HTMLElement;
  toggle: HTMLButtonElement;
  isCollapsed: boolean;
}

/**
 * Resolve a collapse control to the card it belongs to, or null when the
 * element is not a diff card header after all.
 *
 * There is deliberately no "must be inside the changes panel" check: the card
 * list has no container attribute of its own, and requiring one that only
 * looked right is what made an earlier version of this plugin match nothing at
 * all. The structural checks below carry that weight instead, and they are
 * strict enough that a bare `aria-expanded` disclosure elsewhere in the app
 * cannot pass.
 */
export function resolveCard(toggle: Element): DiffCard | null {
  if (!(toggle instanceof HTMLButtonElement)) return null;
  const expanded = toggle.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false") return null;
  if (toggle.closest(TIMELINE_SELECTOR) !== null) return null;

  const left = toggle.parentElement;
  if (left === null || left.firstElementChild !== toggle) return null;
  const headerRow = left.parentElement;
  if (headerRow === null || headerRow.childElementCount !== 2) return null;
  if (!headerRow.classList.contains("justify-between")) return null;
  const actions = headerRow.lastElementChild;
  if (!(actions instanceof HTMLElement) || actions === left) return null;

  const path = pathFromToggleLabel(toggle.getAttribute("aria-label"));
  if (path === null) return null;

  return {
    path,
    fingerprint: readFingerprint(actions),
    headerRow,
    actions,
    toggle,
    isCollapsed: expanded === "false",
  };
}

/**
 * The card's insertion/deletion counts, read from the action group with this
 * plugin's own nodes excluded so the checkbox can never feed its own
 * fingerprint back in.
 */
function readFingerprint(actions: HTMLElement): string {
  const statText = Array.from(actions.children)
    .filter((child) => !child.hasAttribute(OWNED_ATTR))
    .map((child) => child.textContent ?? "")
    .join(" ");
  return fingerprintFromStats(statText);
}

/** Every diff card currently rendered, in document order. */
export function findCards(root: ParentNode): DiffCard[] {
  const cards: DiffCard[] = [];
  for (const toggle of root.querySelectorAll("button[aria-expanded]")) {
    const card = resolveCard(toggle);
    if (card !== null) cards.push(card);
  }
  return cards;
}

/** This plugin's control inside a card header, if it is still mounted. */
export function existingControl(card: DiffCard): HTMLLabelElement | null {
  const control = card.actions.querySelector(`label[${OWNED_ATTR}]`);
  return control instanceof HTMLLabelElement ? control : null;
}

/**
 * Build the Viewed control. It is a real `<label>` wrapping a real checkbox so
 * it is keyboard-reachable and announced correctly without any of bb's React
 * state; `onToggle` receives the user's intent, not the DOM's new value.
 */
export function createControl(
  path: string,
  onToggle: (viewed: boolean) => void,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.setAttribute(OWNED_ATTR, "");
  label.className =
    "flex shrink-0 cursor-pointer select-none items-center gap-1.5 " +
    "rounded-md px-1.5 py-0.5 text-xs font-normal text-muted-foreground " +
    "transition-colors hover:bg-state-hover hover:text-foreground";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "size-3.5 cursor-pointer accent-primary";
  input.setAttribute("aria-label", `Mark ${path} viewed`);
  input.addEventListener("change", () => {
    onToggle(input.checked);
  });
  // bb's card header is itself clickable in places; keep the toggle from
  // reaching anything behind it.
  label.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const text = document.createElement("span");
  text.textContent = "Viewed";

  label.append(input, text);
  return label;
}

/** Reflect a card's viewed state onto its control and header row. */
export function paintCard(card: DiffCard, viewed: boolean): void {
  const control = existingControl(card);
  const input = control?.querySelector("input");
  if (input instanceof HTMLInputElement && input.checked !== viewed) {
    input.checked = viewed;
  }
  if (viewed) {
    card.headerRow.setAttribute(VIEWED_ATTR, "true");
  } else {
    card.headerRow.removeAttribute(VIEWED_ATTR);
  }
}

/**
 * The dimming, injected once. It deliberately does not dim the control itself
 * — a checkbox you have to squint at to uncheck is worse than no checkbox.
 */
export const STYLE_TEXT = `
[${VIEWED_ATTR}="true"] > span:first-child {
  opacity: 0.5;
  transition: opacity 150ms ease;
}
[${VIEWED_ATTR}="true"] label[${OWNED_ATTR}] {
  color: var(--foreground);
}
`;

/**
 * The changes-panel toolbar — the row holding collapse-all, wrap, and the
 * view-mode pair. Its presence is also how this plugin knows the changes panel
 * is open at all, since the file card list below it carries no attribute of
 * its own.
 */
export const TOOLBAR_SELECTOR = '[data-testid="git-diff-toolbar-actions"]';

/**
 * Each control's accessible name. bb flips the wrap button's label with its
 * state, so both readings have to match the same control.
 */
const BUTTON_LABELS: Record<ToolbarClick, readonly string[]> = {
  wrap: ["Wrap diff lines", "Disable diff line wrap"],
  stacked: ["Stacked diff view"],
  split: ["Split diff view"],
};

export function findToolbar(root: ParentNode): HTMLElement | null {
  const toolbar = root.querySelector(TOOLBAR_SELECTOR);
  return toolbar instanceof HTMLElement ? toolbar : null;
}

export function toolbarButton(
  toolbar: HTMLElement,
  click: ToolbarClick,
): HTMLButtonElement | null {
  for (const label of BUTTON_LABELS[click]) {
    const button = toolbar.querySelector(
      `button[aria-label="${CSS.escape(label)}"]`,
    );
    if (button instanceof HTMLButtonElement) return button;
  }
  return null;
}

function isPressed(button: HTMLButtonElement | null): boolean | null {
  const pressed = button?.getAttribute("aria-pressed");
  if (pressed !== "true" && pressed !== "false") return null;
  return pressed === "true";
}

/**
 * Read the toolbar's current settings. Every control reports `aria-pressed`,
 * so nothing here has to infer state from an icon or a class. A control bb did
 * not render reads as null rather than a guess.
 */
export function readToolbar(toolbar: HTMLElement): ToolbarState {
  const stacked = isPressed(toolbarButton(toolbar, "stacked"));
  const split = isPressed(toolbarButton(toolbar, "split"));
  return {
    wrap: isPressed(toolbarButton(toolbar, "wrap")),
    view: stacked === true ? "unified" : split === true ? "split" : null,
  };
}

/** Apply the clicks, skipping any control bb did not render. */
export function applyClicks(
  toolbar: HTMLElement,
  clicks: readonly ToolbarClick[],
): void {
  for (const click of clicks) toolbarButton(toolbar, click)?.click();
}

/** Remove every node, attribute, and class this plugin added under `root`. */
export function undecorate(root: ParentNode): void {
  for (const owned of root.querySelectorAll(`[${OWNED_ATTR}]`)) owned.remove();
  for (const row of root.querySelectorAll(`[${VIEWED_ATTR}]`)) {
    row.removeAttribute(VIEWED_ATTR);
  }
}
