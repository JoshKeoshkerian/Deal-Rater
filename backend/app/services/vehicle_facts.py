"""Decompose a free-text trim string into the separate facts it encodes.

WHY THIS EXISTS
---------------
`trim_text` is one column carrying at least four different facts. Captured data
writes "2.0i Premium Sport Utility 4D", which is:

    trim level    Premium
    body style    sport_utility_4d
    engine        2.0i
    drivetrain    (unstated here; often appended as "AWD")

Comp filtering compared those strings by exact token-set equality, so
"Premium Sport Utility 4D" and "2.0i Premium Sport Utility 4D" read as different
trims on the strength of an engine prefix, and a body-style mismatch was
indistinguishable from a trim-level one -- "EX-L Hatchback 4D" vs "EX Sedan 4D"
failed as a single opaque comparison with no way to tell which half caused it.

Storing the parts separately makes the comparison attributable, and makes the
question answerable from SQL rather than only from inside the pricing model.

WHERE THIS RUNS
---------------
Server-side, at ingest, from the verbatim `trim_text` the extension captured.
Deliberately NOT in the extension: `extract/fields/vehicle.ts` keeps trim
unnormalised because step 6 replaces it with the VIN-decoded value where a VIN
was recovered, and a normalisation applied at capture time would have to be
undone. `trim_text` therefore stays the audit trail and these columns are
derived from it -- which is also what makes them backfillable for the
observations already collected.

ONE DEFINITION OF "SAME TRIM"
-----------------------------
The phrase lists below were built by `pricing/comps.py` against real captured
data and are moved here rather than copied, so the pricing model and anything
querying the stored columns cannot drift apart. `comps.py` re-exports
`trim_tokens`, `parse_drivetrain` and `parse_transmission` from this module for
its existing callers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class DrivetrainSignal(StrEnum):
    """Drivetrain parsed from free text.

    Was inert at step 3 -- recorded, never filtered on -- because it was only
    ever recoverable by regex over trim text, which finds it on a minority of
    listings. `vehicle_transmission_type`'s sibling field is now captured
    directly from the payload, but drivetrain has no such key, so this remains
    the only source until VIN decode (spec 4.2) supplies it.
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
    """Best-effort drivetrain from trim text. Returns UNKNOWN more often than not."""
    for text in texts:
        if not text:
            continue
        for pattern, signal in _DRIVETRAIN_PATTERNS:
            if pattern.search(text):
                return signal
    return DrivetrainSignal.UNKNOWN


def parse_transmission(*texts: str | None) -> str | None:
    """Best-effort transmission from free text.

    Returned None on 100% of captured comp data, which is what
    `vehicle_transmission_type` now replaces as the primary source. Kept for
    rows where the payload field is absent -- every backfilled observation, and
    any comp card that does not carry one.
    """
    for text in texts:
        if not text:
            continue
        match = _TRANSMISSION_PATTERN.search(text)
        if match:
            return match.group(0).lower()
    return None


# Body-style noise, matched as PHRASES before tokenising rather than as loose
# words. The ordering matters and the phrase form is load-bearing: "Sport" is a
# body-style word in "Touring Sport Utility 4D" and a genuine trim level in
# "Sport SUV 4D", and both spellings occur in captured data for the same model.
# Dropping "sport" as a bare stopword would erase the trim from the second.
#
# The van/pickup/cab entries were added after a database pass over the populated
# trim strings: without them "EX-L Sedan 4D" and "EX-L Minivan 4D" read as
# different trims, as do "1500 LT Pickup 4D 5 3/4 ft" and "LT". Both pairs are
# the same trim written against different body styles.
#
# Longest first, so "sport utility" is consumed before "utility" and
# "crew cab" before "cab".
_BODY_STYLE_PHRASES = (
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
    "4d",
    "2d",
    # Bed-length tail, left behind once "5 3/4" tokenises away as bare digits.
    "ft",
)

