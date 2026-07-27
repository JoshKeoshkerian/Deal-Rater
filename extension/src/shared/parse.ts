/**
 * Text normalisers shared by every extraction tier.
 *
 * These are pure functions over strings, deliberately: they are the part of
 * the scraper that can be tested exhaustively without a page, and the part
 * least likely to need changing when Facebook rearranges its markup.
 */

import type { MileageUnit } from "./types";

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 2;

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function textOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = collapseWhitespace(value);
  return collapsed === "" ? null : collapsed;
}

/* -------------------------------------------------------------------------- */
/* price                                                                       */
/* -------------------------------------------------------------------------- */

export interface ParsedPrice {
  cents: number;
  currency: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
};

/**
 * Parse a displayed price into cents.
 *
 * "Free" is a real Marketplace price and means zero, which is not the same as
 * an absent price, so the two are kept distinct.
 */
export function parsePrice(raw: string | null | undefined): ParsedPrice | null {
  if (!raw) return null;
  const text = collapseWhitespace(raw);

  if (/^free$/i.test(text)) return { cents: 0, currency: "USD" };

  const match = text.match(/([$£€])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/);
  if (!match) return null;

  const whole = Number(match[2]!.replace(/,/g, ""));
  if (!Number.isFinite(whole)) return null;

  const fraction = match[3] ? Number(match[3]) : 0;
  const symbol = match[1];
  const currency = (symbol && CURRENCY_SYMBOLS[symbol]) || "USD";

  return { cents: whole * 100 + fraction, currency };
}

/** Cents from an amount already typed as a number or numeric string. */
export function amountToCents(amount: unknown): number | null {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/* -------------------------------------------------------------------------- */
/* mileage                                                                     */
/* -------------------------------------------------------------------------- */

export interface ParsedMileage {
  value: number;
  unit: MileageUnit;
}

const MAX_PLAUSIBLE_MILEAGE = 1_500_000;

/**
 * Parse an odometer reading.
 *
 * Handles the two forms Marketplace actually renders: the full number on a
 * listing page ("96,400 miles") and the abbreviated form on search cards
 * ("96K miles").
 */
export function parseMileage(raw: string | null | undefined): ParsedMileage | null {
  if (!raw) return null;
  const text = collapseWhitespace(raw);

  const match = text.match(
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b)?\s*(miles|mile|mi\b|km\b|kilometers|kilometres)/i,
  );
  if (!match) return null;

  let value = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  if (match[2]) value *= 1000;

  value = Math.round(value);
  if (value < 0 || value > MAX_PLAUSIBLE_MILEAGE) return null;

  const unit: MileageUnit = /km|kilometer|kilometre/i.test(match[3]!) ? "km" : "mi";
  return { value, unit };
}

/** Odometer already typed as a number, e.g. from an embedded JSON payload. */
export function normaliseMileageValue(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value.replace(/,/g, "")) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > MAX_PLAUSIBLE_MILEAGE) return null;
  return rounded;
}

/* -------------------------------------------------------------------------- */
/* vehicle title                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Multi-word makes must be matched before single-word ones, otherwise "Land
 * Rover Range Rover" parses as make "Land" and the model is wrong.
 */
const MULTI_WORD_MAKES = [
  "alfa romeo",
  "aston martin",
  "land rover",
  "range rover",
  "mercedes benz",
  "mercedes-benz",
  "rolls royce",
  "rolls-royce",
];

const MAKES = [
  "acura", "audi", "bmw", "buick", "cadillac", "chevrolet", "chevy", "chrysler",
  "dodge", "ferrari", "fiat", "ford", "genesis", "gmc", "honda", "hummer",
  "hyundai", "infiniti", "isuzu", "jaguar", "jeep", "kia", "lamborghini",
  "lexus", "lincoln", "lucid", "maserati", "mazda", "mclaren", "mercedes",
  "mercury", "mini", "mitsubishi", "nissan", "oldsmobile", "peugeot", "plymouth",
  "polestar", "pontiac", "porsche", "ram", "renault", "rivian", "saab",
  "saturn", "scion", "smart", "subaru", "suzuki", "tesla", "toyota",
  "volkswagen", "volvo", "vw",
];

/** Longest make in MULTI_WORD_MAKES, in whitespace-separated tokens. */
const MAX_MAKE_TOKENS = 2;

