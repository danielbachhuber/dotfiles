import { describe, expect, it } from "vitest";
import { parseTaskList, resolveSubtasks } from "./subtasks.js";

describe("parseTaskList", () => {
  it("counts checked and unchecked items", () => {
    expect(parseTaskList("- [x] one\n- [ ] two\n- [X] three")).toEqual({
      completed: 2,
      total: 3,
      source: "tasks",
    });
  });

  it("accepts every list marker GitHub renders a checkbox for", () => {
    expect(parseTaskList("* [x] a\n+ [ ] b\n1. [ ] c\n2) [x] d")).toEqual({
      completed: 2,
      total: 4,
      source: "tasks",
    });
  });

  it("counts nested items, which are still work", () => {
    expect(parseTaskList("- [ ] parent\n  - [x] child")).toEqual({
      completed: 1,
      total: 2,
      source: "tasks",
    });
  });

  it("ignores checkboxes inside fenced code", () => {
    const body = ["- [x] real", "```md", "- [ ] example", "```", "- [ ] also real"].join("\n");
    expect(parseTaskList(body)).toEqual({ completed: 1, total: 2, source: "tasks" });
  });

  it("ignores a checkbox in prose, which GitHub does not render as one", () => {
    expect(parseTaskList("The state is [x] until it is not.")).toBeNull();
  });

  it("reports nothing for a body with no list", () => {
    expect(parseTaskList("Just prose.")).toBeNull();
    expect(parseTaskList("")).toBeNull();
    expect(parseTaskList(null)).toBeNull();
  });
});

describe("resolveSubtasks", () => {
  it("prefers sub-issues over a body checklist", () => {
    const result = resolveSubtasks({ total: 14, completed: 8 }, "- [ ] stale\n- [ ] leftover");
    expect(result).toEqual({ completed: 8, total: 14, source: "sub-issues" });
  });

  it("falls back to the body when there are no sub-issues", () => {
    expect(resolveSubtasks({ total: 0, completed: 0 }, "- [x] done")).toEqual({
      completed: 1,
      total: 1,
      source: "tasks",
    });
  });

  it("reports nothing when the issue keeps neither", () => {
    expect(resolveSubtasks(null, "Just prose.")).toBeNull();
  });
});
