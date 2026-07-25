/**
 * VIN recovery from free text (spec 4.2).
 *
 * Opportunistic: most listings will not contain one. The check digit is
 * validated before a VIN is accepted, both to avoid transmitting typos and
 * because a 17-character run of letters and digits appears in text often
 * enough that shape alone is not evidence.
 */

/** 17 characters, I/O/Q excluded because they are not valid VIN characters. */
const VIN_CHARS = "[A-HJ-NPR-Z0-9]";
const VIN_CANDIDATE = new RegExp(`(?<![A-Z0-9])${VIN_CHARS}{17}(?![A-Z0-9])`, "gi");

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

const CHECK_DIGIT_INDEX = 8;

export function isValidVin(vin: string): boolean {
  const upper = vin.toUpperCase();
  if (upper.length !== 17) return false;
  if (/[IOQ]/.test(upper)) return false;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(upper)) return false;

  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = upper[i]!;
    const value = char >= "0" && char <= "9" ? Number(char) : TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * WEIGHTS[i]!;
  }

  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return upper[CHECK_DIGIT_INDEX] === expected;
}

/**
 * Return the first check-digit-valid VIN in the text, or null.
 *
 * A listing can mention several 17-character strings (stock numbers, order
 * references). Validating each candidate rather than taking the first match is
 * what keeps those out.
 */
export function findVin(text: string | null | undefined): string | null {
  if (!text) return null;
  const matches = text.toUpperCase().match(VIN_CANDIDATE);
  if (!matches) return null;
  for (const candidate of matches) {
    if (isValidVin(candidate)) return candidate;
  }
  return null;
}
