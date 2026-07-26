import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    // Real fixtures carry live <link rel="stylesheet">/<script src> pointing
    // at Facebook's asset CDN. happy-dom tries to actually fetch those on
    // parse, and the failure throws into a code path that assumes a live
    // window, crashing with a null defaultView. Nothing under test reads CSS
    // or runs page JS, so loading is just disabled.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          // Disabled loading still dispatches an error event by default, and
          // that dispatch is the crashing path (null defaultView) on a
          // detached document. Routing it to "load" instead avoids it.
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
});
