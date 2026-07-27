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
# Comp relevance weighting: TRIED, MEASURED, REJECTED
# ---------------------------------------------------------------------------
#
# Spec 4.3 asks for comps to be treated as better or worse evidence rather than
# as a flat set. The obvious implementation -- weight each comp by how similar
# it is to the target, then fit weighted least squares -- was built in full
# (Cauchy proximity kernel on mileage, three-valued trim weight, Kish effective
# sample size driving every degree of freedom) and REMOVED after measurement.
# It is documented here rather than left as a comment in the code because the
# idea is compelling enough that someone will propose it again.
#
# THE MEASUREMENT. Leave-one-out cross-validation over 92 captured comp sets
# and ~1,530 predictions: hold out one comp, fit on the rest, predict the
# held-out comp's actual asking price. Out of sample, so it cannot be gamed by
# a better in-sample fit. Median absolute percentage error:
#
#     configuration            all comps    lowest-mileage 20%
#     unweighted (shipped)        13.9%          16.3%
#     kernel L = 100k             14.2%          16.5%
#     kernel L =  50k             14.0%          15.6%
#     kernel L =  30k             14.2%          16.0%
#     kernel L =  20k             14.2%          16.3%
#
# Fifteen configurations were swept across kernel width and trim penalty. The
# best of them buys 0.7 points at the low-mileage edge -- inside the noise --
# and every one of them is WORSE than unweighted over the comp set as a whole,
# which is where most targets sit. Trim weighting specifically showed no signal
# at any strength, most likely because Marketplace trim strings are too
# unreliable for "matches" to mean much.
#
# Log-linear and log-log depreciation curves were measured the same way, on the
# theory that a straight line understates low-mileage value because depreciation
# is convex. Also within ~1 point of linear. See `regression.py`'s note on
# functional form.
#
# THE FINDING THAT SETTLED IT. Bias at the lowest-mileage 20% is +2.5%: the
# model already over-predicts low-mileage comps slightly. The systematic
# under-valuation of low-mileage vehicles that weighting was meant to fix does
# not exist in this data. What does exist is enormous unexplained variance
# within a comp set -- captured 2015-2016 CX-5 Tourings ask $6,650 to $12,800
# with almost no mileage signal -- and no weighting scheme fixes a market that
# noisy. The correct response to that variance is a wide interval and a verdict
# that respects it, which is where the fix landed instead (see `curve.py`).

