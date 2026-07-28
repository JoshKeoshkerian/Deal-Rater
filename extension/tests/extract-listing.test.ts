/**
 * Target listing extraction across varied listings.
 *
 * The step-2 success criterion is reliable extraction across 30+ varied
 * listings including edge cases. The table below is that set, expressed so it
 * runs on every change rather than once by hand: each row is a distinct listing
 * shape, and each is checked in whichever render mode is relevant to it.
 */

import { describe, expect, it } from "vitest";

import { extractTargetListing } from "../src/extract/listing";
import { findTargetListingNode } from "../src/extract/fields/listing-node";
import { readSearchRadiusKm } from "../src/extract/fields/place";
import type { ObservationPayload } from "../src/shared/types";
import {
  buildListingDocument,
  itemUrl,
  type ListingSpec,
  type RenderMode,
} from "./helpers/build-page";

const NOW = new Date("2026-07-25T12:00:00Z");

const BASE: ListingSpec = {
  id: "100000000000001",
  title: "2014 Toyota Camry SE",
  priceAmount: "12900",
  priceText: "$12,900",
  mileage: 96_400,
  mileageText: "96,400 miles",
  description: "Runs great, cold AC, clean title in hand. Second owner, records available.",
  photoCount: 12,
  location: "Tulsa, OK",
  latitude: 36.15398,
  longitude: -95.992775,
  createdAtSeconds: 1_752_000_000,
  postedText: "Listed 3 weeks ago",
  sellerId: "61550000000001",
};

async function extract(
  spec: ListingSpec,
  mode: RenderMode = "payload",
): Promise<Awaited<ReturnType<typeof extractTargetListing>>> {
  const doc = buildListingDocument(spec, mode);
  return extractTargetListing(doc, itemUrl(spec.id), NOW);
}

interface Scenario {
  name: string;
  spec: ListingSpec;
  mode: RenderMode;
  expected: Partial<ObservationPayload>;
}

