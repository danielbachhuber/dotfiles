import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite ignores a tsconfig inside node_modules, so bb-plugin-harvest's .tsx
  // would get the classic JSX transform and fail with "React is not defined".
  // The production build is unaffected: `bb plugin build` sets its own.
  esbuild: { jsx: "automatic" },
  test: {
    // Per-file `// @vitest-environment jsdom` docblocks opt individual suites
    // into a DOM; everything else stays on node.
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
});
