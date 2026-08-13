"""Saving an evaluation, and reading back what was saved.

    GET    /v1/evaluations/{capture_id}/save   is it saved? (button state)
    POST   /v1/evaluations/{capture_id}/save   save it
    DELETE /v1/evaluations/{capture_id}/save   unsave it
    GET    /v1/users/me/saved                  the list, newest first

All four require a session; 401 otherwise.

WHY SAVING COMPUTES AN EVALUATION AND STORES IT
-----------------------------------------------
There is no evaluations table in this system. `GET /v1/evaluations/{id}`
recomputes everything from a capture on each call and persists none of it, so
"save" cannot be a foreign key -- there is nothing to point at.

The POST therefore evaluates and stores the serialized result. Two things
follow, both intended:

  * The list endpoint reads stored JSON and calls nothing. Rendering a saved
    list never re-runs the regression, never touches NHTSA, and never bills an
    Anthropic call. Live re-scoring is out of scope by decision, and this is the
    structure that makes it out of scope rather than merely unimplemented.

  * A saved card is a record of what this tool said on a date. That is the
    honest artifact anyway -- spec 4.5 already insists asking prices are not
    transaction prices, and a figure that is now three weeks old deserves the
    same care. `evaluated_at` travels with it and the UI states it.

The evaluation is computed SERVER-SIDE rather than accepted from the client.
The overlay has the payload already and posting it back would save this work,
but it would also mean a user could save any JSON they liked into their own
list, which is a strange thing to have built on purpose.

WHAT A SAVE IS KEYED ON: THE LISTING, NOT THE CAPTURE
------------------------------------------------------
A capture is one click. Clicking Capture on the same car a week later produces a
second capture id for the same vehicle, and while these endpoints matched on
`source_capture_id` alone that meant:

  * the star came back EMPTY on a car the user had already saved, because the
    new capture id had never been saved, and
  * saving from there wrote a SECOND row, so the same car appeared twice on the
    website with different figures and no indication which was current.

Both are the same bug. Identity here belongs to the vehicle, which is what
`listings.id` already is (`source` + `source_listing_id`, upserted at ingest),
so all four routes now resolve a capture to its target listing first and match
on that.

`source_capture_id` is still on the row and is still what an unsave from an
older overlay sends, so it stays as the fallback match -- and it is the ONLY
match available once retention has nulled `listing_id` (spec 8.2), which is
exactly the case the plain column was kept for.

RE-EVALUATING A SAVED CAR REFRESHES ITS SNAPSHOT
------------------------------------------------
Saving the SAME capture twice is still inert: the second call returns the
existing row untouched, because a snapshot is a record of what this tool said on
a date and re-pressing the same button is not new information.

A save posted from a NEWER capture of an already-saved listing is different --
the user went back and ran the tool again, and the figures in front of them are
today's. That call rewrites the row in place: new snapshot, new `evaluated_at`,
new capture ids, and the original `saved_at` preserved, because when they first
took an interest in the car is a separate fact from when it was last checked.
Still one row, so the list still shows one card per vehicle.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import require_user
from app.db import get_session
from app.evaluation import evaluate_capture
from app.models import ListingObservation, SavedEvaluation, User
from app.pricing.loader import StoredCapture, load_captures
from app.schemas import SavedEvaluationOut, SavedListOut, SavedStateOut
from app.services.serialize import evaluation_to_schema

router = APIRouter(prefix="/v1", tags=["saved"])


def _listing_id_for(session: Session, capture_id: int) -> int | None:
    """The `listings.id` this capture was a click on.

    One indexed lookup (`ix_observations_capture`), no capture load and no
    evaluation, so the state endpoint below stays cheap enough to call on every
    overlay render. NULL only if the capture is gone or never had a target
    observation, in which case the caller falls back to the capture id.
    """
    return session.scalars(
        select(ListingObservation.listing_id).where(
            ListingObservation.capture_id == capture_id,
            ListingObservation.role == "target",
        )
    ).first()


def _saved_row(
    session: Session, user: User, capture_id: int, listing_id: int | None = None
) -> SavedEvaluation | None:
    """This user's saved row for the VEHICLE behind `capture_id`, if any.

    Listing first, capture id second. The fallback is not vestigial: a row whose
    `listing_id` retention has nulled can only be found by the capture it was
    saved from, and that row has to stay removable rather than being stranded in
    a list with no way to unsave it. See the module docstring.
    """
    if listing_id is None:
        listing_id = _listing_id_for(session, capture_id)

    if listing_id is not None:
        by_listing = session.scalars(
            select(SavedEvaluation).where(
                SavedEvaluation.user_id == user.id,
                SavedEvaluation.listing_id == listing_id,
            )
        ).first()
        if by_listing is not None:
            return by_listing

    return session.scalars(
        select(SavedEvaluation).where(
            SavedEvaluation.user_id == user.id,
            SavedEvaluation.source_capture_id == capture_id,
        )
    ).first()


def _load_capture(session: Session, capture_id: int) -> StoredCapture:
    captures = load_captures(session, [capture_id])
    if not captures:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No evaluable capture with id {capture_id}",
        )
    return captures[0]


def _target_listing(session: Session, capture: StoredCapture) -> tuple[int | None, str | None]:
    """The target's listing id and URL, for the FK and the card's link."""
    observation = session.get(ListingObservation, capture.target_observation_id)
    if observation is None:
        return None, None
    return observation.listing_id, observation.listing_url


def _snapshot(session: Session, capture: StoredCapture, *, offline: bool) -> dict:
    evaluation = evaluate_capture(session, capture, offline=offline)
    return evaluation_to_schema(capture, evaluation).model_dump(mode="json")


def _to_schema(row: SavedEvaluation) -> SavedEvaluationOut:
    return SavedEvaluationOut(
        id=row.id,
        capture_id=row.source_capture_id,
        saved_at=row.saved_at,
        evaluated_at=row.evaluated_at,
        vehicle=row.vehicle,
        listing_url=row.listing_url,
        # The FK is NULL exactly when retention has removed the capture behind
        # this snapshot. The snapshot itself is unaffected -- see the model.
        snapshot_only=row.capture_id is None,
        evaluation=row.evaluation,
    )


@router.get("/evaluations/{capture_id}/save", response_model=SavedStateOut)
def get_saved_state(
    capture_id: int,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> SavedStateOut:
    """The bookmark button's initial state.

    Cheap on purpose: two indexed rows, no evaluation, no capture load. The
    overlay calls this on every render, so it must not be able to become a
    reason the panel is slow.

    `stale` is the answer to a question the button could not previously ask:
    "this car is saved, but from an OLDER run than the one on screen." The
    overlay uses it to refresh the saved copy so the website shows the figures
    the user is actually looking at (`overlay/bookmark.ts`).

    Older, not merely different, and capture ids are what says so: they come off
    one identity sequence, so a larger one happened later. Without that
    comparison a panel still open on a previous capture -- a second tab, a page
    left overnight -- would report itself stale against the newer snapshot and
    refresh the row BACKWARDS to figures the user has already replaced.
    """
    row = _saved_row(session, user, capture_id)
    return SavedStateOut(
        capture_id=capture_id,
        saved=row is not None,
        saved_at=row.saved_at if row else None,
        saved_capture_id=row.source_capture_id if row else None,
        evaluated_at=row.evaluated_at if row else None,
        stale=row is not None and capture_id > row.source_capture_id,
    )


@router.post("/evaluations/{capture_id}/save", response_model=SavedEvaluationOut)
def save_evaluation(
    capture_id: int,
    response: Response,
    offline: bool = Query(
        False,
        description="Skip NHTSA network calls and use only cached data.",
    ),
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> SavedEvaluationOut:
    """Save, idempotently, keyed on the vehicle.

    Three outcomes, and the difference between the last two is the whole point:

      201  first save of this vehicle by this user.
      200  the SAME capture again. The existing row is returned untouched --
           idempotent in the sense that matters, not merely "no duplicate row"
           but "the second press does not quietly replace the numbers the user
           saved with today's".
      200  a NEWER capture of a vehicle already saved. The row is rewritten in
           place with the new snapshot. The user re-ran the tool on this car;
           the saved copy following the run they are looking at is what makes
           the website agree with the overlay instead of contradicting it.

    Still exactly one row per user per vehicle either way. See the module
    docstring for why the key is the listing rather than the capture.
    """
    listing_id_from_capture = _listing_id_for(session, capture_id)
    existing = _saved_row(session, user, capture_id, listing_id_from_capture)
    if existing is not None and existing.source_capture_id == capture_id:
        response.status_code = status.HTTP_200_OK
        return _to_schema(existing)

    capture = _load_capture(session, capture_id)
    listing_id, listing_url = _target_listing(session, capture)
    snapshot = _snapshot(session, capture, offline=offline)
    now = datetime.now(UTC)

    if existing is not None:
        existing.source_capture_id = capture_id
        existing.capture_id = capture_id
        # Only ever narrowed, never widened back to NULL: a re-save from a
        # capture whose observation has aged out should not throw away the
        # listing identity the row already had.
        existing.listing_id = listing_id if listing_id is not None else existing.listing_id
        existing.listing_url = listing_url or existing.listing_url
        existing.evaluated_at = now
        existing.evaluation = snapshot
        existing.vehicle = snapshot.get("vehicle")
        # `saved_at` deliberately untouched. When they first took an interest in
        # this car is a different fact from when it was last checked, and the
        # card states both.
        session.commit()

        response.status_code = status.HTTP_200_OK
        return _to_schema(existing)

    row = SavedEvaluation(
        user_id=user.id,
        source_capture_id=capture_id,
        capture_id=capture_id,
        listing_id=listing_id,
        saved_at=now,
        evaluated_at=now,
        evaluation=snapshot,
        vehicle=snapshot.get("vehicle"),
        listing_url=listing_url,
    )
    session.add(row)
    session.commit()

    response.status_code = status.HTTP_201_CREATED
    return _to_schema(row)


@router.delete("/evaluations/{capture_id}/save", status_code=status.HTTP_204_NO_CONTENT)
def unsave_evaluation(
    capture_id: int,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> None:
    """Unsave.

    204 whether or not a row was there. Unsaving something already unsaved is
    the state the caller asked for, and a 404 would make a double-click look
    like an error in a UI whose button has already flipped.

    Matched the same way the save was, so unsaving from a fresh capture of a car
    saved weeks ago removes the row the user is looking at rather than silently
    doing nothing.
    """
    row = _saved_row(session, user, capture_id)
    if row is not None:
        session.delete(row)
        session.commit()


@router.get("/users/me/saved", response_model=SavedListOut)
def list_saved(
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> SavedListOut:
    """Everything this user has saved, most recent first.

    Reads stored snapshots and nothing else: no capture load, no regression, no
    NHTSA call, no LLM call. See the module docstring.
    """
    rows = session.scalars(
        select(SavedEvaluation)
        .where(SavedEvaluation.user_id == user.id)
        .order_by(SavedEvaluation.saved_at.desc(), SavedEvaluation.id.desc())
    ).all()
    return SavedListOut(items=[_to_schema(row) for row in rows])
