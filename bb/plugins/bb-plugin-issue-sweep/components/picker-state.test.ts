import { describe, expect, test } from "vitest";

import { resolveSelection, tasksFor, withProject } from "./picker-state.js";

const projects = [
  {
    id: 11,
    name: "Internal",
    code: "INT",
    clientName: "New_ Public",
    tasks: [
      { id: 22, name: "Development" },
      { id: 23, name: "Review" },
    ],
  },
  {
    id: 12,
    name: "Website",
    code: null,
    clientName: "New_ Public",
    tasks: [{ id: 24, name: "Design" }],
  },
];

describe("tasksFor", () => {
  test("returns the tasks of the named project", () => {
    expect(tasksFor(projects, 11).map((task) => task.id)).toEqual([22, 23]);
  });

  test("returns nothing for an unknown project", () => {
    expect(tasksFor(projects, 999)).toEqual([]);
  });

  test("returns nothing when no project is chosen", () => {
    expect(tasksFor(projects, null)).toEqual([]);
  });
});

describe("resolveSelection", () => {
  test("uses the remembered selection when it is still valid", () => {
    expect(resolveSelection(projects, { projectId: 12, taskId: 24 })).toEqual({
      projectId: 12,
      taskId: 24,
    });
  });

  test("falls back to the first project and task when nothing is remembered", () => {
    expect(resolveSelection(projects, null)).toEqual({ projectId: 11, taskId: 22 });
  });

  test("drops a remembered project that is no longer assigned", () => {
    // Losing a project assignment should not leave the picker pointing at a
    // project Harvest will reject.
    expect(resolveSelection(projects, { projectId: 999, taskId: 22 })).toEqual({
      projectId: 11,
      taskId: 22,
    });
  });

  test("keeps a remembered project but repairs a task that no longer exists", () => {
    expect(resolveSelection(projects, { projectId: 12, taskId: 22 })).toEqual({
      projectId: 12,
      taskId: 24,
    });
  });

  test("returns nothing when there are no projects at all", () => {
    expect(resolveSelection([], { projectId: 11, taskId: 22 })).toBeNull();
  });
});

describe("withProject", () => {
  test("moves to the first task of the newly chosen project", () => {
    // Carrying the old task over would post a task that does not belong to
    // the project, which Harvest rejects with an opaque error.
    expect(withProject(projects, 12)).toEqual({ projectId: 12, taskId: 24 });
  });

  test("returns nothing for a project that is not assigned", () => {
    expect(withProject(projects, 999)).toBeNull();
  });
});
