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

from sqlalchemy.orm import Session

from ..alternatives import find_alternatives
from ..db import session_scope
from ..flags import assess_completeness, assess_scam_patterns, read_title_status
from ..flags.params import SCAM_SIGNALS_FOR_WARNING
from ..negotiation import NegotiationAssessment, assess_negotiation, plan_offer
from ..nhtsa import assess_vehicle
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


def print_negotiation(negotiation: NegotiationAssessment, assessment: PricingAssessment) -> None:
    """Spec 6.4: negotiation goes in the brief, not up top as a third headline."""
    n = negotiation
    days = "unknown" if n.days_listed is None else f"{n.days_listed} days"

    # Surfaced before the leverage reading because it changes what the whole
    # section means. Spec 1: a private-party car benchmarked against dealer
    # pricing "makes nearly every FB listing look like a bargain".
    if n.seller.is_dealer:
        print(
            f"\n  SELLER: DEALER   ({', '.join(n.seller.markers)})\n"
            "    This is a dealer listing, not the private-party sale this tool is "
            "built to evaluate.\n"
            "    Dealer asks carry reconditioning, warranty and overhead, so the "
            "comparison is not like for like."
        )

    print(
        f"\n  NEGOTIATION: {n.leverage.value.upper()}   "
        f"(listed {days}; separate from deal quality)"
    )

    for point in n.leverage_points:
        print(f"    - {point}")

    if not n.language.had_text:
        print("    - No description text, so seller phrasing could not be read.")
    elif not n.language.motivated and not n.language.rigid:
        print("    - Description contains none of the usual flexibility or rigidity phrasing.")

    # The offer plan (spec 7.5). Anchored to the comp set when pricing published
    # anchors, and to the ask otherwise -- which is the common case, so the basis
    # is printed rather than left to be inferred from whether a figure appeared.
    published = bool(assessment.anchors)
    plan = plan_offer(
        ask_cents=assessment.ask_cents,
        expected_asking_cents=(
            assessment.estimate.expected_asking_cents if published else None
        ),
        walk_away_cents=assessment.anchors.get("walk_away_above_cents"),
        negotiation=n,
        overpriced=bool(assessment.rating and assessment.rating.band == "overpriced"),
    )

    if not plan.has_figures:
        print(f"    Offer: withheld -- {plan.withheld_reason}")
        return

    print(
        f"\n    OFFER ({plan.stance.value}, anchored on {plan.basis.value})"
        f"\n      Open at:          {money(plan.opening_cents)}"
        f"\n      Expect to pay:    {money(plan.target_cents)}"
    )
    if plan.walk_away_cents is not None:
        print(f"      Walk away above:  {money(plan.walk_away_cents)}")
    for line in plan.reasoning:
        print(f"      - {line}")


def print_alternatives(capture: StoredCapture, assessment: PricingAssessment) -> None:
    """Spec 6.5. Reframes the product from judging a listing to helping a buy."""
    result = find_alternatives(
        assessment.target,
        assessment.comp_set.included,
        assessment.estimate,
        assessment.confidence.level,
    )

    print("\n  BETTER ALTERNATIVES   (spec 6.5)")
    print(f"    {result.message()}")
    for alternative in result.alternatives:
        print(f"      - {alternative.describe()}")
        if alternative.url:
            print(f"        {alternative.url}")
    # Named, not counted: a withhold a reader cannot see is a rumour.
    for withheld in result.withheld:
        print(f"      - {withheld.describe()}")
        print(f"        {withheld.reason}")
        if withheld.url:
            print(f"        {withheld.url}")


def print_vehicle_risk(
    session: Session,
    capture: StoredCapture,
    assessment: PricingAssessment,
    offline: bool,
) -> None:
    """Spec 6.2's vehicle risk, from NHTSA. Separate from pricing, never folded in."""
    risk = assess_vehicle(
        session,
        vin=capture.target_vin,
        year=assessment.target.year,
        make=assessment.target.make,
        model=assessment.target.model,
        offline=offline,
    )
    if not risk.has_data:
        print("\n  VEHICLE RISK: no NHTSA data (needs at least year, make and model)")
        return

    print("\n  VEHICLE RISK   (spec 6.2; separate from price)")
    if risk.spec:
        label = "VIN decoded" if risk.spec.clean_decode else "VIN decoded (partial)"
        print(f"    {label}: {risk.spec.summary}")
    else:
        print("    No VIN in this listing, so trim and drivetrain stay unconfirmed.")
    for message in risk.messages():
        print(f"    {message}")


def print_flags(capture: StoredCapture, assessment: PricingAssessment) -> None:
    """Vehicle-risk flags, completeness and scam patterns (spec 6.2, 6.3)."""
    title = read_title_status(capture.target_title_status)
    completeness = assess_completeness(
        description=capture.target_description,
        photo_count=capture.target_photo_count,
        mileage=assessment.target.mileage,
        title_status=capture.target_title_status,
        vin=capture.target_vin,
        year=assessment.target.year,
        trim_text=assessment.target.trim_text,
    )
    scam = assess_scam_patterns(
        description=capture.target_description,
        photo_count=capture.target_photo_count,
        vin=capture.target_vin,
        price_residual=assessment.residual_fraction,
        price_changed=capture.target_price_changed,
    )

    print(f"\n  TITLE: {title.risk.value.upper()}")
    print(f"    {title.message}")

    print(f"\n  COMPLETENESS: {completeness.score:.0f}/100   (how much the seller disclosed)")
    print(f"    {completeness.message}")

    # Spec 6.3: "a distinct, prominent warning rather than a numerical deduction
    # buried in a composite." Hence a banner, and no score anywhere.
    if scam.warn:
        print("\n  *** SCAM PATTERN WARNING ***")
        print(f"  {len(scam.fired)} independent signals fired together. Any one is weak;")
        print("  this many at once is not. Treat with caution.")
        for text in scam.explain():
            print(f"    - {text}")
    elif scam.fired:
        print(f"\n  Scam signals: {len(scam.fired)} of {len(scam.evaluable)} checkable fired "
              f"(warning needs {SCAM_SIGNALS_FOR_WARNING})")
        for text in scam.explain():
            print(f"    - {text}")
    else:
        print(f"\n  Scam signals: none of {len(scam.evaluable)} checkable fired")

    if scam.reduced_sensitivity:
        print(
            f"    Reduced sensitivity: only {len(scam.evaluable)} of "
            f"{len(scam.results)} signals could be checked."
        )
        for r in scam.unavailable:
            print(f"      - {r.signal.value}: {r.unavailable_reason}")


