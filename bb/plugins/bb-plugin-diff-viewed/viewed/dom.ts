// Reading and decorating bb's diff card headers.
//
// bb owns this DOM. Everything here anchors on the most stable thing bb
// actually emits — the container data attributes, the collapse control's
// accessible name and `aria-expanded`, and the header's two-child structure —
// and never on a minified class name. Read GitDiffCardHeader in
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

/** Marks a node this plugin created, so cleanup can find every one of them. */
export const OWNED_ATTR = "data-diff-viewed-owned";
/** Set on a header row whose file is marked viewed. Drives the dimming. */
export const VIEWED_ATTR = "data-diff-viewed";
/** The changes panel. Timeline diffs are deliberately out of scope. */
export const PANEL_SELECTOR = "[data-secondary-panel-tab-content]";
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
 * element is not a diff card header after all. The structural checks are the
 * point: a bare `aria-expanded` selector would also match unrelated
 * disclosures bb may add later.
 */
export function resolveCard(toggle: Element): DiffCard | null {
  if (!(toggle instanceof HTMLButtonElement)) return null;
  const expanded = toggle.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false") return null;
  if (toggle.closest(TIMELINE_SELECTOR) !== null) return null;
  if (toggle.closest(PANEL_SELECTOR) === null) return null;

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

/** Every diff card currently in the changes panel, in document order. */
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

/** Remove every node, attribute, and class this plugin added under `root`. */
export function undecorate(root: ParentNode): void {
  for (const owned of root.querySelectorAll(`[${OWNED_ATTR}]`)) owned.remove();
  for (const row of root.querySelectorAll(`[${VIEWED_ATTR}]`)) {
    row.removeAttribute(VIEWED_ATTR);
  }
}
