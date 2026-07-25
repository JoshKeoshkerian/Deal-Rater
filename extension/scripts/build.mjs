/**
 * Extension bundler.
 *
 * Two output formats, because MV3 needs both:
 *   content.js     IIFE. Content scripts cannot use ESM imports.
 *   background.js  ESM. The service worker is declared "type": "module".
 *
 * esbuild directly rather than a framework plugin: the build is four files and
 * a copy step, and a deterministic pipeline is worth more here than the
 * convenience of HMR.
 */
import { context, build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

const shared = {
  bundle: true,
  target: "chrome116",
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
  define: { __DEV__: JSON.stringify(dev) },
};

const bundles = [
  { entry: "src/content/index.ts", out: "content.js", format: "iife" },
  { entry: "src/background/index.ts", out: "background.js", format: "esm" },
  { entry: "src/options/options.ts", out: "options.js", format: "iife" },
];

async function copyStatic() {
  await cp(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
  await cp(resolve(root, "src/options/options.html"), resolve(outdir, "options.html"));
}

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await copyStatic();

  const configs = bundles.map((b) => ({
    ...shared,
    entryPoints: [resolve(root, b.entry)],
    outfile: resolve(outdir, b.out),
    format: b.format,
  }));

  if (watch) {
    for (const config of configs) {
      const ctx = await context(config);
      await ctx.watch();
    }
    console.log("watching…");
  } else {
    await Promise.all(configs.map((config) => build(config)));
    console.log(`built -> ${outdir}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
