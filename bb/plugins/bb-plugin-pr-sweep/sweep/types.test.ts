import { describe, expect, it } from "vitest";
import { FLAG_SEVERITY, groupForFlags } from "./types.js";

describe("groupForFlags", () => {
  it("puts a merge-ready row in ready-to-merge", () => {
    expect(groupForFlags(["merge-ready"])).toBe("ready-to-merge");
  });

  it("puts a flagged row in needs-action", () => {
    expect(groupForFlags(["conflict"])).toBe("needs-action");
  });

  it("puts an unflagged row in clean", () => {
    expect(groupForFlags([])).toBe("clean");
  });

  it("orders every flag deterministically, worst first", () => {
    const sorted = [...FLAG_SEVERITY].reverse().sort(
      (a, b) => FLAG_SEVERITY.indexOf(a) - FLAG_SEVERITY.indexOf(b),
    );
    expect(sorted).toEqual(FLAG_SEVERITY);
  });
});
