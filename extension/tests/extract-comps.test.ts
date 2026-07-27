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

  describe("mileage typed into the title", () => {
    // Real captured card: "2016 Mazda CX-5 · Touring 🤘 174160 Miles" with no
    // subtitle. Without this the comp has no mileage and drops out of the
    // step-3 regression, which is what happened to two of ten comps in one
    // captured search.
    const titled = (title: string): CompCardSpec => ({
      id: "301",
      title,
      priceAmount: "8998",
      priceText: "$8,998",
      mileageText: null,
      location: "Centralia, IL",
    });

    it("recovers mileage from the title when there is no subtitle", async () => {
      const { observations } = await extract([titled("2016 Mazda CX-5 · Touring 🤘 174160 Miles")]);
      expect(observations[0]!.mileage).toBe(174_160);
      expect(observations[0]!.mileage_unit).toBe("mi");
    });

    it("handles the abbreviated form", async () => {
      const { observations } = await extract([titled("2016 Mazda CX-5 Touring 96k miles")]);
      expect(observations[0]!.mileage).toBe(96_000);
    });

    it("prefers a subtitle over the title", async () => {
      // The subtitle is the structured field; the title is a last resort.
      const { observations } = await extract([
        { ...titled("2016 Mazda CX-5 · Touring 174160 Miles"), mileageText: "161K miles" },
      ]);
      expect(observations[0]!.mileage).toBe(161_000);
    });

    it("does not invent mileage from a title with no odometer in it", async () => {
      const { observations } = await extract([titled("2016 Mazda CX-5 · Grand Touring")]);
      expect(observations[0]!.mileage).toBeNull();
    });

    it("does not read a model number as mileage", async () => {
      // "328i" and "MAZDA3" must not match; the unit word is required.
      for (const title of ["2015 BMW 328i · Sedan 4D", "2008 Mazda MAZDA3 2.0 Sedan 4D"]) {
        const { observations } = await extract([titled(title)]);
        expect(observations[0]!.mileage).toBeNull();
      }
    });

    it("does not read the model year as mileage", async () => {
      const { observations } = await extract([titled("2016 Mazda CX-5 · Sport SUV 4D")]);
      expect(observations[0]!.mileage).toBeNull();
    });
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

  describe("location scoping", () => {
    // Marketplace scopes by PATH SEGMENT, not query parameter. An earlier
    // attempt passed latitude/longitude/radius_km; Facebook ignored them and
    // returned zero results, which capture 6 recorded as location_scoped:false.
    const LOC = "105517276147313";

    it("scopes to the listing's own place id, not the user's metro", () => {
      const search = buildCompSearch(target({}), LOC)!;
      expect(search.url).toContain(`/marketplace/${LOC}/search/`);
      expect(search.url).toContain("query=2014+Toyota+Camry");
    });

    it("does not pass coordinates as query parameters", () => {
      // Facebook ignores these; sending them produced an empty comp set.
      const url = new URL(buildCompSearch(target({}), LOC)!.url);
      expect(url.searchParams.get("latitude")).toBeNull();
      expect(url.searchParams.get("longitude")).toBeNull();
      expect(url.searchParams.get("radius_km")).toBeNull();
    });

    it("offers an unscoped fallback, since a bad location returns zero not an error", () => {
      const search = buildCompSearch(target({}), LOC)!;
      expect(search.fallbackUrl).toContain("/marketplace/search/");
      expect(search.fallbackUrl).not.toContain(LOC);
    });

    it("records the place id so a wrong-metro comp set is visible in the data", () => {
      expect(buildCompSearch(target({}), LOC)!.query.location_id).toBe(LOC);
    });

    it("falls straight through when the listing carried no place id", () => {
      const search = buildCompSearch(target({}), null)!;
      expect(search.url).toContain("/marketplace/search/");
      expect(search.fallbackUrl).toBeNull();
      expect(search.query.location_id).toBeNull();
    });

    it("rejects a malformed place id rather than building a broken path", () => {
      const search = buildCompSearch(target({}), "../../evil")!;
      expect(search.url).toContain("/marketplace/search/");
      expect(search.query.location_id).toBeNull();
    });
  });
});
