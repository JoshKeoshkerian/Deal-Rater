import { describe, expect, it } from "vitest";

import {
  MAX_PEER_MILES,
  METROS,
  findMetro,
  milesBetween,
  nearestMetro,
  peersFor,
  verifyMetroResults,
} from "../src/comps/metros";
import {
  countTrimMatched,
  countUsable,
  looksUsable,
  pendingPeers,
  shouldWiden,
  trimLooksSimilar,
} from "../src/comps/widen";
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

describe("tiered widening", () => {
  const target = obs({ role: "target" });

  it("counts only comps the backend would plausibly keep", () => {
    const comps = [
      obs({ model: "CX-5" }),
      obs({ model: "CX-9" }), // different model
      obs({ make: "Toyota" }), // different make
      obs({ year: 2004 }), // outside the widest year window
      obs({ price_cents: null }), // no price
    ];
    expect(countUsable(target, comps)).toBe(1);
  });

  it("treats spelling variants as the same model", () => {
    expect(looksUsable(target, obs({ model: "CX5" }))).toBe(true);
    expect(looksUsable(target, obs({ model: "Cx-5" }))).toBe(true);
  });

  it("keeps widening while comps are short", () => {
    const few = Array.from({ length: 8 }, () => obs({}));
    expect(shouldWiden(target, few, 3)).toBe(true);
  });

  it("stops once the usable target is met", () => {
    const many = Array.from({ length: 30 }, () => obs({}));
    expect(shouldWiden(target, many, 3)).toBe(false);
  });

  it("stops when there are no peers left", () => {
    expect(shouldWiden(target, [], 0)).toBe(false);
  });

  it("does not count raw results toward the target", () => {
    // A Porsche 924 search returns fifteen rows of which one is a 924. Counting
    // the fifteen would stop widening exactly where it is needed most.
    const wrongModel = Array.from({ length: 30 }, () => obs({ model: "911" }));
    expect(shouldWiden(target, wrongModel, 3)).toBe(true);
  });

  it("skips slugs already known not to resolve", () => {
    const peers = peersFor(findMetro("tulsa")!, 4);
    const filtered = pendingPeers(peers, [peers[0]!.slug]);
    expect(filtered.map((m) => m.slug)).not.toContain(peers[0]!.slug);
  });
});

