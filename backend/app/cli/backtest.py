"""Leave-one-out cross-validation of the expected-asking-price model.

    python -m app.cli.backtest
    python -m app.cli.backtest --json
    python -m app.cli.backtest --capture 3 --capture 7

WHY THIS EXISTS
---------------
`params.py` records a measurement that decided real design questions -- comp
relevance weighting was built, measured here, and REJECTED; the
`JUNK_FRACTION_BELOW_TREND` constant is justified by a 14.4% -> 13.9% movement
in this number. The script that produced those figures was never committed, so
until now none of them could be recomputed and no future change to the model
could be held to the same standard.

That is the gap this closes. `params.py`'s own instruction -- "Do not tighten any
of these without a calibration run behind it" -- needs a calibration run to be
runnable.

THE METHODOLOGY
---------------
For each stored capture, the comp set is filtered exactly as production filters
it (including spec 4.3's progressive year widening). Then, for each comp usable
in the fit:

    1. Remove that one comp from the set.
    2. Re-run `estimate_expected_asking_price` on the remainder.
    3. Predict the held-out comp's asking price AT ITS OWN mileage and year.
    4. Compare against what it actually asks.

Out of sample by construction: the held-out comp is absent from the fit that
predicts it, so a model that overfits its comp set scores worse here, not
better. That is the property that makes this able to reject a change.

The fit is still SELECTED the way production selects it -- candidate fits are
ranked by interval half-width at the TARGET's mileage, not the held-out comp's
-- because the question is how the shipped model behaves, not how a model tuned
per-prediction would.

WHAT THE NUMBER IS
------------------
Median absolute percentage error. Median rather than mean because a single comp
whose ask is not really an ask (spec 2's adverse selection, and the $1,234 "CX-5"
in captured data) otherwise dominates the average and hides everything else.

READ THE STRATA, NOT JUST THE HEADLINE
--------------------------------------
A change can improve the overall figure while making the model worse where it
matters. The low-mileage stratum is broken out for exactly this reason: it is
where comp relevance weighting was expected to help and where it was measured
not to. Estimator kind is broken out because a median fallback and a fitted
regression are different models, and averaging them together hides which one
moved.

BASELINE, 2026-07-29: trim-mix bias, and why this file could not see it
-----------------------------------------------------------------------
413 captures stored, 393 contributing, 9,116 predictions. MedAPE 15.5%.

That headline is unchanged by the day's work and will stay unchanged, because
the work was client-side: `widen.ts` was over-counting trim matches by 3.76x and
`nearestMetro` was silently disabling comp widening on every listing without
coordinates. Neither can move a number computed from captures already stored.
Both change what FUTURE captures contain, which is the only place the effect can
appear -- so re-run this once post-fix captures accumulate, and expect the
`trim not comparable` stratum (16.8%, still the worst by a wide margin) to shrink
rather than the headline to move.

WHAT THE NEW `--trim-bias` MODE FOUND, and why it needed a new mode at all:

    target's trim rank    n   median gap   median same-trim comps   reach >=6
    bottom quartile      29        -9.0%                        6       15/29
    middle half          58        +1.1%                        6       29/58
    top quartile         30       +10.1%                        3        6/30

A target whose trim sits in the upper quartile of its own model is priced
against a comp mix ~10% cheaper than itself, so it reads as overpriced for
reasons that are not its price. Bottom-quartile trims get the mirror image and
read as bargains. THE TWO SIGNS CANCEL, which is exactly why `--trim-premium`
reports a precise null ($61, CI -$154..$275) and why the run below moved by
0.000 of a percentage point. Both of those measure the comp set's INTERIOR,
where the trim mix is balanced by construction. Neither was wrong; neither was
asking this question. See `run_trim_bias`.

And the harm is a function of supply, which is what makes it actionable:

    same-trim comps    n    median |gap|
    0-2               33          14.2%
    3-5               34           5.5%
    6-8               23           3.3%
    9-11              10           3.4%
    12+               17           2.5%

Flat past 6, which is where `MIN_COMPS_FOR_SLOPE` already sits. So the
thresholds were right and the acquisition was broken.

CALIBRATION RUN, 2026-07-28: vehicle capture reorganisation
-----------------------------------------------------------
233 captures stored, 219 contributing, 4,540 predictions. Before and after the
trim decomposition, the payload-key fix and graded trim matching.

    stratum                        n           before     after
    ALL                         4540          15.613%   15.613%
    lowest-mileage 20%           908          17.642%   17.642%
    highest-mileage 20%          908          15.394%   15.394%
    trim matches target        758/761        14.900%   14.810%
    trim differs from target  2760/2752       14.787%   14.787%
    trim not comparable       1022/1027       18.687%   18.787%
    estimator: regression       4289          15.414%   15.414%
    estimator: comp_median       251          19.422%   19.422%

THE HEADLINE DID NOT MOVE AT ALL, to five decimal places. That is the correct
result and not a disappointment, for two reasons worth writing down before
someone re-runs this and concludes the work did nothing:

  1. `trim_matches` was deliberately left untouched, so the fit selection can
     only change where the new graded fallback in `preferred_fit_points` fires.
     It is newly reachable on 6 of 233 captures (2.6%), and `regression.py`
     still only adopts a candidate fit when it produces a TIGHTER interval at
     the target's mileage -- so most of those 6 keep the fit they already had.

  2. The accuracy win this work was aimed at cannot appear here at all. Dealer
     exclusion needs `seller_type`, which is NULL on every stored observation
     because it was never captured. Backfill deliberately does not invent it.
     Measuring that requires NEW captures through the fixed extractor.

The only stratum movement comes from adding "roadster" to the body-style
phrases (61 affected observations): trim-matched comps improved 14.900% ->
14.810% and 3 more comps became trim-matched, while 5 more became
not-comparable as a bare "Roadster 2D" correctly reduced to no trim at all.
Noise, in the honest sense.

THE INVERSION BELOW IS UNCHANGED and still unexplained.

BASELINE, 2026-07-27
--------------------
136 captures stored, 125 contributing, 2,158 predictions. Two runs: before and
after the `trim_tokens` normalisation fixes (`comps.py`).

    stratum                        n    before     after
    ALL                         2158     15.6%     15.6%
    lowest-mileage 20%           431     18.1%     17.9%
    highest-mileage 20%          431     15.5%     16.4%
    trim matches target        313/338   16.2%     15.7%
    trim differs from target  1385/1346  14.6%     14.8%
    trim not comparable        460/474   19.1%     18.9%
    estimator: regression       2004     15.2%     15.3%
    estimator: comp_median       154     21.0%     21.0%

NOT comparable to the 13.9% in `params.py`: that ran on 92 comp sets and this
runs on 136 captures, and the figure is a property of the data as much as of
the model.

The normalisation fixes moved the headline by 0.003 of a percentage point --
nothing. That is the expected result, and worth stating plainly: trim barely
touches the published price today, so cleaning the strings cannot move the
error much on its own. What it did move is the input quality it was aimed at --
the "0t" collapse is gone, 25 more comps are now correctly identified as
trim-matched, and distinct normalised forms fell from 419 to 368 as equivalent
spellings stopped reading as different trims.

THE ROW WORTH STARING AT is still the third against the fourth. Comps that
MATCH the target's trim are predicted WORSE (15.7%) than comps whose trim
DIFFERS (14.8%). If trim matching carried the signal it is supposed to carry,
that ordering would be reversed. Cleaning the strings narrowed the inversion
(1.6 points to 0.9) without removing it.

Read it as a statement about the STRINGS, not about trim. "Trim not comparable"
remains the worst stratum by a wide margin (18.9%), which says a vehicle whose
trim cannot be read at all really is harder to price. The information is real;
the extraction of it is still weak.
"""

