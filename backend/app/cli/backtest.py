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
import statistics
from argparse import ArgumentParser
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..db import session_scope
from ..pricing import params
from ..pricing.comps import CompSet
from ..pricing.loader import StoredCapture, load_captures
from ..pricing.model import _filter_with_progressive_widening, assess_listing
from ..pricing.regression import EstimatorKind, _fit_multi, estimate_expected_asking_price

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
    args = parser.parse_args(argv)

    with session_scope() as session:
        if args.coverage:
            return run_coverage(session, args.captures, args.json)
        if args.trim_premium:
            return run_trim_premium(session, args.captures, args.json)
        return run(session, args.captures, args.json)


if __name__ == "__main__":
    raise SystemExit(main())
