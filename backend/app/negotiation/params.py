"""Tunable constants for time-on-market and negotiation strength (spec 6.4).

Same convention as `app/pricing/params.py`: everything here is UNCALIBRATED
until spec 9's validation pass runs. Each value carries the reasoning that
produced it and the spec line it came from.

Negotiation strength is a SEPARATE reading from deal quality. Spec 6.4:
"Genuinely orthogonal to deal quality: a slightly overpriced car that has sat 58
days is a weak deal and a strong negotiation." Nothing in this module modifies a
price, a rating, or a confidence level.
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
