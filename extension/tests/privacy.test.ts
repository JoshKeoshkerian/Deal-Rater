/**
 * Privacy invariants (spec 8.2).
 *
 * These are the tests that should fail loudly if someone later adds a field
 * "just for debugging". The rule is not that personal data is rarely sent; it
 * is that there is nowhere for it to go.
 */

import { describe, expect, it } from "vitest";

import { extractTargetListing } from "../src/extract/listing";
import { extractCompCards } from "../src/extract/comp-card";
import { hashSellerId, HASH_VERSION } from "../src/seller/hash";
import { redactContactDetails } from "../src/shared/redact";
import { buildListingDocument, buildSearchDocument, itemUrl } from "./helpers/build-page";

const NOW = new Date("2026-07-25T12:00:00Z");
const SELLER_ID = "61550000000001";

const SPEC = {
  id: "100000000000001",
  title: "2014 Toyota Camry SE",
  priceAmount: "12900",
  priceText: "$12,900",
  mileage: 96_400,
  description: "Clean title. Call Jane at 918-555-0134 or jane.doe@example.com.",
  photoCount: 8,
  location: "Tulsa, OK",
  sellerId: SELLER_ID,
  sellerOtherListingIds: ["501", "502"],
};

describe("seller data leaving the browser", () => {
  it("sends a hash and a count, and nothing else", async () => {
    const { observation } = await extractTargetListing(
      buildListingDocument(SPEC, "payload"),
      itemUrl(SPEC.id),
      NOW,
    );

    expect(Object.keys(observation.seller!).sort()).toEqual([
      "active_vehicle_listing_count",
      "hash_version",
      "seller_hash",
    ]);
  });

  it("never includes the raw seller identifier anywhere in the payload", async () => {
    const { observation } = await extractTargetListing(
      buildListingDocument(SPEC, "payload"),
      itemUrl(SPEC.id),
      NOW,
    );
    expect(JSON.stringify(observation)).not.toContain(SELLER_ID);
  });

  it("never includes a profile URL in the payload", async () => {
    const { observation } = await extractTargetListing(
      buildListingDocument(SPEC, "dom"),
      itemUrl(SPEC.id),
      NOW,
    );
    expect(JSON.stringify(observation)).not.toContain("/marketplace/profile/");
    expect(JSON.stringify(observation)).not.toContain("profile.php");
  });

  it("keeps the raw payload out of raw_extract", async () => {
    const { observation } = await extractTargetListing(
      buildListingDocument(SPEC, "payload"),
      itemUrl(SPEC.id),
      NOW,
    );
    // raw_extract is a whitelist, not a spread. If someone changes it to a
    // spread of the listing node, this fails.
    expect(Object.keys(observation.raw_extract ?? {}).sort()).toEqual([
      "mileage_text",
      "page_signature",
      "posted_text",
      "price_text",
      "title",
    ]);
  });

  it("applies the same rule to comp cards", async () => {
    const { observations } = await extractCompCards(
      buildSearchDocument([
        { id: "301", title: "2014 Toyota Camry", priceAmount: "12000", sellerId: SELLER_ID },
      ]),
      "https://www.facebook.com/marketplace/search/?query=camry",
      NOW,
    );
    expect(JSON.stringify(observations)).not.toContain(SELLER_ID);
    expect(observations[0]!.seller?.seller_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashSellerId", () => {
  it("is stable, which is what the longitudinal features in 4.4 need", async () => {
    expect(await hashSellerId(SELLER_ID)).toBe(await hashSellerId(SELLER_ID));
  });

  it("is not reversible by inspection: output contains nothing of the input", async () => {
    const hash = await hashSellerId(SELLER_ID);
    expect(hash).not.toContain(SELLER_ID);
    expect(hash).toHaveLength(64);
  });

  it("separates different sellers", async () => {
    expect(await hashSellerId("1")).not.toBe(await hashSellerId("2"));
  });

  it("ignores surrounding whitespace so the same seller does not split in two", async () => {
    expect(await hashSellerId(` ${SELLER_ID} `)).toBe(await hashSellerId(SELLER_ID));
  });

  it("carries a version so the pepper can be rotated deliberately", () => {
    expect(HASH_VERSION).toBe(1);
  });

  it("refuses an empty identifier rather than hashing the pepper alone", async () => {
    await expect(hashSellerId("")).rejects.toThrow();
  });
});

describe("description redaction", () => {
  it("removes contact details before the description leaves the browser", async () => {
    const { observation } = await extractTargetListing(
      buildListingDocument(SPEC, "payload"),
      itemUrl(SPEC.id),
      NOW,
    );
    expect(observation.description).toBe("Clean title. Call Jane at [PHONE] or [EMAIL].");
  });

  it("keeps the phrasing that carries the scam and negotiation signal", () => {
    expect(
      redactContactDetails("Cash only, no lowballers. Text 918-555-0134, will not ship."),
    ).toBe("Cash only, no lowballers. Text [PHONE], will not ship.");
  });

  it.each([
    ["918-555-0134", "[PHONE]"],
    ["(918) 555-0134", "[PHONE]"],
    ["918.555.0134", "[PHONE]"],
    ["9185550134", "[PHONE]"],
    ["+1 918 555 0134", "[PHONE]"],
    ["seller@example.com", "[EMAIL]"],
  ])("replaces %s", (input, token) => {
    expect(redactContactDetails(`contact ${input} ok`)).toBe(`contact ${token} ok`);
  });

  it("leaves prices, mileages and VINs alone", () => {
    const text = "Asking 12500 obo, 189000 miles, VIN 1HGCM82633A004352";
    expect(redactContactDetails(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = redactContactDetails("call 918-555-0134")!;
    expect(redactContactDetails(once)).toBe(once);
  });

  it("matches the backend implementation, which redacts again on receipt", () => {
    // Both sides must agree on the tokens, or the same description would be
    // stored two different ways depending on which client sent it.
    expect(redactContactDetails("a@b.co 918-555-0134")).toBe("[EMAIL] [PHONE]");
  });
});