# ---------------------------------------------------------------------------
# Trim as a regressor: TRIED, MEASURED, REJECTED
# ---------------------------------------------------------------------------
#
# The second attempt at making trim move the price, and a DIFFERENT idea from
# the weighting above -- recorded separately because the obvious response to
# "weighting trim did not work" is "then put trim in the model properly", and
# that was tried too.
#
# THE IDEA. Weighting DISCOUNTS dissimilar comps, shrinking an already thin comp
# set. A trim-match indicator instead keeps every comp in the fit and spends one
# parameter ESTIMATING what the trim difference is worth:
#
#     asking price ~ mileage + year + trim_matches
#
# Built on a generalised k-regressor OLS (`regression._fit_multi`, which now
# carries the year term), registered as further candidate fits, and selected by
# the same narrowest-interval rule as every other candidate. Verified on
# synthetic data to recover a known $3,000 trim premium to within noise.
#
# THE MEASUREMENT. Leave-one-out cross-validation over the 136 stored captures,
# 2,158 out-of-sample predictions (`python -m app.cli.backtest`). Median absolute
# percentage error, LOWER IS BETTER:
#
#     configuration                        MedAPE
#     trim term OFF (shipped)              15.577%
#     min 8 comps,  2 per trim level       15.721%
#     min 10 comps, 3 per trim level       15.641%
#     min 12 comps, 4 per trim level       15.641%
#     min 14 comps, 5 per trim level       15.641%
#     min 16 comps, 6 per trim level       15.604%
#     min 20 comps, 8 per trim level       15.604%
#
# EVERY configuration is worse than not having the term, and the sweep is
# monotonic in the wrong direction: tightening the guards only helps because it
# stops the term firing, converging on the baseline from above and never
# crossing it.
#
# THE FINDING THAT SETTLED IT. Where the term did win the interval comparison it
# won on 5 of 114 fits (4%), and among those the estimated premium was NEGATIVE
# on 40% of them -- "matching the target's trim makes the car cheaper". A
# coefficient whose sign is a coin flip is fitting noise, and the narrowest-
# interval rule cannot tell that apart from signal on eight points.
#
# The obvious rescue was that the trim STRINGS are too dirty (which is what the
# weighting note above concluded, and which the normalisation fixes in
# `comps.trim_tokens` had just improved). It does not hold: restricted to the 78
# captures whose comp sets have >=80% readable, comparable trim, the term is
# still worse -- 15.238% off versus 15.358% on.
#
# WHAT THIS DOES NOT SAY. Not that trim is irrelevant to price. The same backtest
# shows comps whose trim cannot be read at all are the hardest to predict by a
# wide margin (18.9% versus 14.8%), so the information is real. What it says is
# that a comp set of this size and this internal variance cannot support
# ESTIMATING the trim effect: captured 2015-2016 CX-5 Tourings -- one trim --
# span $6,650 to $12,800. A parameter fitted inside that spread is noise, which
# is the same wall the weighting attempt hit from the other side.
#
# Trim therefore remains what spec 4.3 asks for: a soft signal that never
# excludes a comp, feeds `trim_coverage` / `trim_agreement`, and moves CONFIDENCE
# rather than the price.

# A comp priced this far BELOW the robust trend line at its own mileage is
# treated as not-an-offer and dropped from the fit.
#
# ASYMMETRIC ON PURPOSE. An implausibly cheap listing is usually not an asking
# price at all -- a placeholder, a parts car, a deposit figure, or a scam (spec
# 2's adverse selection, and captured data's $1,400 and $1,234 "CX-5s" next to a
# $7,900 median). An implausibly HIGH ask is a real thing a real seller really
# did, and this model reports asking prices (spec 4.5), so there is no
# corresponding upper screen.
#
# WHY THIS AND NOT `MIN_PRICE_FRACTION_OF_MEDIAN`, which already exists: that
# one screens against the comp set's MEDIAN, so it only catches a listing that
# is cheap relative to the whole market. A $4,500 2020 Camry at 121k miles is
# not cheap relative to a comp set spanning 2011-2020 -- it is cheap relative to
# what a 2020 Camry at 121k miles should ask, which is what the trend line
# knows and the median does not.
#
# The screen runs against the Theil-Sen line (already computed as the outlier
# diagnostic), which tolerates ~29% contamination and so is not itself dragged
# down by the junk it is being used to find. Least squares would be.
#
# MEASURED: leave-one-out CV over 92 captured comp sets moves median absolute
# error from 14.4% to 13.9% with this screen on. It fires on 29 of 102 fittable
# captures and drops 40 comps in total; the most expensive thing it has ever
# dropped is a $5,500 2013 G37 listed at 300 miles. UNCALIBRATED, but this is
# the one constant in this file with an out-of-sample number behind it.
JUNK_FRACTION_BELOW_TREND = 0.55

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

# A second regressor (model year, alongside mileage) costs a further degree of
# freedom -- df = n-3 rather than n-2. UNCALIBRATED, set one comp above
# MIN_COMPS_FOR_SLOPE for the same reason that constant is 6 and not lower: it
# keeps df comfortably positive (>= 4) rather than merely non-zero. Year is
# only ever ADDED as a candidate fit alongside the mileage-only one (see
# `regression.py`), never required, so this floor only decides whether trying
# it is worthwhile, not whether an estimate is published at all.
MIN_COMPS_FOR_YEAR_TERM = 7

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