const scenarios: Scenario[] = [
  {
    name: "01 complete listing, payload present",
    spec: BASE,
    mode: "payload",
    expected: {
      source_listing_id: "100000000000001",
      price_cents: 1_290_000,
      mileage: 96_400,
      mileage_unit: "mi",
      year: 2014,
      make: "Toyota",
      model: "Camry",
      photo_count: 12,
      location_text: "Tulsa, OK",
      title_status: "clean",
    },
  },
  {
    name: "02 same listing with no payload, read from the DOM",
    spec: BASE,
    mode: "dom",
    expected: {
      price_cents: 1_290_000,
      mileage: 96_400,
      year: 2014,
      make: "Toyota",
      model: "Camry",
      photo_count: 12,
      location_text: "Tulsa, OK",
    },
  },
  {
    name: "03 same listing with nothing but meta tags",
    spec: BASE,
    mode: "meta",
    expected: { year: 2014, make: "Toyota", model: "Camry", price_cents: null },
  },
  {
    name: "04 no price",
    spec: { ...BASE, priceAmount: null, priceText: null },
    mode: "payload",
    expected: { price_cents: null, year: 2014, make: "Toyota" },
  },
  {
    name: "05 no price, DOM only",
    spec: { ...BASE, priceAmount: null, priceText: null },
    mode: "dom",
    expected: { price_cents: null, mileage: 96_400 },
  },
  {
    name: "06 missing mileage",
    spec: { ...BASE, mileage: null, mileageText: null },
    mode: "payload",
    expected: { mileage: null, mileage_unit: null, price_cents: 1_290_000 },
  },
  {
    name: "07 missing mileage, DOM only",
    spec: { ...BASE, mileage: null, mileageText: null },
    mode: "dom",
    expected: { mileage: null, price_cents: 1_290_000 },
  },
  {
    name: "07b mileage masked in the description, no structured field",
    // Sellers write "120xxx miles" to mean "about 120,000" without stating
    // an exact figure. No structured odometer field and no mileage in the
    // title, so this only resolves if the description text-pattern tier
    // (tier 5, the deepest fallback) reconstructs the masked value.
    spec: {
      ...BASE,
      mileage: null,
      mileageText: null,
      description: "Clean title, one owner. Around 120xxx miles, mostly highway.",
    },
    mode: "dom",
    expected: { mileage: 120_000, mileage_unit: "mi", price_cents: 1_290_000 },
  },
  {
    name: "08 empty description",
    spec: { ...BASE, description: "" },
    mode: "payload",
    expected: { description: null, price_cents: 1_290_000 },
  },
  {
    name: "09 no description field at all",
    spec: { ...BASE, description: null },
    mode: "payload",
    expected: { description: null, year: 2014 },
  },
  {
    name: "10 single photo",
    spec: { ...BASE, photoCount: 1 },
    mode: "payload",
    expected: { photo_count: 1 },
  },
  {
    name: "11 no photos",
    spec: { ...BASE, photoCount: 0 },
    mode: "payload",
    expected: { photo_count: 0 },
  },
  {
    name: "12 single photo, DOM only",
    spec: { ...BASE, photoCount: 1 },
    mode: "dom",
    expected: { photo_count: 1 },
  },
  {
    name: "13 kilometres rather than miles",
    spec: { ...BASE, mileage: 155_000, mileageUnit: "KILOMETERS", mileageText: "155,000 km" },
    mode: "payload",
    expected: { mileage: 155_000, mileage_unit: "km" },
  },
  {
    name: "14 abbreviated mileage on the card subtitle",
    spec: { ...BASE, mileage: null, mileageText: "96K miles" },
    mode: "payload",
    expected: { mileage: 96_000, mileage_unit: "mi" },
  },
  {
    name: "15 salvage title stated in the description",
    spec: { ...BASE, description: "Salvage title, runs and drives fine. $12,900 firm." },
    mode: "payload",
    expected: { title_status: "salvage" },
  },
  {
    name: "16 rebuilt title in the structured field",
    spec: { ...BASE, description: "Great car", titleStatus: "rebuilt" },
    mode: "payload",
    expected: { title_status: "rebuilt" },
  },
  {
    name: "17 no title status stated anywhere",
    spec: { ...BASE, description: "Runs great, cold AC, new tires last spring." },
    mode: "payload",
    expected: { title_status: null },
  },
  {
    name: "18 VIN in the description",
    spec: { ...BASE, description: "Clean title. VIN 1HGCM82633A004352. Records available." },
    mode: "payload",
    expected: { vin: "1HGCM82633A004352" },
  },
  {
    name: "19 mistyped VIN is dropped rather than transmitted",
    spec: { ...BASE, description: "Clean title. VIN 1HGCM82633A004353." },
    mode: "payload",
    expected: { vin: null },
  },
  {
    name: "20 no VIN, which is the common case",
    spec: BASE,
    mode: "payload",
    expected: { vin: null },
  },
  {
    name: "21 two-word make",
    spec: { ...BASE, title: "2016 Land Rover Range Rover Sport" },
    mode: "payload",
    expected: { year: 2016, make: "Land Rover", model: "Range" },
  },
  {
    name: "22 abbreviated make is canonicalised",
    spec: { ...BASE, title: "2011 Chevy Silverado 1500 LT" },
    mode: "payload",
    expected: { make: "Chevrolet", model: "Silverado", trim_text: "1500 LT" },
  },
  {
    name: "23 unrecognised make yields nulls rather than a guess",
    spec: { ...BASE, title: "2014 Frobnicator Deluxe" },
    mode: "payload",
    expected: { year: 2014, make: null, model: null },
  },
  {
    name: "24 noise before the year",
    spec: { ...BASE, title: "PRICE DROP 2012 Honda Accord EX-L" },
    mode: "payload",
    expected: { year: 2012, make: "Honda", model: "Accord", trim_text: "EX-L" },
  },
  {
    name: "25 no trim in the title",
    spec: { ...BASE, title: "2014 Toyota Camry" },
    mode: "payload",
    expected: { model: "Camry", trim_text: null },
  },
  {
    name: "26 price shown as Free",
    spec: { ...BASE, priceAmount: "0", priceText: "Free" },
    mode: "payload",
    expected: { price_cents: 0 },
  },
  {
    name: "27 struck-through previous price marks a change",
    spec: { ...BASE, priceDropped: true },
    mode: "dom",
    expected: { price_changed: true },
  },
  {
    name: "28 no price-change marker leaves the field unknown, not false",
    spec: BASE,
    mode: "payload",
    expected: { price_changed: null },
  },
  {
    name: "29 just listed",
    spec: { ...BASE, createdAtSeconds: null, postedText: "Just listed" },
    mode: "dom",
    expected: { posted_at: NOW.toISOString(), posted_relative_text: "Just listed" },
  },
  {
    name: "30 no location",
    spec: { ...BASE, location: null },
    mode: "payload",
    expected: { location_text: null, latitude: null },
  },
  {
    name: "31 no seller identifier",
    spec: { ...BASE, sellerId: null },
    mode: "payload",
    expected: { seller: null },
  },
  {
    name: "32 contact details in the description are replaced before transmit",
    spec: { ...BASE, description: "Great truck. Call or text 918-555-0134 anytime." },
    mode: "payload",
    expected: { description: "Great truck. Call or text [PHONE] anytime." },
  },
  {
    name: "33 listing that yielded nothing but an id",
    spec: { id: "999999999", broken: true },
    mode: "payload",
    expected: {
      source_listing_id: "999999999",
      price_cents: null,
      year: null,
      make: null,
      model: null,
      mileage: null,
    },
  },
  {
    name: "34 very old listing",
    spec: { ...BASE, createdAtSeconds: 1_690_000_000 },
    mode: "payload",
    expected: { posted_at: new Date(1_690_000_000 * 1000).toISOString() },
  },
  {
    name: "35 seller has a star rating",
    spec: { ...BASE, sellerRating: { average: 2.4, count: 7 } },
    mode: "dom",
    expected: {
      seller: {
        seller_hash: expect.any(String),
        hash_version: expect.any(Number),
        active_vehicle_listing_count: null,
        rating_average: 2.4,
        rating_count: 7,
      },
    },
  },
  {
    name: "36 seller has no rating widget at all",
    spec: BASE,
    mode: "dom",
    expected: {
      seller: {
        seller_hash: expect.any(String),
        hash_version: expect.any(Number),
        active_vehicle_listing_count: null,
        rating_average: null,
        rating_count: null,
      },
    },
  },
];

