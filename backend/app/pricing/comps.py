"""Comp set filtering (spec 4.3).

Spec 4.3: "Comp quality is the hardest technical problem in this project and
deserves more attention than the scoring formula." This module is therefore
deliberately verbose about its decisions: every candidate comes out the far end
with an explicit include/exclude and a reason, so a wrong expected price can be
traced to the comp that caused it rather than guessed at.

WHAT THIS MODULE CANNOT DO, AND WHY
-----------------------------------
Spec 4.3 asks for four things. One of them turned out to be available after all,
and the correction is worth recording because the old note here was confidently
wrong for months:

  Dealer exclusion      NOW AVAILABLE, on rows captured after the vehicle
                        payload keys were fixed. This module used to state that
                        none of the spec's three dealer signals existed, which
                        was true of all three -- but Facebook states the answer
                        outright in `vehicle_seller_type` ("PRIVATE_SELLER" /
                        "DEALER"), and the extractor was simply not reading it.
                        See `DealerSignal`, which is still UNAVAILABLE for every
                        row captured before the fix and for comp cards that
                        carry no such field.

  Recency weighting     Spec 4.3 wants recent listings weighted higher. No comp
                        card carries a posted date, so every comp is weighted
                        equally and the fit cannot down-weight a stale ask.

  Drivetrain            Requested as a hard filter. Parseable on ~7% of captured
                        comps because its only source is a regex over trim text;
                        there is no payload key for it. VIN decode (spec 4.2,
                        build step 6) is what fixes this.

  Transmission          Also requested as a hard filter, and also previously
                        recorded here as "parseable on 0% of captured comps".
                        That was a statement about the regex, not about the
                        data: `vehicle_transmission_type` is a payload field.
                        Populated going forward, null on backfilled rows.

For trim, spec 4.3 prescribes the behaviour directly: "When trim cannot be
determined for the target or most comps, widen the interval and lower confidence
rather than pretending the comp set is clean." So trim is a SOFT signal here --
it never excludes a comp, it costs confidence -- and drivetrain and transmission
are recorded but gate nothing.

TRIM COMPARISON IS GRADED, BUT `trim_matches` IS UNCHANGED
----------------------------------------------------------
`trim_matches` (bool | None) keeps exactly the semantics it has always had:
token-set equality with body style, drivetrain and listing noise stripped, and
None whenever either side stated no trim. `backtest.py` strata and the
confidence model both read it, and `params.py` forbids moving a calibrated
threshold without a calibration run behind it.

`trim_match` (TrimMatch) is the new, strictly additional signal. It uses the
decomposed columns to say WHY two trims differ -- a body-style mismatch is not
the same event as a trim-level one -- which the boolean cannot express.

MISSING-FIELD POLICY
--------------------
Spec asks for each missing field to be an explicit include-or-exclude decision.
The rule applied here is: a field is a hard filter only when its absence makes
the comp unverifiable as the same vehicle, or unusable as a data point.

  model missing      EXCLUDE. Cannot confirm it is the same vehicle at all.
  year missing       EXCLUDE. Same reason; year drives price more than anything
                     except mileage.
  price missing      EXCLUDE. It is the dependent variable.
  mileage missing    EXCLUDE FROM THE FIT, but counted and reported separately.
                     It is the independent variable, so a comp without it cannot
                     sit on the line. It is NOT evidence of a bad comp, so it is
                     reported as `mileage_unknown` rather than discarded
                     silently, and it still counts toward market thickness.
  trim missing       INCLUDE. Costs confidence. Excluding on trim would empty
                     the comp set on real data (21% of captured comps have no
                     trim string at all).
  drivetrain missing INCLUDE. Inert until step 6.
  location missing   INCLUDE. Radius is enforced by the search itself.

NOT EVERY RESULT IS A CAR
-------------------------
A Marketplace vehicle search returns parts and accessories alongside vehicles,
and they parse cleanly into year/make/model. Captured data contains a $25 "double
din dash kit 2002 Mazda protege" that became a 2002 Protege comp, and a $180
Android head unit "for Mazda CX-5 (2013-2016)". The price floor caught both only
by accident -- a $300 dash kit would have passed every check and then anchored an
eight-point regression. See `looks_like_a_part`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from statistics import median

from ..services.vehicle_facts import (
    DrivetrainSignal,
    decompose,
    parse_drivetrain,
    parse_transmission,
    trim_tokens,
)
from . import params

# Re-exported for existing callers and tests. The definitions moved to
# `services/vehicle_facts` so that ingest-time decomposition and comp-time
# comparison cannot drift apart -- there is one set of body-style phrases and
# one notion of a trim token, not a copy on each side.
__all__ = [
    "DrivetrainSignal",
    "decompose",
    "parse_drivetrain",
    "parse_transmission",
    "trim_tokens",
]

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_key(value: str | None) -> str:
    """Lowercase and strip non-alphanumerics.

    "CX-5", "Cx-5" and "CX5" all occur in captured data for one vehicle. This is
    the same normalisation `relisting_key` already applies server-side, so comp
    grouping and relisting detection agree on what counts as the same model.
    """
    if not value:
        return ""
    return _NON_ALNUM.sub("", value.lower())



#: There is deliberately no TARGET-side fallback for an unstated trim (there
#: used to be one: a literal `frozenset({"base"})`, standing in for "assume
#: base"). It was rejected empirically, and the mechanism is worth recording
#: because it is not obvious from the diff alone.
#:
#: The assumption could only ever produce "differs", never "agrees". A comp's
#: trim string, when captured, is always a real seller-typed name -- "SE",
#: "Touring", "Limited" -- never literally the word "base", because a seller
#: describing an actual base-trim car has the same nothing-to-brag-about
#: reason to omit the word that the target listing did. So `{"base"} ==
#: {"touring"}` is false, always, and once enough comps had a captured trim to
#: clear `MIN_TRIM_COVERAGE`, the agreement ratio collapsed toward zero on
#: essentially every evaluation whose TARGET trim was unstated -- which is the
#: common case, and disproportionately so for base-trim cars specifically,
#: since those are exactly the listings least likely to name a trim at all.
#: The result was "most comparable listings look like a different trim" firing
#: on nearly every car, independent of whether a real mismatch existed.
#:
#: The fix is to require BOTH sides to have a genuinely stated trim before
#: `trims_agree` runs at all (see the `target_trim and comp_trim` guard
#: below). When the target's trim truly isn't known, "unknown" is the honest
#: answer -- spec 4.3 already says to "widen the interval and lower confidence"
#: in that case, not to manufacture a comparison. This makes `TRIM_DISAGREEMENT`
#: rarer, but every time it now fires, both vehicles actually stated a trim and
#: they actually differ.


def trims_agree(target_trim: frozenset[str], comp_trim: frozenset[str]) -> bool:
    """Whether two normalised trims describe the same specification.

    Equality, not overlap. Overlap was tried and is wrong: it reports "Grand
    Touring" as matching "Touring", and the difference between those two is
    thousands of dollars -- precisely the "large price variance" spec 4.3 warns
    trim drives.

    Being strict here is the safe direction. Trim is a SOFT signal that only
    moves confidence, so a false "differs" costs a little confidence, while a
    false "matches" would quietly assert the comp set is cleaner than it is.
    """
    return target_trim == comp_trim


class TrimMatch(StrEnum):
    """How two trims relate, once decomposed into their parts.

    Strictly additional to `trims_agree`, which stays a boolean because the
    confidence model and `backtest.py`'s strata are calibrated against it.
    This says WHICH PART differs, which the boolean cannot:

      EXACT       trim level and body style both agree, or agree as far as
                  either side states them
      TRIM_ONLY   same trim level, different body -- "EX-L Hatchback 4D" vs
                  "EX-L Sedan 4D". A real difference in the vehicle, but not
                  the difference between an EX and an EX-L
      DIFFERS     different trim level: Touring vs Grand Touring, DX vs LX
      UNKNOWN     either side stated no trim level at all

    ENGINE IS NOT PART OF THE COMPARISON. "Premium Sport Utility 4D" and
    "2.0i Premium Sport Utility 4D" are the same trim written by two sellers,
    one of whom included the displacement -- 28 such pairs in captured data on
    one model alone. `trims_agree` still calls those different, because the
    engine token survives `trim_tokens`; this does not.

    TRIM LEVEL IS COMPARED AS A TOKEN SET, NOT A STRING. `decompose` returns
    `trim_level` as an ordered join because that is the readable column value,
    but "S Carbon Edition" and "Carbon Edition S" are the same trim typed in a
    different order, and a straight string comparison would call them
    different. `grade_trim` re-splits before comparing so this signal is at
    least as order-tolerant as `trim_tokens` already is for the boolean.
    """

    EXACT = "exact"
    TRIM_ONLY = "trim_only"
    DIFFERS = "differs"
    UNKNOWN = "unknown"


def grade_trim(target_trim: str | None, comp_trim: str | None) -> TrimMatch:
    """Compare two raw trim strings by their decomposed parts.

    Takes the RAW strings rather than pre-decomposed facts so that callers
    without database columns -- unit tests, and any candidate built by hand --
    get the same answer as the ingest path.
    """
    target, comp = decompose(target_trim), decompose(comp_trim)

    # Same guard as `trims_agree`: both sides must genuinely state a trim
    # before any comparison happens. See the long note above -- assuming a
    # missing trim means "base" produced a mismatch on nearly every evaluation.
    if target.trim_level is None or comp.trim_level is None:
        return TrimMatch.UNKNOWN

    # Token-SET equality, not string equality. `trim_level` is stored as an
    # ordered join ("s carbon edition") because that is the readable column
    # value, but comparing it as a string would fail "Carbon Edition S" against
    # "S Carbon Edition" -- the same trim, typed in a different order, which is
    # exactly the kind of seller variance `trim_tokens` already tolerates for
    # the boolean signal. Splitting on whitespace before comparing keeps this
    # signal at least as tolerant as that one.
    if set(target.trim_level.split()) != set(comp.trim_level.split()):
        return TrimMatch.DIFFERS

    # Body style is compared only when BOTH state one. A comp card that omits
    # the body style is not evidence of a different body, and treating it as
    # such would demote the majority of cards to TRIM_ONLY for saying nothing.
    if target.body_style and comp.body_style and target.body_style != comp.body_style:
        return TrimMatch.TRIM_ONLY

    return TrimMatch.EXACT


# COMP RELEVANCE WEIGHTING (a proximity kernel on mileage, a three-valued trim
# weight, and weighted least squares downstream) was built here and removed
# after out-of-sample measurement rejected it. See the note in `params` under
# "Comp relevance weighting: TRIED, MEASURED, REJECTED" -- kept as a pointer
# rather than dead code, because the idea is compelling enough to be proposed
# again and the experiment is worth not repeating.


# Parts and accessories listed in a Marketplace vehicle search. These are not
# comps, and the existing price floor catches them only by accident: a $25 dash
# kit is filtered as an implausible price, but a $300 one is not, and it would
# then sit in an eight-point regression as though it were a car.
#
# Two captured examples, both of which parsed as vehicles:
#   '9" Android Touchscreen Car Radio for Mazda CX-5 (2013-2016) - Brand New'
#   'double din dash kit 2002 Mazda protege speed or Mazda protege'  ($25)
# Decisive on their own: nobody advertises a car using these as the subject.
_STRONG_PART_NOUNS = (
    "dash kit",
    "dash cam",
    "head unit",
    "double din",
    "single din",
    "touchscreen",
    "catalytic",
    "key fob",
    "owners manual",
    "parts only",
    "for parts",
    "part out",
    "wiring harness",
    "transmission for",
    "engine for",
)

# Ambiguous: a genuine listing says "new tires" or "heated seats" about the car
# it is selling. These only count when they sit in the SUBJECT position -- ahead
# of the model year -- or alongside a fitment phrase.
_WEAK_PART_NOUNS = (
    "radio",
    "stereo",
    "bumper",
    "headlight",
    "taillight",
    "tail light",
    "mirror",
    "rims",
    "wheels",
    "tires",
    "tyres",
    "seat cover",
    "floor mat",
    "spoiler",
    "grille",
    "fender",
    "tailgate",
    "muffler",
    "exhaust",
    "alternator",
    "starter motor",
)

#: First model year in a title, used to locate where the vehicle description
#: starts. Anything before it is the seller describing the subject.
_YEAR_TOKEN_RE = re.compile(r"\b(19|20)\d{2}\b")

#: "... for Mazda CX-5", "fits Honda Civic" -- an item FOR a car, not a car.
_FITMENT_RE = re.compile(r"\b(for|fits|fit for|compatible with)\s+(a\s+)?[a-z]", re.I)

#: "(2013-2016)" -- a fitment range. A real listing states one model year.
_YEAR_RANGE_RE = re.compile(r"\(?\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b\)?")


def looks_like_a_part(title: str | None) -> bool:
    """Whether a listing title describes an accessory rather than a vehicle.

    Conservative by construction. Wrongly excluding a real car costs as much as
    letting a part through, given how thin the comp set already is, so the
    ambiguous middle is left alone deliberately:

      strong noun anywhere            -> a part
      weak noun before the model year -> a part ("dash kit 2002 Mazda protege")
      weak noun after it              -> a car  ("2016 CX-5, new tires")
      fitment phrase + year range     -> a part ("for Mazda CX-5 (2013-2016)")
    """
    if not title:
        return False
    text = title.lower()

    if any(noun in text for noun in _STRONG_PART_NOUNS):
        return True

    # Everything before the model year is the seller naming what they are
    # selling; everything after is them describing it.
    year_match = _YEAR_TOKEN_RE.search(text)
    subject = text[: year_match.start()] if year_match else text
    if any(noun in subject for noun in _WEAK_PART_NOUNS):
        return True

    # "for Mazda CX-5 (2013-2016)" -- neither half is decisive alone. A car
    # listing can say "great for a family", and a seller can write a year range
    # sloppily, but together they are a fitment description.
    if _FITMENT_RE.search(text) and _YEAR_RANGE_RE.search(text):
        return True

    # "... for Mazda CX-5" trailing a weak noun, with no model year anywhere.
    return bool(year_match is None and _FITMENT_RE.search(text)
                and any(noun in text for noun in _WEAK_PART_NOUNS))


# A "Buy Here Pay Here" ask advertises a financing term, not an asking price --
# "$800 down" or "!!DOWN PAYMENT!!" is what a buyer pays UP FRONT toward a much
# larger total, and `price_cents` captures that up-front figure because it is
# the only dollar amount on the card. Comp-set filtering has no way to recover
# the real total from a search-result card (spec 4.3: "a title and a mileage
# and nothing else"), so the honest response is to drop the comp entirely
# rather than fit a regression line through what looks like a $4,000 Maserati.
#
# Rare on captured data -- 3 of 6,736 stored comp observations -- so this will
# not move an aggregate error figure. Fixed anyway because it is a plain
# mis-extraction (a down payment is not an ask) rather than a calibration
# question, the same way `looks_like_a_part` fixes a $25 dash kit regardless
# of how often one turns up.
_FINANCING_PATTERN = re.compile(
    r"down\s*payment|\$\s*\d+\s*down\b|/\s*mo\b|per\s*month|"
    r"weekly\s*payment|bi[\s-]?weekly|financing\s*available|"
    r"no\s*credit\s*(check|needed)?|bad\s*credit\s*ok",
    re.I,
)


def looks_like_a_financing_offer(text: str | None) -> bool:
    """Whether a comp's title or trim text names a financing term, not a price.

    Checked against both fields because the marker has been observed sitting
    in `trim_text` (the substring after the parsed model year) as often as it
    would in a title -- captured data's `!!DOWN PAYMENT!!` is the whole of
    what the extractor recovered as trim.
    """
    if not text:
        return False
    return bool(_FINANCING_PATTERN.search(text))


class DealerSignal(StrEnum):
    """Whether spec 4.3's dealer exclusion could run on this comp set.

    This was a permanent `UNAVAILABLE` placeholder, on the reasoning that comp
    cards carry no description and no seller listing count, so none of the three
    signals the spec names can be computed. All of that is still true -- and it
    was still the wrong conclusion, because Facebook states the answer directly
    in `vehicle_seller_type` and the extractor was not reading the key.

    UNAVAILABLE therefore now means "this comp set predates the fix, or its
    cards carry no seller type", not "this is impossible". It is still the
    common case: every one of the observations captured before the fix has a
    NULL `seller_type`, and reporting those as "no dealers found" would be a
    false clean bill of health.
    """

    UNAVAILABLE = "unavailable"
    APPLIED = "applied"


# ---------------------------------------------------------------------------
# Candidate / decision types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CompCandidate:
    """One listing offered as a comp, decoupled from the ORM for testability."""

    listing_id: int
    source_listing_id: str
    year: int | None
    make: str | None
    model: str | None
    trim_text: str | None
    price_cents: int | None
    mileage: int | None
    location_text: str | None
    relisting_key: str | None = None
    seller_hash: str | None = None
    listing_url: str | None = None
    #: "fb_catalog" | "title_text" | "description". Facebook's catalog string is
    #: written the same way every time; a seller-typed one is not.
    trim_source: str | None = None
    #: Marketplace's own "PRIVATE_SELLER" / "DEALER". None on every observation
    #: captured before the payload keys were fixed, and on cards without one.
    seller_type: str | None = None
    transmission_text: str | None = None
    #: The raw listing title, kept because the part/accessory signals live in
    #: the portion `parseVehicleTitle` discards -- everything before the year.
    #: "double din dash kit 2002 Mazda protege" parses to a clean 2002 Protege
    #: and only the title still says it is a dash kit.
    title: str | None = None

    @property
    def drivetrain(self) -> DrivetrainSignal:
        return parse_drivetrain(self.trim_text)

    @property
    def transmission(self) -> str | None:
        """Transmission, preferring the payload field over the trim-text regex.

        The regex found this on 0% of captured comps, which is why the field is
        captured directly now. It stays as the fallback for rows that predate
        the fix.
        """
        return self.transmission_text or parse_transmission(self.trim_text)

    @property
    def is_dealer(self) -> bool | None:
        """True/False from Marketplace's own classification, None when unstated.

        Three-valued deliberately: "not a dealer" and "we do not know" are
        different facts, and collapsing them would let every pre-fix row read as
        a confirmed private seller.
        """
        if not self.seller_type:
            return None
        return self.seller_type.strip().upper() == "DEALER"


class Exclusion(StrEnum):
    """Why a candidate did not become a comp. One value per distinct cause, so
    the reasons can be counted across captures to find the dominant loss."""

    SAME_VEHICLE_AS_TARGET = "same_vehicle_as_target"
    DUPLICATE_OF_ANOTHER_COMP = "duplicate_of_another_comp"
    DIFFERENT_MAKE = "different_make"
    DIFFERENT_MODEL = "different_model"
    MODEL_UNKNOWN = "model_unknown"
    YEAR_UNKNOWN = "year_unknown"
    YEAR_OUT_OF_WINDOW = "year_out_of_window"
    PRICE_MISSING = "price_missing"
    PRICE_IMPLAUSIBLE = "price_implausible"
    MILEAGE_IMPLAUSIBLE = "mileage_implausible"
    NOT_A_VEHICLE = "not_a_vehicle"
    NOT_AN_ASKING_PRICE = "not_an_asking_price"
    #: Spec 4.3: "Dealers posting as private sellers pollute the baseline with
    #: retail pricing." Only ever fires on rows that state a seller type.
    DEALER_LISTING = "dealer_listing"


@dataclass(frozen=True)
class CompDecision:
    """The verdict on one candidate, with the reasoning attached."""

    candidate: CompCandidate
    included: bool
    exclusion: Exclusion | None = None
    #: Included but unusable as a regression point -- no mileage to place it on
    #: the x axis. Still counts as evidence the market is thick.
    mileage_unknown: bool = False
    #: Trim comparison against the target. None when either side has no trim.
    #: UNCHANGED SEMANTICS: token-set equality, the value the confidence model
    #: and `backtest.py`'s strata are calibrated against.
    trim_matches: bool | None = None
    #: The same comparison, decomposed, saying which part differs. Additional
    #: to `trim_matches`, never a replacement for it.
    trim_match: TrimMatch = TrimMatch.UNKNOWN
    notes: tuple[str, ...] = ()

    @property
    def usable_in_fit(self) -> bool:
        return self.included and not self.mileage_unknown

    def reason(self) -> str:
        """One-line human explanation, for the CLI's per-comp listing."""
        if not self.included:
            return (self.exclusion or Exclusion.MODEL_UNKNOWN).value
        parts = []
        if self.mileage_unknown:
            parts.append("no mileage (not in fit)")
        if self.trim_matches is True:
            parts.append("trim matches")
        elif self.trim_matches is False:
            parts.append("trim differs")
        else:
            parts.append("trim unknown")
        parts.extend(self.notes)
        return ", ".join(parts)


