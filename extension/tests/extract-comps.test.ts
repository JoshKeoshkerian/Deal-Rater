import { describe, expect, it } from "vitest";

import { extractCompCards } from "../src/extract/comp-card";
import { buildCompSearch } from "../src/comps/build-query";
import type { ObservationPayload } from "../src/shared/types";
import { buildSearchDocument, type CompCardSpec } from "./helpers/build-page";

const NOW = new Date("2026-07-25T12:00:00Z");
const SEARCH_URL = "https://www.facebook.com/marketplace/search/?query=2014%20Toyota%20Camry";

const CARDS: CompCardSpec[] = [
  {
    id: "201",
    title: "2014 Toyota Camry SE",
    priceAmount: "12500",
    priceText: "$12,500",
    mileageText: "88K miles",
    location: "Tulsa, OK",
    sellerId: "700000001",
  },
  {
    id: "202",
    title: "2013 Toyota Camry LE",
    priceAmount: "10900",
    priceText: "$10,900",
    mileageText: "112K miles",
    location: "Broken Arrow, OK",
  },
  {
    id: "203",
    title: "2015 Toyota Camry XLE",
    priceAmount: "14750",
    priceText: "$14,750",
    location: "Owasso, OK",
  },
  {
    id: "204",
    title: "2014 Toyota Camry",
    priceText: null,
    priceAmount: null,
    mileageText: "97K miles",
    location: "Tulsa, OK",
  },
];

async function extract(cards: CompCardSpec[], mode: "payload" | "dom" = "payload") {
  return extractCompCards(buildSearchDocument(cards, mode), SEARCH_URL, NOW);
}

describe("extractCompCards from the payload", () => {
  it("returns every card", async () => {
    const { observations } = await extract(CARDS);
    expect(observations.map((o) => o.source_listing_id).sort()).toEqual([
      "201",
      "202",
      "203",
      "204",
    ]);
  });

  it("marks every observation as a comp", async () => {
    const { observations } = await extract(CARDS);
    expect(observations.every((o) => o.role === "comp")).toBe(true);
  });

  it("reads price, mileage and location off a card", async () => {
    const { observations } = await extract(CARDS);
    const card = observations.find((o) => o.source_listing_id === "201")!;
    expect(card).toMatchObject({
      price_cents: 1_250_000,
      mileage: 88_000,
      mileage_unit: "mi",
      year: 2014,
      make: "Toyota",
      model: "Camry",
      trim_text: "SE",
      location_text: "Tulsa, OK",
    });
  });

  it("keeps a card with no price rather than dropping it", async () => {
    const { observations } = await extract(CARDS);
    const card = observations.find((o) => o.source_listing_id === "204")!;
    expect(card.price_cents).toBeNull();
    expect(card.mileage).toBe(97_000);
  });

  it("keeps a card with no mileage rather than dropping it", async () => {
    const { observations } = await extract(CARDS);
    const card = observations.find((o) => o.source_listing_id === "203")!;
    expect(card.mileage).toBeNull();
    expect(card.price_cents).toBe(1_475_000);
  });

  it("hashes a comp seller the same way as a target seller", async () => {
    const { observations } = await extract(CARDS);
    const card = observations.find((o) => o.source_listing_id === "201")!;
    expect(card.seller?.seller_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(observations)).not.toContain("700000001");
  });

  it("does not count the same listing twice", async () => {
    const { observations } = await extract([...CARDS, CARDS[0]!]);
    const ids = observations.map((o) => o.source_listing_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns an empty set rather than throwing on an empty search", async () => {
    const { observations } = await extract([]);
    expect(observations).toEqual([]);
  });

  it("collapses repeated card issues into one row per field", async () => {
    // Every card lacks a description; that is one fact, not forty.
    const { issues } = await extract(CARDS);
    const byKey = issues.map((i) => `${i.scope}|${i.field_name}|${i.status}`);
    expect(new Set(byKey).size).toBe(byKey.length);
  });
});

describe("extractCompCards from the DOM", () => {
  it("falls back to reading the rendered cards", async () => {
    const { observations } = await extract(CARDS, "dom");
    expect(observations).toHaveLength(4);
  });

  it("reads price and vehicle from the card text", async () => {
    const { observations } = await extract(CARDS, "dom");
    const card = observations.find((o) => o.source_listing_id === "201")!;
    expect(card).toMatchObject({
      price_cents: 1_250_000,
      year: 2014,
      make: "Toyota",
      model: "Camry",
      mileage: 88_000,
    });
    expect(card.field_strategies["price_cents"]).toBe("text_pattern");
  });

  it("does not mistake the price for part of the vehicle title", async () => {
    const { observations } = await extract(CARDS, "dom");
    for (const card of observations) {
      expect(card.make).not.toBeNull();
      expect(card.trim_text ?? "").not.toContain("$");
    }
  });
});

describe("buildCompSearch", () => {
  const target = (patch: Partial<ObservationPayload>): ObservationPayload =>
    ({
      source: "facebook_marketplace",
      source_listing_id: "1",
      role: "target",
      year: 2014,
      make: "Toyota",
      model: "Camry",
      ...patch,
    }) as ObservationPayload;

  it("searches for the vehicle the user is looking at", () => {
    const search = buildCompSearch(target({}));
    expect(search?.query.query).toBe("2014 Toyota Camry");
    expect(search?.url).toContain("query=2014+Toyota+Camry");
  });

  it("stays on the Marketplace search route", () => {
    expect(buildCompSearch(target({}))?.url).toMatch(
      /^https:\/\/www\.facebook\.com\/marketplace\/search\//,
    );
  });

  it("drops the year when it is unknown rather than searching for null", () => {
    expect(buildCompSearch(target({ year: null }))?.query.query).toBe("Toyota Camry");
  });

  it("refuses to search on a make alone", () => {
    // A comp set of every Toyota would look populated and mean nothing, which
    // is worse for step 3 than no comp set at all.
    expect(buildCompSearch(target({ model: null }))).toBeNull();
  });

  it("refuses to search with no vehicle at all", () => {
    expect(buildCompSearch(target({ make: null, model: null }))).toBeNull();
  });

  it("records what the query was derived from", () => {
    expect(buildCompSearch(target({}))?.query.derived_from).toEqual({
      year: 2014,
      make: "Toyota",
      model: "Camry",
    });
  });
});
