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
from ..pricing.model import assess_listing
from ..pricing.regression import EstimatorKind, estimate_expected_asking_price


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
    args = parser.parse_args(argv)

    with session_scope() as session:
        return run(session, args.captures, args.json)


if __name__ == "__main__":
    raise SystemExit(main())
