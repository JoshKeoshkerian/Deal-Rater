"""Run the expected-asking-price model over stored captures and print the result.

    python -m app.cli.price
    python -m app.cli.price --capture 2 --verbose
    python -m app.cli.price --json

Prints, per listing: the expected ASKING price and interval, the comp count, the
comps used and why each was kept or dropped, and the confidence assessment with
its reasons. Every price shown is an ASKING price (spec 4.5).

This is a read-only diagnostic. It writes nothing and calls nothing external.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from ..db import session_scope
from ..pricing import assess_listing, is_calibrated
from ..pricing.comps import CompDecision
from ..pricing.loader import StoredCapture, load_captures
from ..pricing.model import PricingAssessment
from ..pricing.regression import EstimatorKind

RULE = "=" * 78
THIN = "-" * 78


def money(cents: int | None) -> str:
    if cents is None:
        return "n/a"
    return f"${cents / 100:,.0f}"


def miles(value: int | None) -> str:
    return "unknown" if value is None else f"{value:,} mi"


def _vehicle(c) -> str:
    parts = [str(c.year or "????"), c.make or "?", c.model or "?"]
    if c.trim_text:
        parts.append(c.trim_text)
    return " ".join(parts)


def _print_comp_table(decisions: list[CompDecision], header: str) -> None:
    if not decisions:
        return
    print(f"\n  {header}")
    for d in decisions:
        c = d.candidate
        flag = "+" if d.usable_in_fit else ("~" if d.included else "-")
        print(
            f"    {flag} {money(c.price_cents):>9}  {miles(c.mileage):>12}  "
            f"{_vehicle(c)[:44]:<44}  {d.reason()}"
        )


def print_assessment(
    capture: StoredCapture, assessment: PricingAssessment, verbose: bool
) -> None:
    t = assessment.target
    est = assessment.estimate
    cs = assessment.comp_set

    print(RULE)
    print(f"capture {capture.capture_id}   search: {capture.search_query or 'n/a'}")
    print(f"TARGET  {_vehicle(t)}")
    print(f"        {miles(t.mileage)}   {t.location_text or 'location unknown'}")
    print(THIN)

    # --- spec 5.1's four numbers -------------------------------------------
    print(f"  Current ask:          {money(t.price_cents)}")

    if not est.has_estimate:
        print("  Expected asking:      no estimate")
    else:
        print(
            f"  Expected asking:      {money(est.expected_asking_cents)}"
            f"   (point estimate of the ADVERTISED price)"
        )
        print(
            f"  Expected asking range:{money(est.asking_interval_low_cents):>10}"
            f" - {money(est.asking_interval_high_cents)}"
            f"   ({est.coverage:.0%} prediction interval)"
        )
        if assessment.anchors:
            print(f"  Strong offer:         {money(assessment.anchors['strong_offer_cents'])}")
            print(
                f"  Walk away above:      "
                f"{money(assessment.anchors['walk_away_above_cents'])}"
            )
        else:
            print(
                "  Strong offer:         withheld -- the expected range is too wide "
                "to name a figure"
            )

    # --- fit ----------------------------------------------------------------
    print(f"\n  Estimator:            {est.kind.value}")
    print(
        f"  Comps:                {est.n_included} included, "
        f"{est.n_fit_points} with mileage, {len(cs.excluded)} excluded"
    )
    if est.kind is EstimatorKind.MILEAGE_REGRESSION:
        assert est.slope_cents_per_mile is not None
        print(
            f"  Mileage slope:        asking price falls "
            f"${abs(est.slope_cents_per_mile) / 100:.4f} per mile"
        )
        if est.r_squared is not None:
            print(f"  R-squared:            {est.r_squared:.2f}")
    if est.interval_widened_to_floor:
        print(
            "  Interval:             widened to the precision floor "
            "(comp mileage is rounded to 1,000)"
        )
    for reason in est.fallback_reasons:
        print(f"  Fallback:             {reason}")

    # --- rating and residual ------------------------------------------------
    residual = assessment.residual_fraction
    if residual is not None and assessment.rating is not None:
        r = assessment.rating
        direction = "below" if residual < 0 else "above"
        print(
            f"\n  Residual:             {abs(residual):.1%} {direction} expected asking price"
        )
        print(f"  Pricing rating:       {r.rating:.0f}/100  [{r.band}]  (pricing dimension only)")
        print(f"                        {r.label}")
        if not r.calibrated:
            print(
                "  NOT CALIBRATED:       curve breakpoints are placeholders; "
                "no ground truth set has been run (spec 9.4)"
            )

    # --- confidence, kept separate -----------------------------------------
    conf = assessment.confidence
    print(f"\n  Confidence:           {conf.level.value.upper()}   (separate from the price)")
    for text in conf.explain():
        print(f"    - {text}")

    # --- comps --------------------------------------------------------------
    print(f"\n  Trim coverage {cs.trim_coverage:.0%}, agreement {cs.trim_agreement:.0%}")
    _print_comp_table(cs.fit_points, "COMPS IN THE FIT (+)")
    no_mileage = [d for d in cs.included if d.mileage_unknown]
    _print_comp_table(no_mileage, "INCLUDED BUT NOT IN THE FIT (~)")

    if verbose:
        _print_comp_table(cs.excluded, "EXCLUDED (-)")
    else:
        counts = cs.exclusion_counts()
        if counts:
            summary = ", ".join(f"{k} x{v}" for k, v in sorted(counts.items()))
            print(f"\n  Excluded: {summary}   (--verbose to list them)")
    print()


def to_dict(capture: StoredCapture, a: PricingAssessment) -> dict:
    return {
        "capture_id": capture.capture_id,
        "target": asdict(a.target),
        "ask_cents": a.ask_cents,
        "expected_asking_cents": a.estimate.expected_asking_cents,
        "asking_interval_low_cents": a.estimate.asking_interval_low_cents,
        "asking_interval_high_cents": a.estimate.asking_interval_high_cents,
        "interval_coverage": a.estimate.coverage,
        "estimator": a.estimate.kind.value,
        "n_included": a.estimate.n_included,
        "n_fit_points": a.estimate.n_fit_points,
        "residual_fraction": a.residual_fraction,
        "price_rating": a.rating.rating if a.rating else None,
        "price_rating_band": a.rating.band if a.rating else None,
        "price_rating_calibrated": is_calibrated(),
        "confidence": a.confidence.level.value,
        "confidence_limiters": [x.value for x in a.confidence.limiters],
        "fallback_reasons": list(a.estimate.fallback_reasons),
        "excluded_counts": a.comp_set.exclusion_counts(),
        "anchors": a.anchors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the expected-ASKING-price model over stored captures.",
    )
    parser.add_argument("--capture", type=int, action="append", help="capture id (repeatable)")
    parser.add_argument("--verbose", action="store_true", help="list every excluded comp")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    args = parser.parse_args(argv)

    with session_scope() as session:
        captures = load_captures(session, args.capture)

        if not captures:
            print("No captures found. Ingest some listings first.", file=sys.stderr)
            return 1

        results = [
            (
                c,
                assess_listing(c.target, c.candidates, location_scoped=c.location_scoped),
            )
            for c in captures
        ]

    if args.json:
        print(json.dumps([to_dict(c, a) for c, a in results], indent=2, default=str))
        return 0

    print()
    print("EXPECTED ASKING PRICE MODEL (spec step 3)")
    print(
        "Every price below is an ASKING price -- what comparable vehicles are "
        "ADVERTISED at,\nnot what they sell for. Marketplace does not expose "
        "transaction prices (spec 4.5)."
    )
    if not is_calibrated():
        print(
            "\n*** UNCALIBRATED. No ground truth set exists in this repo, so the "
            "discount curve's\n*** breakpoints are placeholders and agreement has "
            "never been measured (spec 9)."
        )
    print()

    for capture, assessment in results:
        print_assessment(capture, assessment, args.verbose)

    with_estimate = sum(1 for _, a in results if a.estimate.has_estimate)
    print(RULE)
    print(f"{len(results)} captures, {with_estimate} with an expected asking price.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
