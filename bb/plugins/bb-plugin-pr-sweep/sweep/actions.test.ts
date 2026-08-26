import { describe, expect, it } from "vitest";
import { actionLabel, skillFor, skillOwnsWorkflow } from "./actions.js";
import { FLAG_SEVERITY } from "./types.js";

describe("actionLabel", () => {
  it("names the action for a single flag", () => {
    expect(actionLabel(["conflict"])).toBe("Resolve conflict");
    expect(actionLabel(["ci-failing"])).toBe("Fix failing CI");
    expect(actionLabel(["feedback"])).toBe("Answer feedback");
    expect(actionLabel(["no-reviewer"])).toBe("Add a reviewer");
    expect(actionLabel(["merge-ready"])).toBe("Merge");
  });

  it("uses the worst flag when a row carries several", () => {
    // A conflict blocks the feedback work, so it is the action to take first.
    expect(actionLabel(["conflict", "feedback"])).toBe("Resolve conflict");
    expect(actionLabel(["feedback", "conflict"])).toBe("Resolve conflict");
    expect(actionLabel(["ci-failing", "no-reviewer"])).toBe("Fix failing CI");
  });

  it("gives every flag a label", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(actionLabel([flag])).not.toBe("Work on this");
    }
  });

  it("falls back for an unknown or empty flag list", () => {
    expect(actionLabel([])).toBe("Work on this");
    expect(actionLabel(["something-new"])).toBe("Work on this");
  });
});

describe("skillFor", () => {
  it("routes a conflict to the merge-conflict skill", () => {
    expect(skillFor(["conflict"])).toBe("resolve-merge-conflicts");
  });

  it("routes reviewer feedback to the code-review skill", () => {
    expect(skillFor(["feedback"])).toBe("address-code-review");
  });

  it("routes everything else to pr-sweep", () => {
    expect(skillFor(["ci-failing"])).toBe("pr-sweep");
    expect(skillFor(["no-reviewer"])).toBe("pr-sweep");
    expect(skillFor(["merge-ready"])).toBe("pr-sweep");
    expect(skillFor([])).toBe("pr-sweep");
  });

  it("routes on the worst flag, matching the action label", () => {
    // The button says "Resolve conflict", so the skill must be the conflict one.
    expect(actionLabel(["conflict", "feedback"])).toBe("Resolve conflict");
    expect(skillFor(["conflict", "feedback"])).toBe("resolve-merge-conflicts");

    // ci-failing outranks feedback, so this row's action is "Fix failing CI"
    // and it routes to pr-sweep rather than the code-review skill.
    expect(actionLabel(["feedback", "ci-failing"])).toBe("Fix failing CI");
    expect(skillFor(["feedback", "ci-failing"])).toBe("pr-sweep");
  });

  it("never names a skill that disagrees with the button", () => {
    // Label and skill both derive from the leading flag, so for any pair the
    // two must resolve against the same one. Catches a divergence introduced
    // by reordering severity or adding a flag to only one of the maps.
    for (const first of FLAG_SEVERITY) {
      for (const second of FLAG_SEVERITY) {
        const worst = FLAG_SEVERITY.find((flag) => flag === first || flag === second)!;
        expect(actionLabel([first, second])).toBe(actionLabel([worst]));
        expect(skillFor([first, second])).toBe(skillFor([worst]));
      }
    }
  });

  it("knows which flags have a skill owning the whole workflow", () => {
    expect(skillOwnsWorkflow(["conflict"])).toBe(true);
    expect(skillOwnsWorkflow(["feedback"])).toBe(true);
    expect(skillOwnsWorkflow(["ci-failing"])).toBe(false);
  });
});
