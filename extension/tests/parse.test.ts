import { describe, expect, it } from "vitest";

import {
  cleanLocationText,
  detectTitleStatus,
  detectTrimInText,
  epochSecondsToDate,
  listingIdFromUrl,
  parseMileage,
  parsePrice,
  parseRelativePostedDate,
  parseVehicleTitle,
} from "../src/shared/parse";

describe("parsePrice", () => {
  it.each([
    ["$12,900", 1_290_000],
    ["$9,400", 940_000],
    ["$500", 50_000],
    ["$1,299.99", 129_999],
    ["12900", 1_290_000],
    ["$0", 0],
  ])("parses %s", (input, cents) => {
    expect(parsePrice(input)?.cents).toBe(cents);
  });

  it("treats Free as zero rather than absent", () => {
    expect(parsePrice("Free")).toEqual({ cents: 0, currency: "USD" });
  });

  it("returns null when there is no price", () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("Make an offer")).toBeNull();
  });

  it("reads the currency from the symbol", () => {
    expect(parsePrice("£8,250")?.currency).toBe("GBP");
    expect(parsePrice("€8.250")?.currency).toBe("EUR");
  });
});

describe("parseMileage", () => {
  it.each([
    ["96,400 miles", 96_400, "mi"],
    ["96K miles", 96_000, "mi"],
    ["96k mi", 96_000, "mi"],
    ["1,200 miles", 1_200, "mi"],
    ["155,000 km", 155_000, "km"],
    ["Driven 88,250 miles", 88_250, "mi"],
    ["7 miles", 7, "mi"],
  ])("parses %s", (input, value, unit) => {
    expect(parseMileage(input)).toEqual({ value, unit });
  });

  it("returns null when there is no odometer reading", () => {
    expect(parseMileage("Great condition")).toBeNull();
    expect(parseMileage(null)).toBeNull();
  });

  it("rejects implausible readings rather than passing them through", () => {
    expect(parseMileage("9,999,999 miles")).toBeNull();
  });

  describe("masked low-order digits", () => {
    it.each([
      ["120xxx miles", 120_000, "mi"],
      ["120xxx mi", 120_000, "mi"],
      ["87xxx", 87_000, "mi"],
      ["134,xxx miles", 134_000, "mi"],
      ["45xx", 4_500, "mi"],
      ["Driven 120xxx miles, still runs great", 120_000, "mi"],
      ["193xxx km", 193_000, "km"],
    ])("parses %s", (input, value, unit) => {
      expect(parseMileage(input)).toEqual({ value, unit });
    });

    it("still returns null for text with no digits at all", () => {
      expect(parseMileage("xxx miles")).toBeNull();
    });
  });
});

