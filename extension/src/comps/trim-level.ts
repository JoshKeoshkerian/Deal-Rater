/**
 * Reducing a raw trim string to its trim LEVEL, client-side.
 *
 * The backend already does this at ingest (`services/vehicle_facts.decompose`),
 * but two things in the extension need the answer before a capture is ever
 * posted: deciding whether widening for trim is still worth a request
 * (`widen.ts`), and naming the trim in a search query (`build-query.ts`). Both
 * are asking the same question, so they share one implementation rather than
 * growing a heuristic each.
 *
 * WHY THIS EXISTS AT ALL, AND WHAT IT REPLACED
 * --------------------------------------------
 * `widen.ts` used to strip nine stopwords -- `4d 4dr 2d 2dr awd fwd rwd 4wd
 * suv` -- and compare the remainder by token OVERLAP. Both halves of that were
 * wrong in the same direction, and together they made `shouldWiden`'s trim
 * clause dead code:
 *
 *   - Body style survived the strip, so `coupe`, `sedan`, `roadster`,
 *     `convertible` and `hatchback` were treated as trim tokens. A target whose
 *     trim was `Coupe 2D` matched 32 of its 36 comps on the token `coupe`,
 *     while the backend -- which correctly reads `Coupe 2D` as no trim at all --
 *     matched 0. 11% of stored targets have a trim that reduces to nothing but
 *     a body style, and the old check found phantom matches for 18 of the 21.
 *   - Overlap then compounded it: one shared token out of several was enough.
 *
 * SET EQUALITY, NOT OVERLAP
 * -------------------------
 * The old code argued that "probably the same trim" was the right bar because
 * this only ever gates an extra search. The argument is sound and the
 * conclusion was still wrong: the point of a client-side count is to PREDICT
 * what the backend will count, and a check that over-predicts stops widening
 * early -- which is the whole failure. So this compares token SETS for equality,
 * having removed body style, drivetrain and the engine designator, which mirrors
 * the backend's `grade_trim` accepting `EXACT | TRIM_ONLY` -- exactly the
 * candidate set `CompSet.preferred_fit_points` builds and the thing widening is
 * trying to supply.
 *
 * MEASURED, on the 184 stored comp sets that clear the comp floor (4,826 comps),
 * against the backend's own `trim_matches` on the same rows:
 *
 *                                          old        this
 *     comps counted as matching           2,552        712
 *     ratio to the backend's 679           3.76x      1.05x
 *     per-comp agreement with backend      61.2%      98.6%
 *     comp sets it called "6 reached"        154         50
 *     ... where the backend agrees            50         50
 *
 * The last two rows are the failure in one line. `shouldWiden`'s trim clause was
 * being told the target was met on 84% of comp sets when it was actually met on
 * 27%, so the clause could not fire where it was needed and the peer loop ran on
 * comp count alone.
 *
 * ENGINE DESIGNATOR IS DROPPED, unlike the backend's `trim_tokens`.
 * `2.0i Premium Sport Utility 4D` and `Premium Sport Utility 4D` are one trim
 * written by two sellers (28 such pairs on one model in stored data). The
 * backend keeps the engine token in `trim_tokens` because `trims_agree` is
 * calibrated against it, and splits it into its own field in `decompose`. This
 * is the `decompose` behaviour, because the question here is which comps are the
 * same trim, not which comps a calibrated boolean calls equal.
 *
 * WHAT THIS DELIBERATELY DOES NOT MIRROR
 * --------------------------------------
 * The backend also strips listing noise before comparing: emoji, `w/` option
 * packages, mileage claims, dealer stock numbers, trailing location bleed. The
 * three cheapest of those are mirrored below; the rest are not, and the
 * consequence is stated rather than hidden. A seller-typed trim carrying
 * leftover noise will fail equality here and go uncounted, so widening does one
 * more search than it strictly needed. That is the safe direction -- an extra
 * request costs latency, a phantom match costs the comp set.
 */

/**
 * Body-style phrases, removed as PHRASES rather than as loose tokens.
 *
 * The distinction matters and is easy to get wrong: `sport utility` has to go
 * as a unit, because dropping a bare `sport` token would destroy the real trim
 * in `Sport Sedan 4D` and in `CX-9 Sport`. Same for `van` inside
 * `passenger van`, and `cab` inside `crew cab`.
 *
 * MUST STAY IN SYNC with `_BODY_STYLE_PHRASES` and `_DRIVETRAIN_PHRASES` in
 * `backend/app/services/vehicle_facts.py`. `backend/tests/test_trim_parity.py`
 * reads this file and asserts the two sets are identical, so a phrase added on
 * one side and forgotten on the other fails CI rather than quietly making the
 * client count differently from the backend -- which is the exact class of bug
 * this module was written to fix.
 *
 * Longest phrases first, so `sport utility` is removed before `suv` or `van`
 * can match part of something else.
 */
