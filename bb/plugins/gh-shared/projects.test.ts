import { describe, expect, it } from "vitest";
import {
  matchProjectForRepo,
  matchProjectTargetForRepo,
  parseRemoteSlug,
} from "./projects.js";

describe("parseRemoteSlug", () => {
  it("parses an SSH remote", () => {
    expect(parseRemoteSlug("git@github.com:acme/widgets.git")).toBe("acme/widgets");
  });

  it("parses an HTTPS remote with and without .git", () => {
    expect(parseRemoteSlug("https://github.com/acme/widgets.git")).toBe("acme/widgets");
    expect(parseRemoteSlug("https://github.com/acme/widgets")).toBe("acme/widgets");
  });

  it("parses an ssh:// URL", () => {
    expect(parseRemoteSlug("ssh://git@github.com/acme/widgets.git")).toBe("acme/widgets");
  });

  it("ignores a trailing slash", () => {
    expect(parseRemoteSlug("https://github.com/acme/widgets/")).toBe("acme/widgets");
  });

  it("returns null for a non-GitHub or unparseable remote", () => {
    expect(parseRemoteSlug("https://gitlab.com/acme/widgets.git")).toBeNull();
    expect(parseRemoteSlug("not a url")).toBeNull();
    expect(parseRemoteSlug("")).toBeNull();
  });
});

describe("matchProjectForRepo", () => {
  const projects = [
    { id: "proj_a", remoteUrls: ["git@github.com:acme/widgets.git"] },
    { id: "proj_b", remoteUrls: ["https://github.com/acme/gadgets"] },
  ];

  it("matches regardless of remote URL form", () => {
    expect(matchProjectForRepo("acme/widgets", projects)).toBe("proj_a");
    expect(matchProjectForRepo("acme/gadgets", projects)).toBe("proj_b");
  });

  it("matches case-insensitively, as GitHub slugs are", () => {
    expect(matchProjectForRepo("ACME/Widgets", projects)).toBe("proj_a");
  });

  it("returns null when nothing matches", () => {
    expect(matchProjectForRepo("acme/unknown", projects)).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(matchProjectForRepo("acme/widgets", [])).toBeNull();
  });
});

describe("matchProjectTargetForRepo", () => {
  const candidates = [
    {
      id: "proj_a",
      remoteUrls: ["git@github.com:acme/widgets.git"],
      hostId: "host_1",
    },
    { id: "proj_b", remoteUrls: ["git@github.com:acme/gadgets.git"] },
  ];

  it("carries the host, which a seeded worktree environment is rejected without", () => {
    expect(matchProjectTargetForRepo("acme/widgets", candidates)).toEqual({
      id: "proj_a",
      hostId: "host_1",
    });
  });

  it("still matches a project whose host was not gathered", () => {
    expect(matchProjectTargetForRepo("acme/gadgets", candidates)).toEqual({
      id: "proj_b",
      hostId: null,
    });
  });

  it("returns null for a repository with no project", () => {
    expect(matchProjectTargetForRepo("acme/nothing", candidates)).toBeNull();
  });
});
