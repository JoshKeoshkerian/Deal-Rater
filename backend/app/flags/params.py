"""Tunable constants for flags and completeness (spec 6.2, 6.3, build step 5).

UNCALIBRATED, same as the other params modules. Spec 9 has not run.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Scam pattern detection (spec 6.3)
# ---------------------------------------------------------------------------

# Spec 6.3: "Any one of these is weak. FOUR together is a strong signal and
# should produce a distinct, prominent warning rather than a numerical deduction
# buried in a composite."
#
# Taken from the spec text verbatim. See `scam.py` for why this number is harder
# to reach than the spec assumes: two of the seven signals cannot be evaluated at
# all with the data this product collects.
SCAM_SIGNALS_FOR_WARNING = 4

# A description shorter than this counts as "minimal" for the scam signal
# (spec 6.3). UNCALIBRATED. Captured private-party descriptions run 247-754
# characters.
#
# Deliberately a SEPARATE constant from `MINIMAL_DESCRIPTION_CHARS` below,
# even though both currently hold 120. They used to be the same import: a
# sparse description cost `information_completeness` AND fired this scam
# signal off the literal same threshold, so one missing fact was double-
# counted through two dimensions of the composite (docs/scoring-audit.md
# finding #6). The two questions -- "did the seller disclose enough" and
# "is this listing shaped like a scam" -- are independently reasoned and
# should stay independently tunable, even though no data yet justifies
# giving them different values.
SCAM_MINIMAL_DESCRIPTION_CHARS = 120

# Photo count at or below which a listing counts as having "very few photos".
# UNCALIBRATED. Spec 11 notes photo COUNT is free metadata and "captures a
# meaningful share of the signal" that vision would otherwise provide.
FEW_PHOTOS = 3

# A description this long or longer counts as "otherwise detailed", which is what
# makes an omitted VIN meaningful rather than merely normal (spec 4.2, 6.3).
DETAILED_DESCRIPTION_CHARS = 400

# How far below the expected asking price counts as "far below" for the scam
# pattern. Distinct from the pricing curve's ADVERSE_SELECTION_RESIDUAL: that one
# lowers confidence in a price, this one contributes to a fraud warning.
# UNCALIBRATED.
#
# THE MIDDLE of three independent "how suspicious is this discount" cutoffs --
# see `pricing/params.py`'s `IMPLAUSIBLE_DISCOUNT` for the full cross-reference,
# the third (`ADVERSE_SELECTION_RESIDUAL`), and the intended graduated ordering
# `test_discount_threshold_ordering.py` protects.
SCAM_PRICE_RESIDUAL = -0.35

# ---------------------------------------------------------------------------
# Information completeness (spec 5.2)
# ---------------------------------------------------------------------------
#
# Spec 5.2 gives completeness a weight of 15 in the composite score (build step
# 8). It is computed here as its own reading and is NOT combined with anything.

# A description shorter than this counts as absent for completeness credit.
# UNCALIBRATED. See `SCAM_MINIMAL_DESCRIPTION_CHARS` above for why this is a
# distinct constant from that one despite sharing a value today.
MINIMAL_DESCRIPTION_CHARS = 120

# Photo count at or above which photos stop adding to completeness.
AMPLE_PHOTOS = 8

# Description length at or above which prose stops adding to completeness.
AMPLE_DESCRIPTION_CHARS = 300
