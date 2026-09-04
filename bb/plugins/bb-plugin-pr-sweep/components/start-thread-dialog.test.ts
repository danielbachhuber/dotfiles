import { describe, expect, it } from "vitest";
import { draftKeyFor } from "./start-thread-dialog.js";

describe("draftKeyFor", () => {
  it("keeps one row's draft away from the next row's", () => {
    expect(draftKeyFor("issue-sweep:acme/widgets#1", "Work on this issue.")).not.toBe(
      draftKeyFor("issue-sweep:acme/widgets#2", "Work on this issue."),
    );
  });

  it("keeps the same key while the panel says the same thing", () => {
    // So reopening a row you edited gives you your edit back.
    expect(draftKeyFor("issue-sweep:acme/widgets#1", "Work on this issue.")).toBe(
      draftKeyFor("issue-sweep:acme/widgets#1", "Work on this issue."),
    );
  });

  it("changes the key once the seeded text does", () => {
    // The whole point: initialPrompt only seeds an empty draft, so a stored
    // draft from an earlier seeding would otherwise shadow the new one for
    // good. This is what let a pre-split prompt keep showing its header and
    // trailer after the server had stopped sending them.
    expect(draftKeyFor("pr-sweep:acme/widgets#42", "A sweep found one thing:")).not.toBe(
      draftKeyFor("pr-sweep:acme/widgets#42", "A sweep found 2 things, worst first:"),
    );
  });
});