from __future__ import annotations

import json
import math
import statistics
from argparse import ArgumentParser
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..db import session_scope
from ..pricing import params
from ..pricing.comps import CompCandidate, CompSet, normalize_key
from ..pricing.loader import StoredCapture, load_captures
from ..pricing.model import _filter_with_progressive_widening, assess_listing
from ..pricing.regression import EstimatorKind, _fit_multi, estimate_expected_asking_price
from ..services.vehicle_facts import decompose

# ---------------------------------------------------------------------------
# Empirical interval coverage (spec 9.5)
# ---------------------------------------------------------------------------
#
# `params.INTERVAL_COVERAGE` has carried "UNCALIBRATED: spec 9.5 requires
# checking that ~80% of held-out listings actually fall inside it, and that
# check has not been run" since it was written. This closes that gap using a
# held-out point that already exists for free: the TARGET's own asking price
# is never part of the fit -- only comps enter `estimate_expected_asking_price`
# -- so it is a genuine out-of-sample observation, at no cost of building a
# second interval-at-an-arbitrary-mileage capability the way scoring the
# leave-one-out COMPS against the published interval would have required (that
# interval is only valid at the mileage it was built for, which is the
# target's, not each held-out comp's).
#
# This deliberately does NOT reuse `predictions_for`'s per-comp loop: comps
# only ever get a POINT prediction there (`predict_asking_cents`), not an
# interval, because the published interval's leverage term is specific to the
# mileage (and year) it was constructed at.


@dataclass(frozen=True)
class Prediction:
    """One held-out comp, and what the model said about it without seeing it."""

    capture_id: int
    source_listing_id: str
    actual_cents: int
    predicted_cents: int
    mileage: int
    #: Trim comparison of the HELD-OUT comp against the capture's target, as
    #: recorded by the comp filter. None when either side had no usable trim.
    trim_matches: bool | None
    #: Comps the reduced fit had available -- one fewer than the full set.
    n_fit_points: int
    kind: EstimatorKind

    @property
    def ape(self) -> float:
        """Absolute percentage error against the comp's real asking price."""
        return abs(self.predicted_cents - self.actual_cents) / self.actual_cents


@dataclass(frozen=True)
class CoverageObservation:
    """One capture's published interval, checked against its target's real ask."""

    capture_id: int
    kind: EstimatorKind
    ask_cents: int
    low_cents: int
    high_cents: int
    inside: bool