describe("extractTargetListing", () => {
  it.each(scenarios)("$name", async ({ spec, mode, expected }) => {
    const { observation } = await extract(spec, mode);
    expect(observation).toMatchObject(expected);
  });

  it("covers at least 30 distinct listing shapes", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
  });
});

describe("field strategies", () => {
  it("records the payload tier as the winner when a payload is present", async () => {
    const { observation } = await extract(BASE, "payload");
    expect(observation.field_strategies["price_cents"]).toBe("json_payload");
    expect(observation.field_strategies["mileage"]).toBe("json_payload");
    expect(observation.field_strategies["location_text"]).toBe("json_payload");
  });

  it("records the fallback tier when the payload is gone", async () => {
    const { observation } = await extract(BASE, "dom");
    expect(observation.field_strategies["price_cents"]).toBe("text_pattern");
    expect(observation.field_strategies["mileage"]).toBe("text_pattern");
  });

  it("records the URL as the source of the listing id, in every mode", async () => {
    for (const mode of ["payload", "dom", "meta"] as RenderMode[]) {
      const { observation } = await extract(BASE, mode);
      expect(observation.field_strategies["source_listing_id"]).toBe("url_path");
    }
  });
});

describe("seller fields", () => {
  it("hashes the identifier and never returns the raw one", async () => {
    const { observation } = await extract(BASE, "payload");
    expect(observation.seller?.seller_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(observation.seller?.hash_version).toBe(1);
    expect(JSON.stringify(observation)).not.toContain(BASE.sellerId!);
  });

  it("produces the same hash for the same seller across captures", async () => {
    const first = await extract(BASE, "payload");
    const second = await extract({ ...BASE, id: "222" }, "payload");
    expect(first.observation.seller?.seller_hash).toBe(second.observation.seller?.seller_hash);
  });

  it("produces different hashes for different sellers", async () => {
    const first = await extract(BASE, "payload");
    const second = await extract({ ...BASE, sellerId: "61550000000002" }, "payload");
    expect(first.observation.seller?.seller_hash).not.toBe(
      second.observation.seller?.seller_hash,
    );
  });

  it("reads a stated listing count from the payload", async () => {
    const { observation } = await extract({ ...BASE, sellerListingCount: 7 }, "payload");
    expect(observation.seller?.active_vehicle_listing_count).toBe(7);
  });

  it("counts the seller's other listings and includes this one", async () => {
    const { observation } = await extract(
      { ...BASE, sellerOtherListingIds: ["501", "502", "503"] },
      "payload",
    );
    expect(observation.seller?.active_vehicle_listing_count).toBe(4);
  });

  it("does not count this listing twice when it appears in its own section", async () => {
    const { observation } = await extract(
      { ...BASE, sellerOtherListingIds: ["501", BASE.id] },
      "payload",
    );
    expect(observation.seller?.active_vehicle_listing_count).toBe(2);
  });
});

describe("structural self-check", () => {
  it("flags a page with no listing payload at required level", async () => {
    const { issues } = await extract({ ...BASE, broken: true }, "payload");
    const probe = issues.find((issue) => issue.field_name === "listing_payload");
    expect(probe?.expectation).toBe("required");
    expect(probe?.status).toBe("missing");
  });

  it("does not flag a healthy page", async () => {
    const { issues } = await extract(BASE, "payload");
    expect(issues.some((issue) => issue.expectation === "required")).toBe(false);
  });

  it("reports a missing price at expected level, not required", async () => {
    const { issues } = await extract({ ...BASE, priceAmount: null, priceText: null }, "payload");
    const price = issues.find((issue) => issue.field_name === "price_cents");
    expect(price?.expectation).toBe("expected");
  });

  it("reports an absent VIN at optional level so it never raises an alarm", async () => {
    const { issues } = await extract(BASE, "payload");
    expect(issues.find((issue) => issue.field_name === "vin")?.expectation).toBe("optional");
  });

  it("attaches a page signature to every issue", async () => {
    const { issues, pageSignature } = await extract({ ...BASE, broken: true }, "payload");
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.page_signature).toBe(pageSignature);
  });

  it("gives the same signature to two listings rendered the same way", async () => {
    const a = await extract(BASE, "payload");
    const b = await extract({ ...BASE, id: "555", title: "2019 Honda Civic LX" }, "payload");
    expect(a.pageSignature).toBe(b.pageSignature);
  });

  it("gives different signatures to differently structured pages", async () => {
    const a = await extract(BASE, "payload");
    const b = await extract(BASE, "meta");
    expect(a.pageSignature).not.toBe(b.pageSignature);
  });
});

