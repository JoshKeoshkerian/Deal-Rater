"""Tunable constants for the ownership-cost context call (spec 6.6, 10).

Everything here is a knob rather than a derivation, kept in one file for the
same reason the pricing and scam parameters are: so that changing a threshold
never means reading the logic that consumes it.
"""

from __future__ import annotations

# --- Model selection -------------------------------------------------------
#
# Spec 3: "one cached text call per evaluation. No vision in the MVP." Spec 10:
# "Without vision, per-evaluation cost is dominated by one small text call. Keep
# it that way."
#
# Haiku 4.5 is the cheapest current Claude model. The task is recall of
# well-documented failure modes plus short prose -- it is not a reasoning
# problem, and paying Opus rates per cache miss would not make a 2013 Focus's
# dual-clutch problem more true.
DEFAULT_MODEL = "claude-haiku-4-5"

#: Enough for four short lists and a paragraph. The prompt caps list lengths, so
#: hitting this ceiling means the model ignored the format, not that the answer
#: was long -- and a truncated JSON body fails to parse and is discarded.
MAX_TOKENS = 1200

#: Thinking is deliberately not enabled. Haiku 4.5 predates adaptive thinking,
#: so the only option would be a fixed `budget_tokens` reservation, and this
#: task does not need one -- it is recall and summarisation, not reasoning.
#: Omitting the parameter runs the model without thinking, which is the cheap
#: path and the point of choosing Haiku.

#: Bumped whenever the prompt or the output shape changes in a way that makes
#: previously cached text wrong or unparseable. Part of the cache key, so a bump
#: invalidates every stored answer without a migration or a manual purge.
PROMPT_VERSION = 1


# --- Cost accounting (spec 10) ---------------------------------------------
#
# "Instrument cost per evaluation from day one. This number determines whether
# the product can be free, freemium, or paid."
#
# Published Haiku 4.5 rates: $1.00 per million input tokens, $5.00 per million
# output tokens. Expressed per token in MICRO-DOLLARS (millionths of a dollar),
# which makes both rates exact integers and keeps the stored cost free of
# floating-point drift when summed over thousands of calls.
#
# THESE MUST BE UPDATED IF `DEFAULT_MODEL` CHANGES. A stale rate here does not
# fail loudly; it silently reports the wrong cost, which is worse. The model id
# is stored on every cache row precisely so a mismatch is detectable after the
# fact.
INPUT_MICRODOLLARS_PER_TOKEN = 1
OUTPUT_MICRODOLLARS_PER_TOKEN = 5


def cost_microdollars(input_tokens: int, output_tokens: int) -> int:
    """Cost of one completion in millionths of a dollar."""
    return (
        input_tokens * INPUT_MICRODOLLARS_PER_TOKEN
        + output_tokens * OUTPUT_MICRODOLLARS_PER_TOKEN
    )


# --- Cache key: mileage bands (spec 10) ------------------------------------
#
# "Cache known-issues text by year/make/model/trim/mileage-band, not per
# listing. Every 2013 Focus at 90k miles gets the same answer, so most calls
# collapse into cache hits almost immediately."
#
# 25k is chosen to match how failure modes are actually discussed -- "around
# 100k" rather than "at 98,400" -- and to keep the cache dense. Narrower bands
# would multiply the miss rate without changing any answer.
MILEAGE_BAND_SIZE = 25_000

#: Above this everything shares one band. Past 200k the relevant advice stops
#: being mileage-specific and becomes "this is a high-mileage car".
MILEAGE_BAND_CEILING = 200_000

#: Used when the listing states no mileage. Kept as its own band rather than
#: guessed at: the answer for an unknown-mileage car is genuinely different
#: (it leans on the model's lifetime issues, not a mileage window).
UNKNOWN_MILEAGE_BAND = "unknown"


def mileage_band(mileage: int | None) -> str:
    """Bucket a mileage reading into its cache-key band."""
    if mileage is None or mileage < 0:
        return UNKNOWN_MILEAGE_BAND
    if mileage >= MILEAGE_BAND_CEILING:
        return f"{MILEAGE_BAND_CEILING // 1000}k+"
    start = (mileage // MILEAGE_BAND_SIZE) * MILEAGE_BAND_SIZE
    return f"{start // 1000}-{(start + MILEAGE_BAND_SIZE) // 1000}k"


def describe_mileage_band(band: str) -> str:
    """The band as prose, for the prompt.

    Kept next to `mileage_band` so the two cannot drift: the key and the words
    the model reads have to describe the same window, or the cache would serve
    an answer written about a different range.
    """
    if band == UNKNOWN_MILEAGE_BAND:
        return "not stated"
    if band.endswith("k+"):
        return f"{int(band[:-2]) * 1000:,} miles and above"
    low, high = band.rstrip("k").split("-")
    return f"{int(low) * 1000:,} to {int(high) * 1000:,} miles"


# --- Spec 10's deterministic gate ------------------------------------------
#
# "Gate the LLM call behind deterministic checks. If pricing is disqualifying or
# the description contains a hard disqualifier (salvage, 'for parts'), return
# the verdict without a model call."
#
# Deliberately short and unambiguous. A phrase earns a place here only if its
# presence means the buyer's decision is already made -- at which point "what
# fails on this model at 90k" is not the question. Anything merely worrying
# ("needs work", "as is") belongs to the scam and completeness flags, which are
# free, not to a paid gate.
HARD_DISQUALIFIER_PHRASES: tuple[str, ...] = (
    "for parts",
    "parts only",
    "parts car",
    "part out",
    "salvage title",
    "salvaged title",
    "rebuilt title",
    "no title",
    "bill of sale only",
    "blown engine",
    "blown motor",
    "seized engine",
    "engine knock",
    "does not run",
    "doesn't run",
    "not running",
    "won't start",
    "does not start",
    "mechanic special",
)

#: Pricing bands from `pricing/curve.py` that make the call pointless. An
#: unexplained discount this deep is spec 2's adverse selection, and the verdict
#: is the discount itself -- model-specific maintenance advice does not change
#: it and would read as endorsement of a listing the pricing model distrusts.
DISQUALIFYING_PRICING_BANDS: frozenset[str] = frozenset({"implausible_discount"})
