/**
 * US metro market groupings for comp widening.
 *
 * Facebook's search radius is fixed at 40 miles and cannot be set per request,
 * so reaching a wider market means searching neighbouring metros separately.
 * This decides WHICH metros are reasonable neighbours for a given one.
 *
 * PEERS ARE COMPUTED, NOT LISTED
 * ------------------------------
 * Fifty metros hand-paired would be 2,450 relationships to write and maintain,
 * and every one an opportunity for a quiet mistake. Instead each metro carries
 * three attributes and peers are derived from them, so the ruleset is auditable
 * in one place and a correction to one metro propagates everywhere.
 *
 * WHAT MAKES TWO MARKETS COMPARABLE
 * ---------------------------------
 * Distance alone is not enough, and the two extra axes are not cosmetic:
 *
 *   rust     Road-salt exposure. A $9,000 car in Buffalo and a $9,000 car in
 *            Phoenix are materially different metal at the same asking price,
 *            and nothing in the pricing model can see condition. Pairing across
 *            this axis would systematically misprice one side.
 *
 *   tier     Price level. Coastal metros carry a persistent premium on the same
 *            vehicle. Comparing a New York listing against St. Louis inventory
 *            would make every New York car look overpriced and every St. Louis
 *            car look like a steal -- the same distortion spec 1 warns about
 *            for dealer-vs-private comps, arrived at geographically.
 *
 * Adjacent categories on each axis are allowed to pair; opposite ends are not.
 * That keeps Chicago and Milwaukee together, and keeps Chicago and Miami apart.
 *
 * SLUGS ARE UNVERIFIED, AND THAT IS HANDLED
 * -----------------------------------------
 * Marketplace identifies a location by a vanity slug or a 15-digit place id.
 * Only two slugs are confirmed from captured data: `chicago` (which returned
 * Alsip, Naperville, Gurnee and Hammond) and `tulsa`. Every other slug below is
 * inferred from the pattern those two follow.
 *
 * An unresolvable location does NOT error -- Facebook silently returns the
 * account's own metro, which is indistinguishable from a market with nothing in
 * it. That has already cost one capture. So slugs here are treated as
 * hypotheses: `verifyMetroResults` checks whether a search actually returned
 * listings from the state it should have, and the caller records failures so a
 * bad slug is used once and then dropped rather than silently forever.
 */

export type RustExposure = "salt" | "mixed" | "sun";
export type PriceTier = "high" | "moderate" | "low";

export interface Metro {
  /** Marketplace location slug. UNVERIFIED except chicago and tulsa. */
  slug: string;
  name: string;
  /** Postal codes a search here should plausibly return, for verification. */
  states: string[];
  lat: number;
  lon: number;
  rust: RustExposure;
  tier: PriceTier;
}

/**
 * The ~50 largest US metros by population.
 *
 * Coordinates are metro centroids, accurate to a few miles, which is far below
 * the resolution any of this needs -- they only order peers by distance.
 */
