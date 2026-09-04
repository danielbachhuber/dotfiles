// The sync loop: what actually decorates bb's DOM and keeps it agreeing with
// stored state.
//
// This lives outside app.tsx so it can be driven under jsdom. Every bug this
// plugin has shipped was in here, and each one survived a green test run
// because the only tests were of pure functions and fixtures — the loop that
// wires them together was never exercised. `startEngine` takes its RPC,
// scheduler, and location as parameters for exactly that reason.
import {
  applyClicks,
  cardForControl,
  createControl,
  existingControl,
  findCards,
  findToolbar,
  paintCard,
  readToolbar,
  undecorate,
  type DiffCard,
} from "./dom";
import { isViewed, threadIdFromPath, type ViewedRecord } from "./marks";
import {
  clicksToApply,
  sameState,
  stateAfter,
  withToolbarState,
  type ToolbarPrefs,
  type ToolbarState,
} from "./prefs";

export type RecordResult = { record: ViewedRecord };
export type PrefsResult = { prefs: ToolbarPrefs };

export interface EngineDeps {
  /** Calls one of the plugin's RPC methods. */
  rpc: <Result>(method: string, input: unknown) => Promise<Result>;
  /** Aborted when the content script generation is torn down. */
  signal: AbortSignal;
  /** The document to decorate. */
  doc: Document;
  /** The current route, read fresh on every pass. */
  pathname: () => string;
  /** Defer a pass. Returns a cancel function. `requestAnimationFrame` in bb. */
  defer: (run: () => void) => () => void;
  /** Where failures go. */
  warn: (cause: unknown) => void;
}

export interface Engine {
  /** Run a pass now, skipping the scheduler. Tests use this. */
  syncNow: () => void;
  /** Ask for a pass on the next frame. */
  schedule: () => void;
  dispose: () => void;
}

interface SyncState {
  threadId: string | null;
  record: ViewedRecord;
  /**
   * Files this engine has already collapsed for you, keyed by path and
   * fingerprint. It is why a viewed file can be reopened and stay open: each
   * one is collapsed at most once per diff, not on every pass.
   */
  autoCollapsed: Set<string>;
  pruned: boolean;
  /** Saved toolbar preferences, or null until loaded. */
  prefs: ToolbarPrefs | null;
  /** The last toolbar reading this engine is responsible for. */
  toolbar: ToolbarState | null;
  applied: boolean;
}

function collapseKey(path: string, fingerprint: string): string {
  return `${path} ${fingerprint}`;
}