def coverage_for(capture: StoredCapture, *, coverage: float) -> CoverageObservation | None:
    """Check one capture's published interval against its target's real ask.

    None when there is nothing to check: no estimate, no target price, or a
    target price below `MIN_PLAUSIBLE_PRICE_CENTS` (a $0 or placeholder ask is
    not a real point to score coverage against -- see
    `AskingPriceEstimate.residual_fraction`).
    """
    assessment = assess_listing(
        capture.target,
        capture.candidates,
        coverage=coverage,
        location_scoped=capture.location_scoped,
    )
    estimate = assessment.estimate
    ask = capture.target.price_cents
    if (
        ask is None
        or ask < params.MIN_PLAUSIBLE_PRICE_CENTS
        or estimate.asking_interval_low_cents is None
        or estimate.asking_interval_high_cents is None
    ):
        return None

    inside = estimate.within_interval(ask)
    assert inside is not None
    return CoverageObservation(
        capture_id=capture.capture_id,
        kind=estimate.kind,
        ask_cents=ask,
        low_cents=estimate.asking_interval_low_cents,
        high_cents=estimate.asking_interval_high_cents,
        inside=inside,
    )


def _coverage_row(label: str, sample: list[CoverageObservation], nominal: float) -> str:
    if not sample:
        return f"{label:<28}{0:>7}{'n/a':>12}{f'{nominal:.0%}':>10}"
    empirical = sum(1 for o in sample if o.inside) / len(sample)
    return f"{label:<28}{len(sample):>7}{empirical:>11.1%}{f'{nominal:.0%}':>10}"


def run_coverage(session: Session, capture_ids: list[int] | None, as_json: bool) -> int:
    captures = load_captures(session, capture_ids)
    if not captures:
        print("No captures stored.")
        return 1

    observations = [
        obs
        for capture in captures
        if (obs := coverage_for(capture, coverage=params.INTERVAL_COVERAGE)) is not None
    ]

    if not observations:
        print(
            f"{len(captures)} captures stored, none produced a scoreable interval "
            "(no estimate, or the target's own ask is missing / below the plausible-price floor)."
        )
        return 1

    nominal = params.INTERVAL_COVERAGE
    by_kind: dict[EstimatorKind, list[CoverageObservation]] = {}
    for obs in observations:
        by_kind.setdefault(obs.kind, []).append(obs)

    if as_json:
        print(
            json.dumps(
                {
                    "captures_loaded": len(captures),
                    "captures_scored": len(observations),
                    "nominal_coverage": nominal,
                    "empirical_coverage": sum(1 for o in observations if o.inside)
                    / len(observations),
                    "by_kind": {
                        kind.value: {
                            "n": len(sample),
                            "empirical_coverage": sum(1 for o in sample if o.inside) / len(sample),
                        }
                        for kind, sample in by_kind.items()
                    },
                },
                indent=2,
            )
        )
        return 0

    print(f"\nCaptures loaded:  {len(captures)}")
    print(
        f"Captures scored:  {len(observations)}  "
        "(target has a real ask and a published interval)"
    )
    print(f"\n{'stratum':<28}{'n':>7}{'empirical':>11}{'nominal':>10}")
    print("-" * 56)
    print(_coverage_row("ALL", observations, nominal))
    print("-" * 56)
    for kind, sample in by_kind.items():
        print(_coverage_row(f"estimator: {kind.value}", sample, nominal))

    print(
        "\nEmpirical coverage is the fraction of TARGETS' real asking prices that fall "
        "inside their own published interval. The target's ask is never part of the "
        "fit that produces the interval -- only comps are -- so this is a genuine "
        "held-out check, not the leave-one-out comp accuracy above.\n"
        "Spec 9.5: an interval that is systematically too narrow (empirical well "
        "below nominal) is worse than no interval, because it manufactures false "
        "confidence."
    )
    return 0


def _without(comp_set: CompSet, index: int) -> CompSet:
    """`comp_set` with one decision removed, everything else preserved.

    Rebuilt rather than mutated so the caller's set stays intact across the
    loop. `year_window` is carried over deliberately: re-running the widening
    ladder on the reduced set could pick a DIFFERENT window and change which
    comps exist, which would measure the ladder rather than the fit.
    """
    return CompSet(
        target=comp_set.target,
        decisions=[d for i, d in enumerate(comp_set.decisions) if i != index],
        location_scoped=comp_set.location_scoped,
        dealer_filtering=comp_set.dealer_filtering,
        year_window=comp_set.year_window,
    )


