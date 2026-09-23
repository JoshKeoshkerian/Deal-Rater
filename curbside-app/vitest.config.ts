import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * curbside-app had no test framework before this pass (see the plan this
 * shipped under). Vitest to match the `extension/` package's existing
 * convention; `@testing-library/react` because these are React components,
 * unlike the extension's vanilla-DOM code.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