@dataclass
class CompSet:
    """The filtered comp set plus everything needed to explain it."""

    target: CompCandidate
    decisions: list[CompDecision] = field(default_factory=list)
    #: Recorded from the capture's comp_search_query. False means the comps came
    #: back scoped to the *user's* metro rather than the listing's -- a real
    #: defect in captured data, and one that invalidates the comp set rather
    #: than merely widening it.
    location_scoped: bool | None = None
    dealer_filtering: DealerSignal = DealerSignal.UNAVAILABLE
    #: The year window this set was filtered at. Above `params.YEAR_WINDOW` it
    #: means progressive widening ran (spec 4.3), which costs confidence.
    year_window: int = params.YEAR_WINDOW

    @property
    def year_window_widened(self) -> bool:
        return self.year_window > params.YEAR_WINDOW

    @property
    def included(self) -> list[CompDecision]:
        return [d for d in self.decisions if d.included]

    @property
    def fit_points(self) -> list[CompDecision]:
        return [d for d in self.decisions if d.usable_in_fit]

    @property
    def excluded(self) -> list[CompDecision]:
        return [d for d in self.decisions if not d.included]

    def preferred_fit_points(self, min_points: int) -> tuple[list[CompDecision], bool]:
        """`fit_points`, restricted to trim-matched comps when there are enough.

        Spec 4.3: "Trim and drivetrain drive large price variance." Trim never
        EXCLUDES a comp (a comp set that is 40% one trim and 60% another should
        not lose the majority), but when the trim-matched comps alone are
        sufficient to fit a slope, they are a candidate set worth fitting
        alongside the full one.

        A CANDIDATE, not an override: `regression.py` compares this fit against
        the unrestricted one on interval width and keeps whichever is tighter.
        A smaller, more similar set can still leave the target's mileage outside
        the range it covers, which widens the interval rather than narrowing it.

        Returns (points to fit, whether the fit was restricted).
        """
        matched = [d for d in self.fit_points if d.trim_matches is True]
        if len(matched) >= min_points:
            return matched, True

        # Second candidate set, from the decomposed comparison: same trim level,
        # differing only in body style or an engine designator one seller wrote
        # and the other did not. `trim_matches` calls those a mismatch because
        # the engine token survives `trim_tokens`, so on a thin comp set this
        # recovers points that are genuinely the same trim.
        #
        # Still only a CANDIDATE -- `regression.py` compares every candidate fit
        # on interval half-width at the target's mileage and keeps the tightest,
        # so this can only be chosen when it actually produces a better fit.
        graded = [
            d
            for d in self.fit_points
            if d.trim_match in (TrimMatch.EXACT, TrimMatch.TRIM_ONLY)
        ]
        if len(graded) >= min_points:
            return graded, True

        return self.fit_points, False

    def trim_match_counts(self) -> dict[str, int]:
        """Included comps by graded trim relation, for reporting."""
        counts: dict[str, int] = {}
        for d in self.included:
            counts[d.trim_match.value] = counts.get(d.trim_match.value, 0) + 1
        return counts

    @property
    def trim_coverage(self) -> float:
        """Fraction of included comps whose trim could be compared at all."""
        inc = self.included
        if not inc:
            return 0.0
        return sum(1 for d in inc if d.trim_matches is not None) / len(inc)

    @property
    def trim_agreement(self) -> float:
        """Fraction of comparable comps whose trim matches the target's."""
        comparable = [d for d in self.included if d.trim_matches is not None]
        if not comparable:
            return 0.0
        return sum(1 for d in comparable if d.trim_matches) / len(comparable)

    def exclusion_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for d in self.excluded:
            key = (d.exclusion or Exclusion.MODEL_UNKNOWN).value
            counts[key] = counts.get(key, 0) + 1
        return counts


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


