"""Backfill the decomposed trim columns for observations already captured.

    python -m app.cli.backfill_vehicle_facts --dry-run
    python -m app.cli.backfill_vehicle_facts

WHY A BACKFILL IS POSSIBLE AT ALL
---------------------------------
`trim_level`, `body_style`, `engine_text` and `drivetrain` are derived from
`trim_text`, which every stored observation already has. `trim_source` is
recoverable too, from a different column: `raw_extract.title` retains the
verbatim listing title, and Marketplace's catalog separator survives in it --
"2016 Mazda CX-5 · Touring Sport Utility 4D". That is precisely the whitelist
`docs/schema.md` describes as existing "so a parser fix can be re-derived
against observations already collected instead of needing a fresh scrape of
listings that may be gone". This is that case, exactly.

WHAT IS DELIBERATELY NOT BACKFILLED
-----------------------------------
`seller_type` and `transmission` stay NULL on every pre-existing row.

They were never captured -- the extractor searched for payload keys that do not
exist (`vehicle_trim`, rather than `vehicle_trim_display_name`), so tier 1 never
fired and no value was ever stored or discarded. There is nothing to recover
from, and inferring a seller type from anything else available would manufacture
exactly the false authority spec 9 exists to prevent: a comp set reading
"dealers excluded" when no dealer check ever ran. `DealerSignal.UNAVAILABLE`
already carries that distinction, and these rows keep it.

IDEMPOTENT
----------
Re-running rewrites the same values. Rows are matched on `trim_text` being
present, not on the target columns being null, so a fix to `vehicle_facts`
can be re-applied over an earlier backfill without a reset step.
"""

from __future__ import annotations

from argparse import ArgumentParser
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_scope
from ..models import ListingObservation
from ..services.vehicle_facts import decompose

#: Rows per flush. The table is ~8k rows today; this keeps the transaction from
#: growing without bound if it is run against a much larger one later.
BATCH_SIZE = 1_000

#: Marketplace's catalog separator. Its presence in the stored title is what
#: distinguishes Facebook's own trim string from whatever a seller typed.
TRIM_SEPARATOR = "·"


def _trim_source(observation: ListingObservation) -> str | None:
    """Re-derive trim provenance from the stored raw title.

    Returns None when the trim cannot be attributed -- either no trim was
    captured, or no title was retained to attribute it against. None is the
    honest answer there; guessing `title_text` would overstate what is known
    about rows whose title was never stored.
    """
    if not observation.trim_text:
        return None

    raw = observation.raw_extract
    title = raw.get("title") if isinstance(raw, dict) else None
    if not isinstance(title, str) or not title:
        return None

    return "fb_catalog" if TRIM_SEPARATOR in title else "title_text"


def run(session: Session, dry_run: bool) -> int:
    observations = session.scalars(
        select(ListingObservation).order_by(ListingObservation.id)
    ).all()

    if not observations:
        print("No observations stored; nothing to backfill.")
        return 0

    sources: Counter[str] = Counter()
    body_styles: Counter[str] = Counter()
    decomposed = 0
    pending = 0

    for observation in observations:
        facts = decompose(observation.trim_text)
        source = _trim_source(observation)

        if not dry_run:
            observation.trim_level = facts.trim_level
            observation.body_style = facts.body_style
            observation.engine_text = facts.engine_text
            observation.drivetrain = facts.drivetrain
            observation.trim_source = source
            pending += 1
            if pending >= BATCH_SIZE:
                session.flush()
                pending = 0

        if facts.trim_level:
            decomposed += 1
        sources[source or "unattributed"] += 1
        if facts.body_style:
            body_styles[facts.body_style] += 1

    total = len(observations)
    print(f"\nObservations scanned: {total}")
    print(f"With a usable trim level: {decomposed} ({decomposed / total:.0%})")

    print(f"\n{'trim source':<20}{'n':>7}{'share':>8}")
    print("-" * 35)
    for source, count in sources.most_common():
        print(f"{source:<20}{count:>7}{count / total:>8.0%}")

    print(f"\n{'body style':<20}{'n':>7}")
    print("-" * 27)
    for style, count in body_styles.most_common(10):
        print(f"{style:<20}{count:>7}")

    print(
        "\nseller_type and transmission are NOT backfilled and remain NULL on "
        "every row above.\nThey were never captured, so there is nothing to "
        "re-derive them from -- see this module's\ndocstring. Comp sets built "
        "from these rows keep DealerSignal.UNAVAILABLE."
    )

    if dry_run:
        print("\nDRY RUN: nothing was written.")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be written without writing it",
    )
    args = parser.parse_args(argv)

    with session_scope() as session:
        return run(session, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
