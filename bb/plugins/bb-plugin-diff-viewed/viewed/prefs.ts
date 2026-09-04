// Pure logic for the changes-panel toolbar preferences: line wrap, and the
// stacked/split view mode. Both are in-memory React state in bb, so they reset
// every time the panel remounts.
//
// These are preferences about how you read a diff, not facts about a thread,
// so unlike viewed marks they are stored once and apply everywhere.

export type ViewMode = "unified" | "split";

/**
 * What the user has chosen. A missing field means they have never touched that
 * control, and bb's own default stands — which matters for `view`, because bb
 * picks stacked or split from the panel's width until you override it. Storing
 * "no preference" separately from "stacked" is what keeps that default alive.
 */
export interface ToolbarPrefs {
  wrap?: boolean;
  view?: ViewMode;
}

/** Global, not per thread. */
export const PREFS_KEY = "toolbar-prefs";

/** The toolbar controls this plugin drives, by the click it takes to set them. */
export type ToolbarClick = "wrap" | "stacked" | "split";

/** The toolbar as read out of the DOM; null where the control was not found. */
export interface ToolbarState {
  wrap: boolean | null;
  view: ViewMode | null;
}

/**
 * Which buttons to click to bring the toolbar to the saved preferences.
 * Returns nothing for a control with no saved preference, one bb did not
 * render, or one that already reads the way it should — clicking a control
 * that already agrees would toggle it away.
 */
export function clicksToApply(
  saved: ToolbarPrefs,
  current: ToolbarState,
): ToolbarClick[] {
  const clicks: ToolbarClick[] = [];
  if (
    saved.wrap !== undefined &&
    current.wrap !== null &&
    saved.wrap !== current.wrap
  ) {
    clicks.push("wrap");
  }
  if (
    saved.view !== undefined &&
    current.view !== null &&
    saved.view !== current.view
  ) {
    clicks.push(saved.view === "split" ? "split" : "stacked");
  }
  return clicks;
}

/**
 * Fold an observed toolbar state into the saved preferences. Only controls bb
 * actually rendered contribute, so a toolbar caught mid-render cannot erase a
 * preference. Returns the original object when nothing changed, which is the
 * signal callers use to skip a write.
 */
export function withToolbarState(
  saved: ToolbarPrefs,
  current: ToolbarState,
): ToolbarPrefs {
  const next: ToolbarPrefs = { ...saved };
  if (current.wrap !== null) next.wrap = current.wrap;
  if (current.view !== null) next.view = current.view;
  if (next.wrap === saved.wrap && next.view === saved.view) return saved;
  return next;
}

/** Whether two observed toolbar states are the same reading. */
export function sameState(a: ToolbarState, b: ToolbarState): boolean {
  return a.wrap === b.wrap && a.view === b.view;
}

/**
 * The state the toolbar will settle into once the applied clicks land. React
 * re-renders after the click, so the DOM still reads the old value on the tick
 * that issues it; recording the intended state instead of the observed one is
 * what keeps that lag from looking like the user changing their mind.
 */
export function stateAfter(
  current: ToolbarState,
  clicks: readonly ToolbarClick[],
): ToolbarState {
  let { wrap, view } = current;
  for (const click of clicks) {
    if (click === "wrap") wrap = wrap === null ? null : !wrap;
    if (click === "stacked") view = "unified";
    if (click === "split") view = "split";
  }
  return { wrap, view };
}