def _identity_key(c: CompCandidate) -> str | None:
    """Content identity for dedup.

    Prefers the stored `relisting_key`, which the ingest layer already computes
    over year/make/model/mileage-bucket/city and which correctly identified the
    duplicate-and-self-match case found in captured data (one Jackson MO CX-9
    appearing as the target and twice more as its own comps, under three
    different listing ids). Falls back to an equivalent local key when the
    candidate did not come from the database.
    """
    if c.relisting_key:
        return c.relisting_key
    model = normalize_key(c.model)
    if not model or c.year is None:
        return None
    bucket = "" if c.mileage is None else str(c.mileage // 10_000)
    city = normalize_key((c.location_text or "").split(",")[0])
    return f"{c.year}|{normalize_key(c.make)}|{model}|{bucket}|{city}"


def filter_comps(
    target: CompCandidate,
    candidates: list[CompCandidate],
    *,
    year_window: int = params.YEAR_WINDOW,
    location_scoped: bool | None = None,
) -> CompSet:
    """Apply spec 4.3's comp filtering, recording a reason for every candidate.

    Order matters: identity checks run before quality checks so that a duplicate
    is reported as a duplicate rather than as whatever else happens to be wrong
    with it.
    """
    comp_set = CompSet(
        target=target, location_scoped=location_scoped, year_window=year_window
    )

    target_model = normalize_key(target.model)
    target_make = normalize_key(target.make)
    # No fallback for an unstated trim -- see the comment above `trims_agree`.
    target_trim = trim_tokens(target.trim_text)

    def same_vehicle(a: CompCandidate, b: CompCandidate) -> bool:
        """Whether two listings are the same physical car.

        Both halves are required. The fuzzy key alone buckets mileage at 10k and
        keys on city, so it matches unrelated cars of the same model and vintage
        in the same metro -- exactly the comps a thin set can least afford to
        lose. Price agreement is what separates a genuine double-posting from a
        neighbour selling a similar car.
        """
        ka, kb = _identity_key(a), _identity_key(b)
        if ka is None or kb is None or ka != kb:
            return False
        if a.price_cents is None or b.price_cents is None:
            return True
        larger = max(a.price_cents, b.price_cents)
        if larger == 0:
            return True
        return abs(a.price_cents - b.price_cents) / larger <= params.DUPLICATE_PRICE_TOLERANCE

    kept: list[CompCandidate] = []
    seen_source_ids: set[str] = {target.source_listing_id}

    # Pass 1: identity and hard field checks.
    def first_failure(c: CompCandidate) -> Exclusion | None:
        """The first rule this candidate fails, or None if it passes them all.

        Order matters: identity checks run before quality checks, so a duplicate
        is reported as a duplicate rather than as whatever else also happens to
        be wrong with it.
        """
        # A search page routinely includes the listing being evaluated, and the
        # extension already drops it by listing id. That is not enough: the same
        # vehicle is posted under several ids. Without this the target is
        # compared against itself and the residual is pinned toward zero.
        if c.source_listing_id in seen_source_ids or same_vehicle(c, target):
            return Exclusion.SAME_VEHICLE_AS_TARGET
        if any(same_vehicle(c, other) for other in kept):
            return Exclusion.DUPLICATE_OF_ANOTHER_COMP
        # Before the field checks: a dash kit parses into a perfectly clean
        # year/make/model and would otherwise pass every one of them.
        if looks_like_a_part(c.title):
            return Exclusion.NOT_A_VEHICLE
        if looks_like_a_financing_offer(c.title) or looks_like_a_financing_offer(c.trim_text):
            return Exclusion.NOT_AN_ASKING_PRICE
        # Spec 4.3's first differentiator: a dealer ask carries reconditioning
        # markup, warranty and overhead, so benchmarking a private-party car
        # against one is an accuracy problem, not a positioning one. Only fires
        # when Marketplace actually said so -- `is_dealer` is None otherwise.
        if c.is_dealer:
            return Exclusion.DEALER_LISTING
        if not c.model:
            return Exclusion.MODEL_UNKNOWN
        if target_make and normalize_key(c.make) != target_make:
            return Exclusion.DIFFERENT_MAKE
        if normalize_key(c.model) != target_model:
            return Exclusion.DIFFERENT_MODEL
        if c.year is None:
            return Exclusion.YEAR_UNKNOWN
        if target.year is not None and abs(c.year - target.year) > year_window:
            return Exclusion.YEAR_OUT_OF_WINDOW
        if c.price_cents is None:
            return Exclusion.PRICE_MISSING
        if c.price_cents < params.MIN_PLAUSIBLE_PRICE_CENTS:
            return Exclusion.PRICE_IMPLAUSIBLE
        if c.mileage is not None and (c.mileage <= 0 or c.mileage > params.MAX_PLAUSIBLE_MILEAGE):
            return Exclusion.MILEAGE_IMPLAUSIBLE
        return None

    provisional: list[CompDecision] = []
    for c in candidates:
        failure = first_failure(c)
        if failure is not None:
            provisional.append(CompDecision(candidate=c, included=False, exclusion=failure))
            continue

        kept.append(c)
        seen_source_ids.add(c.source_listing_id)

        # Soft signal only (spec 4.3): never excludes, only moves confidence.
        # BOTH sides must have a genuinely stated trim, or this stays an
        # honest unknown rather than a manufactured comparison -- see the
        # comment above `trims_agree`.
        comp_trim = trim_tokens(c.trim_text)
        matches: bool | None = (
            trims_agree(target_trim, comp_trim) if target_trim and comp_trim else None
        )

        notes: list[str] = []
        if c.drivetrain is not DrivetrainSignal.UNKNOWN:
            notes.append(f"drivetrain {c.drivetrain.value} (recorded, not filtered)")
        # Recorded, not filtered on: a catalog trim and a seller-typed one are
        # not equally trustworthy, and knowing which is which is what makes a
        # trim disagreement interpretable.
        if c.trim_source and c.trim_source != "fb_catalog":
            notes.append(f"trim from {c.trim_source}")

        provisional.append(
            CompDecision(
                candidate=c,
                included=True,
                mileage_unknown=c.mileage is None,
                trim_matches=matches,
                trim_match=grade_trim(target.trim_text, c.trim_text),
                notes=tuple(notes),
            )
        )

    # Pass 2: relative price sanity, which needs the surviving set's median and
    # therefore cannot run inside pass 1.
    prices = [
        d.candidate.price_cents
        for d in provisional
        if d.included and d.candidate.price_cents is not None
    ]
    if prices:
        floor = median(prices) * params.MIN_PRICE_FRACTION_OF_MEDIAN
        provisional = [
            CompDecision(
                candidate=d.candidate, included=False, exclusion=Exclusion.PRICE_IMPLAUSIBLE
            )
            if d.included and (d.candidate.price_cents or 0) < floor
            else d
            for d in provisional
        ]

    # APPLIED only when at least one candidate actually stated a seller type.
    # A comp set where nobody did is not one where no dealers were found.
    if any(c.seller_type for c in candidates):
        comp_set.dealer_filtering = DealerSignal.APPLIED

    comp_set.decisions = provisional
    return comp_set
