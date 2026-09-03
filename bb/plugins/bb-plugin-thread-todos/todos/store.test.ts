import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS, TodoStore } from "./store.js";

function makeStore() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  let next = 0;
  const store = new TodoStore(db, {
    now: () => 1_000,
    newId: () => `id${++next}`,
  });
  return { db, store };
}

describe("TodoStore", () => {
  let store: TodoStore;

  beforeEach(() => {
    store = makeStore().store;
  });

  it("appends items in the order given", () => {
    store.add("t1", ["one", "two"], "agent");
    expect(store.list("t1").map((todo) => todo.text)).toEqual(["one", "two"]);
    expect(store.list("t1").map((todo) => todo.position)).toEqual([1, 2]);
  });

  it("keeps threads apart", () => {
    store.add("t1", ["one"], "agent");
    store.add("t2", ["two"], "agent");
    expect(store.list("t1").map((todo) => todo.text)).toEqual(["one"]);
    expect(store.list("t2").map((todo) => todo.text)).toEqual(["two"]);
  });

  it("reports only what it actually created, so the agent stops re-adding", () => {
    store.add("t1", ["one"], "agent");
    expect(store.add("t1", ["one", "two"], "agent").map((t) => t.text)).toEqual([
      "two",
    ]);
  });

  it("continues positions past existing items rather than restarting", () => {
    store.add("t1", ["one"], "agent");
    expect(store.add("t1", ["two"], "user")[0]!.position).toBe(2);
  });

  it("records who added an item", () => {
    store.add("t1", ["mine"], "user");
    expect(store.list("t1")[0]!.source).toBe("user");
  });

  it("completes by id and by text", () => {
    const [first, second] = store.add("t1", ["one", "two"], "agent");
    store.setStatus("t1", [first!.id], "done");
    store.setStatus("t1", ["two"], "done");
    expect(store.list("t1").every((todo) => todo.status === "done")).toBe(true);
    expect(second!.id).toBeDefined();
  });

  it("reports unmatched references instead of throwing", () => {
    store.add("t1", ["one"], "agent");
    const result = store.setStatus("t1", ["nope"], "done");
    expect(result.changed).toEqual([]);
    expect(result.unmatched).toEqual(["nope"]);
  });

  it("counts an item as changed only when its status actually moved", () => {
    store.add("t1", ["one"], "agent");
    store.setStatus("t1", ["one"], "done");
    expect(store.setStatus("t1", ["one"], "done").changed).toEqual([]);
  });

  it("reopens a completed item", () => {
    store.add("t1", ["one"], "agent");
    store.setStatus("t1", ["one"], "done");
    store.setStatus("t1", ["one"], "open");
    expect(store.list("t1")[0]!.status).toBe("open");
  });

  it("will not remove another thread's item", () => {
    const [mine] = store.add("t1", ["one"], "agent");
    expect(store.remove("t2", mine!.id)).toBe(false);
    expect(store.list("t1")).toHaveLength(1);
  });

  it("clears only the finished items", () => {
    store.add("t1", ["one", "two"], "agent");
    store.setStatus("t1", ["one"], "done");
    expect(store.clearDone("t1")).toBe(1);
    expect(store.list("t1").map((todo) => todo.text)).toEqual(["two"]);
  });

  it("drops a deleted thread's list entirely", () => {
    store.add("t1", ["one", "two"], "agent");
    expect(store.dropThread("t1")).toBe(2);
    expect(store.list("t1")).toEqual([]);
  });

  it("summarizes every thread that has a list, and only those", () => {
    store.add("t1", ["one", "two"], "agent");
    store.add("t2", ["three"], "agent");
    store.setStatus("t1", ["one"], "done");
    expect(store.allCounts().sort((a, b) => a.threadId.localeCompare(b.threadId))).toEqual([
      { threadId: "t1", open: 1, done: 1 },
      { threadId: "t2", open: 1, done: 0 },
    ]);
  });
});