describe("listing identity", () => {
  it("rebuilds a canonical URL without referral parameters", async () => {
    const doc = buildListingDocument(BASE, "payload");
    const { observation } = await extractTargetListing(
      doc,
      `${itemUrl(BASE.id)}?ref=search&referral_code=marketplace_search`,
      NOW,
    );
    expect(observation.listing_url).toBe(itemUrl(BASE.id));
  });

  it("never pairs one listing's id with another listing's data", async () => {
    // THE bug this guard exists for. Marketplace is a single-page app, so
    // clicking from listing A to listing B swaps the URL before B's payload
    // arrives. Capturing in that window used to attach B's id to A's data.
    //
    // Captured data proves it happened: listing id 2061074687826390 appears on
    // both a 2010 Mercedes C-Class and a 2017 Infiniti Q50. Spec 4.4 keys a
    // per-listing time series on this id, so a mismatch attributes one car's
    // price history to another and nothing downstream can detect it.
    const stalePayload = [
      { id: "100000000000001", marketplace_listing_title: "2014 Toyota Camry SE" },
    ];

    // The URL says we are on a different listing than the payload describes.
    expect(findTargetListingNode(stalePayload, "999999999999999")).toBeNull();
  });

  it("still returns the payload node when the URL id matches it", async () => {
    const payload = [
      { id: "100000000000001", marketplace_listing_title: "2014 Toyota Camry SE" },
    ];
    expect(findTargetListingNode(payload, "100000000000001")).not.toBeNull();
  });

  it("does not pick a similar-listings card over the real listing", async () => {
    const payload = [
      { id: "888", marketplace_listing_title: "2011 Honda Civic LX" },
      { id: "100000000000001", marketplace_listing_title: "2014 Toyota Camry SE" },
    ];
    const node = findTargetListingNode(payload, "100000000000001");
    expect(node?.["marketplace_listing_title"]).toBe("2014 Toyota Camry SE");
  });

  it("still guesses when the route carries no listing id at all", async () => {
    // No id to contradict, so a guess is all there is -- and is better than
    // nothing. Distinct from a mismatch, which is evidence of a stale page.
    const payload = [{ id: "888", marketplace_listing_title: "2011 Honda Civic LX" }];
    expect(findTargetListingNode(payload, null)).not.toBeNull();
  });

  it("reports itself unusable when the URL is not a listing page", async () => {
    const doc = buildListingDocument(BASE, "meta");
    const result = await extractTargetListing(
      doc,
      "https://www.facebook.com/marketplace/",
      NOW,
    );
    // The canonical link still identifies it, so this page is recoverable.
    expect(result.observation.source_listing_id).toBe(BASE.id);
    expect(result.observation.field_strategies["source_listing_id"]).toBe("meta_tag");
  });
});

