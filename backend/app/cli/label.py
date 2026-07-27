"""Hand-label stored listings to build the spec 9.1 ground truth set.

    python -m app.cli.label --labeler josh
    python -m app.cli.label --labeler josh --relabel
    python -m app.cli.label --labeler josh --capture 120
    python -m app.cli.label --status
    python -m app.cli.label --export labels.json

Spec 9.1: "Evaluate 50 to 100 listings by hand as an experienced buyer would
(good deal / fair / overpriced / avoid). Score with the engine and measure
agreement. Disagreements locate the wrong weights."

THIS TOOL DELIBERATELY SHOWS YOU NO MODEL OUTPUT.

It prints the listing and nothing else: no expected asking price, no rating, no
comp set. Seeing the model's answer before recording your own would anchor the
label to it, and an agreement score measured against anchored labels is
measuring nothing. That is the failure spec 9 exists to prevent, so the
separation is enforced here rather than left to discipline.

Run `python -m app.cli.agreement` afterwards to compare.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import session_scope
from ..models import GroundTruthLabel, Listing, ListingObservation

#: Spec 9.1's vocabulary, in order of increasing concern.
LABELS: dict[str, str] = {
    "g": "good_deal",
    "f": "fair",
    "o": "overpriced",
    "a": "avoid",
}

LABEL_HELP = """
  [g] good deal   priced clearly below what this vehicle is worth
  [f] fair        priced about right
  [o] overpriced  priced above what this vehicle is worth
  [a] avoid       do not buy at any price near this ask
  [s] skip        no opinion; leave unlabelled
  [q] quit        stop here, keeping what is already saved
