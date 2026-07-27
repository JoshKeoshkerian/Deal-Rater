"""Comp set filtering (spec 4.3).

Spec 4.3: "Comp quality is the hardest technical problem in this project and
deserves more attention than the scoring formula." This module is therefore
deliberately verbose about its decisions: every candidate comes out the far end
with an explicit include/exclude and a reason, so a wrong expected price can be
traced to the comp that caused it rather than guessed at.

WHAT THIS MODULE CANNOT DO, AND WHY
-----------------------------------
Three requirements in spec 4.3 have no data behind them at step 3 and are not
silently approximated here. Each is represented by an explicit, inert hook so
that the gap is visible in code rather than forgotten:

  Dealer exclusion      Spec 4.3 requires excluding dealer listings, detected
                        via multiple active listings on a profile, business page
                        indicators, or dealer boilerplate. Comp cards carry
                        neither description nor seller listing count -- the
                        field is NULL on every seller observation captured -- so
                        none of the three signals exists. See `DealerSignal`.

  Recency weighting     Spec 4.3 wants recent listings weighted higher. No comp
                        card carries a posted date, so every comp is weighted
                        equally and the fit cannot down-weight a stale ask.

  Drivetrain / trans.   Requested as hard filters. Transmission is parseable on
                        0% of captured comps and drivetrain on 7%, because both
                        come from VIN decode, which spec 13 sequences at step 6
                        -- AFTER this step. Spec 4.2 is explicit that VIN decode
                        is what solves trim and drivetrain ambiguity.

For the third, spec 4.3 prescribes the behaviour directly: "When trim cannot be
determined for the target or most comps, widen the interval and lower confidence
rather than pretending the comp set is clean." So trim is a SOFT signal here --
it never excludes a comp, it costs confidence -- and drivetrain and transmission
are parsed where present and recorded, but gate nothing. When step 6 lands and
populates them, `DrivetrainSignal` becomes a real filter without restructuring.

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

from . import params

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


class DrivetrainSignal(StrEnum):
    """Drivetrain parsed from free text.

    Inert at step 3: recorded, never filtered on. Parseable on 7% of captured
    comps because the real source is VIN decode (spec 4.2), which is step 6.
    """

    AWD = "awd"
    FWD = "fwd"
    RWD = "rwd"
    FOUR_WD = "4wd"
    UNKNOWN = "unknown"


_DRIVETRAIN_PATTERNS: list[tuple[re.Pattern[str], DrivetrainSignal]] = [
    (re.compile(r"\b(awd|all[\s-]?wheel[\s-]?drive)\b", re.I), DrivetrainSignal.AWD),
    (re.compile(r"\b(4wd|4x4|four[\s-]?wheel[\s-]?drive)\b", re.I), DrivetrainSignal.FOUR_WD),
    (re.compile(r"\b(fwd|front[\s-]?wheel[\s-]?drive)\b", re.I), DrivetrainSignal.FWD),
    (re.compile(r"\b(rwd|rear[\s-]?wheel[\s-]?drive)\b", re.I), DrivetrainSignal.RWD),
]

_TRANSMISSION_PATTERN = re.compile(
    r"\b(automatic|manual|cvt|\d[\s-]?speed|stick[\s-]?shift)\b", re.I
)


def parse_drivetrain(*texts: str | None) -> DrivetrainSignal:
    """Best-effort drivetrain from trim text. Returns UNKNOWN far more often
    than not, which is the honest answer until step 6 supplies VIN decodes."""
    for text in texts:
        if not text:
            continue
        for pattern, signal in _DRIVETRAIN_PATTERNS:
            if pattern.search(text):
                return signal
    return DrivetrainSignal.UNKNOWN


def parse_transmission(*texts: str | None) -> str | None:
    """Best-effort transmission. Returns None on 100% of captured comp data."""
    for text in texts:
        if not text:
            continue
        match = _TRANSMISSION_PATTERN.search(text)
        if match:
            return match.group(0).lower()
    return None


# Body-style noise, stripped as PHRASES before tokenising rather than as loose
# words. The ordering matters and the phrase form is load-bearing: "Sport" is a
# body-style word in "Touring Sport Utility 4D" and a genuine trim level in
# "Sport SUV 4D", and both spellings occur in captured data for the same model.
# Dropping "sport" as a bare stopword would erase the trim from the second.
#
# The van/pickup/cab entries were added after a database pass over the 3,109
# populated trim strings: without them "EX-L Sedan 4D" and "EX-L Minivan 4D"
# read as different trims, as do "1500 LT Pickup 4D 5 3/4 ft" and "LT". Both
# pairs are the same trim written against different body styles.
_BODY_STYLE_PHRASES = (
    "sport utility",
    "suv",
    "sedan",
    "hatchback",
    "coupe",
    "convertible",
    "wagon",
    "truck",
    "passenger van",
    "minivan",
    "pickup",
    "van",
    "crew cab",
    "regular cab",
    "extended cab",
    "ext cab",
    "quad cab",
    "double cab",
    "supercrew",
    "cab",
    "4dr",
    "2dr",
    "4d",
    "2d",
    # Bed-length tail, left behind once "5 3/4" tokenises away as bare digits.
    "ft",
)

# Drivetrain words, stripped from the TRIM comparison specifically because
# drivetrain is already parsed out of the same string separately
# (`parse_drivetrain`, recorded as a note on every decision). Leaving them here
# would count one signal twice and, worse, report a false trim mismatch every
# time one seller wrote "EX-L FWD" and another wrote "EX-L" -- which is most of
# them, since drivetrain is stated on a minority of listings.
#
# "quattro" is deliberately NOT in this list: it is Audi branding that forms
# part of the trim name ("quattro Premium Plus"), not a bare drivetrain note.
_DRIVETRAIN_PHRASES = (
    "all wheel drive",
    "front wheel drive",
    "rear wheel drive",
    "four wheel drive",
    "awd",
    "fwd",
    "rwd",
    "4wd",
    "4x4",
)

# Noise stripped BEFORE punctuation is flattened, because every pattern here
# needs the punctuation to identify itself. All of these are real forms found in
# the stored trim strings, where the field is the leftover remainder of a title
# split (`extension/src/shared/parse.ts`) and carries whatever the seller wrote.
_TRIM_NOISE_PATTERNS = (
    # Emoji and other non-ASCII: "LT 🤘 74173 Miles", "Turbo – ¡El deportivo...".
    re.compile(r"[^\x00-\x7f]+"),
    # Option packages. "EX-L w/Honda Sensing" is an EX-L; the package is not a
    # trim level, and treating it as one splits a trim into two.
    re.compile(r"\bw/.*$"),
    # Mileage claims: "74173 Miles", "66k Miles", "124K MILES ONLY", "60k miles".
    re.compile(r"\b\d[\d,]*\s*k?\s*miles?\b"),
    re.compile(r"\b\d+k\b"),
    re.compile(r"\bmiles?\b"),
    # Dealer stock numbers, always trailing a dash: "GLI Autobahn - 515266A".
    re.compile(r"-\s*\d{4,}[a-z]?\b"),
    # Location bleed from dealer-style titles, anchored at the end so a real
    # trim word is never eaten: "... FWD in Chesterfield MO".
    re.compile(r"\bin\s+[a-z.]+(?:\s+[a-z.]+)*\s+[a-z]{2}\s*$"),
)

#: Separators to flatten, KEEPING the dot so decimal displacements survive.
_TRIM_SEPARATORS = re.compile(r"[^a-z0-9.]+")

#: A dot that is not between two digits, i.e. not part of a displacement.
_DANGLING_DOT = re.compile(r"(?<!\d)\.|\.(?!\d)")


def trim_tokens(trim_text: str | None) -> frozenset[str]:
    """Meaningful trim tokens, body-style and listing noise removed.

    "Touring Sport Utility 4D" and "Touring" read as the same trim; captured
    data writes the same car both ways. "Sport SUV 4D" keeps its "sport",
    because there it is the trim rather than the body.

    ENGINE DISPLACEMENT IS PRESERVED, and that is why this does not simply
    reuse `normalize_key`. Flattening every non-alphanumeric splits "2.0T" into
    "2" and "0t", and the "2" is then dropped as a bare number -- so every
    Audi and Subaru displacement trim collapsed to the token "0t" and 2.0T was
    indistinguishable from 3.0T. "0t" was the 15th most common token across the
    stored trim strings. The dot is kept between digits for exactly this case.

    Bare integers are still dropped: they are overwhelmingly body-style
    leftovers ("4D"), bed lengths ("5 3/4 ft") and stock numbers rather than
    trim levels.
    """
    if not trim_text:
        return frozenset()

    text = trim_text.lower()
    for pattern in _TRIM_NOISE_PATTERNS:
        text = pattern.sub(" ", text)

    text = _DANGLING_DOT.sub(" ", _TRIM_SEPARATORS.sub(" ", text))
    text = f" {' '.join(text.split())} "
    for phrase in (*_BODY_STYLE_PHRASES, *_DRIVETRAIN_PHRASES):
        text = text.replace(f" {phrase} ", " ")

    return frozenset(t for t in text.split() if t and not t.replace(".", "").isdigit())


#: Stood in for a listing's trim when nothing was stated. Most Marketplace
#: listings say nothing about trim at all (spec 4.3: "frequently missing"), and
#: leaving that as an empty set made `trim_matches` collapse to `None` for
#: nearly every comp the moment the TARGET's trim was unstated -- not because
#: the comps disagreed with anything, but because there was nothing to compare.
#: Treating "unstated" as the base trim turns that into an actual comparison:
#: two unstated-trim vehicles are assumed to match (both base), and an
#: unstated-trim vehicle against a comp with a real trim ("Touring") correctly
#: reads as a mismatch rather than as unknown.
_BASE_TRIM = frozenset({"base"})


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


class DealerSignal(StrEnum):
    """Placeholder for spec 4.3's dealer exclusion.

    Always UNAVAILABLE at step 3. Comp cards carry no description and no seller
    listing count (NULL on every seller observation captured), so none of the
    three signals the spec names can be computed. Kept as a named value so the
    absence is reported to the user rather than reading as "no dealers found".
    """

    UNAVAILABLE = "unavailable"


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
        return parse_transmission(self.trim_text)


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
    trim_matches: bool | None = None
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
        return self.fit_points, False

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
    # Unstated is assumed base trim (see `_BASE_TRIM`), not "unknown".
    target_trim = trim_tokens(target.trim_text) or _BASE_TRIM

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
        # Unstated is assumed base trim on both sides, so this is always an
        # actual comparison rather than an "unknown" -- see `_BASE_TRIM`.
        comp_trim = trim_tokens(c.trim_text) or _BASE_TRIM
        matches: bool = trims_agree(target_trim, comp_trim)

        notes: list[str] = []
        if c.drivetrain is not DrivetrainSignal.UNKNOWN:
            notes.append(f"drivetrain {c.drivetrain.value} (recorded, not filtered)")

        provisional.append(
            CompDecision(
                candidate=c,
                included=True,
                mileage_unknown=c.mileage is None,
                trim_matches=matches,
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

    comp_set.decisions = provisional
    return comp_set
