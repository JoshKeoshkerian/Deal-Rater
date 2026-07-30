import { describe, expect, it } from "vitest";

import {
  MAX_PEER_MILES,
  METROS,
  MIN_COMP_CITY_HITS,
  findMetro,
  metroFromLocationText,
  milesBetween,
  nearestMetro,
  peersFor,
  verifyMetroResults,
} from "../src/comps/metros";
import type { ObservationPayload } from "../src/shared/types";

const obs = (patch: Partial<ObservationPayload>): ObservationPayload =>
  ({
    source: "facebook_marketplace",
    source_listing_id: "x",
    role: "comp",
    year: 2016,
    make: "Mazda",
    model: "CX-5",
    price_cents: 1_100_000,
    ...patch,
  }) as ObservationPayload;

describe("metro table", () => {
  it("has unique slugs", () => {
    const slugs = METROS.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses only slug forms Marketplace accepts", () => {
    // A 16-digit number is not a Marketplace location, and an unrecognised path
    // silently returns the account's own metro.
    for (const m of METROS) {
      expect(m.slug).toMatch(/^(?:[0-9]{15}|[a-z][a-z0-9-]{2,40})$/);
    }
  });

  it("gives every metro plausible coordinates and states", () => {
    for (const m of METROS) {
      expect(m.lat).toBeGreaterThan(24);
      expect(m.lat).toBeLessThan(50);
      expect(m.lon).toBeLessThan(-66);
      expect(m.lon).toBeGreaterThan(-125);
      expect(m.states.length).toBeGreaterThan(0);
    }
  });
});

describe("peer selection", () => {
  it("never pairs a salt market with a sun market", () => {
    // A $9,000 car in Buffalo and a $9,000 car in Phoenix are different metal.
    const buffalo = findMetro("buffalo")!;
    for (const peer of peersFor(buffalo, 20)) {
      expect(peer.rust).not.toBe("sun");
    }
  });

  it("never pairs a high-price coastal market with a low-price interior one", () => {
    // Spec 1's dealer-vs-private distortion, arrived at geographically.
    const nyc = findMetro("nyc")!;
    for (const peer of peersFor(nyc, 20)) {
      expect(peer.tier).not.toBe("low");
    }
  });

  it("does not return St. Louis for a New York search", () => {
    // The example given when this was specified.
    const slugs = peersFor(findMetro("nyc")!, 20).map((m) => m.slug);
    expect(slugs).not.toContain("stlouis");
  });

  it("returns the neighbouring midwest markets for St. Louis", () => {
    const slugs = peersFor(findMetro("stlouis")!, 6).map((m) => m.slug);
    expect(slugs).toContain("springfieldmo");
    expect(slugs).toContain("kansascity");
  });

  it("returns Oklahoma and Kansas markets for Tulsa", () => {
    const slugs = peersFor(findMetro("tulsa")!, 4).map((m) => m.slug);
    expect(slugs).toContain("oklahomacity");
    expect(slugs).toContain("wichita");
  });

  it("orders peers nearest first", () => {
    const origin = findMetro("chicago")!;
    const miles = peersFor(origin, 8).map((m) => milesBetween(origin, m));
    expect(miles).toEqual([...miles].sort((a, b) => a - b));
  });

  it("never exceeds the distance cap", () => {
    for (const origin of METROS) {
      for (const peer of peersFor(origin, 20)) {
        expect(milesBetween(origin, peer)).toBeLessThanOrEqual(MAX_PEER_MILES);
      }
    }
  });

  it("never returns the origin as its own peer", () => {
    for (const origin of METROS) {
      expect(peersFor(origin, 20).map((m) => m.slug)).not.toContain(origin.slug);
    }
  });
});

describe("locating a listing's metro", () => {
  it("places a listing by coordinates, since listing pages carry no slug", () => {
    expect(nearestMetro(38.63, -90.2)?.slug).toBe("stlouis");
    expect(nearestMetro(36.16, -86.78)?.slug).toBe("nashville");
  });

  it("covers outlying towns within the metro's reach", () => {
    // Farmington MO is ~70 miles from St. Louis and shops that market.
    expect(nearestMetro(37.78, -90.42)?.slug).toBe("stlouis");
  });

  it("returns nothing rather than inventing a distant metro", () => {
    // Rural Montana has no peer market here; the nearest entry is states away.
    expect(nearestMetro(46.9, -110.4)).toBeNull();
  });

  it("handles a listing with no coordinates", () => {
    expect(nearestMetro(null, null)).toBeNull();
  });
});