describe("account search radius", () => {
  // Not settable per request: changing the radius in Marketplace's UI leaves
  // the search URL byte-for-byte identical, so Facebook holds it against the
  // account. Extracting it does not widen anything -- it makes the geographic
  // scope of a comp set recorded rather than an invisible global.
  it("reads a kilometre value", () => {
    expect(readSearchRadiusKm([{ location: { radius: 65 } }])).toBe(65);
  });

  it("reads a metre value as kilometres", () => {
    // Captured pages carry both forms; 65 km and 65,000 m are the same 40 miles.
    expect(readSearchRadiusKm([{ pdpListingId: "1", radius: 65000 }])).toBe(65);
  });

  it("returns null rather than guessing a default", () => {
    expect(readSearchRadiusKm([{ unrelated: true }])).toBeNull();
    expect(readSearchRadiusKm([])).toBeNull();
  });

  it("rejects nonsense rather than passing it through", () => {
    expect(readSearchRadiusKm([{ radius: 0 }])).toBeNull();
    expect(readSearchRadiusKm([{ radius: -5 }])).toBeNull();
    expect(readSearchRadiusKm([{ radius: 99_000_000 }])).toBeNull();
  });
});

describe("single-page-app navigation", () => {
  // Capturing used to require a manual Cmd+R. The refresh was never the point:
  // it forced Facebook to server-render the listing's JSON payload into the
  // DOM. Navigating listing-to-listing leaves the previous listing's payload
  // in place, so the extractor has to notice and re-fetch instead.
  it("reports that the payload did not belong to this listing", async () => {
    const stalePage = buildListingDocument(BASE, "payload");
    const result = await extractTargetListing(
      stalePage,
      itemUrl("999999999999999"),
      NOW,
    );
    expect(result.payloadMatched).toBe(false);
  });

  it("reports a match on a freshly loaded page", async () => {
    const doc = buildListingDocument(BASE, "payload");
    const result = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(result.payloadMatched).toBe(true);
  });

  it("does not claim a match when the page has no payload at all", async () => {
    const doc = buildListingDocument(BASE, "meta");
    const result = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(result.payloadMatched).toBe(false);
  });
});

