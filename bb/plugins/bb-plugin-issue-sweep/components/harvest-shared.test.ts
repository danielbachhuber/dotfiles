import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * The picker is duplicated source.
 *
 * An identical copy lives in the other plugin, because bb plugins cannot
 * render each other's React components and the two live in different
 * repositories. The two working copies cannot see each other, so instead each
 * repository commits the expected hashes and asserts its own copies match.
 *
 * Editing one copy fails this test until the change is ported to the other
 * copy and `harvest-shared.sha256` is regenerated in both:
 *
 *   shasum -a 256 timer-picker.tsx picker-state.ts time-format.ts > harvest-shared.sha256
 *
 * This catches an accidental edit rather than a deliberate divergence, which
 * is the failure mode worth catching: the whole point of the constraint is
 * that these files stay copyable.
 */
const here = dirname(fileURLToPath(import.meta.url));

function expectedHashes(): { name: string; hash: string }[] {
  return readFileSync(join(here, "harvest-shared.sha256"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [hash, name] = line.trim().split(/\s+/);
      return { name: name as string, hash: hash as string };
    });
}

describe("shared picker source", () => {
  test("records a hash for every shared file", () => {
    expect(expectedHashes().map((entry) => entry.name)).toEqual([
      "timer-picker.tsx",
      "picker-state.ts",
      "time-format.ts",
    ]);
  });

  test.each(expectedHashes())("$name matches the hash both plugins agree on", ({ name, hash }) => {
    const actual = createHash("sha256").update(readFileSync(join(here, name))).digest("hex");
    expect(actual).toBe(hash);
  });
});