describe("parseVehicleTitle", () => {
  it("splits year, make, model and trim", () => {
    expect(parseVehicleTitle("2014 Toyota Camry SE")).toEqual({
      year: 2014,
      make: "Toyota",
      model: "Camry",
      trim: "SE",
      // No separator in the title, so the trim is whatever the seller typed.
      trimSource: "title_text",
    });
  });

  describe("trim provenance", () => {
    it("marks the trim after Marketplace's separator as catalog data", () => {
      expect(parseVehicleTitle("2016 Mazda CX-5 · Touring Sport Utility 4D")).toMatchObject({
        model: "CX-5",
        trim: "Touring Sport Utility 4D",
        trimSource: "fb_catalog",
      });
    });

    it("marks a seller-typed trim as title text", () => {
      expect(parseVehicleTitle("2016 Mazda cx-5 grand touring awd")).toMatchObject({
        trim: "grand touring awd",
        trimSource: "title_text",
      });
    });

    // Regression: splitting ON the separator and taking the tail as the trim
    // loses the model entirely here, because Facebook repeats the make in the
    // model slot and pushes the real model past the separator. The separator is
    // read as provenance only, and the existing repeated-make handling still
    // does the parsing.
    it("keeps the model when the separator sits before it", () => {
      expect(parseVehicleTitle("2008 Mazda MAZDA · MAZDA3 2.0 Sedan 4D")).toMatchObject({
        model: "MAZDA3",
        trim: "2.0 Sedan 4D",
        trimSource: "fb_catalog",
      });
    });

    it("reports no source when no trim was found", () => {
      expect(parseVehicleTitle("2016 Audi Q3").trimSource).toBeNull();
    });
  });

  it("handles two-word makes without stealing the model", () => {
    expect(parseVehicleTitle("2016 Land Rover Range Rover Sport")).toMatchObject({
      make: "Land Rover",
      model: "Range",
    });
  });

  describe("make repeated in the model slot", () => {
    // Facebook's structured title emits "<year> <make> <make> · <model> <trim>"
    // for some manufacturers. Taken verbatim it collapses every model of that
    // make onto one key, so a Protege and a MAZDA3 become the same vehicle and
    // step 3's comp matching silently compares unrelated cars.
    it("drops the repeated make and promotes the real model", () => {
      expect(parseVehicleTitle("2002 Mazda MAZDA · Protege5 Hatchback 4D")).toMatchObject({
        year: 2002,
        make: "Mazda",
        model: "Protege5",
        trim: "Hatchback 4D",
      });
    });

    it("separates two models of the same make that previously collided", () => {
      const protege = parseVehicleTitle("2002 Mazda MAZDA · Protege5 Hatchback 4D");
      const mazda3 = parseVehicleTitle("2008 Mazda MAZDA · MAZDA3 2.0 Sedan 4D");
      expect(mazda3.model).toBe("MAZDA3");
      expect(protege.model).not.toBe(mazda3.model);
    });

    it("ignores case and punctuation when spotting the repeat", () => {
      expect(parseVehicleTitle("2015 mercedes-benz Mercedes Benz C300")).toMatchObject({
        make: "Mercedes-Benz",
        model: "C300",
      });
    });

    it("leaves a normal title untouched", () => {
      expect(parseVehicleTitle("2014 Toyota Camry SE")).toMatchObject({
        make: "Toyota",
        model: "Camry",
        trim: "SE",
      });
    });

    it("keeps the make as the model when nothing else follows it", () => {
      // "2016 Mazda Mazda" carries no real model; emptying the field would be
      // worse than echoing what the page said.
      expect(parseVehicleTitle("2016 Mazda Mazda")).toMatchObject({
        make: "Mazda",
        model: "Mazda",
        trim: null,
      });
    });
  });

  it("canonicalises abbreviated makes", () => {
    expect(parseVehicleTitle("2011 Chevy Silverado 1500").make).toBe("Chevrolet");
    expect(parseVehicleTitle("2013 VW Jetta").make).toBe("Volkswagen");
    expect(parseVehicleTitle("2015 BMW 328i").make).toBe("BMW");
  });

  it("returns nulls rather than guessing at an unknown make", () => {
    expect(parseVehicleTitle("2014 Frobnicator Deluxe")).toMatchObject({
      year: 2014,
      make: null,
      model: null,
    });
  });

  it("ignores noise before the year", () => {
    expect(parseVehicleTitle("Price drop! 2012 Honda Accord EX-L")).toMatchObject({
      year: 2012,
      make: "Honda",
      model: "Accord",
      trim: "EX-L",
    });
  });

  it("copes with a title that is only a year and make", () => {
    expect(parseVehicleTitle("2018 Subaru")).toMatchObject({
      make: "Subaru",
      model: null,
      trim: null,
    });
  });

  it("returns all nulls for an empty title", () => {
    expect(parseVehicleTitle(null)).toEqual({
      year: null,
      make: null,
      model: null,
      trim: null,
      trimSource: null,
    });
  });
});

