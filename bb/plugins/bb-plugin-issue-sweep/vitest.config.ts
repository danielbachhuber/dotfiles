import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Per-file `// @vitest-environment jsdom` docblocks opt individual suites
    // into a DOM; everything else stays on node.
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
});
