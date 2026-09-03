import { describe, expect, it } from "vitest";
import {
  INSTRUCTIONS_STATIC_BLOCK,
  renderListSection,
  threadInstructions,
} from "./instructions.js";
import type { Todo } from "./types.js";

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

/** The SDK truncates a contribution past this, mid-item and without warning. */
const SDK_LIMIT = 4096;

describe("renderListSection", () => {
  it("tells the agent to start a list when the thread has none", () => {
    const section = renderListSection([]);
    expect(section).toContain("Empty.");
    expect(section).toContain("start by adding them");
  });

  it("shows ids and status so the agent can act on what it reads", () => {
    const section = renderListSection([
      todo({ id: "a1", text: "Fix the parser" }),
      todo({ id: "b2", text: "Ship it", position: 2, status: "done" }),
    ]);
    expect(section).toContain("[ ] a1  Fix the parser");
    expect(section).toContain("[x] b2  Ship it");
    expect(section).toContain("1 open of 2.");
  });

  it("marks the list as a snapshot, not live state", () => {
    expect(renderListSection([todo({ id: "a", text: "one" })])).toContain(
      "as of session start",
    );
  });

  it("says how many it dropped, so a truncated list never reads as complete", () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      todo({
        id: `id${index}`,
        text: `A reasonably wordy step number ${index} that takes up room`,
        position: index,
      }),
    );
    const section = renderListSection(many);
    expect(section).toContain("not shown here");
    expect(section).toContain("run `bb todo` for the full list");
  });

  it("never cuts an item in half", () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      todo({ id: `id${index}`, text: `Step ${index}`, position: index }),
    );
    for (const line of renderListSection(many).split("\n")) {
      if (!line.startsWith("[")) continue;
      expect(line).toMatch(/^\[[ x]\] \S+ {2}Step \d+$/);
    }
  });
});

describe("threadInstructions", () => {
  it("tells the agent to re-read, because the embed goes stale mid-session", () => {
    expect(threadInstructions([])).toContain(
      "Run `bb todo` at the start of each turn",
    );
  });

  it("leads with the CLI rather than the deferred native tools", () => {
    const text = threadInstructions([]);
    expect(text.indexOf("bb todo add")).toBeLessThan(text.indexOf("todo_add`,"));
  });

  it("stays under the SDK's truncation limit even with a huge list", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      todo({
        id: `id${index}`,
        text: `A step with a fairly long description, number ${index}`,
        position: index,
      }),
    );
    expect(threadInstructions(many).length).toBeLessThan(SDK_LIMIT);
  });

  it("has headroom for the list once the static block is counted", () => {
    expect(INSTRUCTIONS_STATIC_BLOCK.length).toBeLessThan(2200);
  });
});