export const METROS: readonly Metro[] = [
  // --- Northeast: salt, high ------------------------------------------------
  { slug: "nyc", name: "New York", states: ["NY", "NJ", "CT", "PA"], lat: 40.71, lon: -74.01, rust: "salt", tier: "high" },
  { slug: "boston", name: "Boston", states: ["MA", "NH", "RI"], lat: 42.36, lon: -71.06, rust: "salt", tier: "high" },
  { slug: "philadelphia", name: "Philadelphia", states: ["PA", "NJ", "DE"], lat: 39.95, lon: -75.17, rust: "salt", tier: "moderate" },
  { slug: "pittsburgh", name: "Pittsburgh", states: ["PA", "WV", "OH"], lat: 40.44, lon: -79.996, rust: "salt", tier: "low" },
  { slug: "hartford", name: "Hartford", states: ["CT", "MA"], lat: 41.76, lon: -72.69, rust: "salt", tier: "moderate" },
  { slug: "buffalo", name: "Buffalo", states: ["NY"], lat: 42.89, lon: -78.88, rust: "salt", tier: "low" },
  { slug: "rochester", name: "Rochester", states: ["NY"], lat: 43.16, lon: -77.61, rust: "salt", tier: "low" },
  { slug: "providence", name: "Providence", states: ["RI", "MA"], lat: 41.82, lon: -71.41, rust: "salt", tier: "moderate" },

  // --- Great Lakes / Upper Midwest: salt, low-moderate ----------------------
  { slug: "chicago", name: "Chicago", states: ["IL", "IN", "WI"], lat: 41.88, lon: -87.63, rust: "salt", tier: "moderate" },
  { slug: "detroit", name: "Detroit", states: ["MI", "OH"], lat: 42.33, lon: -83.05, rust: "salt", tier: "low" },
  { slug: "milwaukee", name: "Milwaukee", states: ["WI"], lat: 43.04, lon: -87.91, rust: "salt", tier: "low" },
  { slug: "minneapolis", name: "Minneapolis", states: ["MN", "WI"], lat: 44.98, lon: -93.27, rust: "salt", tier: "moderate" },
  { slug: "cleveland", name: "Cleveland", states: ["OH"], lat: 41.50, lon: -81.69, rust: "salt", tier: "low" },
  { slug: "columbus", name: "Columbus", states: ["OH"], lat: 39.96, lon: -83.00, rust: "salt", tier: "low" },
  { slug: "cincinnati", name: "Cincinnati", states: ["OH", "KY", "IN"], lat: 39.10, lon: -84.51, rust: "mixed", tier: "low" },
  { slug: "indianapolis", name: "Indianapolis", states: ["IN"], lat: 39.77, lon: -86.16, rust: "mixed", tier: "low" },
  { slug: "grandrapids", name: "Grand Rapids", states: ["MI"], lat: 42.96, lon: -85.67, rust: "salt", tier: "low" },

  // --- Mid-Atlantic: mixed --------------------------------------------------
  { slug: "washingtondc", name: "Washington DC", states: ["DC", "VA", "MD"], lat: 38.91, lon: -77.04, rust: "mixed", tier: "high" },
  { slug: "baltimore", name: "Baltimore", states: ["MD"], lat: 39.29, lon: -76.61, rust: "mixed", tier: "moderate" },
  { slug: "richmond", name: "Richmond", states: ["VA"], lat: 37.54, lon: -77.44, rust: "mixed", tier: "moderate" },
  { slug: "virginiabeach", name: "Virginia Beach", states: ["VA", "NC"], lat: 36.85, lon: -75.98, rust: "mixed", tier: "moderate" },

  // --- Lower Midwest: mixed, low -------------------------------------------
  { slug: "stlouis", name: "St. Louis", states: ["MO", "IL"], lat: 38.63, lon: -90.20, rust: "mixed", tier: "low" },
  { slug: "kansascity", name: "Kansas City", states: ["MO", "KS"], lat: 39.10, lon: -94.58, rust: "mixed", tier: "low" },
  { slug: "springfieldmo", name: "Springfield MO", states: ["MO"], lat: 37.21, lon: -93.29, rust: "mixed", tier: "low" },
  { slug: "desmoines", name: "Des Moines", states: ["IA"], lat: 41.59, lon: -93.62, rust: "salt", tier: "low" },
  { slug: "omaha", name: "Omaha", states: ["NE", "IA"], lat: 41.26, lon: -95.93, rust: "salt", tier: "low" },
  { slug: "wichita", name: "Wichita", states: ["KS"], lat: 37.69, lon: -97.34, rust: "mixed", tier: "low" },
  { slug: "louisville", name: "Louisville", states: ["KY", "IN"], lat: 38.25, lon: -85.76, rust: "mixed", tier: "low" },

  // --- South Central: sun, low-moderate ------------------------------------
  { slug: "dallas", name: "Dallas", states: ["TX"], lat: 32.78, lon: -96.80, rust: "sun", tier: "moderate" },
  { slug: "houston", name: "Houston", states: ["TX"], lat: 29.76, lon: -95.37, rust: "sun", tier: "moderate" },
  { slug: "austin", name: "Austin", states: ["TX"], lat: 30.27, lon: -97.74, rust: "sun", tier: "moderate" },
  { slug: "sanantonio", name: "San Antonio", states: ["TX"], lat: 29.42, lon: -98.49, rust: "sun", tier: "low" },
  { slug: "oklahomacity", name: "Oklahoma City", states: ["OK"], lat: 35.47, lon: -97.52, rust: "mixed", tier: "low" },
  { slug: "tulsa", name: "Tulsa", states: ["OK"], lat: 36.15, lon: -95.99, rust: "mixed", tier: "low" },
  { slug: "littlerock", name: "Little Rock", states: ["AR"], lat: 34.75, lon: -92.29, rust: "sun", tier: "low" },
  { slug: "neworleans", name: "New Orleans", states: ["LA"], lat: 29.95, lon: -90.07, rust: "sun", tier: "low" },
  { slug: "memphis", name: "Memphis", states: ["TN", "MS", "AR"], lat: 35.15, lon: -90.05, rust: "sun", tier: "low" },
  { slug: "nashville", name: "Nashville", states: ["TN"], lat: 36.16, lon: -86.78, rust: "mixed", tier: "moderate" },

  // --- Southeast: sun -------------------------------------------------------
  { slug: "atlanta", name: "Atlanta", states: ["GA"], lat: 33.75, lon: -84.39, rust: "sun", tier: "moderate" },
  { slug: "charlotte", name: "Charlotte", states: ["NC", "SC"], lat: 35.23, lon: -80.84, rust: "sun", tier: "moderate" },
  { slug: "raleigh", name: "Raleigh", states: ["NC"], lat: 35.78, lon: -78.64, rust: "sun", tier: "moderate" },
  { slug: "jacksonville", name: "Jacksonville", states: ["FL", "GA"], lat: 30.33, lon: -81.66, rust: "sun", tier: "moderate" },
  { slug: "orlando", name: "Orlando", states: ["FL"], lat: 28.54, lon: -81.38, rust: "sun", tier: "moderate" },
  { slug: "tampa", name: "Tampa", states: ["FL"], lat: 27.95, lon: -82.46, rust: "sun", tier: "moderate" },
  { slug: "miami", name: "Miami", states: ["FL"], lat: 25.76, lon: -80.19, rust: "sun", tier: "high" },
  { slug: "birmingham", name: "Birmingham", states: ["AL"], lat: 33.52, lon: -86.80, rust: "sun", tier: "low" },

  // --- Mountain West: mixed ------------------------------------------------
  { slug: "denver", name: "Denver", states: ["CO"], lat: 39.74, lon: -104.99, rust: "mixed", tier: "high" },
  { slug: "saltlakecity", name: "Salt Lake City", states: ["UT"], lat: 40.76, lon: -111.89, rust: "mixed", tier: "moderate" },
  { slug: "albuquerque", name: "Albuquerque", states: ["NM"], lat: 35.08, lon: -106.65, rust: "sun", tier: "low" },
  { slug: "boise", name: "Boise", states: ["ID"], lat: 43.62, lon: -116.20, rust: "mixed", tier: "moderate" },

  // --- Southwest / West Coast: sun -----------------------------------------
  { slug: "phoenix", name: "Phoenix", states: ["AZ"], lat: 33.45, lon: -112.07, rust: "sun", tier: "moderate" },
  { slug: "tucson", name: "Tucson", states: ["AZ"], lat: 32.22, lon: -110.97, rust: "sun", tier: "low" },
  { slug: "lasvegas", name: "Las Vegas", states: ["NV"], lat: 36.17, lon: -115.14, rust: "sun", tier: "moderate" },
  { slug: "losangeles", name: "Los Angeles", states: ["CA"], lat: 34.05, lon: -118.24, rust: "sun", tier: "high" },
  { slug: "sandiego", name: "San Diego", states: ["CA"], lat: 32.72, lon: -117.16, rust: "sun", tier: "high" },
  { slug: "sanfrancisco", name: "San Francisco", states: ["CA"], lat: 37.77, lon: -122.42, rust: "sun", tier: "high" },
  { slug: "sacramento", name: "Sacramento", states: ["CA"], lat: 38.58, lon: -121.49, rust: "sun", tier: "moderate" },
  { slug: "fresno", name: "Fresno", states: ["CA"], lat: 36.74, lon: -119.79, rust: "sun", tier: "low" },
  { slug: "portland", name: "Portland", states: ["OR", "WA"], lat: 45.51, lon: -122.68, rust: "mixed", tier: "high" },
  { slug: "seattle", name: "Seattle", states: ["WA"], lat: 47.61, lon: -122.33, rust: "mixed", tier: "high" },
  { slug: "spokane", name: "Spokane", states: ["WA", "ID"], lat: 47.66, lon: -117.43, rust: "mixed", tier: "low" },
];

