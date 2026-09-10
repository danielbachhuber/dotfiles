import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_BY_ACTION,
  DISPLAY_SECTIONS,
  SECTION_TITLES,
  PERMISSION_MODES,
  actionLabel,
  actionSummary,
  commentsToRead,
  COUNTED_SECTIONS,
  displaySection,
  isCounted,
  hasNothingToDo,
  isOnlyWaitingOnCi,
  isAutoArchivable,
  isWorkFinished,
  reasonsForRow,
  COMMENTS_REASON,
  parseAutoArchiveActions,
  worstFlag,
  modelForFlags,
  parseModelByAction,
  parsePermissionMode,
  skillFor,
  statusTone,
  skillOwnsWorkflow,
  scopedThreadTitle,
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

  it("routes a run in flight to the comments, since waiting is not work", () => {
    // #5914: approved with an open thread and a nit in the review body while
    // three checks ran. "Check on CI" sent a thread to watch a machine.
    expect(skillFor(["ci-pending"], 0)).toBe("pr-sweep");
    expect(skillFor(["ci-pending"], 2)).toBe("address-code-review");
  });

  it("routes an unflagged row carrying comments to the review skill", () => {
    // No flag records an approval's unresolved threads, so a flagless row is
    // not necessarily idle.
    expect(skillFor([], 0)).toBe("pr-sweep");
    expect(skillFor([], 1)).toBe("address-code-review");
  });

  it("only lets unresolved comments matter where nothing else is yours to do", () => {
    // A row whose worst flag is real work has that work in front of the
    // comments, and that flag's skill still owns the step.
    for (const flag of FLAG_SEVERITY) {
      if (flag === "merge-ready" || flag === "ci-pending") continue;
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
  it("carries a few words of the pull request title, so a queue of threads is legible", () => {
    expect(threadTitle(5879, "docs(adr): propose exact API replay")).toBe(
      "Refine #5879: propose exact API replay",
    );
  });

  it("uses one label for every kind of work, whatever the flag", () => {
    // The button still names the specific action; the sidebar has no Status
    // column beside it, so the pull request's own words are worth more there.
    expect(threadTitle(5687, "Fix the widget endpoint")).toMatch(/^Refine #5687: /);
  });

  it("falls back to the bare label and number when there is no title", () => {
    expect(threadTitle(5687)).toBe("Refine #5687");
    expect(threadTitle(5687, "   ")).toBe("Refine #5687");
  });

  it("drops a conventional-commit prefix, which the number already covers", () => {
    expect(threadTitle(12, "fix(sync): handle empty page")).toBe("Refine #12: handle empty page");
    expect(threadTitle(12, "[ACME-4] Handle empty page")).toBe("Refine #12: Handle empty page");
  });

  it("leaves out the repository, which the sidebar already shows", () => {
    expect(threadTitle(5687, "Fix the widget endpoint")).not.toMatch(/\//);
  });

  it("does not truncate, because bb clips a title and adds its own ellipsis", () => {
    // Cutting to a guessed budget here produced "Retire the last…...", cut
    // twice, and threw away the tail the thread list and hover would have
    // shown in full.
    const long = "Add a retry with exponential backoff to the sync worker";
    expect(threadTitle(5931, long)).toBe(`Refine #5931: ${long}`);
    expect(threadTitle(5931, long)).not.toContain("…");
  });

  it("collapses the whitespace a wrapped title arrives with", () => {
    expect(threadTitle(12, "handle\n  empty   page")).toBe("Refine #12: handle empty page");
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

  it("keeps a row with comments out of Waiting on CI", () => {
    // #5914: approved, one unresolved thread, a nit in the review body, three
    // checks running. Waiting on CI hid its button behind the one thing on the
    // row nobody had to do.
    expect(isOnlyWaitingOnCi(["ci-pending"], 2)).toBe(false);
    expect(displaySection("needs-action", false, false, 0, ["ci-pending"], 2)).toBe("needs-action");
  });

  it("keeps an unflagged row with comments out of Awaiting Review when nobody is outstanding", () => {
    // Nobody else is going to answer an open thread on an approved pull
    // request.
    expect(displaySection("clean", false, false, 0, [], 1)).toBe("needs-action");
    expect(displaySection("clean", false, false, 0, [], 0)).toBe("awaiting-review");
  });

  it("files an unflagged row with a reviewer outstanding under Awaiting Review", () => {
    // #5935 and #5950 both read "awaiting review" in the Status column while
    // sitting under Needs Action, because the two decisions were made
    // separately. A reviewer who owes a look decides the section, comments or
    // not: #5950 was approved by one reviewer, awaiting a re-review from
    // another, and carrying four unresolved threads.
    expect(displaySection("clean", false, false, 1, [], 1)).toBe("awaiting-review");
    expect(displaySection("clean", false, false, 1, [], 6, true)).toBe("awaiting-review");
    expect(displaySection("clean", false, false, 0, [], 6, true)).toBe("awaiting-review");
  });

  it("agrees with the row's own Status column on every unflagged row", () => {
    for (const outstanding of [0, 1]) {
      for (const awaitingReReview of [false, true]) {
        for (const comments of [0, 3]) {
          const section = displaySection(
            "clean",
            false,
            false,
            outstanding,
            [],
            comments,
            awaitingReReview,
          );
          const status = unflaggedStatus({
            waitingOn: outstanding > 0 ? ["hubber"] : [],
            awaitingReReview,
          });
          if (status === "awaiting review") expect(section).toBe("awaiting-review");
        }
      }
    }
  });

  it("still files a draft under Draft when it carries comments", () => {
    expect(displaySection("needs-action", false, true, 0, ["ci-pending"], 2)).toBe("draft");
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

describe("hasNothingToDo", () => {
  it("is true only when no flag and no reading is left", () => {
    expect(hasNothingToDo("clean", [], 0)).toBe(true);
    expect(hasNothingToDo("needs-action", ["ci-pending"], 0)).toBe(true);
    expect(hasNothingToDo("needs-action", ["conflict"], 0)).toBe(false);
  });

  it("is false for anything still carrying comments", () => {
    // #5914: the button was hidden on a row with an open thread and a nit in
    // the review body, because the only flag was ci-pending.
    expect(hasNothingToDo("needs-action", ["ci-pending"], 2)).toBe(false);
    expect(hasNothingToDo("clean", [], 1)).toBe(false);
  });
});

describe("a merge-ready pull request with comments on it", () => {
  it("says the click will read them, not just merge", () => {
    expect(actionSummary(["merge-ready"], 3)).toBe("Review and merge");
    expect(actionSummary(["merge-ready"], 0)).toBe("Merge");
  });

  it("says the same of a row whose only flag is a run in flight", () => {
    // Nothing about a running check is yours to do, so the comments are the
    // whole of the work and the label is theirs alone.
    expect(actionSummary(["ci-pending"], 2)).toBe("Review comments");
    expect(actionSummary(["ci-pending"], 0)).toBe("Check on CI");
  });

  it("says the same of a row carrying no flag at all", () => {
    expect(actionSummary([], 1)).toBe("Review comments");
    expect(actionSummary([], 0)).toBe("Work on this");
  });

  it("does not change a row with real work in front of the comments", () => {
    // Those already say what to do, and their flags outrank the comments.
    expect(actionSummary(["conflict"], 3)).toBe("Resolve conflict");
    expect(actionSummary(["ci-failing"], 3)).toBe("Fix failing CI");
  });

  it("does not reach the thread title, which names no flag at all", () => {
    // The title is the pull request's, not the work's, so the comment count
    // that changes the button changes nothing here.
    expect(threadTitle(5801, "Add the widget endpoint")).toBe(
      "Refine #5801: Add the widget endpoint",
    );
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
    expect(actionSummary([], 3).length).toBeLessThanOrEqual(MAX_BUTTON_LABEL);
  });

  it("does not constrain the thread title, which bb clips for itself", () => {
    // The button's cap is about a fixed-width table column. A sidebar entry is
    // clipped by CSS, so the title carries the whole sentence.
    expect(threadTitle(5801, "a".repeat(200))).toHaveLength(200 + "Refine #5801: ".length);
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

describe("reasonsForRow", () => {
  const row = { flags: [] as string[], unresolvedThreads: 0, notedBy: [] as string[] };

  it("records every flag, worst first", () => {
    expect(reasonsForRow({ ...row, flags: ["feedback", "conflict"] })).toEqual([
      "conflict",
      "feedback",
    ]);
  });

  it("records the reading as a reason of its own", () => {
    // Unresolved threads and review notes belong to no flag, and the prompt
    // still sends the thread to answer them.
    expect(reasonsForRow({ ...row, flags: ["conflict"], unresolvedThreads: 4 })).toEqual([
      "conflict",
      COMMENTS_REASON,
    ]);
    expect(reasonsForRow({ ...row, notedBy: ["octocat"] })).toEqual([COMMENTS_REASON]);
  });

  it("is empty for a row asking nothing", () => {
    expect(reasonsForRow(row)).toEqual([]);
  });
});

describe("isWorkFinished", () => {
  it("is not finished while any flag is still there", () => {
    expect(isWorkFinished(["conflict"], ["conflict"])).toBe(false);
    expect(isWorkFinished(["ci-failing"], ["ci-failing", "feedback"])).toBe(false);
  });

  it("is finished once every flag has gone", () => {
    expect(isWorkFinished(["conflict"], [])).toBe(true);
    expect(isWorkFinished(["ci-failing"], ["no-reviewer"])).toBe(true);
    expect(isWorkFinished(["conflict", "feedback"], [])).toBe(true);
  });

  it("is not finished while one of several reasons remains", () => {
    // #5950: conflicting, with live feedback and four unresolved comments.
    // Resolving the conflict finished the first of three numbered steps, and
    // judging the thread on that flag alone archived it mid-run.
    expect(isWorkFinished(["conflict", "feedback"], ["feedback"])).toBe(false);
  });

  it("never counts the reading as finished", () => {
    // No recount clears it: an approval body carrying conditions still reads
    // as APPROVED, so there is no finish line the sweep can see.
    expect(isWorkFinished([COMMENTS_REASON], [])).toBe(false);
    expect(isWorkFinished(["conflict", COMMENTS_REASON], [])).toBe(false);
  });

  it("is not finished for a thread with no recorded reasons", () => {
    // A thread adopted from the composer was not started for a flag, so
    // nothing about the row can say its work is over.
    expect(isWorkFinished([], [])).toBe(false);
  });

  it("does not treat an unknown merge state as a resolved conflict", () => {
    // GitHub drops the conflict flag while it recomputes mergeability, so an
    // unknown reads exactly like a fix that never landed.
    expect(isWorkFinished(["conflict"], ["mergeable-unknown"])).toBe(false);
  });

  it("lets a different reason finish even while mergeability is unknown", () => {
    // The guard is about conflicts specifically; a CI fix does not wait on
    // GitHub recomputing whether the branch merges.
    expect(isWorkFinished(["ci-failing"], ["mergeable-unknown"])).toBe(true);
  });

  it("judges every flag by its own disappearance", () => {
    for (const flag of FLAG_SEVERITY) {
      expect(isWorkFinished([flag], [flag])).toBe(false);
    }
  });
});

describe("isAutoArchivable", () => {
  const conflictsOnly = new Set(["conflict"]);

  it("closes a thread whose only work is enabled", () => {
    expect(isAutoArchivable(["conflict"], conflictsOnly)).toBe(true);
  });

  it("leaves a thread carrying work the setting does not cover", () => {
    // The whole list has to be enabled. "Address feedback" has no finish line
    // the sweep can see, and a conflict thread that also has feedback to
    // address is doing that work too.
    expect(isAutoArchivable(["conflict", "feedback"], conflictsOnly)).toBe(false);
  });

  it("never closes a thread that was sent to read comments", () => {
    // The reading is deliberately not a flag, so the setting cannot name it
    // and this stays false however the setting is written.
    expect(isAutoArchivable(["conflict", COMMENTS_REASON], conflictsOnly)).toBe(false);
    expect(
      isAutoArchivable(["conflict", COMMENTS_REASON], new Set(["conflict", COMMENTS_REASON])),
    ).toBe(true);
    expect(parseAutoArchiveActions(`conflict,${COMMENTS_REASON}`).has(COMMENTS_REASON)).toBe(false);
  });

  it("leaves a thread with no recorded reasons alone", () => {
    expect(isAutoArchivable([], conflictsOnly)).toBe(false);
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

describe("commentsToRead", () => {
  it("adds review notes to unresolved threads", () => {
    // Two shapes of the same problem — an approval that came with conditions —
    // so they add up rather than being tracked apart.
    expect(commentsToRead({ unresolvedThreads: 2, notedBy: ["hubber"] })).toBe(3);
  });

  it("is zero for a row with neither", () => {
    expect(commentsToRead({ unresolvedThreads: 0, notedBy: [] })).toBe(0);
  });

  it("turns a bare approval-with-notes into Review and merge", () => {
    // The row that prompted this: approved, green, no unresolved thread, and a
    // review body full of caveats. The button said "Merge".
    const row = { unresolvedThreads: 0, notedBy: ["hubber"] };
    expect(actionSummary(["merge-ready"], commentsToRead(row))).toBe("Review and merge");
    expect(skillFor(["merge-ready"], commentsToRead(row))).toBe("address-code-review");
  });

  it("leaves a genuinely clean merge alone", () => {
    const row = { unresolvedThreads: 0, notedBy: [] };
    expect(actionSummary(["merge-ready"], commentsToRead(row))).toBe("Merge");
    expect(skillFor(["merge-ready"], commentsToRead(row))).toBe("pr-sweep");
  });
});

describe("isCounted", () => {
  it("counts a row that needs work", () => {
    expect(isCounted("needs-action")).toBe(true);
  });

  it("counts a row that is ready to merge", () => {
    // Nothing is wrong with it, but clicking merge is still your move, and a
    // finished pull request nobody merges is what a badge is for.
    expect(isCounted("ready-to-merge")).toBe(true);
  });

  it("does not count what is waiting on someone or something else", () => {
    for (const section of ["in-progress", "waiting-on-ci", "partial-approval", "awaiting-review", "draft"] as const) {
      expect(isCounted(section)).toBe(false);
    }
  });

  it("gives every section an answer", () => {
    // A new section must be classified deliberately rather than defaulting to
    // uncounted by omission.
    for (const section of DISPLAY_SECTIONS) {
      expect(typeof isCounted(section)).toBe("boolean");
    }
    expect(COUNTED_SECTIONS.every((section) => DISPLAY_SECTIONS.includes(section))).toBe(true);
  });
});

describe("scopedThreadTitle", () => {
  it("names the work the thread was started for, not the pull request", () => {
    // #5840's three threads all read "Refine #5840: hide the profile toggles…"
    // — three ways of saying nothing. What differs is what each is for.
    expect(scopedThreadTitle(5840, actionSummary(["conflict"]))).toBe("Refine #5840: resolve conflict");
    expect(scopedThreadTitle(5840, actionSummary(["ci-failing"]))).toBe(
      "Refine #5840: fix failing CI",
    );
    expect(scopedThreadTitle(5840, actionSummary(["merge-ready"], 3))).toBe(
      "Refine #5840: review and merge",
    );
  });

  it("tells a pull request's threads apart, which the gist could not", () => {
    const titles = new Set(
      [["conflict"], ["ci-failing"], ["feedback"]].map((flags) =>
        scopedThreadTitle(5840, actionSummary(flags)),
      ),
    );
    expect(titles.size).toBe(3);
  });

  it("lower-cases the scope, since it completes a phrase after a colon", () => {
    expect(scopedThreadTitle(12, "Fix failing CI")).toBe("Refine #12: fix failing CI");
    // Only the first character: "CI" is not an accident of capitalisation.
    expect(scopedThreadTitle(12, "Fix failing CI")).toContain("CI");
  });

  it("falls back to the bare label and number when there is no scope", () => {
    expect(scopedThreadTitle(12, "")).toBe("Refine #12");
    expect(scopedThreadTitle(12, "   ")).toBe("Refine #12");
  });

  it("names every flag in full, since nothing here is truncated", () => {
    for (const flag of FLAG_SEVERITY) {
      const scope = actionSummary([flag]);
      const expected = scope.charAt(0).toLowerCase() + scope.slice(1);
      expect(scopedThreadTitle(5840, scope)).toBe(`Refine #5840: ${expected}`);
    }
  });
});
