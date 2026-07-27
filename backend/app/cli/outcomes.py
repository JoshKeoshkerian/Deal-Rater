"""Listing outcomes: spec 9.3's recheck-and-compare validation.

    python -m app.cli.outcomes --due
    python -m app.cli.outcomes

Spec 9.3: "Recheck scored listings at 7, 14, and 30 days. Fast disappearance at
asking price indicates attractive pricing; sitting and dropping indicates the
opposite. Imperfect but free, and it uses the same infrastructure as section
4.4."

HOW RECHECKING ACTUALLY HAPPENS HERE
-------------------------------------
Spec 8.1 is a hard constraint elsewhere in this project: no timers, no alarms,
no scheduled jobs, no background crawling, anywhere. Spec 11 defers background
monitoring outright because it "conflicts directly with 8.1." So this tool does
not fetch anything. Rechecking means a person reopens a listing they already
captured and clicks "Capture listing" again, exactly like any other capture.
That is `--due`'s job: it is a worklist, not a scraper, telling you which
already-captured listings are overdue for a look.

WHAT THIS CANNOT MEASURE
-------------------------
A listing that is sold or removed cannot be reopened, so it can never produce a
second observation -- there is no page left to click "Capture" on. That means
"no second observation" is ambiguous: it might mean the listing is gone, or it
might just mean nobody has revisited it yet. Only listings that WERE reopened
and are still live can be measured here, and only for price movement while
listed, not for disappearance. Reporting the ambiguous case as a signal would
be exactly spec 9's own failure mode: a number that looks like evidence and
isn't. So the report below counts what actually happened (price held / dropped
/ rose) and says nothing about the rest.
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_scope
from ..models import Listing, ListingObservation
from ..pricing import assess_listing
from ..pricing.loader import load_captures

#: Spec 9.3's checkpoints. Recheck cadence is a floor, not a schedule: a
#: listing becomes "due" once this many days have passed since it was last
#: looked at, whether that was the first capture or a previous recheck.
DUE_AFTER_DAYS = 7

#: Bands that read as "attractively priced" for spec 9.3's hypothesis test.
#: Mirrors `cli/agreement.py`'s collapse of the pricing curve's five bands.
ATTRACTIVE_BANDS = {"plateau", "declining", "implausible_discount"}


def _target_observations(session: Session) -> dict[int, list[ListingObservation]]:
    """All target-role observations, grouped by listing, oldest first."""
    rows = session.execute(
        select(ListingObservation)
        .join(Listing, Listing.id == ListingObservation.listing_id)
        .where(ListingObservation.role == "target")
        .order_by(ListingObservation.observed_at)
    ).scalars()

    by_listing: dict[int, list[ListingObservation]] = {}
    for obs in rows:
        by_listing.setdefault(obs.listing_id, []).append(obs)
    return by_listing


def _vehicle(obs: ListingObservation) -> str:
    return " ".join(str(p) for p in [obs.year, obs.make, obs.model, obs.trim_text] if p) or (
        "(vehicle unidentified)"
    )


def _price(cents: int | None) -> str:
    return "no price stated" if not cents else f"${cents / 100:,.0f}"


def run_due(session: Session) -> int:
    by_listing = _target_observations(session)
    now = datetime.now(UTC)

    due: list[tuple[int, ListingObservation, int]] = []
    for observations in by_listing.values():
        latest = observations[-1]
        observed_at = latest.observed_at
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=UTC)
        days_since = (now - observed_at).days
        if days_since >= DUE_AFTER_DAYS:
            due.append((days_since, latest, len(observations)))

    if not due:
        print(
            f"\nNothing is due yet. A listing becomes due for a recheck "
            f"{DUE_AFTER_DAYS}+ days after it was last observed."
        )
        return 0

    due.sort(key=lambda row: row[0], reverse=True)

    print(f"\n{len(due)} listing(s) due for a recheck (open the URL, click Capture again):\n")
    for days_since, obs, n_checks in due:
        checked = "first capture only" if n_checks == 1 else f"rechecked {n_checks - 1}x so far"
        print(f"  [{days_since:>3}d]  {_vehicle(obs)}  --  {_price(obs.price_cents)}  ({checked})")
        if obs.listing_url:
            print(f"          {obs.listing_url}")
    print()
    return 0


def run_report(session: Session) -> int:
    by_listing = _target_observations(session)
    rechecked = {lid: obs for lid, obs in by_listing.items() if len(obs) >= 2}

    print(f"\nTarget listings captured:     {len(by_listing)}")
    print(f"Rechecked at least once:      {len(rechecked)}")

    if not rechecked:
        print(
            "\nNo listing has a second observation yet, so there is nothing to "
            "compare. Run --due to see what's ready to be reopened."
        )
        return 0

    # Pricing verdict at the FIRST capture is what is being validated, so it is
    # read from that capture's own comp set, not today's.
    captures_by_obs_id = {c.target_observation_id: c for c in load_captures(session)}

    rows: list[dict] = []
    for observations in rechecked.values():
        first, latest = observations[0], observations[-1]
        capture = captures_by_obs_id.get(first.id)
        if capture is None:
            continue  # A capture with no evaluable target -- see loader.py.

        assessment = assess_listing(
            capture.target, capture.candidates, location_scoped=capture.location_scoped
        )
        band = assessment.rating.band if assessment.rating else None

        def _aware(dt: datetime) -> datetime:
            return dt if dt.tzinfo else dt.replace(tzinfo=UTC)

        days_elapsed = (_aware(latest.observed_at) - _aware(first.observed_at)).days

        if first.price_cents is None or latest.price_cents is None:
            direction = "unknown"
        elif latest.price_cents < first.price_cents:
            direction = "dropped"
        elif latest.price_cents > first.price_cents:
            direction = "rose"
        else:
            direction = "held"

        rows.append(
            {
                "vehicle": _vehicle(first),
                "band": band,
                "days_elapsed": days_elapsed,
                "first_price": first.price_cents,
                "latest_price": latest.price_cents,
                "direction": direction,
                "n_checks": len(observations) - 1,
            }
        )

    print(f"\n{'vehicle':<38}{'band':<20}{'days':>6}{'direction':>11}\n" + "-" * 75)
    for row in sorted(rows, key=lambda r: r["days_elapsed"], reverse=True):
        band = row["band"] or "unscored"
        print(f"{row['vehicle']:<38.38}{band:<20}{row['days_elapsed']:>6}{row['direction']:>11}")
        print(
            f"  {_price(row['first_price'])} -> {_price(row['latest_price'])}, "
            f"{row['n_checks']} recheck(s)"
        )

    # Spec 9.3's actual hypothesis: attractive pricing holds, overpriced sits
    # and drops. Only meaningful once there is more than a handful of rows --
    # printed either way, but read it as a trend to watch, not a verdict.
    scored = [r for r in rows if r["band"] and r["direction"] != "unknown"]
    if scored:
        print("\nPrice movement by initial pricing verdict:")
        groups = [
            ("attractive", ATTRACTIVE_BANDS),
            ("fair", {"fair"}),
            ("overpriced", {"overpriced"}),
        ]
        for label, bands in groups:
            group = [r for r in scored if r["band"] in bands]
            if not group:
                continue
            dropped = sum(1 for r in group if r["direction"] == "dropped")
            print(f"  {label:<12} {len(group):>3} listing(s), {dropped} dropped in price")

    print(
        "\nNOTE: a listing that disappears cannot be reobserved, so this report "
        "only\ncovers listings that were reopened and were still live. It says "
        "nothing about\nlistings that vanished -- sold, removed, or simply not "
        "revisited look identical\nfrom here."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--due",
        action="store_true",
        help="Show listings overdue for a manual recheck, instead of the outcomes report.",
    )
    args = parser.parse_args(argv)

    with session_scope() as session:
        return run_due(session) if args.due else run_report(session)


if __name__ == "__main__":
    sys.exit(main())