def predictions_for(capture: StoredCapture, *, coverage: float) -> list[Prediction]:
    """Every leave-one-out prediction this capture supports."""
    # Filtered through the public pipeline rather than the filter alone, so the
    # comp set here is the same one production would price against -- including
    # spec 4.3's progressive year widening.
    comp_set = assess_listing(
        capture.target,
        capture.candidates,
        coverage=coverage,
        location_scoped=capture.location_scoped,
    ).comp_set

    out: list[Prediction] = []
    for index, decision in enumerate(comp_set.decisions):
        if not decision.usable_in_fit:
            continue
        held = decision.candidate
        if held.price_cents is None or held.price_cents <= 0 or held.mileage is None:
            continue

        estimate = estimate_expected_asking_price(_without(comp_set, index), coverage=coverage)
        predicted = estimate.predict_asking_cents(held.mileage, held.year)
        if predicted is None or predicted <= 0:
            # No estimate at all, or a published fit that needs a year term the
            # held-out comp cannot supply. Not an error, and not a prediction.
            continue

        out.append(
            Prediction(
                capture_id=capture.capture_id,
                source_listing_id=held.source_listing_id,
                actual_cents=held.price_cents,
                predicted_cents=predicted,
                mileage=held.mileage,
                trim_matches=decision.trim_matches,
                n_fit_points=estimate.n_fit_points,
                kind=estimate.kind,
            )
        )
    return out


def _medape(sample: list[Prediction]) -> float | None:
    return statistics.median(p.ape for p in sample) if sample else None


def _row(label: str, sample: list[Prediction], total: int) -> str:
    med = _medape(sample)
    share = f"{len(sample) / total:.0%}" if total else "n/a"
    if med is None:
        return f"{label:<34}{len(sample):>7}{share:>8}{'n/a':>12}"
    return f"{label:<34}{len(sample):>7}{share:>8}{med:>11.1%}"


