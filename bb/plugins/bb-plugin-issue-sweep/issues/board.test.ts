import { describe, expect, it } from "vitest";
import { boardPlacement, countedRows, shouldAutoApply } from "./board.js";

describe("boardPlacement", () => {
  it("reads the status from the named board, ignoring the others", () => {
    const placement = boardPlacement(
      [
        { title: "Someone's untitled project", status: { name: "Backlog" } },
        { title: "Acme Board", status: { name: "In Review" } },
      ],
      "Acme Board",
    );
    expect(placement).toEqual({ onBoard: true, status: "In Review" });
  });

  it("separates being on the board from having a status there", () => {
    expect(boardPlacement([{ title: "Acme Board", status: { name: "" } }], "Acme Board")).toEqual({
      onBoard: true,
      status: null,
    });
  });

  it("reports an issue on a different board as off this one", () => {
    expect(boardPlacement([{ title: "Other", status: { name: "Ready" } }], "Acme Board")).toEqual({
      onBoard: false,
      status: null,
    });
  });
});

describe("shouldAutoApply", () => {
  it("moves a card that is somewhere else", () => {
    expect(shouldAutoApply("Backlog", null, "In Progress")).toBe(true);
  });

  it("moves a card that is on no column yet", () => {
    expect(shouldAutoApply(null, null, "In Progress")).toBe(true);
  });

  it("leaves a card that is already there", () => {
    // The write would change nothing and the sweep runs every few minutes.
    expect(shouldAutoApply("In Progress", null, "In Progress")).toBe(false);
    expect(shouldAutoApply("in progress", null, "In Progress")).toBe(false);
    expect(shouldAutoApply(" In Progress ", null, "In Progress")).toBe(false);
  });

  it("refuses to make the same move twice", () => {
    // This is the one that matters. A closing pull request stays open for
    // days, so without it every sweep would drag the card back to In Review
    // and a move made by hand would never survive.
    expect(shouldAutoApply("Backlog", "In Review", "In Review")).toBe(false);
  });

  it("still makes a different move it has not made before", () => {
    // Having moved a card to In Progress must not block the later promotion.
    expect(shouldAutoApply("In Progress", "In Progress", "In Review")).toBe(true);
  });

  it("does nothing when the target is blank, which is how the move is turned off", () => {
    expect(shouldAutoApply("Backlog", null, "")).toBe(false);
    expect(shouldAutoApply("Backlog", null, "   ")).toBe(false);
  });
});

describe("countedRows", () => {
  const row = (boardStatus: string | null, blockedBy = 0) => ({ boardStatus, blockedBy });

  it("counts only the statuses asked for", () => {
    const rows = [row("In Progress"), row("Ready"), row("Backlog"), row("In Review")];
    expect(countedRows(rows, ["In Progress", "Ready"])).toHaveLength(2);
  });

  it("matches a status however it is cased or spaced", () => {
    expect(countedRows([row("in progress")], [" In Progress "])).toHaveLength(1);
  });

  it("never counts a blocked issue, whatever its status", () => {
    // The panel lifts blocked rows out of their section and files them last,
    // so counting one would put a number on the badge that no visible section
    // accounts for.
    expect(countedRows([row("In Progress", 1)], ["In Progress"])).toHaveLength(0);
  });

  it("does not count an issue with no board status", () => {
    expect(countedRows([row(null)], ["In Progress", "Ready"])).toHaveLength(0);
  });

  it("counts every unblocked row when no statuses are configured", () => {
    // Blank is how a board-less setup turns the filter off.
    const rows = [row("Backlog"), row(null), row("Ready", 2)];
    expect(countedRows(rows, [])).toHaveLength(2);
  });
});