"""


def _targets(session: Session) -> list[tuple[ListingObservation, Listing]]:
    """Target observations to label, one per distinct vehicle-and-price.

    Comps are excluded: a search-result card carries a title and a mileage and
    nothing else, which is too little for a person to judge honestly.

    Repeat captures of the same car are collapsed. Capturing one listing twice
    is legitimate and wanted -- append-only observations are what spec 4.4's
    time series is built from -- but a ground truth set is a set of JUDGEMENTS,
    and judging the same vehicle at the same price twice does not add evidence.
    It inflates the label count toward spec 9.1's target of 50 while adding
    nothing, and double-weights that car in the agreement figure.

    Keyed on price as well as vehicle, so the SAME car relisted at a NEW price
    is offered again. That is a genuinely different question for a buyer, and
    the earlier verdict does not answer it.
    """
    rows = session.execute(
        select(ListingObservation, Listing)
        .join(Listing, Listing.id == ListingObservation.listing_id)
        .where(ListingObservation.role == "target")
        .order_by(ListingObservation.observed_at)
    ).all()

    seen: set[tuple] = set()
    unique: list[tuple[ListingObservation, Listing]] = []
    for obs, listing in rows:
        key = (
            obs.year,
            (obs.make or "").lower(),
            (obs.model or "").lower(),
            obs.price_cents,
            obs.mileage,
        )
        # A row with no vehicle at all cannot be deduplicated meaningfully, so
        # it is kept rather than collapsed against other unidentified rows.
        if obs.make and obs.model:
            if key in seen:
                continue
            seen.add(key)
        unique.append((obs, listing))
    return unique


def _existing(session: Session, labeler: str) -> dict[int, GroundTruthLabel]:
    rows = session.scalars(
        select(GroundTruthLabel).where(GroundTruthLabel.labeler == labeler)
    ).all()
    return {r.observation_id: r for r in rows}


def _show(obs: ListingObservation, listing: Listing, index: int, total: int) -> None:
    print("\n" + "=" * 70)
    print(f"[{index}/{total}]  listing {listing.source_listing_id}")
    print("=" * 70)

    vehicle = " ".join(
        str(p) for p in [obs.year, obs.make, obs.model, obs.trim_text] if p
    )
    price = "no price stated" if not obs.price_cents else f"${obs.price_cents / 100:,.0f}"
    print(f"  {vehicle}")
    print(f"  Asking:    {price}")
    print(f"  Mileage:   {obs.mileage:,} mi" if obs.mileage else "  Mileage:   unknown")
    print(f"  Location:  {obs.location_text or 'unknown'}")
    if obs.title_status:
        print(f"  Title:     {obs.title_status}")
    if obs.photo_count is not None:
        print(f"  Photos:    {obs.photo_count}")
    if obs.posted_relative_text:
        print(f"  Posted:    {obs.posted_relative_text}")
    if obs.listing_url:
        print(f"  URL:       {obs.listing_url}")
    if obs.description:
        body = obs.description.strip()
        clipped = body[:900] + (" ..." if len(body) > 900 else "")
        print(f"\n  Description:\n    {clipped.replace(chr(10), chr(10) + '    ')}")
    print(LABEL_HELP)


def run_status(session: Session) -> int:
    targets = _targets(session)
    labels = session.scalars(select(GroundTruthLabel)).all()
    by_labeler: dict[str, int] = {}
    by_label: dict[str, int] = {}
    for label in labels:
        by_labeler[label.labeler] = by_labeler.get(label.labeler, 0) + 1
        by_label[label.label] = by_label.get(label.label, 0) + 1

    print(f"\nLabelable target listings: {len(targets)}")
    print(f"Labels recorded:           {len(labels)}")
    if by_labeler:
        print("\nBy labeller:")
        for name, count in sorted(by_labeler.items()):
            print(f"  {name:<20} {count}")
        print("\nBy verdict:")
        for name, count in sorted(by_label.items()):
            print(f"  {name:<20} {count}")

    print(
        f"\nSpec 9.1 asks for 50-100 hand-labelled listings. "
        f"{len(labels)} recorded, {max(0, 50 - len(labels))} short of the floor."
    )
    if len(targets) < 50:
        print(
            f"NOTE: only {len(targets)} target listings are stored, so the set "
            f"cannot reach 50 without capturing more."
        )
    return 0


def run_export(session: Session, path: str) -> int:
    rows = session.execute(
        select(GroundTruthLabel, ListingObservation, Listing)
        .join(ListingObservation, ListingObservation.id == GroundTruthLabel.observation_id)
        .join(Listing, Listing.id == ListingObservation.listing_id)
    ).all()
    payload = [
        {
            "observation_id": label.observation_id,
            "source_listing_id": listing.source_listing_id,
            "label": label.label,
            "labeler": label.labeler,
            "labeled_at": label.labeled_at.isoformat(),
            "note": label.note,
            "year": obs.year,
            "make": obs.make,
            "model": obs.model,
            "ask_cents": obs.price_cents,
            "mileage": obs.mileage,
        }
        for label, obs, listing in rows
    ]
    with open(path, "w") as fh:
        json.dump(payload, fh, indent=2)
    print(f"Wrote {len(payload)} labels to {path}")
    return 0


def run_labeling(
    session: Session, labeler: str, relabel: bool, capture_id: int | None = None
) -> int:
    targets = _targets(session)
    if not targets:
        print("No target listings stored. Capture some first.", file=sys.stderr)
        return 1

    if capture_id is not None:
        targets = [(obs, listing) for obs, listing in targets if obs.capture_id == capture_id]
        if not targets:
            print(f"No target observation for capture {capture_id}.", file=sys.stderr)
            return 1

    existing = _existing(session, labeler)
    queue = [
        (obs, listing)
        for obs, listing in targets
        if relabel or obs.id not in existing
    ]

    if not queue:
        print(
            f"All {len(targets)} target listings are already labelled by "
            f"'{labeler}'. Use --relabel to revise them."
        )
        return 0

    print(
        f"\nLabelling as '{labeler}'. {len(queue)} listing(s) to go.\n"
        f"Judge each as an experienced private-party buyer would. The model's "
        f"answer is\ndeliberately not shown -- seeing it first would anchor the "
        f"label and make the\nagreement measurement meaningless."
    )

    saved = 0
    for index, (obs, listing) in enumerate(queue, start=1):
        _show(obs, listing, index, len(queue))

        prior = existing.get(obs.id)
        if prior:
            print(f"  (currently labelled '{prior.label}')")

        choice = ""
        while choice not in {*LABELS, "s", "q"}:
            try:
                choice = input("  verdict > ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print("\nStopping. Labels already entered are saved.")
                return 0

        if choice == "q":
            break
        if choice == "s":
            continue

        try:
            note = input("  why (one line, optional) > ").strip() or None
        except (EOFError, KeyboardInterrupt):
            note = None

        if prior:
            prior.label = LABELS[choice]
            prior.note = note
            prior.labeled_at = datetime.now(UTC)
        else:
            session.add(
                GroundTruthLabel(
                    observation_id=obs.id,
                    label=LABELS[choice],
                    labeler=labeler,
                    labeled_at=datetime.now(UTC),
                    note=note,
                )
            )
        # Committed per label so an interrupted session keeps its work.
        session.commit()
        saved += 1

    print(f"\nSaved {saved} label(s). Run `python -m app.cli.agreement` to score.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Hand-label listings for the spec 9.1 ground truth set.",
    )
    parser.add_argument("--labeler", help="who is labelling; required to label")
    parser.add_argument("--relabel", action="store_true", help="revisit already-labelled rows")
    parser.add_argument("--status", action="store_true", help="show progress and exit")
    parser.add_argument("--export", metavar="PATH", help="write labels to JSON and exit")
    parser.add_argument(
        "--capture", type=int, metavar="ID", help="label only this capture's target listing"
    )
    args = parser.parse_args(argv)

    with session_scope() as session:
        if args.status:
            return run_status(session)
        if args.export:
            return run_export(session, args.export)
        if not args.labeler:
            parser.error("--labeler is required when labelling")
        return run_labeling(session, args.labeler, args.relabel, args.capture)


if __name__ == "__main__":
    raise SystemExit(main())
