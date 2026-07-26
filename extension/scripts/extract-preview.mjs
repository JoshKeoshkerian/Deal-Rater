#!/usr/bin/env node
/**
 * Run the real extractor against a saved page and print what it got.
 *
 *   npm run extract-preview -- tests/fixtures/pages/fb-item-123….html
 *   npm run extract-preview -- <file> --search
 *   npm run extract-preview -- <file> --expected > <file>.expected.json
 *
 * Two uses:
 *
 *   1. After editing fb-keys.ts, confirm the fields now resolve, and confirm
 *      they resolve at the tier you expect. `json_payload` beating
 *      `text_pattern` is the difference between a fix and a coincidence.
 *
 *   2. `--expected` emits a draft expectation file for the fixture suite.
 *
 * On that draft: it records what the extractor currently produces, which is not
 * the same thing as what is true. Check every value against the real listing
 * before committing it. A fixture generated from the extractor's own output and
 * never verified asserts only that the code still agrees with itself, which is
 * exactly the failure mode the fixture suite exists to catch.
 */

import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Window } from "happy-dom";

import { loadTs } from "./lib/load-ts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function urlFor(file, html, isSearch) {
  if (isSearch) return "https://www.facebook.com/marketplace/search/";
  const fromCanonical = html.match(/rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
  if (fromCanonical) return fromCanonical;
  const fromName = basename(file).match(/(\d{6,})/)?.[1];
  return fromName
    ? `https://www.facebook.com/marketplace/item/${fromName}/`
    : "https://www.facebook.com/marketplace/item/0/";
}

function summarise(observation, strategies) {
  const rows = [];
  for (const [field, value] of Object.entries(observation)) {
    if (field === "field_strategies" || field === "raw_extract") continue;
    const tier = strategies[field] ?? strategies[`${field}`] ?? "";
    const shown = value === null ? "—" : JSON.stringify(value);
    rows.push([field, shown.length > 60 ? `${shown.slice(0, 60)}…` : shown, tier]);
  }
  const width = Math.max(...rows.map((r) => r[0].length));
  for (const [field, value, tier] of rows) {
    console.log(`  ${field.padEnd(width)}  ${value.padEnd(62)}  ${tier}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((arg) => !arg.startsWith("--"));
  const isSearch = argv.includes("--search");
  const wantExpected = argv.includes("--expected");

  if (!file) {
    console.error("usage: npm run extract-preview -- <saved-page.html> [--search] [--expected]");
    process.exit(1);
  }

  const path = resolve(process.cwd(), file);
  const html = await readFile(path, "utf8");

  // A scrubbed fixture still has real <link rel="stylesheet"> and <script src>
  // references to Facebook's asset CDN. happy-dom tries to actually fetch
  // those on parse, which throws (no network in this script) into a code path
  // that assumes a live window and crashes with a null defaultView. Nothing
  // extracted here reads CSS or runs page JS, so loading is just disabled.
  const window = new Window({
    url: "https://www.facebook.com/",
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
      // Disabled loading still dispatches an error event by default, and
      // that dispatch is the crashing path (null defaultView) on a document
      // this detached. Routing it to a "load" event instead avoids it.
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  globalThis.DOMParser = window.DOMParser;
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  const url = urlFor(file, html, isSearch);

  if (isSearch) {
    const { extractCompCards } = await loadTs(resolve(root, "src/extract/comp-card.ts"));
    const { observations, issues } = await extractCompCards(doc, url);

    if (wantExpected) {
      console.log(
        JSON.stringify({ kind: "search", url, minCards: observations.length }, null, 2),
      );
      return;
    }

    console.log(`\n${observations.length} comp cards recovered\n`);
    for (const card of observations.slice(0, 10)) {
      console.log(
        `  ${card.source_listing_id.padEnd(18)} ` +
          `${String(card.year ?? "—").padEnd(6)} ` +
          `${`${card.make ?? "—"} ${card.model ?? "—"}`.padEnd(24)} ` +
          `${String(card.price_cents ? `$${card.price_cents / 100}` : "—").padEnd(10)} ` +
          `${card.mileage ?? "—"}`,
      );
    }
    if (observations.length > 10) console.log(`  … and ${observations.length - 10} more`);
    console.log(`\n  tiers used: ${JSON.stringify(observations[0]?.field_strategies ?? {})}`);
    console.log(`  issues: ${issues.length}\n`);
    return;
  }

  const { extractTargetListing } = await loadTs(resolve(root, "src/extract/listing.ts"));
  const { observation, issues, pageSignature, usable } = await extractTargetListing(doc, url);

  if (wantExpected) {
    const present = Object.entries(observation)
      .filter(
        ([field, value]) =>
          value !== null &&
          !["field_strategies", "raw_extract", "source", "role", "seller"].includes(field),
      )
      .map(([field]) => field);

    console.log(
      JSON.stringify(
        {
          kind: "item",
          url,
          _verify: "Check every value below against the real listing before committing.",
          expect: {
            price_cents: observation.price_cents,
            year: observation.year,
            make: observation.make,
            model: observation.model,
            mileage: observation.mileage,
            photo_count: observation.photo_count,
            location_text: observation.location_text,
          },
          requirePresent: present,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\n${basename(file)}   usable: ${usable}   signature: ${pageSignature}\n`);
  console.log(`  ${"field".padEnd(22)}  ${"value".padEnd(62)}  tier`);
  console.log(`  ${"-".repeat(22)}  ${"-".repeat(62)}  ${"-".repeat(14)}`);
  summarise(observation, observation.field_strategies);

  const required = issues.filter((issue) => issue.expectation === "required");
  const expected = issues.filter((issue) => issue.expectation === "expected");

  console.log(`\n  required failures: ${required.map((i) => i.field_name).join(", ") || "none"}`);
  console.log(`  expected missing:  ${expected.map((i) => i.field_name).join(", ") || "none"}`);

  const tiers = Object.values(observation.field_strategies);
  const payloadShare = tiers.filter((t) => t === "json_payload").length;
  console.log(
    `\n  ${payloadShare}/${tiers.length} fields resolved at tier 1 (json_payload).` +
      (payloadShare < tiers.length / 2
        ? " Low — check fb-keys.ts with `npm run probe-keys`."
        : ""),
  );
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
