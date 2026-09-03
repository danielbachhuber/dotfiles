import { describe, expect, it } from "vitest";
import { parseCommand } from "./cli.js";

describe("parseCommand", () => {
  it("lists when given nothing, so the cheapest call is the useful one", () => {
    expect(parseCommand([])).toEqual({ kind: "list" });
    expect(parseCommand(["list"])).toEqual({ kind: "list" });
  });

  it("takes several steps in one add", () => {
    expect(parseCommand(["add", "one", "two"])).toEqual({
      kind: "add",
      texts: ["one", "two"],
    });
  });

  it("accepts done and complete as the same verb", () => {
    expect(parseCommand(["done", "one"])).toEqual({
      kind: "status",
      refs: ["one"],
      status: "done",
    });
    expect(parseCommand(["complete", "one"])).toEqual({
      kind: "status",
      refs: ["one"],
      status: "done",
    });
  });

  it("reopens", () => {
    expect(parseCommand(["reopen", "one"])).toEqual({
      kind: "status",
      refs: ["one"],
      status: "open",
    });
  });

  it("explains an add with nothing to add rather than silently succeeding", () => {
    const result = parseCommand(["add"]);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain("bb todo add");
  });

  it("rejects a blank-only add", () => {
    expect(parseCommand(["add", "   "]).kind).toBe("error");
  });

  it("names the unknown verb it was given", () => {
    const result = parseCommand(["frobnicate"]);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain("frobnicate");
  });

  it("offers help under each spelling", () => {
    for (const flag of ["help", "--help", "-h"]) {
      expect(parseCommand([flag])).toEqual({ kind: "help" });
    }
  });
});
