"""Mileage-adjusted expected ASKING price with a prediction interval (spec 5.1).

EVERY NUMBER THIS MODULE PRODUCES IS AN ASKING PRICE.

Spec 4.5: "Marketplace exposes asking prices, not transaction prices. Everything
this tool produces, including the expected price in section 5.1, is a statement
about how similar vehicles are *advertised*, not what they *sell for*." Spec 5.1
adds: "Do not call this a Zestimate equivalent. Zillow trains on recorded
transactions. This trains on asking prices, which is a weaker and different
claim."

The naming in this file is therefore deliberate and load-bearing. Types, fields,
and docstrings all say "asking". Do not rename anything here to a bare "price"
or "value": the weaker claim is the correct one, and the way it gets quietly
upgraded is exactly this kind of drift.

WHAT IS FITTED
--------------
Ordinary least squares of asking price on mileage across the filtered comp set,
optionally with model year as a second regressor. Not log-linear, despite
depreciation being multiplicative: on eight points a log fit's extra curvature
is unidentifiable, and the residual spread dwarfs the functional-form error.
Revisit when comp counts support it.

Two guards keep a small sample from producing a confident-looking wrong answer:

  too few points     Below MIN_COMPS_FOR_SLOPE the slope is not estimated at
                     all and the model reports a location-only estimate.
  implausible slope  A fitted slope that is positive (more miles, higher asking
                     price) is noise, not a finding. It is rejected in favour of
                     the location-only estimate rather than extrapolated from.

MULTIPLE CANDIDATE FITS, NARROWEST WINS
----------------------------------------
Once the guards above pass, more than one fit may be attempted: mileage alone
on every usable comp (the guaranteed baseline), mileage alone restricted to
comps confirmed to match the target's trim (spec 4.3), and mileage-plus-year on
either set when there is enough data to support the extra parameter. Trim
similarity and a year term both narrow the interval OFTEN but not ALWAYS -- a
smaller, more similar set can still leave the target's mileage outside the
range it covers, which the leverage term correctly reports as WIDER, not
narrower. So none of these is preferred by construction; every fit that
succeeds is compared on the number that actually matters, interval half-width,
and the tightest one is published. The baseline is the only one whose failure
is ever surfaced as a fallback reason -- the others are refinements of a fit
that already works, and their absence needs no explaining.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from statistics import median

from . import params
from .comps import CompDecision, CompSet
from .tdist import t_two_sided


class EstimatorKind(StrEnum):
    """Which estimator produced the expected asking price."""

    #: OLS of asking price on mileage. The intended path.
    MILEAGE_REGRESSION = "mileage_regression"
    #: Median asking price of the comp set, no mileage adjustment. Used when
    #: there are too few points to fit a slope, when mileage does not vary, or
    #: when the fitted slope came out implausible.
    COMP_MEDIAN = "comp_median"
    #: Not enough comps to say anything. No estimate is published.
    INSUFFICIENT = "insufficient"


@dataclass(frozen=True)
class AskingPriceEstimate:
    """Expected ASKING price for the target, with a prediction interval.

    Every monetary field is in cents and every one of them describes what the
    vehicle would be ADVERTISED at, not what it would sell for (spec 4.5).
    """

    kind: EstimatorKind
    #: Point estimate of the expected asking price. None when INSUFFICIENT.
    expected_asking_cents: int | None
    #: Prediction interval on the asking price, at `coverage`.
    asking_interval_low_cents: int | None
    asking_interval_high_cents: int | None
    coverage: float

    #: Points the fit actually used. A fit actually happened only when `kind`
    #: is MILEAGE_REGRESSION; on the fallback paths this is comps carrying a
    #: mileage -- what was AVAILABLE, not what was used. On the regression path
    #: it may be smaller than the mileage-carrying comp count, when
    #: `restricted_to_trim_match` narrowed the fit to the trim-matched subset.
    n_fit_points: int
    #: Comps that passed filtering, including those without a mileage.
    n_included: int

    #: Cents of asking price per mile. Negative for a normal fit. None when no
    #: slope was estimated.
    slope_cents_per_mile: float | None
    #: Fitted intercept, in cents. Together with the slope(s) this lets any
    #: vehicle be priced at ITS OWN mileage (and year) rather than the
    #: target's, which is what step 7 needs to rank alternatives by value
    #: instead of by sticker.
    intercept_cents: float | None
    #: Residual standard error of the fit, in cents.
    residual_std_error_cents: float | None
    #: Share of asking-price variance explained by mileage alone.
    r_squared: float | None

    #: Theil-Sen estimate at the target's mileage, computed alongside the OLS
    #: fit purely as a DIAGNOSTIC. Never published as the price. See
    #: `outlier_sensitivity`.
    robust_asking_cents: int | None = None

    #: Why the estimator fell back, when it did. Surfaced to the user.
    fallback_reasons: tuple[str, ...] = ()
    #: True when the published interval was widened to the floor in params,
    #: rather than being the fit's own interval.
    interval_widened_to_floor: bool = False
    #: True when the fit was narrowed to comps confirmed to match the target's
    #: trim (spec 4.3), because that subset alone was enough to fit a slope.
    #: See `CompSet.preferred_fit_points`.
    restricted_to_trim_match: bool = False
    #: Cents of asking price per year of model year, when the published fit
    #: added one. None on every other fit -- including a MILEAGE_REGRESSION one
    #: that tried a year term and found it did not narrow the interval, which
    #: is why this is not simply "whether a year term was attempted".
    slope_cents_per_year: float | None = None

    @property
    def uses_year_term(self) -> bool:
        return self.slope_cents_per_year is not None

    @property
    def has_estimate(self) -> bool:
        return self.expected_asking_cents is not None

    @property
    def outlier_sensitivity(self) -> float | None:
        """How far the OLS estimate moves under a breakdown-resistant fit.

        Least squares weights a squared residual, so one junk listing in an
        eight-point comp set can move the line materially -- and spec 2 says
        junk listings are exactly what a private-party market oversupplies, so
        this is the expected case rather than a rare one.

        Theil-Sen (median of pairwise slopes) tolerates up to ~29% contamination.
        Comparing the two is a cheap check on whether the published estimate
        rests on the comp set as a whole or on one or two points.

        THE ROBUST FIT IS NOT PUBLISHED AS THE PRICE. Which of the two is closer
        to the truth is a calibration question (spec 9.4), and there is no ground
        truth set to answer it. On captured data the two disagree by 0.7%, 4.0%
        and 12.2% across three fittable captures -- enough to flip one verdict
        from "overpriced" to "fair". Picking the winner without evidence would be
        exactly the unvalidated confidence spec 9 exists to prevent, so the
        disagreement is reported as reduced CONFIDENCE instead.
        """
        if self.expected_asking_cents is None or self.robust_asking_cents is None:
            return None
        if self.expected_asking_cents == 0:
            return None
        return abs(self.expected_asking_cents - self.robust_asking_cents) / (
            self.expected_asking_cents
        )

    def residual_fraction(self, ask_cents: int | None) -> float | None:
        """Signed residual of the target's ask against expected asking price.

        Positive means asking ABOVE expected, negative means BELOW. This is the
        input to the rise-plateau-decline curve (spec 2), and it compares an ask
        to an expected ask -- like for like, both advertised prices.
        """
        if ask_cents is None or not self.expected_asking_cents:
            return None
        # A listing at $0 or a few dollars is not asking that price -- it is a
        # "make an offer" or a placeholder. Captured data contains a Protege
        # target at $0 and a comp at $25. Treating those as real asks would
        # report a 100% discount and hand back the model's most extreme output
        # on its least meaningful input.
        if ask_cents < params.MIN_PLAUSIBLE_PRICE_CENTS:
            return None
        return (ask_cents - self.expected_asking_cents) / self.expected_asking_cents

    def predict_asking_cents(self, mileage: int | None, year: int | None = None) -> int | None:
        """Expected ASKING price at an arbitrary mileage (and, when the
        published fit used one, model year).

        `expected_asking_cents` is this evaluated at the TARGET's own mileage
        and year. Any comparison BETWEEN vehicles has to price each one at ITS
        OWN mileage and year -- otherwise a high-mileage or older car looks
        like better value purely for being cheap, which is the naive ranking
        this model exists to avoid.
        """
        if self.slope_cents_per_mile is None or self.intercept_cents is None:
            # No slope was fitted, so mileage carries no information and every
            # vehicle shares the one location estimate.
            return self.expected_asking_cents
        if mileage is None:
            return self.expected_asking_cents
        value = self.intercept_cents + self.slope_cents_per_mile * float(mileage)
        if self.slope_cents_per_year is not None:
            if year is None:
                # The published fit needs a year term to be evaluated
                # correctly. Falling back to the mileage-only line would
                # silently drop a term the fit relies on -- every comp that
                # reaches this point already has a year (spec 4.3's filter
                # requires one), so this is expected to be rare.
                return None
            value += self.slope_cents_per_year * float(year)
        return int(value) if value > 0 else None

    def residual_against_own_expectation(
        self, ask_cents: int | None, mileage: int | None, year: int | None = None
    ) -> float | None:
        """Signed residual of a vehicle against its OWN expected asking price."""
        if ask_cents is None or ask_cents < params.MIN_PLAUSIBLE_PRICE_CENTS:
            return None
        expected = self.predict_asking_cents(mileage, year)
        if not expected:
            return None
        return (ask_cents - expected) / expected

    def within_interval(self, ask_cents: int | None) -> bool | None:
        if (
            ask_cents is None
            or self.asking_interval_low_cents is None
            or self.asking_interval_high_cents is None
        ):
            return None
        return self.asking_interval_low_cents <= ask_cents <= self.asking_interval_high_cents


def _theil_sen(xs: list[float], ys: list[float]) -> tuple[float, float] | None:
    """Median of pairwise slopes, with the matching median intercept.

    O(n^2) in the comp count, which is irrelevant at n < 50 and keeps the
    implementation short enough to audit.
    """
    slopes = [
        (ys[j] - ys[i]) / (xs[j] - xs[i])
        for i in range(len(xs))
        for j in range(i + 1, len(xs))
        if xs[j] != xs[i]
    ]
    if not slopes:
        return None
    slope = median(slopes)
    intercept = median(y - slope * x for x, y in zip(xs, ys, strict=True))
    return slope, intercept


@dataclass(frozen=True)
class _Fit:
    """One candidate fit, evaluated at the target's own mileage (and year).

    `half_width` is what candidates are ranked on -- see the module docstring.
    """

    point: float
    half_width: float
    slope_mileage: float
    slope_year: float | None
    intercept: float
    residual_se: float
    r_squared: float | None
    n: int


def _fit_mileage_only(
    xs: list[float],
    ys: list[float],
    target_mileage: float,
    coverage: float,
) -> tuple[_Fit | None, str | None]:
    """OLS of asking price on mileage. Returns (fit, reason) -- `reason` is
    only ever set alongside `None`, and only carries the three messages this
    function has always produced, so callers that need them (the baseline
    fit's fallback-to-median path) get exactly the wording they did before
    multiple candidates existed.
    """
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)

    if sxx == 0:
        return None, "every comp reports the same mileage, so no slope is identifiable"

    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    # A positive slope says more miles command a higher asking price. On this
    # many points that is sampling noise, and extrapolating it to a target with
    # unusual mileage produces a confidently wrong number.
    if slope > 0:
        return None, (
            "fitted mileage slope was positive (higher mileage, higher asking price), "
            "which is noise rather than a finding at this sample size"
        )

    fitted = [intercept + slope * x for x in xs]
    ss_res = sum((y - f) ** 2 for y, f in zip(ys, fitted, strict=True))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else None

    df = n - 2
    residual_se = (ss_res / df) ** 0.5

    point = intercept + slope * target_mileage
    if point <= 0:
        return None, (
            "the fitted line predicts a non-positive asking price at the target's mileage, "
            "which means the target sits far outside the range the comps cover"
        )

    # Standard prediction-interval form. The "1 +" is what makes this a
    # PREDICTION interval for a new listing rather than a confidence interval on
    # the fitted mean -- the wider and correct one for the question being asked.
    # The (x0 - mean_x)^2 / sxx term is what widens the interval when the target
    # sits outside the mileage range the comps cover, which is the honest
    # response to extrapolation.
    leverage = 1.0 + 1.0 / n + (target_mileage - mean_x) ** 2 / sxx
    half_width = t_two_sided(coverage, df) * residual_se * (leverage**0.5)

    return (
        _Fit(
            point=point,
            half_width=half_width,
            slope_mileage=slope,
            slope_year=None,
            intercept=intercept,
            residual_se=residual_se,
            r_squared=r_squared,
            n=n,
        ),
        None,
    )


def _fit_mileage_and_year(
    xs_mileage: list[float],
    xs_year: list[float],
    ys: list[float],
    target_mileage: float,
    target_year: float,
    coverage: float,
) -> _Fit | None:
    """OLS of asking price on mileage AND model year.

    An optional enhancement over `_fit_mileage_only` (see the module
    docstring), so unlike that function this returns no reason on failure --
    there is always a working baseline fit, and this one silently declining to
    improve on it needs no explanation to a caller.

    Solved via the normal equations on CENTERED regressors, which reduces a
    3-parameter fit to a 2x2 system (mirrors the single-variable fit's use of
    centering to keep the intercept decoupled from the slope). Verified
    against `numpy.linalg.lstsq` on synthetic data during development; not a
    dependency of the shipped code, which stays self-contained like the rest
    of this module (see `tdist.py`).
    """
    n = len(xs_mileage)
    mean_m = sum(xs_mileage) / n
    mean_y = sum(xs_year) / n
    mean_p = sum(ys) / n
    cm = [x - mean_m for x in xs_mileage]
    cy = [x - mean_y for x in xs_year]
    cp = [p - mean_p for p in ys]

    s_mm = sum(a * a for a in cm)
    s_yy = sum(a * a for a in cy)
    s_my = sum(a * b for a, b in zip(cm, cy, strict=True))
    s_mp = sum(a * b for a, b in zip(cm, cp, strict=True))
    s_yp = sum(a * b for a, b in zip(cy, cp, strict=True))

    det = s_mm * s_yy - s_my * s_my
    if det == 0:
        # Mileage and year are perfectly collinear in this comp set (or year
        # does not vary at all), so their individual effects cannot be told
        # apart. Not an error -- just nothing this fit can add.
        return None

    slope_mileage = (s_mp * s_yy - s_yp * s_my) / det
    slope_year = (s_mm * s_yp - s_my * s_mp) / det
    intercept = mean_p - slope_mileage * mean_m - slope_year * mean_y

    if slope_mileage > 0:
        return None

    fitted = [
        intercept + slope_mileage * m + slope_year * y
        for m, y in zip(xs_mileage, xs_year, strict=True)
    ]
    ss_res = sum((p - f) ** 2 for p, f in zip(ys, fitted, strict=True))
    ss_tot = sum((p - mean_p) ** 2 for p in ys)
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else None

    df = n - 3
    if df <= 0:
        return None
    residual_se = (ss_res / df) ** 0.5

    point = intercept + slope_mileage * target_mileage + slope_year * target_year
    if point <= 0:
        return None

    # Same prediction-interval form as the single-variable fit, generalised to
    # two regressors: leverage = 1 + 1/n + x0_centered^T (X_c^T X_c)^-1
    # x0_centered, where the 2x2 inverse is (1/det) * [[s_yy,-s_my],[-s_my,s_mm]].
    x0_m = target_mileage - mean_m
    x0_y = target_year - mean_y
    quad = (s_yy * x0_m * x0_m - 2 * s_my * x0_m * x0_y + s_mm * x0_y * x0_y) / det
    leverage = 1.0 + 1.0 / n + quad
    if leverage < 0:
        return None  # Not reachable analytically; guards a sqrt of a negative.
    half_width = t_two_sided(coverage, df) * residual_se * (leverage**0.5)

    return _Fit(
        point=point,
        half_width=half_width,
        slope_mileage=slope_mileage,
        slope_year=slope_year,
        intercept=intercept,
        residual_se=residual_se,
        r_squared=r_squared,
        n=n,
    )


def _median_estimate(
    prices: list[int],
    n_included: int,
    n_with_mileage: int,
    coverage: float,
    reasons: tuple[str, ...],
) -> AskingPriceEstimate:
    """Location-only fallback: median asking price, deliberately wide interval.

    Spec 4.3: "Never silently score off 3 comps." The interval here is wide by
    construction rather than derived, because with this few points a derived
    interval would be a fiction with a decimal place on it.
    """
    point = int(median(prices))
    half = int(point * params.FALLBACK_INTERVAL_HALF_WIDTH_FRACTION)
    return AskingPriceEstimate(
        kind=EstimatorKind.COMP_MEDIAN,
        expected_asking_cents=point,
        asking_interval_low_cents=max(0, point - half),
        asking_interval_high_cents=point + half,
        coverage=coverage,
        n_fit_points=n_with_mileage,
        n_included=n_included,
        slope_cents_per_mile=None,
        intercept_cents=None,
        residual_std_error_cents=None,
        r_squared=None,
        fallback_reasons=reasons,
    )


def estimate_expected_asking_price(
    comp_set: CompSet,
    *,
    coverage: float = params.INTERVAL_COVERAGE,
) -> AskingPriceEstimate:
    """Fit the comp set and return an expected ASKING price for the target."""
    included = comp_set.included
    fit_points = comp_set.fit_points
    n_included = len(included)

    all_prices = [
        d.candidate.price_cents for d in included if d.candidate.price_cents is not None
    ]

    if n_included < params.MIN_COMPS_FOR_ANY_ESTIMATE or not all_prices:
        return AskingPriceEstimate(
            kind=EstimatorKind.INSUFFICIENT,
            expected_asking_cents=None,
            asking_interval_low_cents=None,
            asking_interval_high_cents=None,
            coverage=coverage,
            n_fit_points=len(fit_points),
            n_included=n_included,
            slope_cents_per_mile=None,
            intercept_cents=None,
            residual_std_error_cents=None,
            r_squared=None,
            fallback_reasons=(
                f"only {n_included} usable comps, below the floor of "
                f"{params.MIN_COMPS_FOR_ANY_ESTIMATE} for any estimate",
            ),
        )

    reasons: list[str] = []

    target_mileage = comp_set.target.mileage
    if target_mileage is None:
        reasons.append("target has no mileage, so no mileage adjustment is possible")
        return _median_estimate(all_prices, n_included, len(fit_points), coverage, tuple(reasons))

    if len(fit_points) < params.MIN_COMPS_FOR_SLOPE:
        reasons.append(
            f"{len(fit_points)} comps with mileage, below the "
            f"{params.MIN_COMPS_FOR_SLOPE} needed to fit a mileage slope"
        )
        return _median_estimate(all_prices, n_included, len(fit_points), coverage, tuple(reasons))

    # The guaranteed baseline: mileage-only OLS on every usable comp. Its
    # failure is the only one that produces a fallback reason -- see the
    # module docstring on why the rest are treated as optional refinements.
    xs_all = [float(d.candidate.mileage) for d in fit_points]  # type: ignore[arg-type]
    ys_all = [float(d.candidate.price_cents) for d in fit_points]  # type: ignore[arg-type]
    baseline, failure_reason = _fit_mileage_only(xs_all, ys_all, float(target_mileage), coverage)
    if baseline is None:
        assert failure_reason is not None
        reasons.append(failure_reason)
        return _median_estimate(all_prices, n_included, len(fit_points), coverage, tuple(reasons))

    # (fit, points used, restricted-to-trim) for every candidate that succeeded.
    candidates: list[tuple[_Fit, list[CompDecision], bool]] = [(baseline, fit_points, False)]

    # Prefer the trim-matched subset when it alone is enough to support a
    # slope (spec 4.3; see CompSet.preferred_fit_points): a comp confirmed to
    # share the target's trim is worth more per point than one that might not
    # be. But it is a CANDIDATE, not an override -- a smaller, more similar
    # set can still leave the target's mileage outside the range it covers,
    # which widens rather than narrows things, so it only wins if it actually
    # produces a tighter interval than the baseline.
    trim_matched, trim_restricted = comp_set.preferred_fit_points(params.MIN_COMPS_FOR_SLOPE)
    if trim_restricted:
        xs_trim = [float(d.candidate.mileage) for d in trim_matched]  # type: ignore[arg-type]
        ys_trim = [float(d.candidate.price_cents) for d in trim_matched]  # type: ignore[arg-type]
        trim_fit, _ = _fit_mileage_only(xs_trim, ys_trim, float(target_mileage), coverage)
        if trim_fit is not None:
            candidates.append((trim_fit, trim_matched, True))

    # Model year as a second regressor: within a comp-year window that may
    # have been widened to reach the comp floor, depreciation by age is real
    # and independent of mileage. Left out, that variance is absorbed into
    # residual noise instead of explained. Tried on both the full fit points
    # and the trim-matched subset, wherever there is enough data to support
    # the extra parameter, and kept only if it actually narrows things.
    target_year = comp_set.target.year
    if target_year is not None:
        year_attempts = [(fit_points, xs_all, False)]
        if trim_restricted:
            year_attempts.append((trim_matched, xs_trim, True))
        for points, xs_mileage, restricted in year_attempts:
            if len(points) < params.MIN_COMPS_FOR_YEAR_TERM:
                continue
            years = [d.candidate.year for d in points]
            if any(y is None for y in years):
                continue
            xs_year = [float(y) for y in years]
            ys_points = [float(d.candidate.price_cents) for d in points]  # type: ignore[arg-type]
            year_fit = _fit_mileage_and_year(
                xs_mileage, xs_year, ys_points, float(target_mileage), float(target_year), coverage
            )
            if year_fit is not None:
                candidates.append((year_fit, points, restricted))

    chosen, chosen_points, chosen_restricted = min(candidates, key=lambda c: c[0].half_width)

    # Comp mileage arrives rounded to the nearest 1,000 on every captured comp,
    # so the x values carry quantisation the residual variance never sees and a
    # fit can read tighter than its inputs justify.
    half_width = chosen.half_width
    widened = False
    floor_half = abs(chosen.point) * params.MIN_INTERVAL_HALF_WIDTH_FRACTION
    if half_width < floor_half:
        half_width = floor_half
        widened = True

    # Diagnostic only -- see `outlier_sensitivity`. Never becomes the price.
    # Always the simple univariate robust fit on whichever points were chosen,
    # regardless of whether the chosen fit added a year term: this checks
    # sensitivity to one or two points, not a second price.
    robust = _theil_sen(
        [float(d.candidate.mileage) for d in chosen_points],  # type: ignore[arg-type]
        [float(d.candidate.price_cents) for d in chosen_points],  # type: ignore[arg-type]
    )
    robust_point: int | None = None
    if robust is not None:
        robust_value = robust[1] + robust[0] * float(target_mileage)
        if robust_value > 0:
            robust_point = int(robust_value)

    return AskingPriceEstimate(
        kind=EstimatorKind.MILEAGE_REGRESSION,
        expected_asking_cents=int(chosen.point),
        asking_interval_low_cents=max(0, int(chosen.point - half_width)),
        asking_interval_high_cents=int(chosen.point + half_width),
        coverage=coverage,
        n_fit_points=chosen.n,
        n_included=n_included,
        slope_cents_per_mile=chosen.slope_mileage,
        slope_cents_per_year=chosen.slope_year,
        intercept_cents=chosen.intercept,
        residual_std_error_cents=chosen.residual_se,
        r_squared=chosen.r_squared,
        robust_asking_cents=robust_point,
        fallback_reasons=tuple(reasons),
        interval_widened_to_floor=widened,
        restricted_to_trim_match=chosen_restricted,
    )
