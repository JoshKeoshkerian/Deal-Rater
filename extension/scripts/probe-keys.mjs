#!/usr/bin/env node
/**
 * Verify the Facebook payload key names in src/extract/fb-keys.ts against a
 * real saved page.
 *
 *   npm run probe-keys -- tests/fixtures/raw/fb-item-123….html
 *   npm run probe-keys -- <file> --find "12,900" --find 96400 --find Camry
 *
 * Two modes, and the second is the one that matters.
 *
 * `--keys` (default) reports which of the names we guessed are actually
 * present. Useful, but it can only find keys we already named correctly.
 *
 * `--find <value>` searches the payloads for a literal value you can see on the
 * page — the price, the odometer reading, the trim — and prints the full path
 * to it. That works even when every guess in fb-keys.ts is wrong, which is the
 * situation this script exists for. Read the key name off the path and put it
 * in fb-keys.ts.
 *
 * Run this on the RAW download, not the scrubbed fixture: scrubbing replaces
 * exactly the values you would be searching for.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTs } from "./lib/load-ts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MAX_NODES = 2_000_000;
const SAMPLE_LENGTH = 70;

function parseArgs(argv) {
  const file = argv.find((arg) => !arg.startsWith("--"));
  const find = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--find" && argv[i + 1]) find.push(argv[i + 1]);
  }
  return { file, find };
}

function extractPayloads(html) {
  const payloads = [];
  const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let failed = 0;

  while ((match = re.exec(html)) !== null) {
    try {
      payloads.push(JSON.parse(match[1]));
    } catch {
      failed += 1;
    }
  }
  return { payloads, failed };
}

/** Depth-first walk yielding [path, key, value] for every property. */
function* walk(roots) {
  const stack = roots.map((node, i) => ({ node, path: `[${i}]` }));
  let seen = 0;

  while (stack.length > 0) {
    const { node, path } = stack.pop();
    if ((seen += 1) > MAX_NODES) return;

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        const child = node[i];
        if (typeof child === "object" && child !== null) {
          stack.push({ node: child, path: `${path}[${i}]` });
        }
      }
      continue;
    }
    if (typeof node !== "object" || node === null) continue;

    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      yield [childPath, key, value];
      if (typeof value === "object" && value !== null) {
        stack.push({ node: value, path: childPath });
      }
    }
  }
}

function sample(value) {
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > SAMPLE_LENGTH ? `${text.slice(0, SAMPLE_LENGTH)}…` : text;
}

function checkKeys(payloads, fbKeys) {
  // One pass: collect the first sighting of every key name in the file.
  const wanted = new Set();
  for (const names of Object.values(fbKeys)) for (const name of names) wanted.add(name);

  const hits = new Map();
  for (const [path, key, value] of walk(payloads)) {
    if (!wanted.has(key) || hits.has(key)) continue;
    if (value === null || value === undefined) continue;
    hits.set(key, { path, value });
  }

  console.log("KEY CHECK  (src/extract/fb-keys.ts)\n");
  let missing = 0;

  for (const [group, names] of Object.entries(fbKeys)) {
    const found = names.find((name) => hits.has(name));
    if (found) {
      const hit = hits.get(found);
      console.log(`  ok    ${group.padEnd(22)} ${found}`);
      console.log(`        ${" ".repeat(22)} ${sample(hit.value)}`);
    } else {
      missing += 1;
      console.log(`  MISS  ${group.padEnd(22)} none of: ${names.join(", ")}`);
    }
  }

  console.log(
    `\n  ${Object.keys(fbKeys).length - missing}/${Object.keys(fbKeys).length} groups resolved.`,
  );
  if (missing > 0) {
    console.log(
      "  For each MISS, find the value on the page and re-run with " +
        "--find '<that value>' to get its real key name.",
    );
  }
}

function findValues(payloads, needles) {
  console.log("\nVALUE SEARCH\n");

  const normalised = needles.map((needle) => ({
    raw: needle,
    // "12,900" and "12900" are the same number written two ways; the payload
    // usually holds the unformatted one while the page shows the formatted one.
    variants: [needle.toLowerCase(), needle.replace(/[,$\s]/g, "").toLowerCase()],
  }));

  const results = new Map(normalised.map((n) => [n.raw, []]));

  for (const [path, key, value] of walk(payloads)) {
    if (typeof value === "object" && value !== null) continue;
    const text = String(value).toLowerCase();
    const compact = text.replace(/[,$\s]/g, "");

    for (const needle of normalised) {
      const list = results.get(needle.raw);
      if (list.length >= 6) continue;
      if (needle.variants.some((v) => text === v || compact === v || text.includes(v))) {
        list.push({ path, key, value });
      }
    }
  }

  for (const [needle, list] of results) {
    console.log(`  "${needle}"`);
    if (list.length === 0) {
      console.log("      not found in any payload");
      console.log("      -> this value is not server-rendered; it needs a DOM tier\n");
      continue;
    }
    for (const hit of list) {
      console.log(`      key: ${hit.key}`);
      console.log(`      at:  ${hit.path}`);
      console.log(`      val: ${sample(hit.value)}`);
    }
    console.log();
  }
}

async function main() {
  const { file, find } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("usage: npm run probe-keys -- <saved-page.html> [--find <value>]…");
    process.exit(1);
  }

  const html = await readFile(resolve(process.cwd(), file), "utf8");
  const { payloads, failed } = extractPayloads(html);

  console.log(
    `\n${payloads.length} JSON payload${payloads.length === 1 ? "" : "s"} parsed` +
      (failed > 0 ? `, ${failed} unparseable` : "") +
      `, ${(html.length / 1024).toFixed(0)} KB of HTML\n`,
  );

  if (payloads.length === 0) {
    console.log(
      "No embedded JSON at all. Either the save happened before the page " +
        "finished loading, or tier 1 does not apply to this route — check the " +
        "DOM tiers with `npm run extract-preview` instead.\n",
    );
    return;
  }

  const { FB_KEYS } = await loadTs(resolve(root, "src/extract/fb-keys.ts"));
  checkKeys(payloads, FB_KEYS);

  if (find.length > 0) findValues(payloads, find);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
