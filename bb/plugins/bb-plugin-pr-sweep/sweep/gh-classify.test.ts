import { describe, expect, it } from "vitest";
// Through this plugin's own re-export, which is how the shared runner is
// actually reached at build time.
import { createGhRunner, GhUnavailableError } from "./gh.js";

describe("gh error classification", () => {
  it("still reports a missing binary", async () => {
    const gh = createGhRunner("/nonexistent/gh-does-not-exist");
    await expect(gh.run(["--version"])).rejects.toBeInstanceOf(GhUnavailableError);
  });

  it("does not call a plain failure an auth problem", async () => {
    // The old test was /auth|logged in|credentials|token/i against the whole
    // error, and the error message contains the argv.
    const gh = createGhRunner("/bin/sh");
    await expect(
      gh.run(["-c", "echo 'query=... reviewRequests ... oauth token' >&2; exit 1"]),
    ).rejects.not.toBeInstanceOf(GhUnavailableError);
  });

  it("recognises what gh actually says about a broken login", async () => {
    const gh = createGhRunner("/bin/sh");
    await expect(
      gh.run(["-c", "echo 'gh: To get started with GitHub CLI, please run: gh auth login' >&2; exit 1"]),
    ).rejects.toBeInstanceOf(GhUnavailableError);
  });

  it("recognises a rejected token", async () => {
    const gh = createGhRunner("/bin/sh");
    await expect(
      gh.run(["-c", "echo 'HTTP 401: Bad credentials' >&2; exit 1"]),
    ).rejects.toBeInstanceOf(GhUnavailableError);
  });
});
