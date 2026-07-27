"""Measure model agreement against the hand-labelled ground truth set.

    python -m app.cli.agreement
    python -m app.cli.agreement --labeler josh

This is STEP 3'S SUCCESS CRITERION (spec 13.3): "agreement with manual
assessment on the ground truth set". Spec 9.1 adds the point of it:
"Disagreements locate the wrong weights."

IT REFUSES TO RUN WITHOUT LABELS. It will not fabricate a set, will not fall
back to a heuristic, and will not report a score computed from a handful of
rows as though it meant something. An agreement number with no labels behind it
is worse than no number, because it looks like validation.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_scope
from ..models import GroundTruthLabel
from ..pricing import assess_listing, is_calibrated
from ..pricing.curve import PricingRating
from ..pricing.loader import load_captures

#: Minimum labels before an agreement figure is reported at all. Spec 9.1 asks
#: for 50 to 100; below 20 the confusion matrix is mostly empty cells and any
#: percentage read off it is noise.
MIN_LABELS_TO_SCORE = 20

ORDER = ["good_deal", "fair", "overpriced", "avoid"]


def model_verdict(rating: PricingRating | None) -> str | None:
    """Collapse the pricing rating into spec 9.1's four-way vocabulary.

    UNCALIBRATED, and circularly so on purpose: these cutoffs are read off the
    same placeholder curve the labels are meant to correct. That is exactly why
    the mapping lives here in the scorer rather than in the model -- it is part
    of the measurement, and it moves when calibration moves.

    Note the model CANNOT produce "avoid". That verdict is about vehicle and
    seller risk (spec 6.2, 6.3), which are build steps 5 and 6. A human "avoid"
    landing anywhere on the pricing scale is therefore expected, and is reported
    separately below rather than counted as a plain miss.
    """
    if rating is None:
        return None
    if rating.band in {"plateau", "declining", "implausible_discount"}:
        return "good_deal"
    if rating.band == "fair":
        return "fair"
    return "overpriced"


def run(session: Session, labeler: str | None) -> int:
    stmt = select(GroundTruthLabel)
    if labeler:
        stmt = stmt.where(GroundTruthLabel.labeler == labeler)
    labels = {label.observation_id: label for label in session.scalars(stmt)}

    if not labels:
        print(
            "No ground truth labels found.\n\n"
            "Step 3's success criterion (spec 13.3) is agreement with manual\n"
            "assessment on the ground truth set, and that set does not exist yet.\n"
            "Nothing here can be validated until it does.\n\n"
            "Build it with:  python -m app.cli.label --labeler <your-name>\n"
            "Spec 9.1 asks for 50 to 100 hand-evaluated listings.",
            file=sys.stderr,
        )
        return 1

    captures = load_captures(session)
    scored: list[tuple[str, str | None]] = []
    unscorable = 0

    for capture in captures:
        label = labels.get(capture.target_observation_id)
        if label is None:
            continue
        assessment = assess_listing(
            capture.target, capture.candidates, location_scoped=capture.location_scoped
        )
        verdict = model_verdict(assessment.rating)
        if verdict is None:
            unscorable += 1
        scored.append((label.label, verdict))

    if not scored:
        print(
            "Labels exist, but none of them are on listings the model can score.",
            file=sys.stderr,
        )
        return 1

    comparable = [(h, m) for h, m in scored if m is not None]

    print(f"\nGround truth labels:        {len(labels)}")
    print(f"Matched to a capture:       {len(scored)}")
    print(f"Model produced a verdict:   {len(comparable)}")
    if unscorable:
        print(f"No verdict (too few comps): {unscorable}")

    if len(comparable) < MIN_LABELS_TO_SCORE:
        print(
            f"\nREFUSING TO REPORT AN AGREEMENT FIGURE.\n"
            f"{len(comparable)} scorable labels is below the floor of "
            f"{MIN_LABELS_TO_SCORE}, and spec 9.1 asks for 50 to 100.\n"
            f"A percentage computed from this many rows would be noise wearing a "
            f"decimal point.\n\nLabel more listings, then run this again."
        )
        return 1

    # --- confusion matrix ---------------------------------------------------
    matrix: dict[tuple[str, str], int] = {}
    for human, model in comparable:
        matrix[(human, model)] = matrix.get((human, model), 0) + 1

    model_labels = [x for x in ORDER if x != "avoid"]
    print("\nConfusion matrix (rows: human, columns: model)")
    print(f"  {'':<12}" + "".join(f"{m:>13}" for m in model_labels))
    for human in ORDER:
        row = "".join(f"{matrix.get((human, m), 0):>13}" for m in model_labels)
        print(f"  {human:<12}{row}")

    exact = sum(count for (h, m), count in matrix.items() if h == m)
    print(f"\nExact agreement:  {exact}/{len(comparable)}  ({exact / len(comparable):.0%})")

    # "avoid" is a risk verdict the pricing dimension cannot express, so it is
    # excluded from the headline rather than counted as a pricing miss.
    pricing_only = [(h, m) for h, m in comparable if h != "avoid"]
    if pricing_only:
        exact_pricing = sum(1 for h, m in pricing_only if h == m)
        print(
            f"Excluding 'avoid': {exact_pricing}/{len(pricing_only)}  "
            f"({exact_pricing / len(pricing_only):.0%})"
        )

    n_avoid = sum(1 for h, _ in comparable if h == "avoid")
    if n_avoid:
        print(
            f"\n{n_avoid} listing(s) labelled 'avoid'. The pricing dimension cannot "
            f"produce that\nverdict -- it needs vehicle and seller risk (steps 5 and 6)."
        )

    if not is_calibrated():
        print(
            "\nNOTE: the discount curve is still uncalibrated. This figure is the "
            "input to\nspec 9.4's calibration pass, not a result from it."
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Measure model agreement against the ground truth set (spec 9.1).",
    )
    parser.add_argument("--labeler", help="restrict to one labeller")
    args = parser.parse_args(argv)

    with session_scope() as session:
        return run(session, args.labeler)


if __name__ == "__main__":
    raise SystemExit(main())
