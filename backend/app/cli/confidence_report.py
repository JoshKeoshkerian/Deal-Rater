"""Confidence-level, limiter, and negotiation-anchor distribution report.

    python -m app.cli.confidence_report
    python -m app.cli.confidence_report --offline

WHY THIS EXISTS
---------------
docs/scoring-audit.md findings #4 and #5: confidence never reached HIGH and
negotiation anchors were withheld on 95% of evaluations across every stored
capture at the time of that audit, both driven by thresholds
(`WIDE_INTERVAL`'s 35%-of-point cutoff, `COMPS_FOR_HIGH_CONFIDENCE=15`,
`MAX_INTERVAL_WIDTH_FOR_ANCHORS=0.30`) that were never checked against real
comp-set noise. There is no calibrated ground truth to justify changing those
numbers now (spec 9's pass has not run), so the audit's own recommendation was
to add visibility rather than guess at new values.

This is exactly the ad-hoc script that audit wrote once, by hand, to produce
its section 6 numbers -- checked in so the next person (or the next run of
this tool, after a future change to `curve.py`, `confidence.py`, or the
comp-filtering pipeline) can answer "did this move something it shouldn't
have" with one command instead of reconstructing the analysis from scratch.

Same pattern as `app.cli.ablation`: `load_captures` -> `evaluate_capture` over
every stored capture, aggregated and printed.
"""

from __future__ import annotations

from argparse import ArgumentParser
from collections import Counter

from sqlalchemy.orm import Session

from ..db import session_scope
from ..evaluation import evaluate_capture
from ..pricing import params
from ..pricing.loader import load_captures


def run(session: Session, offline: bool) -> int:
    captures = load_captures(session)
    if not captures:
        print("No captures stored.")
        return 1

    confidence_counts: Counter[str] = Counter()
    limiter_counts: Counter[str] = Counter()
    n_with_estimate = 0
    n_anchors_published = 0
    n_total = len(captures)

    for capture in captures:
        evaluation = evaluate_capture(session, capture, offline=offline)
        pricing = evaluation.pricing
        confidence_counts[pricing.confidence.level.value] += 1
        for limiter in pricing.confidence.limiters:
            limiter_counts[limiter.value] += 1
        if pricing.estimate.has_estimate:
            n_with_estimate += 1
            if pricing.anchors:
                n_anchors_published += 1

    print(f"\nCaptures loaded: {n_total}")

    print(f"\n{'confidence level':<20}{'n':>6}{'share':>8}")
    print("-" * 34)
    for level in ("high", "medium", "low", "none"):
        count = confidence_counts.get(level, 0)
        share = f"{count / n_total:.0%}" if n_total else "n/a"
        print(f"{level:<20}{count:>6}{share:>8}")
    if confidence_counts.get("high", 0) == 0:
        print(
            "\nHIGH confidence was reached on 0 captures. Per docs/scoring-audit.md "
            "finding #4, this is not necessarily a bug -- it may mean COMPS_FOR_HIGH_"
            "CONFIDENCE and WIDE_INTERVAL's threshold are simply stricter than this "
            "market's real comp-set noise. Re-run this after any comp-filtering or "
            "confidence change to see whether that ceiling moved."
        )

    print(f"\n{'limiter':<32}{'n':>6}{'share of captures':>20}")
    print("-" * 58)
    for limiter, count in limiter_counts.most_common():
        print(f"{limiter:<32}{count:>6}{count / n_total:>20.0%}")

    print("\nNegotiation anchors (spec 5.1's 'strong offer' / 'walk away above'):")
    if n_with_estimate:
        share = n_anchors_published / n_with_estimate
        print(
            f"  published on {n_anchors_published}/{n_with_estimate} evaluations with an "
            f"estimate ({share:.0%}); withheld on the rest because the published interval "
            f"exceeds MAX_INTERVAL_WIDTH_FOR_ANCHORS ({params.MAX_INTERVAL_WIDTH_FOR_ANCHORS:.0%})."
        )
    else:
        print("  no evaluation produced an estimate to check anchors against.")

    print(
        "\nUNCALIBRATED: none of the thresholds behind these numbers "
        "(COMPS_FOR_HIGH_CONFIDENCE, WIDE_INTERVAL's cutoff, "
        "MAX_INTERVAL_WIDTH_FOR_ANCHORS) have been changed based on this report -- "
        "spec 9 has not run, and changing them now would just swap one unvalidated "
        "guess for another. This tool is for tracking the distribution over time, "
        "not for tuning it."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="never call NHTSA; use only what is already cached",
    )
    args = parser.parse_args(argv)

    with session_scope() as session:
        return run(session, args.offline)


if __name__ == "__main__":
    raise SystemExit(main())
