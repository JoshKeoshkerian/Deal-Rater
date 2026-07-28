/**
 * The extension half of the contract check.
 *
 * `contract/capture-example.json` is validated against the backend's Pydantic
 * model by `backend/tests/test_contract.py`. This asserts the extension emits
 * exactly that shape. Adding a field on either side without the other now fails
 * a test instead of producing a 422 after the extension is already installed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { extractTargetListing } from "../src/extract/listing";
import { extractCompCards } from "../src/extract/comp-card";
import { buildCapturePayload } from "../src/content/run-capture";
import { buildListingDocument, buildSearchDocument, itemUrl } from "./helpers/build-page";

const EXAMPLE = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "contract", "capture-example.json"), "utf8"),
) as Record<string, unknown>;

const NOW = new Date("2026-07-25T12:00:00Z");

async function buildRealPayload() {
  const target = await extractTargetListing(
    buildListingDocument(
      {
        id: "100000000000001",
        title: "2014 Toyota Camry SE",
        priceAmount: "12900",
        priceText: "$12,900",
        mileage: 96_400,
        description: "Runs great, clean title. VIN 1HGCM82633A004352.",
        photoCount: 12,
        location: "Tulsa, OK",
        latitude: 36.15398,
        longitude: -95.992775,
        createdAtSeconds: 1_752_000_000,
        sellerId: "61550000000001",
      },
      "payload",
    ),
    itemUrl("100000000000001"),
    NOW,
  );

  const comps = await extractCompCards(
    buildSearchDocument([
      {
        id: "200000000000002",
        title: "2014 Toyota Camry SE",
        priceAmount: "12500",
        mileageText: "88K miles",
        location: "Broken Arrow, OK",
      },
    ]),
    "https://www.facebook.com/marketplace/search/?query=2014+Toyota+Camry",
    NOW,
  );

  return buildCapturePayload({
    capturedAt: NOW,
    captureId: "3f1a5c8e-9b2d-4e77-8a10-6c4f2b9d1e33",
    target: target.observation,
    comps: comps.observations,
    issues: [...target.issues, ...comps.issues],
    compSearchQuery: { query: "2014 Toyota Camry", source: "same_origin_fetch" },
  });
}

function keysOf(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

describe("capture payload contract", () => {
  it("emits the top-level keys in the example", async () => {
    const payload = await buildRealPayload();
    expect(keysOf(payload)).toEqual(keysOf(EXAMPLE));
  });

  it("emits the capture metadata keys in the example", async () => {
    const payload = await buildRealPayload();
    expect(keysOf(payload.capture)).toEqual(keysOf(EXAMPLE["capture"]));
  });

  it("emits the observation keys in the example, no more and no fewer", async () => {
    const payload = await buildRealPayload();
    const expected = keysOf((EXAMPLE["target"] as Record<string, unknown>));
    expect(keysOf(payload.target)).toEqual(expected);
    for (const comp of payload.comps) expect(keysOf(comp)).toEqual(expected);
  });

  it("emits exactly the five permitted seller keys", async () => {
    const payload = await buildRealPayload();
    const expected = keysOf(
      (EXAMPLE["target"] as Record<string, unknown>)["seller"] as Record<string, unknown>,
    );
    expect(keysOf(payload.target.seller)).toEqual(expected);
    expect(expected).toEqual([
      "active_vehicle_listing_count",
      "hash_version",
      "rating_average",
      "rating_count",
      "seller_hash",
    ]);
  });

  it("emits the extraction issue keys in the example", async () => {
    const payload = await buildRealPayload();
    const expected = keysOf(
      (EXAMPLE["extraction_report"] as unknown[])[0] as Record<string, unknown>,
    );
    expect(payload.extraction_report.length).toBeGreaterThan(0);
    for (const issue of payload.extraction_report) expect(keysOf(issue)).toEqual(expected);
  });

  it("emits ISO-8601 timestamps, which is what Pydantic parses", async () => {
    const payload = await buildRealPayload();
    expect(payload.capture.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(payload.target.posted_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("emits a UUID for the idempotency key", async () => {
    const payload = await buildRealPayload();
    expect(payload.capture.client_capture_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