describe("parseRelativePostedDate", () => {
  const now = new Date("2026-07-25T12:00:00Z");

  it("resolves weeks", () => {
    const result = parseRelativePostedDate("Listed 3 weeks ago", now);
    expect(result?.postedAt?.toISOString()).toBe("2026-07-04T12:00:00.000Z");
  });

  it("resolves a bare 'an hour ago'", () => {
    const result = parseRelativePostedDate("an hour ago", now);
    expect(result?.postedAt?.toISOString()).toBe("2026-07-25T11:00:00.000Z");
  });

  it("treats 'Just listed' as now", () => {
    expect(parseRelativePostedDate("Just listed", now)?.postedAt?.toISOString()).toBe(
      now.toISOString(),
    );
  });

  it("keeps the original phrasing so the approximation stays visible", () => {
    expect(parseRelativePostedDate("Listed 3 weeks ago", now)?.relativeText).toBe(
      "Listed 3 weeks ago",
    );
  });

  it("returns null when there is no relative phrase", () => {
    expect(parseRelativePostedDate("Tulsa, OK", now)).toBeNull();
  });
});

describe("epochSecondsToDate", () => {
  it("reads seconds, not milliseconds", () => {
    expect(epochSecondsToDate(1_752_000_000)?.getUTCFullYear()).toBe(2025);
  });

  it("rejects nonsense", () => {
    expect(epochSecondsToDate(0)).toBeNull();
    expect(epochSecondsToDate(null)).toBeNull();
    expect(epochSecondsToDate("nope")).toBeNull();
  });
});

describe("detectTitleStatus", () => {
  it.each([
    ["Clean title in hand", "clean"],
    ["Salvage title, runs fine", "salvage"],
    ["Rebuilt title", "rebuilt"],
    ["No title, bill of sale only", "no_title"],
    ["Selling for parts only", "parts_only"],
    ["Flood damage, branded title", "branded"],
  ])("reads %s", (text, status) => {
    expect(detectTitleStatus(text)).toBe(status);
  });

  it("reports the worst status stated anywhere", () => {
    expect(detectTitleStatus("Clean title", "actually salvage")).toBe("salvage");
  });

  it("returns null when the title is not mentioned", () => {
    expect(detectTitleStatus("Runs great, cold AC")).toBeNull();
  });
});

describe("detectTrimInText", () => {
  it("finds a real trim mentioned only in the description", () => {
    // The motivating case: a 2016 Mazda CX-5 whose structured field and title
    // both carried no trim, but the seller wrote it into the description.
    const description =
      "2016 Mazda CX-5 Grand Touring, one owner, clean carfax, fully loaded " +
      "with navigation, leather, and moonroof. 40 miles on a fresh rebuild.";
    expect(detectTrimInText(description)).toBe("Grand Touring");
  });

  it("prefers the longer phrase over the trim name nested inside it", () => {
    expect(detectTrimInText("Loaded Touring trim")).toBe("Touring");
    expect(detectTrimInText("Grand Touring package, low miles")).toBe("Grand Touring");
  });

  it.each([
    ["Jeep Grand Cherokee Overland, fully loaded", "Overland"],
    ["Laredo edition, cold AC, runs great", "Laredo"],
    ["GMC Denali, heated everything", "Denali"],
    ["Ford Lariat, king cab", "Lariat"],
  ])("reads %s", (text, trim) => {
    expect(detectTrimInText(text)).toBe(trim);
  });

  it("is case-insensitive and normalises casing on output", () => {
    expect(detectTrimInText("touring model, well maintained")).toBe("Touring");
    expect(detectTrimInText("TOURING MODEL")).toBe("Touring");
  });

  it("does not match short trim codes at all, by design", () => {
    // SE/LE/EX/LX/LT and similar are the majority of real trim names, and are
    // excluded on purpose: as bare words in marketing-copy prose they produce
    // far more false positives than genuine catches. See the module docstring
    // on `DESCRIPTION_TRIM_PHRASES` for the reasoning.
    expect(detectTrimInText("Runs great, LE me know if you have questions")).toBeNull();
    expect(detectTrimInText("Clean SE Missouri title")).toBeNull();
  });

  it("returns null on ordinary prose with no trim mentioned", () => {
    expect(
      detectTrimInText("Runs and drives great, new tires, no accidents, clean title."),
    ).toBeNull();
  });

  it("returns null for empty or missing text", () => {
    expect(detectTrimInText(null)).toBeNull();
    expect(detectTrimInText(undefined)).toBeNull();
    expect(detectTrimInText("")).toBeNull();
  });
});