def _strata(predictions: list[Prediction]) -> list[tuple[str, list[Prediction]]]:
    """The breakdowns worth reading alongside the headline figure."""
    by_mileage = sorted(predictions, key=lambda p: p.mileage)
    cut = max(1, len(by_mileage) // 5)

    strata: list[tuple[str, list[Prediction]]] = [
        ("lowest-mileage 20%", by_mileage[:cut]),
        ("highest-mileage 20%", by_mileage[-cut:]),
        ("trim matches target", [p for p in predictions if p.trim_matches is True]),
        ("trim differs from target", [p for p in predictions if p.trim_matches is False]),
        ("trim not comparable", [p for p in predictions if p.trim_matches is None]),
    ]
    for kind in EstimatorKind:
        sample = [p for p in predictions if p.kind is kind]
        if sample:
            strata.append((f"estimator: {kind.value}", sample))
    return strata


def run(session: Session, capture_ids: list[int] | None, as_json: bool) -> int:
    captures = load_captures(session, capture_ids)
    if not captures:
        print("No captures stored.")
        return 1

    predictions: list[Prediction] = []
    contributing = 0
    for capture in captures:
        got = predictions_for(capture, coverage=params.INTERVAL_COVERAGE)
        if got:
            contributing += 1
        predictions.extend(got)

    if not predictions:
        print(
            f"{len(captures)} captures stored, none of which produced a prediction. "
            "A capture contributes only when its comp set survives filtering with "
            "enough mileage-carrying comps to fit without one of them."
        )
        return 1

    overall = _medape(predictions)
    assert overall is not None

    if as_json:
        print(
            json.dumps(
                {
                    "captures_loaded": len(captures),
                    "captures_contributing": contributing,
                    "predictions": len(predictions),
                    "medape": overall,
                    "strata": {
                        label: {"n": len(sample), "medape": _medape(sample)}
                        for label, sample in _strata(predictions)
                    },
                },
                indent=2,
            )
        )
        return 0

    print(f"\nCaptures loaded:      {len(captures)}")
    print(f"Captures contributing:{contributing:>7}")
    print(f"Predictions:          {len(predictions):>7}")

    print(f"\n{'stratum':<34}{'n':>7}{'share':>8}{'MedAPE':>12}")
    print("-" * 61)
    print(_row("ALL", predictions, len(predictions)))
    print("-" * 61)
    for label, sample in _strata(predictions):
        print(_row(label, sample, len(predictions)))

    print(
        "\nMedAPE is the median absolute percentage error against each held-out "
        "comp's real asking price, out of sample. LOWER IS BETTER.\n"
        "Compare a change against a baseline run on the same captures -- the "
        "absolute figure is a property of this data as much as of the model, so "
        "it is not comparable across different stored capture sets."
    )
    print(
        "This measures asking prices only (spec 4.5). A model that predicts "
        "advertised prices perfectly still says nothing about what a vehicle "
        "sells for."
    )
    return 0


# ---------------------------------------------------------------------------
# Trim premium, reanalysed (params.py: "Trim as a regressor: TRIED, MEASURED,
# REJECTED")
# ---------------------------------------------------------------------------
#
# That section's headline numbers -- "won the interval comparison on 5 of 114
# fits, negative 40% of the time it won" -- describe the rare cases the
# narrowest-interval SELECTION rule picked the trim-indicator candidate over
# the others, not the coefficient's identifiability in general. On n=5, "40%
# negative" has a Wilson 95% CI of roughly 12% to 77%: a coin flip is well
# inside it, so that specific statistic cannot support "trim does not predict
# price" on its own -- it is simply too small a sample of a rare event.
#
# This instead fits `asking price ~ mileage + trim_matches` on EVERY capture
# with enough trim variation to identify the term at all (not just the ones
# where it happened to win the selection), and pools the resulting per-capture
# coefficients by inverse-variance weighting -- a standard fixed-effect
# meta-analysis, not the win/lose count above. That is a fair test of whether
# the term carries a real, if small, signal that the selection rule was simply
# declining to use.
#
# Simplified to two regressors (mileage + trim_matches, no year term) to keep
# n from shrinking further across three parameters; reported as what it is, a
# diagnostic recomputation, not a replacement for the removed experiment.


def _trim_premium_fit(points, n_min: int) -> tuple[float, float, int] | None:
    """(coefficient_cents, standard_error_cents, n) for one capture's comp set.

    None when there is not enough trim variation to identify the term: fewer
    than `n_min` comps on either side of the match/no-match split.
    """
    matched = [d for d in points if d.trim_matches is True]
    differs = [d for d in points if d.trim_matches is False]
    if len(matched) < n_min or len(differs) < n_min:
        return None

    usable = matched + differs
    xs_mileage = [float(d.candidate.mileage) for d in usable]
    xs_trim = [1.0 if d.trim_matches else 0.0 for d in usable]
    ys = [float(d.candidate.price_cents) for d in usable]
    n = len(ys)

    mean_mileage = statistics.mean(xs_mileage)
    mean_trim = statistics.mean(xs_trim)
    target_x = [mean_mileage, mean_trim]

    # `_fit_multi` only special-cases the literal labels "mileage" and "year"
    # when populating the returned `_Fit.slope_mileage` / `.slope_year` --
    # labelling the trim column "year" is what surfaces its coefficient below,
    # not a claim that trim is being treated as a year term.
    fit = _fit_multi(
        [xs_mileage, xs_trim], ("mileage", "year"), ys, target_x, params.INTERVAL_COVERAGE
    )
    if fit is None or fit.slope_year is None:
        return None

    centered_trim = [x - mean_trim for x in xs_trim]
    centered_mileage = [x - mean_mileage for x in xs_mileage]
    cross_mm = sum(x * x for x in centered_mileage)
    cross_tt = sum(x * x for x in centered_trim)
    cross_mt = sum(a * b for a, b in zip(centered_mileage, centered_trim, strict=True))
    det = cross_mm * cross_tt - cross_mt * cross_mt
    if abs(det) < 1e-6:
        return None
    # (X_c'X_c)^-1 diagonal entry for the trim column, via Cramer's rule on the
    # 2x2 system -- the general `_solve` path `_fit_multi` uses internally
    # isn't exposed, so this reproduces just the one entry this needs.
    inv_trim_trim = cross_mm / det
    if inv_trim_trim <= 0:
        return None
    se = fit.residual_se * (inv_trim_trim**0.5)
    return fit.slope_year, se, n


def run_trim_premium(session: Session, capture_ids: list[int] | None, as_json: bool) -> int:
    captures = load_captures(session, capture_ids)
    if not captures:
        print("No captures stored.")
        return 1

    n_min = params.MIN_COMPS_FOR_YEAR_TERM // 2  # >= this many on EACH side of the split
    per_capture: list[tuple[int, float, float, int]] = []
    for capture in captures:
        comp_set = _filter_with_progressive_widening(
            capture.target,
            capture.candidates,
            year_window=params.YEAR_WINDOW,
            location_scoped=capture.location_scoped,
        )
        points = [d for d in comp_set.fit_points if d.trim_matches is not None]
        result = _trim_premium_fit(points, n_min)
        if result is not None:
            beta, se, n = result
            per_capture.append((capture.capture_id, beta, se, n))

    if not per_capture:
        print(
            f"{len(captures)} captures stored, none had >= {n_min} trim-matched AND "
            f">= {n_min} trim-differing comps to identify the term at all."
        )
        return 1

    betas = [b for _, b, _, _ in per_capture]
    n_negative = sum(1 for b in betas if b < 0)
    weights = [1.0 / (se**2) for _, _, se, _ in per_capture]
    pooled_beta = sum(w * b for w, (_, b, _, _) in zip(weights, per_capture, strict=True)) / sum(
        weights
    )
    pooled_se = (1.0 / sum(weights)) ** 0.5
    ci_low = pooled_beta - 1.96 * pooled_se
    ci_high = pooled_beta + 1.96 * pooled_se
    individually_significant = sum(1 for _, b, se, _ in per_capture if abs(b) > 1.96 * se)

    if as_json:
        print(
            json.dumps(
                {
                    "captures_loaded": len(captures),
                    "captures_fittable": len(per_capture),
                    "median_premium_cents": statistics.median(betas),
                    "fraction_negative": n_negative / len(betas),
                    "pooled_premium_cents": pooled_beta,
                    "pooled_ci_95_cents": [ci_low, ci_high],
                    "ci_spans_zero": ci_low < 0 < ci_high,
                    "individually_significant_p05": individually_significant,
                },
                indent=2,
            )
        )
        return 0

    print(f"\nCaptures loaded:    {len(captures)}")
    print(
        f"Fittable (>= {n_min} comps each side of trim match/no-match): "
        f"{len(per_capture)}"
    )
    print(f"\nPer-capture premium: median ${statistics.median(betas) / 100:,.0f}, "
          f"negative on {n_negative} of {len(betas)} ({n_negative / len(betas):.1%})")
    print(
        f"Pooled (fixed-effect, inverse-variance): ${pooled_beta / 100:,.0f}, "
        f"95% CI ${ci_low / 100:,.0f} to ${ci_high / 100:,.0f}"
    )
    print(f"CI spans zero: {ci_low < 0 < ci_high}")
    print(
        f"Individually significant at p<.05 on the capture's own data alone: "
        f"{individually_significant} of {len(per_capture)}"
    )
    print(
        "\nThis pools every capture with enough trim variation to identify the term, "
        "not only the rare ones the narrowest-interval rule happened to select -- "
        "see the module comment above for why that distinction matters."
    )
    return 0


# ---------------------------------------------------------------------------
# Trim-mix bias, conditional on the TARGET's trim (spec 4.3)
# ---------------------------------------------------------------------------
#
# WHY THIS MODE EXISTS, AND WHY EVERY OTHER MEASUREMENT IN THIS FILE IS BLIND
# TO WHAT IT FINDS.
#
# `run` predicts held-out COMPS. `run_trim_premium` pools a trim coefficient
# fitted inside comp sets. Both are measurements about the comp set's interior,
# and inside a comp set the trim mix is balanced BY CONSTRUCTION -- the mean
# comp sits at the mean trim, so a trim effect has nothing to bias. That is why
# both came back null, and both nulls are real answers to the question they
# asked.
#
# The question neither one asks is whether the comp set is centred on the
# TARGET. A target whose trim sits above its model's average is benchmarked
# against a mix that is mostly cheaper trims, and the resulting error has a
# SIGN that depends on the target's trim rank. Averaged over targets the two
# signs cancel, which is precisely how a real bias hides inside a precise null.
#
# THE MEASUREMENT. No ground truth is needed, because the comparison is
# internal: build a price index per (make, model, trim level) from the stored
# observations themselves, then ask how far the target's own trim sits from the
# mean trim of the comps it was scored against. That distance is in log
# dollars, so it converts straight to a percentage of price.
#
# WHAT IT IS NOT. Not a claim about what the vehicle is worth (spec 4.5 --
# these are asking prices), and not an accuracy figure comparable to MedAPE
# above. It measures the CENTRING of the comp set, which no interval width can
# fix: spec 9.5 argues an interval that is systematically too narrow
# manufactures false confidence, and an interval whose centre is systematically
# wrong manufactures a false verdict the same way.

#: A (make, model, year) cell needs at least this many observations, and at
#: least two distinct trim levels, before it can say anything about what a trim
#: is worth relative to its neighbours. UNCALIBRATED, and chosen to be
#: conservative: a cell of 3 rows spanning 2 trims would produce an index entry
#: built on a single price each.
_MIN_CELL_SIZE = 6

#: A (make, model, trim level) index entry needs this many contributing cells
#: before it is trusted. Same reasoning; one observation is not an index.
_MIN_TRIM_SUPPORT = 3

#: Comps a target must have, and indexed comps among them, before its trim-mix
#: gap is meaningful. The first mirrors `MIN_COMPS_FOR_REGRESSION` so this
#: reports on the comp sets that actually get priced.
_MIN_COMPS_FOR_GAP = params.MIN_COMPS_FOR_REGRESSION
_MIN_INDEXED_COMPS_FOR_GAP = 4


def _trim_key(candidate: CompCandidate) -> tuple[str, str, str] | None:
    """(make, model, trim level) for the index, or None when trim is unstated.

    Derived through `decompose` rather than read off a column so that a
    candidate built by hand -- a test, a fixture -- keys the same way an
    ingested row does. `trim_level` and not `trim_text`: the verbatim string
    also encodes body style and engine, and `Premium Sport Utility 4D` is not a
    different trim from `2.0i Premium Sport Utility 4D`.
    """
    level = decompose(candidate.trim_text).trim_level
    if not level:
        return None
    model = normalize_key(candidate.model)
    if not model:
        return None
    return normalize_key(candidate.make), model, level


def build_trim_index(
    observations: list[CompCandidate],
) -> tuple[dict[tuple[str, str, str], float], dict[tuple[str, str, str], int]]:
    """A price index per (make, model, trim level), in log dollars.

    Each observation's log price minus the median log price of its own
    (make, model, year) cell, averaged per trim level. Differencing against the
    cell removes model and vintage, which are the two things that dominate
    price and would otherwise swamp the trim signal. Mileage is the residual
    confounder and is assumed roughly independent of trim within a cell -- it is
    not, quite, but nothing in the data suggests sellers of one trim
    systematically drive further.

    Returns (index, support) where support is the contributing observation count
    per entry, so a caller can report how thin an entry is.
    """
    cells: dict[tuple[str, str, int], list[CompCandidate]] = {}
    for obs in observations:
        if obs.year is None or not obs.price_cents or obs.price_cents <= 0:
            continue
        model = normalize_key(obs.model)
        if not model:
            continue
        cells.setdefault((normalize_key(obs.make), model, obs.year), []).append(obs)

    deviations: dict[tuple[str, str, str], list[float]] = {}
    for cell in cells.values():
        if len(cell) < _MIN_CELL_SIZE:
            continue
        keys = [_trim_key(obs) for obs in cell]
        if len({k for k in keys if k is not None}) < 2:
            continue
        median_log = statistics.median(math.log(obs.price_cents) for obs in cell)  # type: ignore[arg-type]
        for obs, key in zip(cell, keys, strict=True):
            if key is not None:
                deviations.setdefault(key, []).append(
                    math.log(obs.price_cents) - median_log  # type: ignore[arg-type]
                )

    index = {
        key: statistics.mean(values)
        for key, values in deviations.items()
        if len(values) >= _MIN_TRIM_SUPPORT
    }
    support = {key: len(deviations[key]) for key in index}
    return index, support


@dataclass(frozen=True)
class TrimGap:
    """One target, and how far its trim sits from its comp set's average trim."""

    capture_id: int
    label: str
    #: The target's own trim index, in log dollars relative to its model's
    #: average trim. Positive means an upper trim.
    target_index: float
    #: Mean index of the indexed comps it was scored against.
    comp_index: float
    n_comps: int
    n_indexed: int
    n_same_trim: int

    @property
    def gap(self) -> float:
        """Log-dollar distance from the comp set's centre to the target's trim.

        Positive means the comps are, in trim terms, CHEAPER cars than the
        target -- so the expected asking price they support is too low and the
        target reads as overpriced for reasons that are not its price.
        """
        return self.target_index - self.comp_index

    @property
    def gap_pct(self) -> float:
        return math.exp(self.gap) - 1.0


def trim_gaps(captures: list[StoredCapture]) -> list[TrimGap]:
    """The trim-mix gap for every capture that can support one.

    DEDUPLICATED BY TARGET LISTING, unlike every other mode in this file. The
    same listing evaluated five times is one fact about one comp set, and
    leaving the repeats in would let a handful of re-clicked listings decide
    which quartile the distribution's edges fall in. The index is deduplicated
    the same way and for the same reason: a listing that recurs across thirty
    captures would otherwise dominate its own cell.
    """
    latest: dict[str, StoredCapture] = {}
    for capture in captures:
        key = capture.target.source_listing_id
        previous = latest.get(key)
        if previous is None or capture.capture_id > previous.capture_id:
            latest[key] = capture
    unique = sorted(latest.values(), key=lambda c: c.capture_id)

    pool: dict[str, CompCandidate] = {}
    for capture in captures:
        pool.setdefault(capture.target.source_listing_id, capture.target)
        for candidate in capture.candidates:
            pool.setdefault(candidate.source_listing_id, candidate)
    index, _support = build_trim_index(list(pool.values()))

    out: list[TrimGap] = []
    for capture in unique:
        target_key = _trim_key(capture.target)
        if target_key is None or target_key not in index:
            continue

        comp_set = _filter_with_progressive_widening(
            capture.target,
            capture.candidates,
            year_window=params.YEAR_WINDOW,
            location_scoped=capture.location_scoped,
        )
        included = [d.candidate for d in comp_set.included]
        if len(included) < _MIN_COMPS_FOR_GAP:
            continue
        indexed = [index[k] for c in included if (k := _trim_key(c)) is not None and k in index]
        if len(indexed) < _MIN_INDEXED_COMPS_FOR_GAP:
            continue

        target = capture.target
        out.append(
            TrimGap(
                capture_id=capture.capture_id,
                label=f"{target.year} {target.make} {target.model} "
                f"[{decompose(target.trim_text).trim_level}]",
                target_index=index[target_key],
                comp_index=statistics.mean(indexed),
                n_comps=len(included),
                n_indexed=len(indexed),
                n_same_trim=sum(1 for c in included if _trim_key(c) == target_key),
            )
        )
    return out


def _quartiles(gaps: list[TrimGap]) -> list[tuple[str, list[TrimGap]]]:
    """Targets split by where their own trim sits within their model's range.

    The split that matters, and the one no other mode here makes. Reported as
    thirds-by-count rather than by an absolute index cutoff because the index
    is model-relative already: what "an upper trim" means in dollars differs
    between a Civic and an X5, but "above most trims of its own model" does not.
    """
    ranked = sorted(gaps, key=lambda g: g.target_index)
    n = len(ranked)
    return [
        ("bottom quartile trim", ranked[: n // 4]),
        ("middle half", ranked[n // 4 : 3 * n // 4]),
        ("top quartile trim", ranked[3 * n // 4 :]),
    ]


def _gap_row(label: str, sample: list[TrimGap]) -> str:
    if not sample:
        return f"{label:<24}{0:>6}{'n/a':>12}{'n/a':>10}{'n/a':>10}"
    median_gap = statistics.median(g.gap_pct for g in sample)
    median_same = statistics.median(g.n_same_trim for g in sample)
    reach = sum(1 for g in sample if g.n_same_trim >= params.MIN_COMPS_FOR_SLOPE)
    return (
        f"{label:<24}{len(sample):>6}{median_gap:>11.1%}{median_same:>10.0f}"
        f"{f'{reach}/{len(sample)}':>10}"
    )


def run_trim_bias(session: Session, capture_ids: list[int] | None, as_json: bool) -> int:
    captures = load_captures(session, capture_ids)
    if not captures:
        print("No captures stored.")
        return 1

    gaps = trim_gaps(captures)
    if not gaps:
        print(
            f"{len(captures)} captures stored, none scoreable. A capture needs a target "
            f"whose trim level appears in the index (>= {_MIN_TRIM_SUPPORT} observations "
            f"in cells of >= {_MIN_CELL_SIZE} spanning >= 2 trims), at least "
            f"{_MIN_COMPS_FOR_GAP} included comps, and at least "
            f"{_MIN_INDEXED_COMPS_FOR_GAP} of them indexed."
        )
        return 1

    # Buckets of three, which is the resolution the sample supports; the
    # question is where the gap stops shrinking, not its exact shape.
    by_same: dict[int, list[TrimGap]] = {}
    for gap in gaps:
        by_same.setdefault(min(gap.n_same_trim // 3 * 3, 12), []).append(gap)

    if as_json:
        print(
            json.dumps(
                {
                    "captures_loaded": len(captures),
                    "targets_scored": len(gaps),
                    "median_gap": statistics.median(g.gap_pct for g in gaps),
                    "mean_gap": statistics.mean(g.gap_pct for g in gaps),
                    "by_trim_rank": {
                        label: {
                            "n": len(sample),
                            "median_gap": statistics.median(g.gap_pct for g in sample),
                            "median_same_trim_comps": statistics.median(
                                g.n_same_trim for g in sample
                            ),
                        }
                        for label, sample in _quartiles(gaps)
                        if sample
                    },
                    "by_same_trim_count": {
                        str(bucket): {
                            "n": len(sample),
                            "median_abs_gap": statistics.median(abs(g.gap_pct) for g in sample),
                        }
                        for bucket, sample in sorted(by_same.items())
                    },
                },
                indent=2,
            )
        )
        return 0

    print(f"\nCaptures loaded:  {len(captures)}")
    print(f"Targets scored:   {len(gaps)}  (deduplicated by target listing)")
    print(
        f"\n{'trim rank of target':<24}{'n':>6}{'median gap':>11}"
        f"{'same-trim':>10}{f'>= {params.MIN_COMPS_FOR_SLOPE}':>10}"
    )
    print("-" * 61)
    print(_gap_row("ALL", gaps))
    print("-" * 61)
    for label, sample in _quartiles(gaps):
        print(_gap_row(label, sample))

    print(f"\n{'same-trim comps':<24}{'n':>6}{'median |gap|':>14}")
    print("-" * 44)
    for bucket, sample in sorted(by_same.items()):
        span = f"{bucket}-{bucket + 2}" if bucket < 12 else "12+"
        median_abs = statistics.median(abs(g.gap_pct) for g in sample)
        print(f"{span:<24}{len(sample):>6}{median_abs:>13.1%}")

    print("\n--- 10 largest gaps ---")
    for gap in sorted(gaps, key=lambda g: -abs(g.gap))[:10]:
        print(
            f"{gap.gap_pct:>+7.1%}  {gap.n_comps:>3} comps, {gap.n_same_trim:>2} same trim  "
            f"{gap.label}"
        )

    print(
        "\nGAP is how far the target's own trim sits above the average trim of the comps "
        "it was scored against, as a fraction of price. POSITIVE means the comp set is "
        "made of cheaper trims than the target, so the expected asking price it supports "
        "is too low and the target reads as overpriced for reasons that are not its "
        "price. NEGATIVE is the mirror image and reads as a bargain.\n"
        "Read the quartile rows, not the ALL row. The two signs cancel when averaged "
        "over targets, which is exactly how this bias hides inside the precise null "
        "that --trim-premium reports."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description="Leave-one-out CV of the expected-asking-price model.")
    parser.add_argument(
        "--capture",
        type=int,
        action="append",
        dest="captures",
        help="restrict to this capture id; repeatable",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--coverage",
        action="store_true",
        help="check published intervals against targets' real asks (spec 9.5) instead of "
        "the leave-one-out comp accuracy",
    )
    parser.add_argument(
        "--trim-premium",
        action="store_true",
        help="pooled CI on the trim-match premium coefficient, reanalysing params.py's "
        "'Trim as a regressor' finding across every fittable capture instead of only "
        "the ones the narrowest-interval rule happened to select",
    )
    parser.add_argument(
        "--trim-bias",
        action="store_true",
        help="how far each target's own trim sits from the average trim of its comp set, "
        "split by the target's trim rank -- the target-side measurement the other modes "
        "are structurally blind to",
    )
    args = parser.parse_args(argv)

    with session_scope() as session:
        if args.coverage:
            return run_coverage(session, args.captures, args.json)
        if args.trim_premium:
            return run_trim_premium(session, args.captures, args.json)
        if args.trim_bias:
            return run_trim_bias(session, args.captures, args.json)
        return run(session, args.captures, args.json)


if __name__ == "__main__":
    raise SystemExit(main())