/** Display spelling for makes commonly written as an abbreviation. */
const MAKE_CANONICAL: Record<string, string> = {
  chevy: "Chevrolet",
  vw: "Volkswagen",
  mercedes: "Mercedes-Benz",
  "mercedes benz": "Mercedes-Benz",
  "mercedes-benz": "Mercedes-Benz",
  "rolls royce": "Rolls-Royce",
  "rolls-royce": "Rolls-Royce",
  bmw: "BMW",
  gmc: "GMC",
  ram: "RAM",
  kia: "Kia",
};

export interface ParsedVehicleTitle {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function canonicalMake(raw: string): string {
  return MAKE_CANONICAL[raw.toLowerCase()] ?? titleCase(raw);
}

/** Whether a fragment begins with a make this parser recognises. */
function startsWithKnownMake(fragment: string): boolean {
  const lower = fragment.toLowerCase();
  if (!lower) return false;
  if (MULTI_WORD_MAKES.some((m) => lower === m || lower.startsWith(`${m} `))) return true;
  return MAKES.includes(lower.split(" ")[0] ?? "");
}

/**
 * Split a listing title into year / make / model / trim.
 *
 * Marketplace vehicle titles are overwhelmingly "<year> <make> <model> <trim>",
 * so this handles the common case well and returns nulls rather than guesses
 * when it does not fit. A wrong trim is worse than an absent one: it would
 * silently narrow the comp set in step 3.
 */
export function parseVehicleTitle(raw: string | null | undefined): ParsedVehicleTitle {
  const empty: ParsedVehicleTitle = { year: null, make: null, model: null, trim: null };
  if (!raw) return empty;

  const text = collapseWhitespace(raw);
  const yearMatch = text.match(/\b(1[89]\d{2}|20\d{2})\b/);
  const year =
    yearMatch && Number(yearMatch[1]) >= MIN_YEAR && Number(yearMatch[1]) <= MAX_YEAR
      ? Number(yearMatch[1])
      : null;

  // Usually the year leads and the vehicle follows it, with any noise ("Sold",
  // "Price drop") in front. But sellers also write the year LAST --
  // "Porsche 911 Carrera Cabriolet 1984" occurs in captured data -- and slicing
  // after the year there leaves an empty string, losing make and model
  // entirely. So try the text after the year, and fall back to the text before
  // it when that yields nothing to parse.
  const tidy = (value: string) => collapseWhitespace(value.replace(/[·|,]/g, " "));

  let cleaned: string;
  if (yearMatch) {
    const after = tidy(text.slice(yearMatch.index! + yearMatch[0].length));
    const before = tidy(text.slice(0, yearMatch.index!));
    cleaned = startsWithKnownMake(after) || !startsWithKnownMake(before) ? after : before;
  } else {
    cleaned = tidy(text);
  }
  const lower = cleaned.toLowerCase();

  let make: string | null = null;
  let remainder = "";

  for (const candidate of MULTI_WORD_MAKES) {
    if (lower.startsWith(`${candidate} `) || lower === candidate) {
      make = canonicalMake(candidate);
      remainder = cleaned.slice(candidate.length).trim();
      break;
    }
  }

  if (make === null) {
    const firstWord = cleaned.split(" ")[0] ?? "";
    if (MAKES.includes(firstWord.toLowerCase())) {
      make = canonicalMake(firstWord);
      remainder = cleaned.slice(firstWord.length).trim();
    }
  }

  if (make === null) return { year, make: null, model: null, trim: null };

  const parts = remainder.split(" ").filter(Boolean);

  // Facebook's structured title repeats the make in the model slot for some
  // manufacturers: "2002 Mazda MAZDA · Protege5 Hatchback 4D" and
  // "2008 Mazda MAZDA · MAZDA3 2.0 Sedan 4D". Taking parts[0] verbatim yields
  // model "MAZDA" with the real model buried in the trim, which collapses every
  // one of that make's models onto a single key and silently destroys comp
  // matching in step 3 — a Protege and a MAZDA3 become the same vehicle.
  //
  // Only an exact repeat of the make just matched is dropped, and only when
  // something still follows it. That is narrow on purpose: "Ford Ford" is the
  // bug, whereas a model legitimately containing its make ("Mazda MX-5" as
  // written by a seller) still keeps a real model token either way.
  //
  // The repeat can span several tokens, because a two-word make may be written
  // one way then the other: "mercedes-benz Mercedes Benz C300". Longest run
  // first, so "Mercedes Benz" is consumed as a unit rather than leaving "Benz"
  // behind as the model.
  const maxRepeatTokens = Math.min(MAX_MAKE_TOKENS, parts.length - 1);
  for (let n = maxRepeatTokens; n >= 1; n--) {
    if (makeToken(parts.slice(0, n).join("")) === makeToken(make)) {
      parts.splice(0, n);
      break;
    }
  }

  const model = parts.length > 0 ? titleCase(parts[0]!) : null;
  const trim = parts.length > 1 ? parts.slice(1).join(" ") : null;

  return { year, make, model, trim };
}

/**
 * Compare a make token to a canonical make ignoring case, spacing and
 * punctuation, so "MAZDA"/"Mazda" and "Mercedes-Benz"/"mercedes benz" match.
 */
function makeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Normalised model key for comp matching.
 *
 * "CX-5", "Cx-5" and "CX5" are the same vehicle written three ways, and all
 * three occur in captured data. Exported so step 3 groups on the same key the
 * relisting hash already uses server-side.
 */
export function normalizeModel(value: string | null | undefined): string {
  return value ? makeToken(value) : "";
}

/* -------------------------------------------------------------------------- */
/* posted date                                                                 */
/* -------------------------------------------------------------------------- */

const RELATIVE_UNITS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export interface ParsedPostedDate {
  postedAt: Date | null;
  relativeText: string;
}

/**
 * Convert "Listed 3 weeks ago" into an approximate absolute timestamp.
 *
 * Both values are kept. The derived timestamp is what days-on-market will be
 * computed from in step 4; the raw text is retained because rounding "3 weeks"
 * to a timestamp loses the fact that it was ever approximate, and the interval
 * width in step 3 depends on knowing that.
 */
export function parseRelativePostedDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): ParsedPostedDate | null {
  if (!raw) return null;
  const text = collapseWhitespace(raw);

  if (/just listed|listed (just )?now|a few seconds ago/i.test(text)) {
    return { postedAt: new Date(now.getTime()), relativeText: text.slice(0, 64) };
  }

  const match = text.match(/(?:about\s+)?(an?|\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
  if (!match) return null;

  const rawCount = match[1]!.toLowerCase();
  const count = rawCount === "a" || rawCount === "an" ? 1 : Number(rawCount);
  if (!Number.isFinite(count)) return null;

  const unitMs = RELATIVE_UNITS[match[2]!.toLowerCase()];
  if (unitMs === undefined) return null;

  return {
    postedAt: new Date(now.getTime() - count * unitMs),
    relativeText: text.slice(0, 64),
  };
}

/** Facebook payload timestamps are seconds since epoch, not milliseconds. */
export function epochSecondsToDate(value: unknown): Date | null {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* -------------------------------------------------------------------------- */
/* title status                                                                */
/* -------------------------------------------------------------------------- */

/** Ordered by severity: the worst status stated anywhere in the text wins. */
const TITLE_STATUS_PATTERNS: Array<[string, RegExp]> = [
  ["parts_only", /\b(for parts|parts only|parts car|not running|non[- ]?running)\b/i],
  ["no_title", /\b(no title|lost title|bill of sale only|bos only)\b/i],
  ["salvage", /\bsalvage\b/i],
  ["rebuilt", /\b(rebuilt|reconstructed|prior salvage)\b/i],
  ["branded", /\b(branded title|flood|lemon|hail damage title)\b/i],
  ["clean", /\b(clean title|clear title|title in hand)\b/i],
];

export function detectTitleStatus(...texts: Array<string | null | undefined>): string | null {
  const haystack = texts.filter(Boolean).join(" \n ");
  if (!haystack) return null;
  for (const [status, pattern] of TITLE_STATUS_PATTERNS) {
    if (pattern.test(haystack)) return status;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* location                                                                    */
/* -------------------------------------------------------------------------- */

/** Strip the "Listed 3 weeks ago in " prefix Marketplace puts before a place. */
export function cleanLocationText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = collapseWhitespace(raw).replace(/^.*?\bin\s+/i, "");
  return textOrNull(text)?.slice(0, 255) ?? null;
}

/* -------------------------------------------------------------------------- */
/* listing id                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pull the listing id out of a Marketplace URL.
 *
 * The URL shape is the single most stable anchor on the whole page: it is
 * routing, not presentation, so it survives the markup rewrites that break
 * everything else.
 */
export function listingIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/marketplace\/item\/(\d+)/);
  return match ? match[1]! : null;
}