export function startEngine(deps: EngineDeps): Engine {
  const { rpc, signal, doc, pathname, defer, warn } = deps;
  const state: SyncState = {
    threadId: null,
    record: {},
    autoCollapsed: new Set(),
    pruned: false,
    prefs: null,
    toolbar: null,
    applied: false,
  };
  // True while this engine is writing to the DOM, so an observer driving
  // `schedule` does not treat its own edits as a reason to run again.
  let writing = false;
  let cancel: (() => void) | null = null;
  let loading: Promise<void> | null = null;
  let watchedToolbar: Element | null = null;

  const fail = (cause: unknown) => {
    // A failed write must not leave the checkbox showing a state the server
    // never accepted, so resync from whatever the server does have.
    warn(cause);
    void reload();
  };

  function schedule(): void {
    if (signal.aborted || cancel !== null) return;
    cancel = defer(() => {
      cancel = null;
      syncNow();
    });
  }

  async function reload(): Promise<void> {
    const { threadId } = state;
    if (threadId === null) return;
    try {
      const { record } = await rpc<RecordResult>("viewed_list", { threadId });
      if (signal.aborted || state.threadId !== threadId) return;
      state.record = record;
      schedule();
    } catch (cause) {
      warn(cause);
    }
  }

  /**
   * Handle a click on one file's Viewed checkbox.
   *
   * The card is resolved from the clicked control, never from the pass that
   * injected it — see `cardForControl` for why nothing captured at injection
   * time can be trusted here.
   */
  function setMark(control: Element, viewed: boolean): void {
    const { threadId } = state;
    const card = cardForControl(control);
    if (threadId === null || card === null) return;

    // Paint optimistically: the checkbox has already moved under the user's
    // cursor and snapping it back while a round trip runs reads as a bug.
    state.record = viewed
      ? { ...state.record, [card.path]: card.fingerprint }
      : Object.fromEntries(
          Object.entries(state.record).filter(([path]) => path !== card.path),
        );

    const key = collapseKey(card.path, card.fingerprint);
    writing = true;
    try {
      paintCard(card, viewed);
      if (viewed) {
        state.autoCollapsed.add(key);
        if (!card.isCollapsed) card.toggle.click();
      } else {
        state.autoCollapsed.delete(key);
        if (card.isCollapsed) card.toggle.click();
      }
    } finally {
      writing = false;
    }

    schedule();
    rpc<RecordResult>("viewed_set", {
      threadId,
      path: card.path,
      fingerprint: card.fingerprint,
      viewed,
    }).then(({ record }) => {
      if (signal.aborted || state.threadId !== threadId) return;
      state.record = record;
      schedule();
    }, fail);
  }

  /**
   * Restore the saved wrap and view-mode settings onto a freshly rendered
   * toolbar, then keep whatever the user does with them.
   *
   * The restore has to happen by clicking bb's own buttons rather than by
   * setting anything: the state lives in React and bb's view mode is picked
   * from the panel width until the user overrides it. Clicking is that
   * override, which is also why applying once per toolbar is enough.
   */
  function syncToolbar(toolbar: HTMLElement): void {
    const prefs = state.prefs;
    if (prefs === null) return;
    const current = readToolbar(toolbar);

    if (!state.applied) {
      state.applied = true;
      const clicks = clicksToApply(prefs, current);
      writing = true;
      try {
        applyClicks(toolbar, clicks);
      } finally {
        writing = false;
      }
      // Record what the clicks will settle into, not what the DOM says now:
      // React has not re-rendered yet, and treating that lag as a change would
      // save the state we just moved away from.
      state.toolbar = stateAfter(current, clicks);
      if (clicks.length > 0) schedule();
      return;
    }

    const last = state.toolbar;
    if (last !== null && sameState(last, current)) return;
    state.toolbar = current;
    const next = withToolbarState(prefs, current);
    if (next === prefs) return;
    state.prefs = next;
    rpc<PrefsResult>("prefs_set", next).then(({ prefs: saved }) => {
      if (signal.aborted) return;
      state.prefs = saved;
    }, warn);
  }

  /** A toolbar not seen before is a fresh mount of bb's own state. */
  function onToolbar(toolbar: Element | null): void {
    if (toolbar === watchedToolbar) return;
    watchedToolbar = toolbar;
    state.applied = false;
    state.toolbar = null;
  }

  function decorate(cards: readonly DiffCard[]): void {
    writing = true;
    try {
      for (const card of cards) {
        if (existingControl(card) === null) {
          // The handler is given its own control, not this card object, so the
          // click re-reads the live header instead of a stale snapshot.
          const control: HTMLElement = createControl(card.path, (viewed) =>
            setMark(control, viewed),
          );
          card.actions.append(control);
        }
        const viewed = isViewed(state.record, card);
        paintCard(card, viewed);
        const key = collapseKey(card.path, card.fingerprint);
        if (viewed && !card.isCollapsed && !state.autoCollapsed.has(key)) {
          state.autoCollapsed.add(key);
          card.toggle.click();
        }
      }
    } finally {
      writing = false;
    }
  }

  function syncNow(): void {
    if (signal.aborted) return;
    const threadId = threadIdFromPath(pathname());
    if (threadId !== state.threadId) {
      state.threadId = threadId;
      state.record = {};
      state.autoCollapsed.clear();
      state.pruned = false;
      if (threadId !== null) loading = reload();
    }
    // The toolbar's presence is the signal that the changes panel is open. The
    // card list below it has no container attribute, so there is nothing else
    // to test, and scanning the whole document on every pass would be wasteful
    // on the many screens that have no diff at all.
    const toolbar = findToolbar(doc);
    onToolbar(toolbar);
    if (toolbar !== null) syncToolbar(toolbar);
    if (toolbar === null || threadId === null) {
      writing = true;
      undecorate(doc.body);
      writing = false;
      return;
    }

    const visible = findCards(doc);
    decorate(visible);

    // Prune once per thread, after the first pass that produced cards, so a
    // thread never accumulates marks for files that left its diff.
    if (!state.pruned && visible.length > 0 && loading !== null) {
      state.pruned = true;
      const threadForPrune = threadId;
      void loading.then(() => {
        if (signal.aborted || state.threadId !== threadForPrune) return;
        rpc<RecordResult>("viewed_prune", {
          threadId: threadForPrune,
          presentPaths: visible.map((card) => card.path),
        }).then(({ record }) => {
          if (signal.aborted || state.threadId !== threadForPrune) return;
          state.record = record;
          schedule();
        }, fail);
      });
    }
  }

  /**
   * Toolbar preferences are global, so they load once per mount rather than per
   * thread. Until they arrive the toolbar is left exactly as bb rendered it.
   */
  rpc<PrefsResult>("prefs_get", null).then(({ prefs }) => {
    if (signal.aborted) return;
    state.prefs = prefs;
    schedule();
  }, warn);

  // bb re-renders constantly, so the decoration is re-applied from whatever the
  // DOM currently says rather than assumed to survive. Passes are deferred and
  // coalesced, and edits this engine makes itself are skipped.
  const observer = new doc.defaultView!.MutationObserver(() => {
    if (writing) return;
    schedule();
  });
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-label", "aria-pressed"],
  });

  schedule();

  return {
    syncNow,
    schedule,
    dispose() {
      observer.disconnect();
      if (cancel !== null) cancel();
      cancel = null;
      writing = true;
      undecorate(doc.body);
      writing = false;
    },
  };
}