def print_assessment(
    session: Session,
    capture: StoredCapture,
    assessment: PricingAssessment,
    verbose: bool,
    offline: bool,
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
    if cs.year_window_widened:
        print(
            f"  Year window:          widened to +/-{cs.year_window} years to reach the "
            f"comp floor (spec 4.3)"
        )
    if est.kind is EstimatorKind.MILEAGE_REGRESSION:
        assert est.slope_cents_per_mile is not None
        print(
            f"  Mileage slope:        asking price falls "
            f"${abs(est.slope_cents_per_mile) / 100:.4f} per mile"
        )
        if est.r_squared is not None:
            print(f"  R-squared:            {est.r_squared:.2f}")
        sensitivity = est.outlier_sensitivity
        if sensitivity is not None:
            print(
                f"  Outlier sensitivity:  {sensitivity:.1%}"
                f"   (robust fit says {money(est.robust_asking_cents)}; diagnostic only)"
            )
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
        # What the verdict was actually computed on, and how much of the gap
        # the comp set could not resolve. Printed whenever they differ, so a
        # surprising rating can be traced to the uncertainty that caused it
        # rather than looking like a bug in the curve.
        if r.uncertainty_margin > 0 and r.scored_residual_fraction != residual:
            print(
                f"  Expected price known: +/-{r.uncertainty_margin:.1%}"
                f"   -> {abs(r.scored_residual_fraction):.1%} of that gap is resolvable"
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

    # --- negotiation (spec 6.4), a separate reading from deal quality -------
    print_negotiation(
        assess_negotiation(
            posted_at=capture.target_posted_at,
            observed_at=capture.target_observed_at,
            description=capture.target_description,
            price_residual=assessment.residual_fraction,
        ),
        assessment,
    )

    # --- flags (spec 6.2, 6.3) ----------------------------------------------
    print_flags(capture, assessment)
    print_vehicle_risk(session, capture, assessment, offline)
    print_alternatives(capture, assessment)

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
    title = read_title_status(capture.target_title_status)
    completeness = assess_completeness(
        description=capture.target_description,
        photo_count=capture.target_photo_count,
        mileage=a.target.mileage,
        title_status=capture.target_title_status,
        vin=capture.target_vin,
        year=a.target.year,
        trim_text=a.target.trim_text,
    )
    scam = assess_scam_patterns(
        description=capture.target_description,
        photo_count=capture.target_photo_count,
        vin=capture.target_vin,
        price_residual=a.residual_fraction,
        price_changed=capture.target_price_changed,
    )
    n = assess_negotiation(
        posted_at=capture.target_posted_at,
        observed_at=capture.target_observed_at,
        description=capture.target_description,
        price_residual=a.residual_fraction,
    )
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
        "expected_uncertainty_fraction": a.estimate.expected_uncertainty_fraction,
        "scored_residual_fraction": a.rating.scored_residual_fraction if a.rating else None,
        "within_noise": a.rating.within_noise if a.rating else None,
        "price_rating_calibrated": is_calibrated(),
        "confidence": a.confidence.level.value,
        "confidence_limiters": [x.value for x in a.confidence.limiters],
        "fallback_reasons": list(a.estimate.fallback_reasons),
        "excluded_counts": a.comp_set.exclusion_counts(),
        "anchors": a.anchors,
        "negotiation": {
            "seller_type": n.seller.seller_type.value,
            "dealer_markers": list(n.seller.markers),
            "leverage": n.leverage.value,
            "strength": n.strength,
            "days_listed": n.days_listed,
            "motivated_phrases": list(n.language.motivated),
            "rigid_phrases": list(n.language.rigid),
            "leverage_points": list(n.leverage_points),
        },
        "flags": {
            "title_risk": title.risk.value,
            "title_raw": title.raw,
            "completeness": completeness.score,
            "completeness_missing": list(completeness.missing),
            # Spec 6.3: a combination and a warning, deliberately never a score.
            "scam_warning": scam.warn,
            "scam_signals_fired": [r.signal.value for r in scam.fired],
            "scam_signals_evaluable": len(scam.evaluable),
            "scam_signals_total": len(scam.results),
            "scam_reduced_sensitivity": scam.reduced_sensitivity,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the expected-ASKING-price model over stored captures.",
    )
    parser.add_argument("--capture", type=int, action="append", help="capture id (repeatable)")
    parser.add_argument("--verbose", action="store_true", help="list every excluded comp")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="never call NHTSA; use only what is already cached",
    )
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

        return _report(session, results, args)


def _report(session: Session, results, args) -> int:

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
        print_assessment(session, capture, assessment, args.verbose, args.offline)

    with_estimate = sum(1 for _, a in results if a.estimate.has_estimate)
    print(RULE)
    print(f"{len(results)} captures, {with_estimate} with an expected asking price.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
