"""Tunable constants for better-alternatives (spec 6.5, build step 7).

UNCALIBRATED, like every other params module here. Spec 9 has not run.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# When to show alternatives at all (spec 6.5)
# ---------------------------------------------------------------------------
#
# Spec 6.5: "Show alternatives when the target scores average or worse and
# better-priced comps exist within a reasonable radius. Suppress when the target
# is already the best available, and say so, since that is also useful."

# "Average or worse" is decided by COMPARISON against the comp set, not by an
# absolute threshold on the pricing curve -- see `finder._should_suppress` for
# why the old `SHOW_WHEN_RATING_AT_OR_BELOW = 60.0` was removed. There is no
# constant here because the median of the comp residuals is the threshold, and
# it is recomputed per listing.

# How much better a comp's own residual must be before it counts as a
# meaningful advantage rather than a practical tie. Without a margin, a comp
# 0.4% cheaper would be presented as decisively better, which is noise dressed
# up as advice. UNCALIBRATED.
MIN_RESIDUAL_ADVANTAGE = 0.05

# How much WORSE a same-trim comp's residual may be than the target's and
# still be shown in `alternatives` as "equalish" rather than dropped.
#
# Added 2026-07-30 alongside the trim restriction in `finder.py`: with
# `alternatives` now scoped to comps that actually share the target's trim,
# the pool is often thin (spec 4.3: trim is missing on 21% of comps outright),
# and a same-trim comp within a couple of points of the target's own residual
# is a practical tie, not "worse" -- silently dropping it made "no
# alternatives" and "no BETTER alternatives" look identical when they are not.
# Only pulls comps in on the good-or-tied side: `find_alternatives` still
# excludes anything genuinely worse than the target. UNCALIBRATED.
EQUALISH_TOLERANCE = 0.02

# Most same-trim alternatives to show. Spec 6.5's example names four; beyond a
# handful the list stops being a recommendation and becomes a search results
# page.
MAX_ALTERNATIVES = 4

# Most different-trim alternatives to show, in the "Different trim" dropdown.
# Mirrors MAX_ALTERNATIVES; kept as its own constant because there is no
# reason the two caps have to move together -- the different-trim pool is
# usually the larger one (see `finder.py`'s TRIM-RESTRICTED note), so the same
# cap keeps that dropdown from turning into a second search-results page.
MAX_DIFFERENT_TRIM_ALTERNATIVES = 4

# ---------------------------------------------------------------------------
# What disqualifies a comp from being recommended
# ---------------------------------------------------------------------------

# A comp priced this far below its own expected value is not a recommendation,
# it is the adverse-selection case spec 2 warns about: "an unexplained extreme
# discount should reduce confidence rather than inflate the score." Naming such
# a listing as a "better option" would send a first-time buyer straight at the
# riskiest car in the set. UNCALIBRATED; kept in step with the pricing curve's
# ADVERSE_SELECTION_RESIDUAL.
TOO_CHEAP_TO_RECOMMEND = -0.25

# Outlier sensitivity beyond which the fitted line is not trustworthy enough to
# rank listings against.
#
# Alternatives are ranked by residual against the fit, so when one comp is
# dragging the line the ORDER of those residuals stops meaning much. Capture 9
# is the case that prompted this: R-squared 0.18, sensitivity 72%, and the
# resulting "best alternative" was a 2006 Civic advertised at 2,200 miles --
# almost certainly a typo, and exactly the listing a broken fit promotes.
#
# Naming specific listings to a first-time buyer is a stronger act than printing
# a range, so it needs a firmer footing. UNCALIBRATED.
MAX_OUTLIER_SENSITIVITY_TO_RECOMMEND = 0.30

# Mileage advantage beyond which a cheaper comp is flagged as a trade-off rather
# than a straight win. A car $2k cheaper with 60k more miles is not better; it
# is different. UNCALIBRATED.
MILEAGE_TRADEOFF_THRESHOLD = 25_000