describe("seller star rating", () => {
  // The aria-label carries the precise average ("2.4 out of 5 stars"); the
  // review COUNT in that same label was observed unreliable on a real
  // captured page ("From one review'" on a seller with 7 reviews), so the
  // real count is read from a separate "(N)" sibling span instead. These
  // tests build custom documents directly rather than through ListingSpec so
  // the exact nesting between the widget and that span can be varied.
  function docWithRatingMarkup(innerHtml: string): Document {
    const html = `<!DOCTYPE html><html><body>
      <div id="header"><h1>2014 Toyota Camry SE</h1><span>$12,900</span></div>
      <div role="main">${innerHtml}</div>
    </body></html>`;
    return new DOMParser().parseFromString(html, "text/html");
  }

  it("reads the precise average from the aria-label, not the rounded stars", async () => {
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>` +
        `<div><div role="img" aria-label="2.4 out of 5 stars, From one review'"></div><span>(7)</span></div>`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.seller?.rating_average).toBe(2.4);
    expect(observation.seller?.rating_count).toBe(7);
  });

  it("ignores the review count baked into the aria-label and trusts the sibling span", async () => {
    // Same aria-label wording as the captured page ("From one review'"), but
    // the real count sitting in "(N)" is different from what that text says.
    // If this ever read "one" out of the label text, it would be wrong here.
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>` +
        `<div><div role="img" aria-label="4.9 out of 5 stars, From one review'"></div><span>(41)</span></div>`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.seller?.rating_average).toBe(4.9);
    expect(observation.seller?.rating_count).toBe(41);
  });

  it("finds the count through several layers of wrapper divs", async () => {
    const wrapped =
      `<div><div><div><div>` +
      `<div role="img" aria-label="3 out of 5 stars, From one review'"></div>` +
      `</div></div></div><div><div><span>(15)</span></div></div></div>`;
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>${wrapped}`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.seller?.rating_average).toBe(3);
    expect(observation.seller?.rating_count).toBe(15);
  });

  it("still reports the average when no count span can be found nearby", async () => {
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>` +
        `<div><div role="img" aria-label="4.0 out of 5 stars, From one review'"></div></div>`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.seller?.rating_average).toBe(4.0);
    expect(observation.seller?.rating_count).toBeNull();
  });

  it("rejects a nonsensical out-of-range average rather than passing it through", async () => {
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>` +
        `<div><div role="img" aria-label="7 out of 5 stars, From one review'"></div><span>(3)</span></div>`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.seller?.rating_average).toBeNull();
    expect(observation.seller?.rating_count).toBeNull();
  });

  it("marks the field strategy as aria_dom when a rating is found", async () => {
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>` +
        `<div><div role="img" aria-label="2.4 out of 5 stars, From one review'"></div><span>(7)</span></div>`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.field_strategies["seller_rating"]).toBe("aria_dom");
  });

  it("leaves the strategy unset when there is no rating widget at all", async () => {
    const doc = docWithRatingMarkup(
      `<a href="/marketplace/profile/61550000000001/">Seller</a>`,
    );
    const { observation } = await extractTargetListing(doc, itemUrl(BASE.id), NOW);
    expect(observation.field_strategies["seller_rating"]).toBeUndefined();
    expect(observation.seller?.rating_average).toBeNull();
  });
});