# Drivetrain words, stripped from the TRIM comparison specifically because
# drivetrain is parsed out of the same string separately. Leaving them here
# would count one signal twice and report a false trim mismatch every time one
# seller wrote "EX-L FWD" and another wrote "EX-L" -- which is most of them.
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
# needs the punctuation to identify itself. All are real forms found in stored
# trim strings, where the field is the leftover remainder of a title split and
# carries whatever the seller wrote.
_TRIM_NOISE_PATTERNS = (
    # Emoji and other non-ASCII: "LT 🤘 74173 Miles", "Turbo – ¡El deportivo...".
    re.compile(r"[^\x00-\x7f]+"),
    # Option packages. "EX-L w/Honda Sensing" is an EX-L; the package is not a
    # trim level, and treating it as one splits a trim into two.
    re.compile(r"\bw/.*$"),
    # Mileage claims: "74173 Miles", "66k Miles", "124K MILES ONLY".
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

#: An engine designator: a decimal displacement with an optional series letter
#: ("2.0", "2.0T", "2.0i", "3.6L"). Bare integers are excluded deliberately --
#: they are overwhelmingly body-style leftovers ("4D") and bed lengths.
_ENGINE_TOKEN = re.compile(r"^\d\.\d[a-z]?$")


def _scrub(trim_text: str) -> str:
    """Lowercase, strip listing noise, and space-pad for phrase removal."""
    text = trim_text.lower()
    for pattern in _TRIM_NOISE_PATTERNS:
        text = pattern.sub(" ", text)
    text = _DANGLING_DOT.sub(" ", _TRIM_SEPARATORS.sub(" ", text))
    return f" {' '.join(text.split())} "


def trim_tokens(trim_text: str | None) -> frozenset[str]:
    """Meaningful trim tokens, body-style and listing noise removed.

    "Touring Sport Utility 4D" and "Touring" read as the same trim; captured
    data writes the same car both ways. "Sport SUV 4D" keeps its "sport",
    because there it is the trim rather than the body.

    ENGINE DISPLACEMENT IS PRESERVED. Flattening every non-alphanumeric splits
    "2.0T" into "2" and "0t", and the "2" is then dropped as a bare number -- so
    every Audi and Subaru displacement trim collapsed to the token "0t" and 2.0T
    was indistinguishable from 3.0T. "0t" was the 15th most common token across
    the stored trim strings. The dot is kept between digits for exactly this
    case.

    Bare integers are still dropped: they are overwhelmingly body-style
    leftovers ("4D"), bed lengths ("5 3/4 ft") and stock numbers.

    NOTE the asymmetry with `decompose`: this keeps the engine token in the set,
    `decompose` splits it into its own field. That is deliberate and this
    behaviour is unchanged -- `trims_agree` is calibrated against it, and
    `params.py` forbids moving a threshold without a calibration run behind it.
    """
    if not trim_text:
        return frozenset()

    text = _scrub(trim_text)
    for phrase in (*_BODY_STYLE_PHRASES, *_DRIVETRAIN_PHRASES):
        text = text.replace(f" {phrase} ", " ")

    return frozenset(t for t in text.split() if t and not t.replace(".", "").isdigit())


@dataclass(frozen=True)
class VehicleFacts:
    """The separate facts a single `trim_text` string encodes."""

    #: Trim level with body style, engine and drivetrain removed: "Grand Touring".
    #: None when nothing is left, which is the honest answer for a trim string
    #: that was only ever a body style ("Sedan 4D").
    trim_level: str | None
    #: Normalised body style: "sport_utility", "sedan", "hatchback", ...
    body_style: str | None
    #: Engine designator as written: "2.0t", "2.5".
    engine_text: str | None
    #: Drivetrain, or None when unstated. Not `UNKNOWN` -- a stored column
    #: should carry SQL's null for "not stated" rather than a sentinel string.
    drivetrain: str | None


#: Normalised spellings for body styles that are written several ways. The
#: door-count suffix is dropped: "Sedan 4D" and "Sedan" are the same body, and
#: keeping the count would re-create the spurious distinctions this exists to
#: remove. Cab variants keep their own identity because on a pickup the cab IS
#: the body style and drives price.
_BODY_STYLE_CANONICAL = {
    "sport utility": "sport_utility",
    "suv": "sport_utility",
    "passenger van": "van",
    "minivan": "minivan",
    "van": "van",
    "crew cab": "crew_cab",
    "regular cab": "regular_cab",
    "extended cab": "extended_cab",
    "ext cab": "extended_cab",
    "quad cab": "quad_cab",
    "double cab": "double_cab",
    "supercrew": "crew_cab",
    "cab": "cab",
    "hatchback": "hatchback",
    "convertible": "convertible",
    "roadster": "convertible",
    "coupe": "coupe",
    "sedan": "sedan",
    "wagon": "wagon",
    "pickup": "pickup",
    "truck": "truck",
}


def decompose(trim_text: str | None) -> VehicleFacts:
    """Split one trim string into trim level, body style, engine and drivetrain.

    Every part is optional and independently absent; a listing that states only
    "LX" yields a trim level and three nulls, which is correct rather than
    degraded.
    """
    if not trim_text:
        return VehicleFacts(None, None, None, None)

    drivetrain = parse_drivetrain(trim_text)
    text = _scrub(trim_text)

    # Body style first and longest-phrase-first, so "sport utility" is consumed
    # before a bare "utility" and "crew cab" before "cab". Only the FIRST body
    # style found is recorded: a string naming two is malformed, and picking one
    # arbitrarily is better than concatenating them into a value that matches
    # nothing.
    body_style: str | None = None
    for phrase in _BODY_STYLE_PHRASES:
        if f" {phrase} " in text:
            if body_style is None:
                body_style = _BODY_STYLE_CANONICAL.get(phrase)
            text = text.replace(f" {phrase} ", " ")

    for phrase in _DRIVETRAIN_PHRASES:
        text = text.replace(f" {phrase} ", " ")

    engine_text: str | None = None
    level_tokens: list[str] = []
    for token in text.split():
        if not token:
            continue
        if _ENGINE_TOKEN.match(token):
            # First engine designator wins, for the same reason as body style.
            if engine_text is None:
                engine_text = token
            continue
        # Bare integers are body-style and bed-length leftovers, never a trim.
        if token.replace(".", "").isdigit():
            continue
        level_tokens.append(token)

    return VehicleFacts(
        trim_level=" ".join(level_tokens) or None,
        body_style=body_style,
        engine_text=engine_text,
        drivetrain=None if drivetrain is DrivetrainSignal.UNKNOWN else drivetrain.value,
    )
