import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  // Every suite here tests a pure function — a parser, a grouping, a prompt.
  // Nothing needs a DOM.
  test: { environment: "node" },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
});
