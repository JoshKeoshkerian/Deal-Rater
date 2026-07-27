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
Ordinary least squares of asking price on mileage across the filtered comp set.
Not log-linear, despite depreciation being multiplicative: on eight points a
log fit's extra curvature is unidentifiable, and the residual spread dwarfs the
functional-form error. Revisit when comp counts support it.

Two guards keep a small sample from producing a confident-looking wrong answer:

  too few points     Below MIN_COMPS_FOR_SLOPE the slope is not estimated at
                     all and the model reports a location-only estimate.
  implausible slope  A fitted slope that is positive (more miles, higher asking
                     price) is noise, not a finding. It is rejected in favour of
                     the location-only estimate rather than extrapolated from.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from statistics import median

from . import params
from .comps import CompSet
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

    #: Comps carrying a mileage, and so usable as regression points. A fit
    #: actually happened only when `kind` is MILEAGE_REGRESSION; on the fallback
    #: paths this is what was available rather than what was used.
    n_fit_points: int
    #: Comps that passed filtering, including those without a mileage.
    n_included: int

    #: Cents of asking price per mile. Negative for a normal fit. None when no
    #: slope was estimated.
    slope_cents_per_mile: float | None
    #: Residual standard error of the fit, in cents.
    residual_std_error_cents: float | None
    #: Share of asking-price variance explained by mileage alone.
    r_squared: float | None

    #: Why the estimator fell back, when it did. Surfaced to the user.
    fallback_reasons: tuple[str, ...] = ()
    #: True when the published interval was widened to the floor in params,
    #: rather than being the fit's own interval.
    interval_widened_to_floor: bool = False

    @property
    def has_estimate(self) -> bool:
        return self.expected_asking_cents is not None

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

    def within_interval(self, ask_cents: int | None) -> bool | None:
        if (
            ask_cents is None
            or self.asking_interval_low_cents is None
            or self.asking_interval_high_cents is None
        ):
            return None
        return self.asking_interval_low_cents <= ask_cents <= self.asking_interval_high_cents


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

    xs = [float(d.candidate.mileage) for d in fit_points]  # type: ignore[arg-type]
    ys = [float(d.candidate.price_cents) for d in fit_points]  # type: ignore[arg-type]
    n = len(xs)

    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)

    if sxx == 0:
        reasons.append("every comp reports the same mileage, so no slope is identifiable")
        return _median_estimate(all_prices, n_included, len(fit_points), coverage, tuple(reasons))

    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    # A positive slope says more miles command a higher asking price. On this
    # many points that is sampling noise, and extrapolating it to a target with
    # unusual mileage produces a confidently wrong number.
    if slope > 0:
        reasons.append(
            "fitted mileage slope was positive (higher mileage, higher asking price), "
            "which is noise rather than a finding at this sample size"
        )
        return _median_estimate(all_prices, n_included, len(fit_points), coverage, tuple(reasons))

    fitted = [intercept + slope * x for x in xs]
    ss_res = sum((y - f) ** 2 for y, f in zip(ys, fitted, strict=True))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else None

    df = n - 2
    residual_se = (ss_res / df) ** 0.5

    point = intercept + slope * float(target_mileage)

    # Standard prediction-interval form. The "1 +" is what makes this a
    # PREDICTION interval for a new listing rather than a confidence interval on
    # the fitted mean -- the wider and correct one for the question being asked.
    # The (x0 - mean_x)^2 / sxx term is what widens the interval when the target
    # sits outside the mileage range the comps cover, which is the honest
    # response to extrapolation.
    leverage = 1.0 + 1.0 / n + (float(target_mileage) - mean_x) ** 2 / sxx
    half_width = t_two_sided(coverage, df) * residual_se * (leverage**0.5)

    # Comp mileage arrives rounded to the nearest 1,000 on every captured comp,
    # so the x values carry quantisation the residual variance never sees and a
    # fit can read tighter than its inputs justify.
    widened = False
    floor_half = abs(point) * params.MIN_INTERVAL_HALF_WIDTH_FRACTION
    if half_width < floor_half:
        half_width = floor_half
        widened = True

    if point <= 0:
        reasons.append(
            "the fitted line predicts a non-positive asking price at the target's mileage, "
            "which means the target sits far outside the range the comps cover"
        )
        return _median_estimate(all_prices, n_included, len(fit_points), coverage, tuple(reasons))

    return AskingPriceEstimate(
        kind=EstimatorKind.MILEAGE_REGRESSION,
        expected_asking_cents=int(point),
        asking_interval_low_cents=max(0, int(point - half_width)),
        asking_interval_high_cents=int(point + half_width),
        coverage=coverage,
        n_fit_points=n,
        n_included=n_included,
        slope_cents_per_mile=slope,
        residual_std_error_cents=residual_se,
        r_squared=r_squared,
        fallback_reasons=tuple(reasons),
        interval_widened_to_floor=widened,
    )
