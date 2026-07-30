/**
 * Tiered comp widening, and the trim comparison that drives it.
 *
 * Split out of `metros.test.ts`, which is about the metro table. These cover
 * `src/comps/widen.ts` and `src/comps/trim-level.ts`, which had no test file of
 * their own -- and that is part of why the trim check could over-count by 3.76x
 * unnoticed for as long as it did.
 *
 * SEVERAL ASSERTIONS HERE WERE INVERTED FROM WHAT THEY USED TO SAY, and each one
 * is marked. The old versions asserted token OVERLAP, which called "Touring" a
 * match for "Grand Touring" -- a difference the backend puts at thousands of
 * dollars and documents as the reason it does not use overlap
 * (`pricing/comps.trims_agree`). They were faithful tests of the wrong rule.
 */

import { describe, expect, it } from "vitest";

import { findMetro, peersFor } from "../src/comps/metros";
import {
  TRIM_MATCH_TARGET,
  USABLE_COMP_TARGET,
  countTrimMatched,
  countUsable,
  looksUsable,
  pendingPeers,
  shouldWiden,
  trimLooksSimilar,
} from "../src/comps/widen";
import { trimLevelQueryTerm, trimLevelTokens } from "../src/comps/trim-level";
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
    const many = Array.from({ length: USABLE_COMP_TARGET }, () => obs({}));
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

describe("reducing a trim string to its trim level", () => {
  it("strips body style, drivetrain and door count", () => {
    expect([...trimLevelTokens("Touring Sport Utility 4D", "CX-5")]).toEqual(["touring"]);
    expect([...trimLevelTokens("EX-L FWD", "Accord")].sort()).toEqual(["ex", "l"]);
  });

  it("keeps a body-style word that is really the trim name", () => {
    // "Sport Sedan 4D" is a Sport. Removing phrases rather than loose tokens is
    // what makes this work: stripping a bare "sport" token (from the phrase
    // "sport utility") would delete the trim itself.
    expect([...trimLevelTokens("Sport Sedan 4D", "Civic")]).toEqual(["sport"]);
    expect([...trimLevelTokens("Sport Utility 4D", "CX-5")]).toEqual([]);
  });

  it("treats a trim that is only a body style as no trim at all", () => {
    // 11% of stored targets look like this. The backend records trim_level NULL
    // for them; the old client read "Coupe 2D" as the trim token {coupe} and
    // matched it against every coupe in the comp set -- 32 of 36 on one capture
    // where the backend matched 0.
    for (const text of ["Sedan 4D", "Coupe 2D", "Convertible", "Roadster 2D", "Hatchback 4D"]) {
      expect([...trimLevelTokens(text, "Civic")]).toEqual([]);
    }
  });

  it("drops the engine designator so one trim reads as one trim", () => {
    // Two sellers, one trim: 28 such pairs on a single model in stored data.
    expect(trimLevelTokens("2.0i Premium Sport Utility 4D", "Forester")).toEqual(
      trimLevelTokens("Premium Sport Utility 4D", "Forester"),
    );
  });

  it("strips the model name when a listing repeats it inside the trim", () => {
    expect([...trimLevelTokens("CX-5 Grand Touring", "CX-5")].sort()).toEqual([
      "grand",
      "touring",
    ]);
  });

  it("strips option packages and mileage claims", () => {
    expect(trimLevelTokens("EX-L w/Honda Sensing", "Accord")).toEqual(
      trimLevelTokens("EX-L", "Accord"),
    );
    expect([...trimLevelTokens("Touring 174160 Miles", "CX-5")]).toEqual(["touring"]);
  });

  it("names the trim for a search query in the order the seller wrote it", () => {
    expect(trimLevelQueryTerm("Grand Touring Sport Utility 4D", "CX-5")).toBe("grand touring");
    expect(trimLevelQueryTerm("2.0i Premium Sport Utility 4D", "Forester")).toBe("premium");
    expect(trimLevelQueryTerm("Sedan 4D", "Civic")).toBeNull();
    expect(trimLevelQueryTerm(null, "Civic")).toBeNull();
  });
});

