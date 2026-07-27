/**
 * Build-time constants substituted by esbuild (`scripts/build.mjs`).
 *
 * `__DEV__` is false in a packaged build, so anything behind it is removed by
 * dead-code elimination rather than merely hidden. That matters for the fixture
 * capture control: it writes a full page snapshot to disk, which is a developer
 * tool and has no business existing in a build that reaches the Chrome Web
 * Store, where spec 8.1 makes over-reaching behaviour a rejection risk.
 */
declare const __DEV__: boolean;