export const TRIM_BODY_AND_DRIVETRAIN_PHRASES: readonly string[] = [
  // Drivetrain. Stripped because the backend parses drivetrain out of this same
  // string separately, so leaving it would count one signal twice and report a
  // false mismatch every time one seller wrote "EX-L FWD" and another "EX-L".
  // "quattro" is deliberately absent: it is Audi branding inside a trim name.
  "all wheel drive",
  "front wheel drive",
  "rear wheel drive",
  "four wheel drive",
  // Body style.
  "sport utility",
  "passenger van",
  "regular cab",
  "extended cab",
  "double cab",
  "supercrew",
  "quad cab",
  "crew cab",
  "ext cab",
  "hatchback",
  "convertible",
  "minivan",
  "roadster",
  "pickup",
  "coupe",
  "sedan",
  "wagon",
  "truck",
  "suv",
  "van",
  "cab",
  "4dr",
  "2dr",
  "awd",
  "fwd",
  "rwd",
  "4wd",
  "4x4",
  "4d",
  "2d",
  // Bed-length tail, left behind once "5 3/4" tokenises away as bare digits.
  "ft",
];

/** The subset of the backend's listing-noise patterns worth mirroring. */
const NOISE_PATTERNS: readonly RegExp[] = [
  // Emoji and other non-ASCII: "LT 🤘 74173 Miles".
  /[^\x00-\x7f]+/g,
  // Option packages. "EX-L w/Honda Sensing" is an EX-L.
  /\bw\/.*$/g,
  // Mileage claims: "174160 Miles", "66k Miles".
  /\b\d[\d,]*\s*k?\s*miles?\b/g,
];

/**
 * An engine displacement designator: "2.0t", "3.7", "45" in "45 TFSI".
 *
 * Bare integers are dropped separately as body-style leftovers ("4D") and stock
 * numbers, so this only has to catch the decimal forms.
 */
const ENGINE_DESIGNATOR = /^\d+\.\d+[a-z]*$/;

/** Separators to flatten, KEEPING the dot so "2.0T" survives as one token. */
const SEPARATORS = /[^a-z0-9.]+/g;

/**
 * Trim-level tokens: body style, drivetrain, engine and the model name gone.
 *
 * Returns an EMPTY set when nothing meaningful is left, which is the honest
 * answer for a trim string that was only ever a body style ("Sedan 4D") and is
 * what the backend records as `trim_level = NULL`. Callers must treat an empty
 * set as "trim unknown" rather than as a trim that matches other empty sets.
 *
 * `model` is removed because some listings repeat it inside the trim string
 * ("CX-5 Touring"), and leaving it would make every comp of the same model
 * share a token.
 *
 * KNOWN GAP, unchanged from the code this replaces: only what `model` actually
 * contains is removed. Facebook's structured data does not always agree with
 * itself about where the model ends and the trim begins -- "Grand Cherokee" has
 * appeared as model="Grand" with trim_text="Cherokee Limited...", and stripping
 * "grand" leaves the leaked "cherokee". Recovering the true model name belongs
 * to the extraction pipeline that produced the split, not here. The failure is
 * benign: a leaked model token is shared by both sides of the comparison, so it
 * cancels under set equality.
 */
export function trimLevelTokens(
  trimText: string | null | undefined,
  model: string | null | undefined,
): Set<string> {
  if (!trimText) return new Set();

  let text = trimText.toLowerCase();
  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, " ");
  text = text.replace(SEPARATORS, " ");

  // Space-padded so a phrase can only match on whole-word boundaries: without
  // the padding, "sedan" would match inside a hypothetical trim containing it.
  let padded = ` ${text.split(/\s+/).filter(Boolean).join(" ")} `;
  for (const phrase of TRIM_BODY_AND_DRIVETRAIN_PHRASES) {
    // Repeated, because a trim can legitimately state one twice ("4D Sedan 4D")
    // and a single pass leaves the second occurrence behind.
    while (padded.includes(` ${phrase} `)) padded = padded.replace(` ${phrase} `, " ");
  }

  const modelWords = new Set(
    (model ?? "")
      .toLowerCase()
      .split(SEPARATORS)
      .filter(Boolean),
  );

  return new Set(
    padded
      .split(/\s+/)
      .filter(
        (token) =>
          token.length > 0 &&
          !modelWords.has(token) &&
          // Bare numbers: body-style leftovers, bed lengths, stock numbers.
          !/^\d+$/.test(token) &&
          !ENGINE_DESIGNATOR.test(token),
      ),
  );
}

/** Whether two token sets describe the same trim level. */
export function trimLevelsMatch(target: Set<string>, comp: Set<string>): boolean {
  // An unstated trim on either side is not a match. Two empty sets are two
  // unknowns, not an agreement -- the same guard the backend applies before
  // `trims_agree` runs at all, and for the same reason: assuming a missing trim
  // means anything in particular manufactured a comparison that did not exist.
  if (target.size === 0 || comp.size === 0) return false;
  if (target.size !== comp.size) return false;
  for (const token of target) {
    if (!comp.has(token)) return false;
  }
  return true;
}

/**
 * The trim level as a search term, or null when there is none to name.
 *
 * Token order is not recoverable from a set, and a query is a string, so this
 * re-derives the level from the original text in the order the seller wrote it.
 */
export function trimLevelQueryTerm(
  trimText: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const tokens = trimLevelTokens(trimText, model);
  if (tokens.size === 0) return null;

  const ordered = (trimText ?? "")
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .split(/\s+/)
    .filter((token) => tokens.has(token));

  // Deduplicated, preserving first appearance: "S Carbon Edition S" is one term.
  return [...new Set(ordered)].join(" ") || null;
}