describe("listingIdFromUrl", () => {
  it("reads the id out of the route", () => {
    expect(listingIdFromUrl("https://www.facebook.com/marketplace/item/123456789/")).toBe(
      "123456789",
    );
  });

  it("survives query parameters", () => {
    expect(listingIdFromUrl("/marketplace/item/987/?ref=search&referral_code=x")).toBe("987");
  });

  it("returns null off a listing route", () => {
    expect(listingIdFromUrl("https://www.facebook.com/marketplace/search/?query=camry")).toBeNull();
  });
});

describe("cleanLocationText", () => {
  it("strips the leading listed-ago clause", () => {
    expect(cleanLocationText("Listed 3 weeks ago in Tulsa, OK")).toBe("Tulsa, OK");
  });

  it("leaves a bare place alone", () => {
    expect(cleanLocationText("St. Louis, MO")).toBe("St. Louis, MO");
  });
});

describe("parseVehicleTitle with the year written last", () => {
  // Captured data: "Porsche 911 Carrera Cabriolet 1984" lost its make and model
  // entirely, because everything after the year was an empty string.
  it("recovers make and model when the year trails", () => {
    expect(parseVehicleTitle("Porsche 911 Carrera Cabriolet 1984")).toMatchObject({
      year: 1984,
      make: "Porsche",
      model: "911",
      trim: "Carrera Cabriolet",
    });
  });

  it("still prefers the text after the year in the normal case", () => {
    expect(parseVehicleTitle("2014 Toyota Camry SE")).toMatchObject({
      make: "Toyota",
      model: "Camry",
      trim: "SE",
    });
  });

  it("ignores leading noise rather than treating it as a make", () => {
    expect(parseVehicleTitle("Price drop 2014 Toyota Camry SE")).toMatchObject({
      make: "Toyota",
      model: "Camry",
    });
  });

  it("handles a two-word make before a trailing year", () => {
    expect(parseVehicleTitle("Mercedes-Benz C300 Sport 2015")).toMatchObject({
      year: 2015,
      make: "Mercedes-Benz",
      model: "C300",
    });
  });

  it("parses a title with no year at all", () => {
    // Captured data: "Porsche 924", no year stated anywhere.
    expect(parseVehicleTitle("Porsche 924")).toMatchObject({
      year: null,
      make: "Porsche",
      model: "924",
    });
  });
});

describe("classic and discontinued marques", () => {
  // A captured "1977 Triumph spitfire" produced a null make, which meant no
  // comp search ran at all: buildCompSearch requires make AND model, so an
  // unrecognised marque does not thin the comp set, it eliminates it.
  it.each([
    ["1977 Triumph Spitfire", "Triumph", "Spitfire"],
    ["1972 Datsun 240Z", "Datsun", "240Z"],
    ["1968 MG MGB", "MG", "MGB"],
    ["1981 DeLorean DMC-12", "DeLorean", "DMC-12"],
    ["1970 AMC Javelin", "AMC", "Javelin"],
    ["1985 Yugo GV", "Yugo", "GV"],
  ])("parses %s", (title, make, model) => {
    expect(parseVehicleTitle(title)).toMatchObject({ make, model });
  });

  it("still refuses to guess at a genuinely unknown make", () => {
    expect(parseVehicleTitle("2014 Frobnicator Deluxe").make).toBeNull();
  });
});
