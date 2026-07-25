import { describe, expect, it } from "vitest";

import { findVin, isValidVin } from "../src/shared/vin";

// Real-format VINs with correct check digits.
const VALID = ["1HGCM82633A004352", "JH4TB2H26CC000000", "5YJ3E1EA2JF000316"];

describe("isValidVin", () => {
  it.each(VALID)("accepts %s", (vin) => {
    expect(isValidVin(vin)).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidVin("1HGCM82633A004353")).toBe(false);
  });

  it.each(["I", "O", "Q"])("rejects a VIN containing %s", (char) => {
    expect(isValidVin(`1HGCM8263${char}A004352`)).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidVin("1HGCM82633A00435")).toBe(false);
    expect(isValidVin("1HGCM82633A0043521")).toBe(false);
  });
});

describe("findVin", () => {
  it("recovers a VIN from a description", () => {
    expect(findVin("Clean title. VIN 1HGCM82633A004352, records available.")).toBe(
      "1HGCM82633A004352",
    );
  });

  it("is case insensitive", () => {
    expect(findVin("vin: 1hgcm82633a004352")).toBe("1HGCM82633A004352");
  });

  it("skips 17-character strings that are not VINs", () => {
    // A stock number of the right shape, then a real VIN.
    const text = "Stock ABCDEFGHJKLMNPRST then VIN 1HGCM82633A004352";
    expect(findVin(text)).toBe("1HGCM82633A004352");
  });

  it("returns null when the only candidate fails its check digit", () => {
    expect(findVin("VIN 1HGCM82633A004353")).toBeNull();
  });

  it("returns null on text with no VIN, which is the common case", () => {
    expect(findVin("Runs great, cold AC, 96k miles")).toBeNull();
    expect(findVin(null)).toBeNull();
  });

  it("does not match a longer alphanumeric run", () => {
    expect(findVin("X1HGCM82633A004352X")).toBeNull();
  });
});
