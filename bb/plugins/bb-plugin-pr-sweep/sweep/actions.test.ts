import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_BY_ACTION,
  MAX_THREAD_TITLE,
  actionLabel,
  modelForFlags,
  parseModelByAction,
  skillFor,
  skillOwnsWorkflow,
  threadTitle,
} from "./actions.js";
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

describe("threadTitle", () => {
  it("pairs the action with the pull request number", () => {
    expect(threadTitle(["conflict"], 5687)).toBe("Resolve conflict #5687");
    expect(threadTitle(["feedback"], 5708)).toBe("Answer feedback #5708");
    expect(threadTitle(["merge-ready"], 5707)).toBe("Merge #5707");
  });

  it("leaves out the repository, which the sidebar already shows", () => {
    expect(threadTitle(["conflict"], 5687)).not.toMatch(/\//);
  });

  it("fits the sidebar for every flag at a realistic number", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(threadTitle([flag], 5687).length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    }
  });

  it("fits the sidebar even for an implausibly long number", () => {
    for (const flag of FLAG_SEVERITY) {
      const title = threadTitle([flag], 999_999_999);
      expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
      expect(title).toContain("999999999");
    }
  });

  it("sacrifices the label rather than the number when squeezed", () => {
    const title = threadTitle(["mergeable-unknown"], 12_345_678_901);
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    expect(title).toContain("#12345678901");
  });

  it("names the same action the button does", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(threadTitle([flag], 1).startsWith(actionLabel([flag]))).toBe(true);
    }
  });
});

describe("modelForFlags", () => {
  it("uses the model for the row's worst flag", () => {
    const models = { conflict: "haiku", feedback: "sonnet" };
    expect(modelForFlags(["conflict", "feedback"], models)).toBe("haiku");
    expect(modelForFlags(["feedback"], models)).toBe("sonnet");
  });

  it("returns undefined for a flag with no model, taking the provider default", () => {
    expect(modelForFlags(["ci-failing"], { conflict: "haiku" })).toBeUndefined();
    expect(modelForFlags([], { conflict: "haiku" })).toBeUndefined();
  });

  it("picks by worst flag, matching the button and the skill", () => {
    // ci-failing outranks feedback, so a model set only for feedback is unused.
    expect(modelForFlags(["feedback", "ci-failing"], { feedback: "sonnet" })).toBeUndefined();
  });
});

describe("parseModelByAction", () => {
  it("falls back to the defaults when unset or blank", () => {
    expect(parseModelByAction(undefined).models).toBe(DEFAULT_MODEL_BY_ACTION);
    expect(parseModelByAction("   ").models).toBe(DEFAULT_MODEL_BY_ACTION);
  });

  it("defaults to a cheap model for merge conflicts", () => {
    expect(DEFAULT_MODEL_BY_ACTION.conflict).toBe("claude-haiku-4-5-20251001");
  });

  it("reads a flag-to-model object", () => {
    expect(parseModelByAction('{"conflict":"haiku","no-reviewer":"sonnet"}')).toEqual({
      models: { conflict: "haiku", "no-reviewer": "sonnet" },
      error: null,
    });
  });

  it("never throws on malformed input, and says what was wrong", () => {
    for (const bad of ["{", "[]", "null", '"a string"', "42"]) {
      const result = parseModelByAction(bad);
      expect(result.models).toBe(DEFAULT_MODEL_BY_ACTION);
      expect(result.error).toBeTruthy();
    }
  });

  it("reports an unknown flag rather than silently ignoring it", () => {
    const result = parseModelByAction('{"conflcit":"haiku"}');
    expect(result.error).toMatch(/conflcit/);
    expect(result.models).toEqual({});
  });

  it("skips entries whose model is not a non-empty string", () => {
    expect(parseModelByAction('{"conflict":"","feedback":null,"ci-failing":"x"}').models).toEqual({
      "ci-failing": "x",
    });
  });
});