describe("verifying a slug resolved", () => {
  const tulsa = findMetro("tulsa")!;

  it("accepts results from the expected state", () => {
    expect(verifyMetroResults(tulsa, ["Tulsa, OK", "Broken Arrow, OK"])).toBe(true);
  });

  it("rejects the home metro coming back instead", () => {
    // The actual failure mode: Facebook answers an unrecognised location by
    // returning the account's own metro, not an error.
    expect(verifyMetroResults(tulsa, ["St Louis, MO", "Arnold, MO"])).toBe(false);
  });

  it("rejects an empty result set", () => {
    expect(verifyMetroResults(tulsa, [])).toBe(false);
  });

  it("tolerates a mixed result set", () => {
    // Metro areas cross state lines and searches reach beyond them.
    expect(verifyMetroResults(tulsa, ["Joplin, MO", "Tulsa, OK"])).toBe(true);
  });
});

describe("locating a metro from city names", () => {
  // The fallback for listings whose page publishes no coordinates. Before it
  // existed those captures did no widening at all -- 32 of 237 post-fix
  // captures, finishing on a median of ~10 usable comps against ~34.

  it("matches the listing's own city against the metro table", () => {
    expect(metroFromLocationText("Tulsa, OK")?.slug).toBe("tulsa");
  });

  it("tolerates the punctuation listings actually use", () => {
    // The table says "St. Louis"; Marketplace writes "St Louis".
    expect(metroFromLocationText("St Louis, MO")?.slug).toBe("stlouis");
    expect(metroFromLocationText("St. Louis, MO")?.slug).toBe("stlouis");
  });

  it("matches a metro whose display name carries a disambiguating state", () => {
    // The table entry is named "Springfield MO" so it is distinguishable in a
    // peer list. Without stripping that suffix, the city it is named after
    // failed to match it at all.
    expect(metroFromLocationText("Springfield, MO")?.slug).toBe("springfieldmo");
  });

  it("does not match a same-named city in the wrong state", () => {
    // Springfield IL is not this table's Springfield, and pairing them would
    // draw peers from 200 miles away in the wrong market.
    expect(metroFromLocationText("Springfield, IL")).toBeNull();
  });

  it("falls back to the metro named most often among the comps' cities", () => {
    // A suburb has no entry of its own and never will. The comps came from a
    // search scoped to the listing's own place id, so they are its market.
    const metro = metroFromLocationText("Barnhart, MO", [
      "St Louis, MO",
      "Chesterfield, MO",
      "St Louis, MO",
      "Warrenton, MO",
    ]);
    expect(metro?.slug).toBe("stlouis");
  });

  it("ignores comp cities from states the search never touched", () => {
    const metro = metroFromLocationText("Barnhart, MO", [
      "Phoenix, AZ",
      "Phoenix, AZ",
      "Tucson, AZ",
    ]);
    expect(metro).toBeNull();
  });

  it(`requires at least ${MIN_COMP_CITY_HITS} comps to name the same metro`, () => {
    // One listing from a city 100 miles out is normal spill on a 40-mile
    // radius, not evidence about where the listing is.
    expect(metroFromLocationText("Barnhart, MO", ["St Louis, MO"])).toBeNull();
    expect(
      metroFromLocationText("Barnhart, MO", ["St Louis, MO", "St Louis, MO"])?.slug,
    ).toBe("stlouis");
  });

  it("declines a tie rather than guessing between two markets", () => {
    const metro = metroFromLocationText("Quincy, IL", [
      "St Louis, MO",
      "St Louis, MO",
      "Chicago, IL",
      "Chicago, IL",
    ]);
    expect(metro).toBeNull();
  });

  it("declines when there is nothing to go on", () => {
    expect(metroFromLocationText(null)).toBeNull();
    expect(metroFromLocationText("")).toBeNull();
    // No comma means no state, so a bare city cannot be state-checked.
    expect(metroFromLocationText("Tulsa")).toBeNull();
    expect(metroFromLocationText("Barnhart, MO", [])).toBeNull();
  });

  it("does not count one comp city twice when two metros claim its state", () => {
    // "Hammond, IN" is not a metro name, but if it were listed under two
    // entries a single comp must still cast a single vote -- otherwise two
    // listings could clear a threshold meant to need two distinct ones.
    const metro = metroFromLocationText("Ballwin, MO", ["St Louis, MO", "St Louis, MO"]);
    expect(metro?.slug).toBe("stlouis");
  });
});
