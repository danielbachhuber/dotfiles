import { describe, expect, it } from "vitest";
import {
  countsFor,
  headerLabel,
  newTexts,
  normalizeText,
  orderForDisplay,
  renderForAgent,
  resolveRefs,
  rowStatusFor,
} from "./list.js";
import type { Todo } from "./types.js";
import { TEXT_MAX } from "./types.js";

function todo(overrides: Partial<Todo> & { id: string; text: string }): Todo {
  return {
    threadId: "t1",
    status: "open",
    source: "agent",
    position: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("normalizeText", () => {
  it("collapses whitespace", () => {
    expect(normalizeText("  fix   the\n parser ")).toBe("fix the parser");
  });

  it("strips a leading bullet or number, which models routinely include", () => {
    expect(normalizeText("- Fix the parser")).toBe("Fix the parser");
    expect(normalizeText("• Fix the parser")).toBe("Fix the parser");
    expect(normalizeText("3. Fix the parser")).toBe("Fix the parser");
    expect(normalizeText("2) Fix the parser")).toBe("Fix the parser");
  });

  it("leaves a hyphen that is part of the text alone", () => {
    expect(normalizeText("re-run the suite")).toBe("re-run the suite");
  });

  it("elides past the cap", () => {
    const result = normalizeText("a".repeat(TEXT_MAX + 50));
    expect(result).toHaveLength(TEXT_MAX);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("newTexts", () => {
  it("drops items already open on the thread, ignoring case and punctuation", () => {
    const existing = [todo({ id: "a", text: "Fix the parser" })];
    expect(newTexts(existing, ["fix the parser!", "Ship it"])).toEqual(["Ship it"]);
  });

  it("allows re-adding something already completed", () => {
    const existing = [todo({ id: "a", text: "Fix the parser", status: "done" })];
    expect(newTexts(existing, ["Fix the parser"])).toEqual(["Fix the parser"]);
  });

  it("dedupes within a single call", () => {
    expect(newTexts([], ["Ship it", "ship it"])).toEqual(["Ship it"]);
  });

  it("drops entries that normalize to nothing", () => {
    expect(newTexts([], ["   ", "-", "Ship it"])).toEqual(["Ship it"]);
  });
});

describe("resolveRefs", () => {
  const todos = [
    todo({ id: "a1", text: "Fix the parser" }),
    todo({ id: "b2", text: "Fix the writer", position: 2 }),
    todo({ id: "c3", text: "Ship it", position: 3 }),
  ];

  it("resolves by id", () => {
    expect(resolveRefs(todos, ["b2"]).matched.map((t) => t.id)).toEqual(["b2"]);
  });

  it("resolves by the item's own text, which models pass instead of ids", () => {
    expect(resolveRefs(todos, ["fix the parser"]).matched.map((t) => t.id)).toEqual([
      "a1",
    ]);
  });

  it("resolves a unique prefix", () => {
    expect(resolveRefs(todos, ["Ship"]).matched.map((t) => t.id)).toEqual(["c3"]);
  });

  it("refuses an ambiguous prefix rather than guessing", () => {
    const result = resolveRefs(todos, ["Fix the"]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual(["Fix the"]);
  });

  it("reports what it could not resolve", () => {
    expect(resolveRefs(todos, ["nope"]).unmatched).toEqual(["nope"]);
  });

  it("does not return the same item twice", () => {
    expect(resolveRefs(todos, ["a1", "Fix the parser"]).matched).toHaveLength(1);
  });
});

describe("orderForDisplay", () => {
  it("puts open items first, each group in position order", () => {
    const todos = [
      todo({ id: "a", text: "one", position: 1, status: "done" }),
      todo({ id: "b", text: "two", position: 2 }),
      todo({ id: "c", text: "three", position: 3 }),
    ];
    expect(orderForDisplay(todos).map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});

describe("countsFor and its labels", () => {
  it("counts open and done separately", () => {
    const todos = [
      todo({ id: "a", text: "one" }),
      todo({ id: "b", text: "two", status: "done" }),
    ];
    expect(countsFor("t1", todos)).toEqual({ threadId: "t1", open: 1, done: 1 });
  });

  it("says nothing at all for a thread with no list", () => {
    expect(headerLabel({ threadId: "t1", open: 0, done: 0 })).toBeNull();
  });

  it("reads as progress: finished over total", () => {
    expect(headerLabel({ threadId: "t1", open: 4, done: 2 })).toBe("2/6");
  });

  it("shows a finished list as complete rather than as zero", () => {
    expect(headerLabel({ threadId: "t1", open: 0, done: 3 })).toBe("3/3");
  });

  it("shows an untouched list as none-of-many", () => {
    expect(headerLabel({ threadId: "t1", open: 5, done: 0 })).toBe("0/5");
  });

  it("clears the sidebar glyph when nothing is open", () => {
    expect(rowStatusFor({ threadId: "t1", open: 0, done: 4 })).toBeNull();
  });

  it("labels the glyph with the remaining count, singular and plural", () => {
    expect(rowStatusFor({ threadId: "t1", open: 1, done: 0 })?.label).toBe(
      "1 step remaining",
    );
    expect(rowStatusFor({ threadId: "t1", open: 3, done: 0 })?.label).toBe(
      "3 steps remaining",
    );
  });
});

describe("renderForAgent", () => {
  it("hands back ids so the next call can reference them", () => {
    const rendered = renderForAgent([
      todo({ id: "a1", text: "Fix the parser" }),
      todo({ id: "b2", text: "Ship it", position: 2, status: "done" }),
    ]);
    expect(rendered).toContain("[ ] a1  Fix the parser");
    expect(rendered).toContain("[x] b2  Ship it");
    expect(rendered).toContain("1 open of 2.");
  });

  it("says so when the list is empty", () => {
    expect(renderForAgent([])).toBe("The todo list is empty.");
  });
});
