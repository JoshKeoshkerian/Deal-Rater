"""Every tunable constant in the expected-asking-price model, in one file.

Two kinds of constant live here and they are not the same thing:

  CALIBRATED    derived from data, safe to trust
  UNCALIBRATED  a placeholder standing in for a number section 9 has not
                produced yet

Everything below is currently UNCALIBRATED. There is no ground truth set in the
repo, so nothing here has been fitted to anything — these are documented guesses
chosen to be defensible, not correct. Each one carries the reasoning that
produced it and the section that will replace it.

Do not tighten any of these without a calibration run behind it. A narrower
interval or a more confident curve that is not backed by held-out accuracy is
strictly worse than the wide version, because it manufactures confidence the
data does not support (spec 9.5).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Comp filtering (spec 4.3)
# ---------------------------------------------------------------------------

# How far from the target's model year a comp may be and still be a comp.
# UNCALIBRATED. +/-2 keeps a generation together for most models while staying
# narrow enough that a mid-cycle redesign does not slip in.
YEAR_WINDOW = 2

# Progressive widening ladder (spec 4.3): "Below that, fall back progressively
# (widen radius, then year range) and report low confidence explicitly."
#
# Tried in order, stopping at the FIRST window that reaches
# MIN_COMPS_FOR_REGRESSION. Minimal widening is the least damaging: a 2019 and a
# 2015 of the same model are genuinely different cars, and every step trades comp
# quality for comp count.
#
# The spec widens radius first and year range second. This does the opposite,
# because measurement says so: across 48 captures, 0% of comps were rejected for
# distance while 37% were rejected for falling outside +/-2 years. Facebook
# already returns a full page of results; the constraint is what survives
# filtering, not what comes back. Widening to +/-4 takes captures meeting the
# 8-comp floor from 34/48 to 38/48 at no request cost, and +/-5 adds nothing.
#
# Radius widening remains worth doing for genuinely rare vehicles -- there is no
# eighth Porsche 924 in one metro at any year window -- and is the follow-up.
YEAR_WINDOW_LADDER = (2, 3, 4)

# Absolute floor for a believable private-party asking price, in cents.
# UNCALIBRATED. Captured data contains a $25 "Protege speed" and a $180 row with
# no make or model; both are placeholders, parts cars, or scams rather than
# vehicles being sold at that price. They drag a small-sample fit badly.
MIN_PLAUSIBLE_PRICE_CENTS = 50_000

# A comp priced below this fraction of the comp set's own median is treated as
# junk rather than as a data point. UNCALIBRATED, and deliberately generous: the
# whole product exists to find genuinely underpriced cars, so this must only
# catch listings that are not really offers at all.
MIN_PRICE_FRACTION_OF_MEDIAN = 0.15

# Mileage beyond which a reading is assumed to be a typo or a placeholder.
# UNCALIBRATED.
MAX_PLAUSIBLE_MILEAGE = 500_000

# Two listings are treated as the same vehicle only when their fuzzy identity
# key matches AND their asking prices agree to within this fraction.
#
# The key alone is too blunt for this job. It buckets mileage at 10k and keys on
# city, so two genuinely different 2016 CX-5s at 120k and 123k miles in St Louis
# share a key -- and dropping one of them would thin an already thin comp set.
# Requiring price agreement as well is what makes the match safe: the real
# duplicates found in captured data agreed exactly ($5,500 twice in Jackson MO,
# $12,490 twice in Arnold MO), while unrelated cars sharing a key do not.
#
# Non-zero rather than exact because a relisted car often returns at a slightly
# different price. UNCALIBRATED.
DUPLICATE_PRICE_TOLERANCE = 0.05

# ---------------------------------------------------------------------------
# Comp count thresholds (spec 4.3, calibrated by spec 0)
# ---------------------------------------------------------------------------

# Spec 4.3 puts the floor at "roughly 8", to be calibrated against the section 0
# comp-density test. That test's numbers are NOT in the repo, so 8 is taken from
# the spec text directly and is UNCALIBRATED here.
#
# Observed yield on the four captures currently stored is 8 / 4 / 2 / 10 after
# filtering, so two of four fall below this floor. That is a statement about the
# data, not about the threshold.
MIN_COMPS_FOR_REGRESSION = 8

# Below this, no central estimate is published at all. Spec 4.3: "Never silently
# score off 3 comps." UNCALIBRATED.
MIN_COMPS_FOR_ANY_ESTIMATE = 3

# A regression needs enough residual degrees of freedom for the interval to mean
# anything. With n-2 <= 1 the t multiplier explodes and the interval is honest
# but useless, so below this the model reports a location-only estimate instead.
MIN_COMPS_FOR_SLOPE = 6

# ---------------------------------------------------------------------------
# Interval (spec 5.1)
# ---------------------------------------------------------------------------

# Coverage of the reported prediction interval. 0.80 rather than 0.95 because
# the interval is shown to a user as an expected range, and a 95% interval on
# eight comps is so wide it stops being actionable. UNCALIBRATED: spec 9.5
# requires checking that ~80% of held-out listings actually fall inside it, and
# that check has not been run.
INTERVAL_COVERAGE = 0.80

# Floor on interval half-width as a fraction of the point estimate, applied to
# the regression interval. UNCALIBRATED.
#
# Rationale: comp mileage arrives rounded to the nearest 1,000 (every captured
# comp has mileage % 1000 == 0), so the regressor's x values carry roughly
# +/-500 miles of quantisation that the residual variance does not see. A fit
# can therefore look tighter than the inputs justify. This floor stops the model
# publishing an interval narrower than the input precision supports.
MIN_INTERVAL_HALF_WIDTH_FRACTION = 0.04

# Half-width used by the location-only fallback, as a fraction of the estimate,
# when there are too few comps to fit a slope. UNCALIBRATED. Wide on purpose:
# this is the "we do not really know" branch and it should look like it.
FALLBACK_INTERVAL_HALF_WIDTH_FRACTION = 0.22

# ---------------------------------------------------------------------------
# Rise-plateau-decline curve (spec 2, spec 5.1)
# ---------------------------------------------------------------------------
#
# Spec 2: the relationship between discount and quality is NOT linear. Adverse
# selection means the cheapest listings are disproportionately the worst cars,
# so the curve rises, plateaus, then falls as the discount becomes implausible.
#
# EVERY BREAKPOINT BELOW IS A PLACEHOLDER. Spec 15 lists "where the discount
# curve plateaus and declines" as an open question, and spec 9.4 assigns it to
# the calibration pass against the ground truth set. The values here come from
# the illustrative numbers in spec 2 ("10 to 15 percent under ... forty-five
# percent under") and have not been fitted to anything.
#
# Residuals are signed fractions of the expected asking price:
#   +0.10 = asking 10% ABOVE expected,  -0.10 = asking 10% BELOW expected.

# Above this, the car is priced over comps and the rating falls off.
OVERPRICED_KNEE = 0.05

# Where the "genuine deal" plateau begins and ends.
PLATEAU_START = -0.10
PLATEAU_END = -0.20

# Where an unexplained discount stops reading as a bargain and starts reading as
# a problem. Spec 2's "forty-five percent under is more likely to signal a
# problem" is the source of this number.
IMPLAUSIBLE_DISCOUNT = -0.45

# Rating awarded at the top of the plateau, and the floor the curve declines to
# at IMPLAUSIBLE_DISCOUNT. The decline floor is deliberately not zero: an
# extreme discount is a reason for suspicion, and suspicion is reported as
# reduced CONFIDENCE and a scam-pattern flag (step 5), not as a price rating of
# zero. Collapsing those would be exactly the conflation spec 2 forbids.
PLATEAU_RATING = 92.0
IMPLAUSIBLE_DISCOUNT_RATING = 45.0
FAIR_PRICE_RATING = 60.0
OVERPRICED_FLOOR_RATING = 5.0

# Residual at which an overpriced car bottoms out.
OVERPRICED_FLOOR = 0.30

# ---------------------------------------------------------------------------
# Negotiation anchors (spec 5.1's third and fourth numbers)
# ---------------------------------------------------------------------------

# How far below / above the expected asking price the suggested offer and the
# walk-away figure sit. UNCALIBRATED: taken from the relationship in spec 5.1's
# worked example (expected ~$14,050, strong offer $13,200, walk away $14,600).
STRONG_OFFER_BELOW = 0.06
WALK_AWAY_ABOVE = 0.04

# Widest interval, as a fraction of the point estimate, that still supports
# quoting a specific offer figure. Beyond this the anchors are withheld rather
# than printed, because every figure inside such a range is equally defensible
# and naming one implies precision the comp set does not have. UNCALIBRATED.
MAX_INTERVAL_WIDTH_FOR_ANCHORS = 0.30

# ---------------------------------------------------------------------------
# Confidence (spec 4.3, spec 5.1)
# ---------------------------------------------------------------------------
#
# Confidence is a SEPARATE OUTPUT from the price estimate and is never folded
# into it (spec 2: price and risk must not be collapsed; spec 6.4: confidence is
# a qualifier rather than a peer metric).

# Fraction of included comps that must carry a usable trim string before trim
# agreement is considered meaningful at all. Below this the comp set is treated
# as trim-unknown, which widens nothing directly but does lower confidence, per
# spec 4.3's "widen the interval and lower confidence rather than pretending the
# comp set is clean". UNCALIBRATED.
MIN_TRIM_COVERAGE = 0.5

# A discount past this point costs confidence regardless of how the price rating
# reads, because the most likely explanation is something the listing is not
# saying (spec 2). UNCALIBRATED.
ADVERSE_SELECTION_RESIDUAL = -0.25

# How far the least-squares estimate may move under a breakdown-resistant
# (Theil-Sen) fit before the comp set is treated as outlier-dominated.
#
# Measured on captured data, the two estimators differ by 0.7%, 4.0% and 12.2%
# across the three fittable captures -- and the 12.2% case flips the verdict
# from "overpriced" to "fair". That is a real fragility, and which estimator is
# closer to the truth is a calibration question (spec 9.4) with no ground truth
# set to answer it. So the disagreement lowers CONFIDENCE rather than switching
# the price. UNCALIBRATED.
MAX_ROBUST_DISAGREEMENT = 0.08

# Comp count at or above which count stops limiting confidence. UNCALIBRATED;
# spec 0's "15 or more usable comps typical: the premise holds" is the source.
COMPS_FOR_HIGH_CONFIDENCE = 15
