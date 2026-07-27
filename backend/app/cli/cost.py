"""Cost per evaluation for the one LLM call (spec 10).

    python -m app.cli.cost
    python -m app.cli.cost --json

Spec 10: "Instrument cost per evaluation from day one. This number determines
whether the product can be free, freemium, or paid."

THE NUMBER THAT MATTERS IS NOT THE PRICE OF A CALL
---------------------------------------------------
It is total spend divided by evaluations SERVED. A cache hit costs nothing, and
spec 10's whole design ("every 2013 Focus at 90k miles gets the same answer")
is a bet that most evaluations are hits. Reporting cost per call would price the
misses and quietly ignore the reason the cache exists; the two figures diverge
by exactly the hit rate, which is printed alongside so the bet is checkable.

Read-only. Calls nothing external and writes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import func, select

from ..db import session_scope
from ..models import KnownIssuesEntry

RULE = "=" * 78


def _dollars(microdollars: float) -> str:
    return f"${microdollars / 1_000_000:,.6f}"


def collect() -> dict:
    with session_scope() as session:
        rows = session.scalars(select(KnownIssuesEntry)).all()

        calls = len(rows)
        served = sum(r.served_count or 0 for r in rows)
        spend = sum(r.cost_microdollars or 0 for r in rows)
        dropped = sum(r.currency_items_dropped or 0 for r in rows)

        by_model: dict[str, dict] = {}
        for r in rows:
            bucket = by_model.setdefault(
                r.llm_model, {"calls": 0, "served": 0, "microdollars": 0}
            )
            bucket["calls"] += 1
            bucket["served"] += r.served_count or 0
            bucket["microdollars"] += r.cost_microdollars or 0

        input_tokens = session.scalar(select(func.sum(KnownIssuesEntry.input_tokens))) or 0
        output_tokens = session.scalar(select(func.sum(KnownIssuesEntry.output_tokens))) or 0

    return {
        "cached_vehicles": calls,
        "model_calls": calls,
        "evaluations_served": served,
        # Hits are every serve beyond the one that generated the row.
        "cache_hits": max(served - calls, 0),
        "cache_hit_rate": (served - calls) / served if served else None,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_microdollars": spend,
        "microdollars_per_call": spend / calls if calls else None,
        "microdollars_per_evaluation": spend / served if served else None,
        "currency_items_dropped": dropped,
        "by_model": by_model,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Machine-readable output.")
    args = parser.parse_args(argv)

    stats = collect()

    if args.json:
        print(json.dumps(stats, indent=2))
        return 0

    print(RULE)
    print("SPEC 6.6 KNOWN-ISSUES CALL -- COST (spec 10)")
    print(RULE)

    if not stats["model_calls"]:
        print("\nNo calls yet. Either no evaluation has passed spec 10's gate, or")
        print("the feature is unconfigured (DEAL_RATER_ANTHROPIC_API_KEY).")
        return 0

    print(f"\n  Vehicles cached        {stats['cached_vehicles']:>10,}")
    print(f"  Model calls made       {stats['model_calls']:>10,}")
    print(f"  Evaluations served     {stats['evaluations_served']:>10,}")
    print(f"  Cache hits             {stats['cache_hits']:>10,}")
    rate = stats["cache_hit_rate"]
    print(f"  Cache hit rate         {'n/a' if rate is None else f'{rate:>9.1%}'}")

    print(f"\n  Input tokens           {stats['input_tokens']:>10,}")
    print(f"  Output tokens          {stats['output_tokens']:>10,}")
    print(f"  Total spend            {_dollars(stats['total_microdollars']):>10}")

    print(f"\n  Cost per model call    {_dollars(stats['microdollars_per_call']):>10}")
    # The one that answers spec 15's free / freemium / paid question.
    print(f"  COST PER EVALUATION    {_dollars(stats['microdollars_per_evaluation']):>10}")

    if stats["currency_items_dropped"]:
        print(
            f"\n  WARNING: {stats['currency_items_dropped']} bullet(s) were dropped for "
            "stating a money\n  figure, against an explicit instruction (spec 6.6). The guard "
            "held, but\n  the prompt is not holding on its own."
        )

    if len(stats["by_model"]) > 1:
        print("\n  By model (rates are per-model; see known_issues/params.py):")
        for name, bucket in sorted(stats["by_model"].items()):
            per_eval = bucket["microdollars"] / bucket["served"] if bucket["served"] else 0
            print(f"    {name:<24} {bucket['calls']:>6,} calls  {_dollars(per_eval)}/eval")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
