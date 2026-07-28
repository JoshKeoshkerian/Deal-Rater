"""Tunable constants for time-on-market and negotiation strength (spec 6.4).

Same convention as `app/pricing/params.py`: everything here is UNCALIBRATED
until spec 9's validation pass runs. Each value carries the reasoning that
produced it and the spec line it came from.

Negotiation strength is a SEPARATE reading from deal quality. Spec 6.4:
"Genuinely orthogonal to deal quality: a slightly overpriced car that has sat 58
days is a weak deal and a strong negotiation." Nothing in this module modifies a
price, a rating, or a confidence level.

Also holds the base strength, the time-on-market bands, the leverage
cutoffs, and the language-score cap/multiplier that used to live as inline
literals in `strength.py` (docs/scoring-audit.md finding #7) -- moved here so
`strength.py` imports from this module the same way `curve.py` imports from
`pricing/params.py`. Per-phrase language weights stay inline in
`language.py`'s `SIGNALS` tuple, where splitting weight from phrase/pattern
would hurt readability more than centralizing helps; see that file's own
UNCALIBRATED disclaimer.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Days listed (spec 6.4)
# ---------------------------------------------------------------------------

# Spec 6.4: "Under 24 hours means competing with everyone else who saw it, so
# leverage is low regardless of price."
FRESH_LISTING_HOURS = 24

# Spec 6.4: "30+ at unchanged price indicates a motivated seller and that the
# ask exceeds what the market will bear." Taken from the spec text directly and
# UNCALIBRATED.
STALE_LISTING_DAYS = 30

# Beyond this the listing is not merely stale, it has failed to sell across a
# whole season. UNCALIBRATED; captured data contains a listing at 104 days.
VERY_STALE_LISTING_DAYS = 75

# ---------------------------------------------------------------------------
# Price / time interaction (spec 6.4)
# ---------------------------------------------------------------------------
#
# Spec 6.4: "Model the interaction explicitly rather than scoring price and time
# independently. A car at market price sitting 45 days is a better opportunity
# than the price residual alone suggests."
#
# The interaction is expressed as a bonus to negotiation strength that applies
# only when the ask is at or above the expected asking price AND the listing is
# stale. Those two together mean the market has already declined the ask, which
# is different information from either fact alone.

# Residual at or above which the ask counts as "the market has not taken it".
MARKET_HAS_DECLINED_RESIDUAL = -0.02

# Strength points added when a listing is both stale and not underpriced.
# UNCALIBRATED.
STALE_AND_OVERPRICED_BONUS = 18.0

# ---------------------------------------------------------------------------
# Suggested offer (spec 7)
# ---------------------------------------------------------------------------

# How much further below the expected asking price a strong negotiating
# position justifies opening. Applied on top of the pricing anchor, never
# instead of it. UNCALIBRATED.
MAX_EXTRA_DISCOUNT_FROM_LEVERAGE = 0.06

# ---------------------------------------------------------------------------
# Strength scoring (spec 6.4, build step 4) -- moved from strength.py
# ---------------------------------------------------------------------------

# Starting point before any time-on-market or language signal is added.
# UNCALIBRATED.
BASE_STRENGTH = 30.0

# `_time_component`'s bands, 0-100 (well, 0-45 before rescaling -- see
# `NegotiationAssessment.time_on_market_score`). UNCALIBRATED throughout.
TIME_COMPONENT_VERY_STALE = 45.0
TIME_COMPONENT_STALE = 32.0
TIME_COMPONENT_ESTABLISHED = 18.0  # 14+ days, "early interest has passed"
TIME_COMPONENT_ORDINARY = 8.0
TIME_COMPONENT_FRESH = 0.0  # under FRESH_LISTING_HOURS

# `_language_component`'s cap and per-phrase-weight multiplier. Capped so a
# description stuffed with motivated phrasing cannot swamp the time signal,
# which is the more objective of the two. UNCALIBRATED.
LANGUAGE_SCORE_CAP = 20.0
LANGUAGE_SCORE_MULTIPLIER = 4.0

# `strength` thresholds for STRONG / MODERATE / WEAK leverage. UNCALIBRATED.
LEVERAGE_STRONG_AT = 70.0
LEVERAGE_MODERATE_AT = 45.0