describe("widening for trim, not just count", () => {
  const target = obs({ role: "target", trim_text: "Grand Touring" });

  it("counts a comp with the same trim word as similar", () => {
    expect(trimLooksSimilar(target, obs({ trim_text: "Grand Touring" }))).toBe(true);
    expect(trimLooksSimilar(target, obs({ trim_text: "Touring" }))).toBe(true);
  });

  it("does not count a genuinely different trim as similar", () => {
    expect(trimLooksSimilar(target, obs({ trim_text: "Sport" }))).toBe(false);
  });

  it("does not count as similar when either side has no trim at all", () => {
    expect(trimLooksSimilar(target, obs({ trim_text: null }))).toBe(false);
    expect(trimLooksSimilar(obs({ role: "target", trim_text: null }), obs({ trim_text: "Sport" }))).toBe(
      false,
    );
  });

  it("does not let a model name repeated inside the trim cause a false match", () => {
    // Some listings write the model into the trim text too ("CX-5 Touring").
    // Without stripping it, every comp of the same model would share that
    // token and register as similar regardless of their real trim.
    const repeated = obs({ role: "target", model: "CX-5", trim_text: "CX-5 Grand Touring" });
    expect(trimLooksSimilar(repeated, obs({ model: "CX-5", trim_text: "CX-5 Sport" }))).toBe(
      false,
    );
    expect(
      trimLooksSimilar(repeated, obs({ model: "CX-5", trim_text: "CX-5 Grand Touring" })),
    ).toBe(true);
  });

  it("KNOWN GAP: a model name split across model+trim can still false-match", () => {
    // Documented limitation, not a passing guarantee -- see the docstring on
    // `trimTokens`. Facebook's own structured data has put model="Grand" and
    // trim_text="Cherokee Limited..." on a real Jeep Grand Cherokee capture,
    // and this function only knows to strip what `model` actually contains,
    // so it cannot recover "Cherokee" as part of the model here. The failure
    // mode is benign: it just means less widening for this specific vehicle,
    // not an incorrect score -- this function only ever gates a search.
    const leaked = obs({ role: "target", model: "Grand", trim_text: "Cherokee Limited" });
    const differentRealTrim = obs({ model: "Grand", trim_text: "Cherokee Altitude" });
    expect(trimLooksSimilar(leaked, differentRealTrim)).toBe(true);
  });

  it("ignores body-style and drivetrain noise words", () => {
    const noisyTarget = obs({ role: "target", trim_text: "Touring Sport Utility 4D" });
    expect(trimLooksSimilar(noisyTarget, obs({ trim_text: "Touring AWD" }))).toBe(true);
  });

  it("counts trim-matched comps among the usable ones", () => {
    const comps = [
      obs({ trim_text: "Grand Touring" }),
      obs({ trim_text: "Touring" }),
      obs({ trim_text: "Sport" }),
      obs({ model: "CX-9", trim_text: "Grand Touring" }), // wrong model
    ];
    expect(countTrimMatched(target, comps)).toBe(2);
  });

  it("keeps widening on a full usable count when too few share the trim", () => {
    const comps = [
      ...Array.from({ length: 29 }, () => obs({ trim_text: "Sport" })),
      obs({ trim_text: "Grand Touring" }),
    ];
    expect(countUsable(target, comps)).toBe(30);
    expect(shouldWiden(target, comps, 3)).toBe(true);
  });

  it("stops once both the usable count and the trim count are met", () => {
    const comps = [
      ...Array.from({ length: 24 }, () => obs({ trim_text: "Sport" })),
      ...Array.from({ length: 6 }, () => obs({ trim_text: "Grand Touring" })),
    ];
    expect(countUsable(target, comps)).toBe(30);
    expect(countTrimMatched(target, comps)).toBe(6);
    expect(shouldWiden(target, comps, 3)).toBe(false);
  });

  it("does not widen for trim when the target's own trim is unknown", () => {
    // Nothing to widen FOR: there is no basis to judge whether a comp matches
    // a trim we do not know. The usable-count check still applies on its own.
    const noTrimTarget = obs({ role: "target", trim_text: null });
    const many = Array.from({ length: 30 }, () => obs({ trim_text: "Sport" }));
    expect(shouldWiden(noTrimTarget, many, 3)).toBe(false);
  });

  it("stops widening for trim once the peer list runs out, regardless of count", () => {
    const thin = [obs({ trim_text: "Sport" })];
    expect(shouldWiden(target, thin, 0)).toBe(false);
  });
});

describe("widening counts unique comps, not raw results", () => {
  const target = obs({ role: "target", source_listing_id: "t" });

  it("does not let a duplicate listing count as progress twice", () => {
    // Neighbouring metros overlap heavily: a St. Louis search and a Springfield
    // search return many of the same cars. Counting raw results made widening
    // stop two peers in, believing 32 raw results were 32 comps when only 27
    // were unique.
    const same = Array.from({ length: 30 }, () => obs({ source_listing_id: "dup" }));
    const unique = new Map(same.map((c) => [c.source_listing_id, c]));
    expect(unique.size).toBe(1);
    expect(countUsable(target, [...unique.values()])).toBe(1);
  });

  it("keeps widening when the unique count is short", () => {
    const unique = Array.from({ length: 20 }, (_, i) =>
      obs({ source_listing_id: `c${i}` }),
    );
    expect(shouldWiden(target, unique, 4)).toBe(true);
  });

  it("stops once thirty unique usable comps exist", () => {
    const unique = Array.from({ length: 30 }, (_, i) =>
      obs({ source_listing_id: `c${i}` }),
    );
    expect(shouldWiden(target, unique, 4)).toBe(false);
  });
});
