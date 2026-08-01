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


def _saved_row(session: Session, user: User, capture_id: int) -> SavedEvaluation | None:
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

    Cheap on purpose: one indexed row, no evaluation, no capture load. The
    overlay calls this on every render, so it must not be able to become a
    reason the panel is slow.
    """
    row = _saved_row(session, user, capture_id)
    return SavedStateOut(
        capture_id=capture_id,
        saved=row is not None,
        saved_at=row.saved_at if row else None,
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
    """Save, idempotently.

    Saving something already saved returns the EXISTING row with 200 and does
    not recompute the snapshot. That is what makes it idempotent in the sense
    that matters: not merely "no duplicate row", but "the second call does not
    quietly replace the numbers the user saved with today's". Refreshing the
    figures is a re-evaluate, which is a different, deliberate action.
    """
    existing = _saved_row(session, user, capture_id)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _to_schema(existing)

    capture = _load_capture(session, capture_id)
    listing_id, listing_url = _target_listing(session, capture)
    snapshot = _snapshot(session, capture, offline=offline)
    now = datetime.now(UTC)

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
