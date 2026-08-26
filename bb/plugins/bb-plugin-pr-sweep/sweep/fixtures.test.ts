import { describe, expect, it } from "vitest";
import { checkRun, makePr, teamRequest, userRequest } from "./fixtures.js";

describe("fixtures", () => {
  it("builds a default clean PR", () => {
    const pr = makePr();
    expect(pr.number).toBe(1);
    expect(pr.isDraft).toBe(false);
    expect(pr.mergeable).toBe("MERGEABLE");
    expect(pr.author?.login).toBe("octocat");
  });

  it("applies overrides", () => {
    expect(makePr({ number: 42, isDraft: true }).number).toBe(42);
    expect(makePr({ isDraft: true }).isDraft).toBe(true);
  });

  it("builds both reviewRequest shapes", () => {
    expect(userRequest("hubber")).toEqual({ __typename: "User", login: "hubber" });
    expect(teamRequest("reviewers")).toEqual({
      __typename: "Team",
      name: "Reviewers",
      slug: "reviewers",
    });
  });

  it("builds a completed check run", () => {
    expect(checkRun("build", "COMPLETED", "SUCCESS")).toMatchObject({
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    });
  });
});
