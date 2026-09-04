import { describe, expect, test } from "vitest";

import { timerDefaultsForIssue } from "./reference.js";

const row = {
  repo: "octocat/acme-widgets",
  number: 5515,
  title: "Audit areas affected by the stats port",
  url: "https://github.com/octocat/acme-widgets/issues/5515",
};

describe("timerDefaultsForIssue", () => {
  test("mirrors the convention the Harvest Chrome extension uses", () => {
    // The extension writes the bare issue number as the id, the repository as
    // the group, and the owner as the account. Matching it exactly is what
    // makes hours tracked in Chrome and in bb add up to one total.
    expect(timerDefaultsForIssue(row).externalReference).toEqual({
      id: "5515",
      groupId: "acme-widgets",
      accountId: "octocat",
      permalink: "https://github.com/octocat/acme-widgets/issues/5515",
    });
  });

  test("prefills the note the way the issue reads", () => {
    expect(timerDefaultsForIssue(row).notes).toBe(
      "#5515: Audit areas affected by the stats port",
    );
  });

  test("treats a bare repository name as having no owner", () => {
    const defaults = timerDefaultsForIssue({ ...row, repo: "acme-widgets" });
    expect(defaults.externalReference.groupId).toBe("acme-widgets");
    expect(defaults.externalReference.accountId).toBeNull();
  });
});
