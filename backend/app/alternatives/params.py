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

# How much better a comp's own residual must be before it is worth naming.
# Without a margin, a comp 0.4% cheaper would be presented as an alternative,
# which is noise dressed up as advice. UNCALIBRATED.
MIN_RESIDUAL_ADVANTAGE = 0.05

# Most alternatives to show. Spec 6.5's example names four; beyond a handful the
# list stops being a recommendation and becomes a search results page.
MAX_ALTERNATIVES = 4

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
