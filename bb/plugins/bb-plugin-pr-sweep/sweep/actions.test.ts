import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_BY_ACTION,
  DISPLAY_SECTIONS,
  SECTION_TITLES,
  PERMISSION_MODES,
  MAX_THREAD_TITLE,
  actionLabel,
  actionSummary,
  displaySection,
  isOnlyWaitingOnCi,
  isWorkFinished,
  parseAutoArchiveActions,
  worstFlag,
  modelForFlags,
  parseModelByAction,
  parsePermissionMode,
  skillFor,
  statusTone,
  skillOwnsWorkflow,
  threadTitle,
  unflaggedStatus,
} from "./actions.js";
import { FLAG_SEVERITY } from "./types.js";

describe("actionLabel", () => {
  it("names the action for a single flag", () => {
    expect(actionLabel(["conflict"])).toBe("Resolve conflict");
    expect(actionLabel(["ci-failing"])).toBe("Fix failing CI");
    expect(actionLabel(["feedback"])).toBe("Address feedback");
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

  it("routes a merge with unresolved comments to the code-review skill", () => {
    // The button already says "Review and merge" for this row, so sending it
    // to triage contradicted what the click promised. Answering comments is
    // exactly what the feedback skill specifies.
    expect(actionSummary(["merge-ready"], 3)).toBe("Review and merge");
    expect(skillFor(["merge-ready"], 3)).toBe("address-code-review");
    expect(skillOwnsWorkflow(["merge-ready"], 3)).toBe(true);
  });

  it("leaves a clean merge on pr-sweep", () => {
    // No comments means no review work, and pr-sweep owns the merge playbook.
    expect(skillFor(["merge-ready"], 0)).toBe("pr-sweep");
  });

  it("only lets unresolved comments matter where a merge is the work", () => {
    // A row whose worst flag is anything else has real work in front of the
    // comments, and that flag's skill still owns the step.
    for (const flag of FLAG_SEVERITY) {
      if (flag === "merge-ready") continue;
      expect(skillFor([flag], 3)).toBe(skillFor([flag], 0));
    }
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
    expect(threadTitle(["feedback"], 5708)).toBe("Address feedback #5708");
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

  it("names the same action the button does, for any set of flags", () => {
    for (const first of FLAG_SEVERITY) {
      for (const second of FLAG_SEVERITY) {
        const pair = [first, second];
        expect(threadTitle(pair, 1)).toBe(`${actionSummary(pair)} #1`);
      }
    }
  });

  it("titles a multi-step thread after the summary, not the first step", () => {
    expect(threadTitle(["conflict", "feedback"], 5780)).toBe("Address issues #5780");
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
    expect(DEFAULT_MODEL_BY_ACTION.conflict).toBe("claude-sonnet-5");
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

describe("parsePermissionMode", () => {
  it("accepts each mode bb defines", () => {
    for (const mode of PERMISSION_MODES) {
      expect(parsePermissionMode(mode)).toBe(mode);
    }
  });

  it("falls back to full for an unset or unrecognized value", () => {
    // A select cannot produce these, but a hand-edited settings file can, and
    // an unknown string would be rejected by threads.spawn.
    for (const bad of [undefined, "", "bypass", "ACCEPT-EDITS", "plan"]) {
      expect(parsePermissionMode(bad)).toBe("full");
    }
  });
});

describe("displaySection", () => {
  it("moves any row with a thread into in-progress", () => {
    for (const group of ["needs-action", "ready-to-merge", "clean"]) {
      for (const isDraft of [true, false]) {
        expect(displaySection(group, true, isDraft)).toBe("in-progress");
      }
    }
  });

  it("keeps the flag-derived group when there is no thread", () => {
    expect(displaySection("needs-action", false, false)).toBe("needs-action");
    expect(displaySection("ready-to-merge", false, false)).toBe("ready-to-merge");
  });

  it("files a row that is only waiting on CI out of the actionable queue", () => {
    // The run decides; there is nothing for the user to do. A row with any
    // other flag keeps that flag's section — broken CI beside a running job is
    // still broken.
    expect(displaySection("needs-action", false, false, 0, ["ci-pending"])).toBe("waiting-on-ci");
    expect(displaySection("needs-action", false, false, 0, ["ci-failing", "ci-pending"])).toBe(
      "needs-action",
    );
    expect(isOnlyWaitingOnCi(["ci-pending"])).toBe(true);
    expect(isOnlyWaitingOnCi(["ci-pending", "conflict"])).toBe(false);
    expect(isOnlyWaitingOnCi([])).toBe(false);
  });

  it("separates an approval that still has reviewers outstanding", () => {
    // One approval clears the technical bar, but people who were asked and
    // have not answered make merging a judgement call rather than housekeeping.
    expect(displaySection("ready-to-merge", false, false, 0)).toBe("ready-to-merge");
    expect(displaySection("ready-to-merge", false, false, 2)).toBe("partial-approval");
  });

  it("splits an unflagged row on whether it is a draft", () => {
    expect(displaySection("clean", false, false)).toBe("awaiting-review");
    expect(displaySection("clean", false, true)).toBe("draft");
  });

  it("files a draft under Draft however many flags it carries", () => {
    // A draft is not offered to anyone yet, so it is not waiting on you
    // whatever else is true of it. The flags still show in the Status column.
    expect(displaySection("needs-action", false, true)).toBe("draft");
    expect(displaySection("clean", false, true)).toBe("draft");
    expect(displaySection("ready-to-merge", false, true, 0)).toBe("draft");
    expect(displaySection("needs-action", false, true, 0, ["ci-pending"])).toBe("draft");
  });

  it("still puts a draft with a thread in In Progress", () => {
    // Work being done outranks the draft state.
    expect(displaySection("needs-action", true, true)).toBe("in-progress");
  });

  it("orders the sections from most to least urgent", () => {
    expect(DISPLAY_SECTIONS).toEqual([
      "ready-to-merge",
      "needs-action",
      "in-progress",
      "waiting-on-ci",
      "partial-approval",
      "awaiting-review",
      "draft",
    ]);
  });

  it("gives every section a capitalized title", () => {
    for (const section of DISPLAY_SECTIONS) {
      const title = SECTION_TITLES[section];
      expect(title).toBeTruthy();
      expect(title[0]).toBe(title[0]!.toUpperCase());
    }
    expect(SECTION_TITLES["needs-action"]).toBe("Needs Action");
    expect(SECTION_TITLES["ready-to-merge"]).toBe("Ready to Merge");
  });
});

describe("actionSummary", () => {
  it("reads as a single action for one flag", () => {
    expect(actionSummary(["conflict"])).toBe("Resolve conflict");
    expect(actionSummary(["feedback"])).toBe("Address feedback");
  });

  it("says Address issues whenever there is more than one step", () => {
    expect(actionSummary(["conflict", "feedback"])).toBe("Address issues");
    expect(actionSummary(["conflict", "feedback", "no-reviewer"])).toBe("Address issues");
    expect(actionSummary(["conflict", "ci-failing", "feedback", "no-reviewer"])).toBe(
      "Address issues",
    );
  });

  it("stays short enough not to wrap the button", () => {
    for (const first of FLAG_SEVERITY) {
      for (const second of FLAG_SEVERITY) {
        expect(actionSummary([first, second]).length).toBeLessThanOrEqual(20);
      }
    }
  });

  it("falls back for a row with no known flag", () => {
    expect(actionSummary([])).toBe("Work on this");
  });
});

describe("unflaggedStatus", () => {
  it("reads as awaiting review when a reviewer is outstanding", () => {
    expect(unflaggedStatus({ waitingOn: ["hubber"], awaitingReReview: false })).toBe(
      "awaiting review",
    );
  });

  it("reads as awaiting review when a re-review is pending", () => {
    expect(unflaggedStatus({ waitingOn: [], awaitingReReview: true })).toBe("awaiting review");
  });

  it("reads as clean only when nobody is outstanding", () => {
    expect(unflaggedStatus({ waitingOn: [], awaitingReReview: false })).toBe("clean");
  });
});

describe("statusTone", () => {
  it("treats merge-readiness as the only good news", () => {
    expect(statusTone("merge-ready")).toBe("positive");
  });

  it("treats every fault as a problem", () => {
    const notFaults = new Set(["merge-ready", "ci-pending"]);
    for (const flag of FLAG_SEVERITY.filter((f) => !notFaults.has(f))) {
      expect(statusTone(flag)).toBe("negative");
    }
  });

  it("does not colour a run in flight as a fault", () => {
    // Nothing is wrong while CI is still deciding.
    expect(statusTone("ci-pending")).toBe("info");
  });

  it("treats an unflagged row as informational", () => {
    expect(statusTone(null)).toBe("info");
  });
});

describe("a merge-ready pull request with comments on it", () => {
  it("says the click will read them, not just merge", () => {
    expect(actionSummary(["merge-ready"], 3)).toBe("Review and merge");
    expect(actionSummary(["merge-ready"], 0)).toBe("Merge");
  });

  it("does not change a row that is not merge-ready", () => {
    // Those already say what to do, and their flags outrank the comments.
    expect(actionSummary(["conflict"], 3)).toBe("Resolve conflict");
    expect(actionSummary(["ci-failing"], 3)).toBe("Fix failing CI");
  });

  it("titles the thread with the same words, untruncated", () => {
    const title = threadTitle(["merge-ready"], 5801, 3);
    expect(title).toBe("Review and merge #5801");
    expect(title.length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
  });

  it("still fits the plain case exactly", () => {
    expect(threadTitle(["merge-ready"], 5801, 0)).toBe("Merge #5801");
  });
});

describe("every button label fits its column", () => {
  // The action column is 11.5rem, of which 1.5rem is cell padding, and the
  // button does not wrap. A long label overflows and puts a horizontal
  // scrollbar on the whole table; "Review comments and merge" did exactly
  // that.
  const MAX_BUTTON_LABEL = 20;

  it("holds for every flag on its own", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(actionSummary([flag]).length).toBeLessThanOrEqual(MAX_BUTTON_LABEL);
      expect(actionSummary([flag], 3).length).toBeLessThanOrEqual(MAX_BUTTON_LABEL);
    }
  });

  it("holds for every pair, and for the empty case", () => {
    for (const first of FLAG_SEVERITY) {
      for (const second of FLAG_SEVERITY) {
        expect(actionSummary([first, second]).length).toBeLessThanOrEqual(MAX_BUTTON_LABEL);
      }
    }
    expect(actionSummary([]).length).toBeLessThanOrEqual(MAX_BUTTON_LABEL);
  });

  it("keeps every thread title inside the sidebar budget too", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(threadTitle([flag], 5801, 3).length).toBeLessThanOrEqual(MAX_THREAD_TITLE);
    }
  });
});

describe("worstFlag", () => {
  it("agrees with everything else that resolves against the worst flag", () => {
    // The stored reason has to name the same flag the button and the skill
    // did, or a thread would be judged finished against work it never started.
    for (const first of FLAG_SEVERITY) {
      for (const second of FLAG_SEVERITY) {
        const worst = worstFlag([first, second])!;
        expect(actionLabel([first, second])).toBe(actionLabel([worst]));
        expect(skillFor([first, second])).toBe(skillFor([worst]));
      }
    }
  });

  it("is null for a row with nothing on it", () => {
    expect(worstFlag([])).toBeNull();
    expect(worstFlag(["something-new"])).toBeNull();
  });
});

describe("isWorkFinished", () => {
  it("is not finished while the flag is still there", () => {
    expect(isWorkFinished("conflict", ["conflict"])).toBe(false);
    expect(isWorkFinished("ci-failing", ["ci-failing", "feedback"])).toBe(false);
  });

  it("is finished once the flag has gone", () => {
    expect(isWorkFinished("conflict", [])).toBe(true);
    expect(isWorkFinished("ci-failing", ["no-reviewer"])).toBe(true);
  });

  it("does not treat an unknown merge state as a resolved conflict", () => {
    // GitHub drops the conflict flag while it recomputes mergeability, so an
    // unknown reads exactly like a fix that never landed.
    expect(isWorkFinished("conflict", ["mergeable-unknown"])).toBe(false);
  });

  it("lets a different reason finish even while mergeability is unknown", () => {
    // The guard is about conflicts specifically; a CI fix does not wait on
    // GitHub recomputing whether the branch merges.
    expect(isWorkFinished("ci-failing", ["mergeable-unknown"])).toBe(true);
  });

  it("judges every flag by its own disappearance", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(isWorkFinished(flag, [flag])).toBe(false);
    }
  });
});

describe("parseAutoArchiveActions", () => {
  it("defaults the setting to conflicts alone", () => {
    expect([...parseAutoArchiveActions("conflict")]).toEqual(["conflict"]);
  });

  it("reads a list", () => {
    const actions = parseAutoArchiveActions("conflict, ci-failing");
    expect(actions.has("conflict")).toBe(true);
    expect(actions.has("ci-failing")).toBe(true);
  });

  it("turns the behaviour off when blank", () => {
    expect(parseAutoArchiveActions("").size).toBe(0);
    expect(parseAutoArchiveActions("   ").size).toBe(0);
    expect(parseAutoArchiveActions(undefined).size).toBe(0);
  });

  it("drops a name no flag will ever match", () => {
    // A typo that stayed in the set would never fire, which is the safe
    // failure, but keeping it invites the opposite bug later.
    const actions = parseAutoArchiveActions("conflcit, conflict");
    expect([...actions]).toEqual(["conflict"]);
  });
});