const BY_SLUG = new Map(METROS.map((m) => [m.slug, m]));

/** Peers must be within this many miles. Beyond it, a car is not a comparable
 * offer to the same buyer even when the market is similar. UNCALIBRATED. */
export const MAX_PEER_MILES = 550;

const RUST_ORDER: RustExposure[] = ["salt", "mixed", "sun"];
const TIER_ORDER: PriceTier[] = ["low", "moderate", "high"];

function stepsApart<T>(order: T[], a: T, b: T): number {
  return Math.abs(order.indexOf(a) - order.indexOf(b));
}

/** Great-circle distance in miles. */
export function milesBetween(a: Metro, b: Metro): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function findMetro(slug: string | null | undefined): Metro | null {
  return slug ? (BY_SLUG.get(slug.toLowerCase()) ?? null) : null;
}

/**
 * Metros comparable to `origin`, nearest first.
 *
 * A peer must be within `MAX_PEER_MILES` and no more than one step away on each
 * of the rust and price axes. One step rather than zero because the categories
 * are coarse: Cincinnati is "mixed" and Columbus is "salt", and refusing that
 * pairing would be precision the underlying classification does not have.
 */
export function peersFor(origin: Metro, limit = 8): Metro[] {
  return METROS.filter((m) => m.slug !== origin.slug)
    .filter((m) => stepsApart(RUST_ORDER, m.rust, origin.rust) <= 1)
    .filter((m) => stepsApart(TIER_ORDER, m.tier, origin.tier) <= 1)
    .map((m) => ({ metro: m, miles: milesBetween(origin, m) }))
    .filter(({ miles }) => miles <= MAX_PEER_MILES)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit)
    .map(({ metro }) => metro);
}

