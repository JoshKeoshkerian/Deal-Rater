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
# The offer plan (spec 7.5), see `offer.py`
# ---------------------------------------------------------------------------

# How far below the expected asking price a maximal negotiating position
# justifies landing. Scaled by `NegotiationAssessment.leverage_fraction`, so a
# listing with no time-on-market evidence gets none of it. UNCALIBRATED.
#
# Deliberately equal to `pricing.params.STRONG_OFFER_BELOW`, which is what makes
# the two sections agree rather than compete: the pricing gauge's "strong offer"
# is the best case, and the negotiation target slides between the expected price
# and that figure according to how much leverage the listing actually gives.
MAX_LEVERAGE_DISCOUNT = 0.06

# Gap between the opening offer and the price the buyer expects to settle at.
# An opening offer equal to the target leaves nowhere to be met, so a seller who
# splits the difference lands ABOVE what the evidence supports. UNCALIBRATED.
OPENING_GAP = 0.05

# Furthest below the ASK an opening offer can sit and still be answered.
#
# The concept the spec has no equivalent of, and the reason it is needed: an
# offer anchored purely to the expected price can land 40% under a badly
# overpriced ask, which does not read as an aggressive opening -- it reads as an
# insult, and it ends the conversation the brief exists to start. Private-party
# sellers rarely reply below roughly this much off. UNCALIBRATED, and the number
# most worth checking against real message threads.
MAX_CREDIBLE_BELOW_ASK = 0.15

# ---------------------------------------------------------------------------
# Ask-anchored bands
# ---------------------------------------------------------------------------
#
# Used when the comp set cannot name a market price at all -- which is the
# COMMON case, not the edge case: `pricing.params.MAX_INTERVAL_WIDTH_FOR_ANCHORS`
# withholds the expected-price anchors on roughly 95% of real evaluations
# (docs/scoring-audit.md finding #5). Anchoring the whole brief to a figure that
# exists one time in twenty is what left this section with a leverage word and a
# day count and nothing to act on.
#
# Spec 6.4 already justifies the alternative: negotiation strength is "genuinely
# orthogonal to deal quality", so a figure derived from time on market and
# seller wording owes the comp set nothing. It is a different, weaker claim --
# "this is what sellers in this position usually take", not "this is what the car
# is worth" -- and `OfferBasis` records which claim is being made so the UI can
# say so.
#
# Each pair interpolates from no leverage to maximum leverage. The floors are the
# ordinary movement in a private-party sale; the ceilings meet
# MAX_CREDIBLE_BELOW_ASK so the two models cannot disagree about what is
# credible. UNCALIBRATED throughout.
ASK_ANCHORED_OPENING_MIN = 0.07
ASK_ANCHORED_OPENING_MAX = 0.15
ASK_ANCHORED_TARGET_MIN = 0.03
ASK_ANCHORED_TARGET_MAX = 0.09

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

# The most `strength` can rise above BASE_STRENGTH: the very-stale time band,
# the stale-and-overpriced interaction, and a description made entirely of
# motivated phrasing. Derived rather than chosen, so it cannot drift out of step
# with the three constants it is the sum of.
#
# This is what makes `leverage_fraction` mean "how much of the available evidence
# this listing actually has" rather than "strength over 100". Dividing by 100
# would hand a listing posted an hour ago by a seller who wrote "firm, no
# lowballers" a leverage fraction of 0.3, and with it a discount it has done
# nothing to earn -- which is exactly the bug the old `extra_discount` had.
MAX_STRENGTH_ABOVE_BASE = (
    TIME_COMPONENT_VERY_STALE + STALE_AND_OVERPRICED_BONUS + LANGUAGE_SCORE_CAP
)