describe("whether a comp is the same trim as the target", () => {
  const target = obs({ role: "target", trim_text: "Grand Touring" });

  it("matches an identical trim", () => {
    expect(trimLooksSimilar(target, obs({ trim_text: "Grand Touring" }))).toBe(true);
  });

  it("CHANGED: does not match a trim that merely shares a word", () => {
    // This asserted `true` under token overlap. Set equality is the point:
    // `pricing/comps.trims_agree` records that "overlap was tried and is wrong:
    // it reports 'Grand Touring' as matching 'Touring', and the difference
    // between those two is thousands of dollars".
    expect(trimLooksSimilar(target, obs({ trim_text: "Touring" }))).toBe(false);
  });

  it("does not match a genuinely different trim", () => {
    expect(trimLooksSimilar(target, obs({ trim_text: "Sport" }))).toBe(false);
  });

  it("does not match when either side has no trim at all", () => {
    expect(trimLooksSimilar(target, obs({ trim_text: null }))).toBe(false);
    expect(
      trimLooksSimilar(obs({ role: "target", trim_text: null }), obs({ trim_text: "Sport" })),
    ).toBe(false);
  });

  it("does not match two trims that are both only a body style", () => {
    // Two unknowns are not an agreement. Without this guard every sedan in the
    // comp set would match every other sedan and the trim target would be met
    // instantly on exactly the listings that state no trim.
    const bodyOnly = obs({ role: "target", trim_text: "Sedan 4D" });
    expect(trimLooksSimilar(bodyOnly, obs({ trim_text: "Sedan 4D" }))).toBe(false);
  });

  it("ignores body-style and drivetrain noise on either side", () => {
    const noisy = obs({ role: "target", trim_text: "Touring Sport Utility 4D" });
    expect(trimLooksSimilar(noisy, obs({ trim_text: "Touring AWD" }))).toBe(true);
  });

  it("is order-insensitive, as the backend's comparison is", () => {
    const carbon = obs({ role: "target", trim_text: "S Carbon Edition" });
    expect(trimLooksSimilar(carbon, obs({ trim_text: "Carbon Edition S" }))).toBe(true);
  });

  it("does not let a model name repeated inside the trim cause a false match", () => {
    const repeated = obs({ role: "target", model: "CX-5", trim_text: "CX-5 Grand Touring" });
    expect(trimLooksSimilar(repeated, obs({ model: "CX-5", trim_text: "CX-5 Sport" }))).toBe(
      false,
    );
    expect(
      trimLooksSimilar(repeated, obs({ model: "CX-5", trim_text: "CX-5 Grand Touring" })),
    ).toBe(true);
  });

  it("CHANGED: a model name split across model+trim no longer false-matches", () => {
    // Was documented as a KNOWN GAP asserting `true`. Facebook has put
    // model="Grand" with trim_text="Cherokee Limited..." on a real Jeep Grand
    // Cherokee capture, and the leaked "cherokee" made overlap fire on any
    // other Cherokee trim. Set equality closes it for free: the leaked token
    // appears on both sides, so it cancels, and the real trims still differ.
    const leaked = obs({ role: "target", model: "Grand", trim_text: "Cherokee Limited" });
    expect(trimLooksSimilar(leaked, obs({ model: "Grand", trim_text: "Cherokee Altitude" }))).toBe(
      false,
    );
    expect(trimLooksSimilar(leaked, obs({ model: "Grand", trim_text: "Cherokee Limited" }))).toBe(
      true,
    );
  });

  it("CHANGED: counts only genuine trim matches among the usable comps", () => {
    // Was 2 under overlap, which counted "Touring" as a "Grand Touring".
    const comps = [
      obs({ trim_text: "Grand Touring" }),
      obs({ trim_text: "Touring" }),
      obs({ trim_text: "Sport" }),
      obs({ model: "CX-9", trim_text: "Grand Touring" }), // wrong model
    ];
    expect(countTrimMatched(target, comps)).toBe(1);
  });
});

describe("widening for trim, not just count", () => {
  const target = obs({ role: "target", trim_text: "Grand Touring" });

  it("keeps widening on a full usable count when too few share the trim", () => {
    const comps = [
      ...Array.from({ length: USABLE_COMP_TARGET - 1 }, () => obs({ trim_text: "Sport" })),
      obs({ trim_text: "Grand Touring" }),
    ];
    expect(countUsable(target, comps)).toBe(USABLE_COMP_TARGET);
    expect(shouldWiden(target, comps, 3)).toBe(true);
  });

  it("stops once both the usable count and the trim count are met", () => {
    const comps = [
      ...Array.from({ length: USABLE_COMP_TARGET - TRIM_MATCH_TARGET }, () =>
        obs({ trim_text: "Sport" }),
      ),
      ...Array.from({ length: TRIM_MATCH_TARGET }, () => obs({ trim_text: "Grand Touring" })),
    ];
    expect(countUsable(target, comps)).toBe(USABLE_COMP_TARGET);
    expect(countTrimMatched(target, comps)).toBe(TRIM_MATCH_TARGET);
    expect(shouldWiden(target, comps, 3)).toBe(false);
  });

  it("does not widen for trim when the target's own trim is unknown", () => {
    const noTrim = obs({ role: "target", trim_text: null });
    const many = Array.from({ length: USABLE_COMP_TARGET }, () => obs({ trim_text: "Sport" }));
    expect(shouldWiden(noTrim, many, 3)).toBe(false);
  });

  it("does not widen for trim when the target's trim is only a body style", () => {
    // The regression this guard exists for. `trim_text` is populated, so a check
    // on the raw string would let widening run -- but `countTrimMatched` can
    // never rise, so it would spend the entire peer budget chasing a trim the
    // listing never stated. 11% of stored targets look like this.
    const bodyOnly = obs({ role: "target", trim_text: "Sport Utility 4D" });
    const many = Array.from({ length: USABLE_COMP_TARGET }, () => obs({ trim_text: "Sport" }));
    expect(countTrimMatched(bodyOnly, many)).toBe(0);
    expect(shouldWiden(bodyOnly, many, 8)).toBe(false);
  });

  it("stops widening for trim once the peer list runs out, regardless of count", () => {
    expect(shouldWiden(target, [obs({ trim_text: "Sport" })], 0)).toBe(false);
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
    const unique = Array.from({ length: 20 }, (_, i) => obs({ source_listing_id: `c${i}` }));
    expect(shouldWiden(target, unique, 4)).toBe(true);
  });

  it("stops once thirty unique usable comps exist", () => {
    const unique = Array.from({ length: USABLE_COMP_TARGET }, (_, i) =>
      obs({ source_listing_id: `c${i}` }),
    );
    expect(shouldWiden(target, unique, 4)).toBe(false);
  });
});