/**
 * Whether a search actually reached the metro it named.
 *
 * Facebook answers an unrecognised location by silently returning the account's
 * own metro. Since the slugs here are inferred rather than confirmed, that
 * failure would otherwise look exactly like a market with nothing in it -- and
 * it has already cost one capture.
 *
 * A single matching state is enough. Metro areas cross state lines and a search
 * legitimately returns some listings from further out, so requiring a majority
 * would reject working slugs.
 */
export function verifyMetroResults(metro: Metro, locationTexts: string[]): boolean {
  if (locationTexts.length === 0) return false;
  const expected = new Set(metro.states);
  return locationTexts.some((text) => {
    const state = text.split(",").pop()?.trim().toUpperCase();
    return state ? expected.has(state) : false;
  });
}

/**
 * The metro a listing sits in, located by coordinates.
 *
 * Listing pages carry a numeric `location_vanity_or_id`, not a slug, so the
 * target's own metro cannot be looked up by name. Coordinates are on every
 * listing that states a location and place the listing directly.
 *
 * Returns null beyond `MAX_HOME_METRO_MILES`: a listing in rural Montana has no
 * peer market in this table, and inventing one would compare it against a city
 * three states away.
 */
export const MAX_HOME_METRO_MILES = 120;

export function nearestMetro(
  latitude: number | null,
  longitude: number | null,
): Metro | null {
  if (latitude === null || longitude === null) return null;
  const here = { lat: latitude, lon: longitude } as Metro;

  let best: Metro | null = null;
  let bestMiles = Infinity;
  for (const metro of METROS) {
    const miles = milesBetween(here, metro);
    if (miles < bestMiles) {
      bestMiles = miles;
      best = metro;
    }
  }
  return bestMiles <= MAX_HOME_METRO_MILES ? best : null;
}
