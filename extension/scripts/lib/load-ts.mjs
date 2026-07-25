/**
 * Import a TypeScript module from a plain Node script.
 *
 * Bundles with esbuild in memory and imports the result as a data URL, so the
 * dev scripts can use the real extractor rather than a reimplementation of it.
 * A second copy of the parsing logic would drift from the first, and the whole
 * point of these scripts is to tell you what the shipped code actually does.
 */

import { build } from "esbuild";

export async function loadTs(entryPath) {
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });

  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(url);
}
