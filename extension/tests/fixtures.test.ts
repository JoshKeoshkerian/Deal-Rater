/**
 * Regression suite over saved real pages.
 *
 * The synthetic pages in `helpers/build-page.ts` prove the cascades work
 * against every shape we can think of. This file proves they work against the
 * shapes Facebook actually ships, which is the only claim that satisfies the
 * step-2 success criterion.
 *
 * It is empty until fixtures are added, and it says so rather than passing
 * silently — a green suite with no real pages in it would be misleading about
 * what has been verified.
 *
 * Adding one:
 *   1. Options page -> developer mode -> "Save fixture" on a listing
 *   2. npm run scrub-fixture -- <downloaded file>
 *   3. read the scrubbed file, then move it into tests/fixtures/pages/
 *   4. write <same-name>.expected.json next to it
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { extractCompCards } from "../src/extract/comp-card";
import { extractTargetListing } from "../src/extract/listing";
import type { ObservationPayload } from "../src/shared/types";

const PAGES_DIR = join(__dirname, "fixtures", "pages");

interface FixtureExpectation {
  kind: "item" | "search";
  url: string;
  /** Fields that must match exactly. */
  expect?: Partial<ObservationPayload>;
  /** Fields that must be non-null, without pinning the value. */
  requirePresent?: string[];
  /** Search fixtures: the minimum number of cards that must be recovered. */
  minCards?: number;
}

function fixtureFiles(): string[] {
  if (!existsSync(PAGES_DIR)) return [];
  return readdirSync(PAGES_DIR).filter((name) => name.endsWith(".html"));
}

const files = fixtureFiles();

describe.skipIf(files.length === 0)("saved page fixtures", () => {
  it.each(files)("%s", async (file) => {
    const html = readFileSync(join(PAGES_DIR, file), "utf8");
    const expectationPath = join(PAGES_DIR, `${basename(file, ".html")}.expected.json`);

    if (!existsSync(expectationPath)) {
      throw new Error(
        `${file} has no .expected.json beside it. A fixture without expectations ` +
          `asserts nothing, so it would pass however badly extraction broke.`,
      );
    }

    const expectation = JSON.parse(
      readFileSync(expectationPath, "utf8"),
    ) as FixtureExpectation;

    const doc = new DOMParser().parseFromString(html, "text/html");

    if (expectation.kind === "search") {
      const { observations } = await extractCompCards(doc, expectation.url);
      expect(observations.length).toBeGreaterThanOrEqual(expectation.minCards ?? 1);
      for (const card of observations) {
        expect(card.source_listing_id).toMatch(/^\d+$/);
        expect(card.role).toBe("comp");
      }
      return;
    }

    const { observation, issues } = await extractTargetListing(doc, expectation.url);

    if (expectation.expect) expect(observation).toMatchObject(expectation.expect);

    for (const field of expectation.requirePresent ?? []) {
      expect(
        observation[field as keyof ObservationPayload],
        `${field} came back null on ${file}`,
      ).not.toBeNull();
    }

    // A real page that trips the structural probe means the payload search has
    // stopped working against live markup, whatever else still passes.
    expect(
      issues.filter((issue) => issue.expectation === "required"),
      "required-level extraction failures",
    ).toEqual([]);
  });
});

describe.skipIf(files.length > 0)("saved page fixtures", () => {
  it("are not present yet, so only synthetic pages have been verified", () => {
    expect(files).toEqual([]);
  });
});
