import { describe, expect, it } from "vitest";
import {
  clicksToApply,
  sameState,
  stateAfter,
  withToolbarState,
  type ToolbarPrefs,
} from "./prefs";

describe("clicksToApply", () => {
  it("clicks nothing when the toolbar already reads the saved way", () => {
    expect(
      clicksToApply({ wrap: true, view: "split" }, { wrap: true, view: "split" }),
    ).toEqual([]);
  });

  it("clicks wrap when it disagrees", () => {
    expect(
      clicksToApply({ wrap: true }, { wrap: false, view: "unified" }),
    ).toEqual(["wrap"]);
  });

  it("clicks the button for the saved view mode, not a toggle", () => {
    expect(
      clicksToApply({ view: "split" }, { wrap: false, view: "unified" }),
    ).toEqual(["split"]);
    expect(
      clicksToApply({ view: "unified" }, { wrap: false, view: "split" }),
    ).toEqual(["stacked"]);
  });

  it("leaves a control with no saved preference alone", () => {
    // This is what keeps bb's width-driven view-mode default in charge until
    // the user actually picks something.
    expect(clicksToApply({}, { wrap: true, view: "split" })).toEqual([]);
  });

  it("leaves a control bb did not render alone", () => {
    expect(
      clicksToApply({ wrap: true, view: "split" }, { wrap: null, view: null }),
    ).toEqual([]);
  });

  it("fixes both controls at once", () => {
    expect(
      clicksToApply({ wrap: true, view: "split" }, { wrap: false, view: "unified" }),
    ).toEqual(["wrap", "split"]);
  });
});

describe("stateAfter", () => {
  it("predicts where the toolbar lands, since React has not re-rendered yet", () => {
    expect(stateAfter({ wrap: false, view: "unified" }, ["wrap", "split"])).toEqual(
      { wrap: true, view: "split" },
    );
  });

  it("is the identity for no clicks", () => {
    const current = { wrap: true, view: "split" as const };
    expect(stateAfter(current, [])).toEqual(current);
  });

  it("leaves a control bb did not render unknown", () => {
    expect(stateAfter({ wrap: null, view: null }, ["wrap"])).toEqual({
      wrap: null,
      view: null,
    });
  });
});

describe("withToolbarState", () => {
  it("records what the user just chose", () => {
    expect(withToolbarState({}, { wrap: true, view: "split" })).toEqual({
      wrap: true,
      view: "split",
    });
  });

  it("returns the same object when nothing changed", () => {
    const prefs: ToolbarPrefs = { wrap: true, view: "split" };
    expect(withToolbarState(prefs, { wrap: true, view: "split" })).toBe(prefs);
  });

  it("cannot erase a preference from a toolbar caught mid-render", () => {
    const prefs: ToolbarPrefs = { wrap: true, view: "split" };
    expect(withToolbarState(prefs, { wrap: null, view: null })).toBe(prefs);
  });

  it("updates one control without disturbing the other", () => {
    expect(
      withToolbarState({ wrap: true, view: "split" }, { wrap: null, view: "unified" }),
    ).toEqual({ wrap: true, view: "unified" });
  });
});

describe("sameState", () => {
  it("compares both controls", () => {
    expect(sameState({ wrap: true, view: "split" }, { wrap: true, view: "split" })).toBe(
      true,
    );
    expect(sameState({ wrap: true, view: "split" }, { wrap: false, view: "split" })).toBe(
      false,
    );
    expect(sameState({ wrap: null, view: null }, { wrap: null, view: null })).toBe(true);
  });
});
