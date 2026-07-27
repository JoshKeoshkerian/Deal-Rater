"""Component ablation: spec 9.2's check on whether a weight is doing real work.

    python -m app.cli.ablation
    python -m app.cli.ablation --offline

Spec 9.2: "Run with each dimension disabled. If removing seller signals changes
almost nothing, the weight is too high or the signal is not real."

WHAT "DISABLED" MEANS HERE
---------------------------
Not re-running the pipeline with a dimension switched off -- the assessment
functions do not take an "ignore this" flag, and adding one only for this tool
would be a production code path that exists purely to be turned off. Instead,
each capture is scored normally, and the ablation is a counterfactual on the
ALREADY-COMPUTED components (`score.ablate_component`): recompute the weighted
average with one component's value dropped and the rest renormalised, exactly
as `compute_deal_score` renormalises around a component that could not be
assessed at all. That answers spec 9.2's question -- how much of the headline
number this dimension is actually responsible for -- without a second code path
that only ever runs in this tool.

Skips listings whose full score was suppressed (spec 5.2's scam-warning
withholding, missing price residual, or too little coverage): there is no
number to compare an ablated one against in any of those cases.
"""

from __future__ import annotations

import statistics
from argparse import ArgumentParser

from sqlalchemy.orm import Session

from ..db import session_scope
from ..evaluation import evaluate_capture
from ..evaluation.score import WEIGHTS, ablate_component
from ..pricing.loader import load_captures


def run(session: Session, offline: bool) -> int:
    captures = load_captures(session)
    if not captures:
        print("No captures stored.")
        return 1

    deltas: dict[str, list[float]] = {name: [] for name in WEIGHTS}
    scored = 0

    for capture in captures:
        evaluation = evaluate_capture(session, capture, offline=offline)
        score = evaluation.deal_score
        if score.score is None:
            continue
        scored += 1
        for name in WEIGHTS:
            ablated = ablate_component(score, name)
            if ablated is not None:
                deltas[name].append(abs(score.score - ablated))

    print(f"\nCaptures with a published score: {scored}")
    if not scored:
        print("Nothing to ablate -- no capture produced a headline score.")
        return 1

    print(f"\n{'component':<24}{'weight':>8}{'n':>6}{'mean |delta|':>14}{'max |delta|':>13}")
    print("-" * 65)
    for name, weight in WEIGHTS.items():
        sample = deltas[name]
        if not sample:
            print(f"{name:<24}{weight:>8.0f}{0:>6}{'n/a':>14}{'n/a':>13}")
            continue
        print(
            f"{name:<24}{weight:>8.0f}{len(sample):>6}"
            f"{statistics.mean(sample):>14.2f}{max(sample):>13.2f}"
        )

    print(
        "\n'n' is how many scored listings actually had this component available to "
        "drop; a component that is usually missing (e.g. vehicle_risk with no VIN) "
        "gets a thin sample here independent of whether its weight is right.\n"
        "A component whose mean |delta| is small relative to its weight is doing "
        "little work -- spec 9.2 reads that as 'the weight is too high or the "
        "signal is not real', not as confirmation the dimension does not matter."
    )
    print(
        "UNCALIBRATED: the weights above are spec 5.2's starting hypotheses. This "
        "is an input to correcting them (spec 9), not a verdict on its own."
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
