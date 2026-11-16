"""When a check costs a credit, and when it doesn't.

Free: a retried request, re-checking a listing you already checked, a listing
that doesn't identify a vehicle, an unlimited plan. Refunded: a charged check
whose evaluation can't price the vehicle confidently (confidence low/none --
the overlay's "This vehicle cannot be priced confidently." state).
"""

from __future__ import annotations

from sqlalchemy import select

import app.api.evaluations as evaluations_api
from app.billing import FREE_EVALUATIONS, get_or_create_account
from app.models import BillingAccount, CreditLedger, User

from .conftest import DEFAULT_TEST_EMAIL, capture_payload, observation


def pin_confidence(monkeypatch, level: str) -> None:
    """Force the evaluation's pricing confidence, which is exactly what the
    refund rule keys on, without building a comp set that lands there."""
    real = evaluations_api.evaluation_to_schema

    def pinned(capture, evaluation):
        out = real(capture, evaluation)
        out.pricing.confidence = level
        return out

    monkeypatch.setattr(evaluations_api, "evaluation_to_schema", pinned)


def balance(session) -> int:
    session.expire_all()
    user = session.scalars(select(User).where(User.email == DEFAULT_TEST_EMAIL)).one()
    return session.get(BillingAccount, user.id).credit_balance


def check(client, *, listing: str = "100000000000001", **target_overrides) -> dict:
    target = observation(source_listing_id=listing, **target_overrides)
    response = client.post("/v1/captures", json=capture_payload(target=target))
    assert response.status_code == 201, response.text
    return response.json()


def evaluate(client, capture_id: int) -> dict:
    response = client.get(f"/v1/evaluations/{capture_id}?offline=true")
    assert response.status_code == 200, response.text
    return response.json()


# --- the same car twice -------------------------------------------------------


def test_checking_the_same_car_twice_costs_one_check(client, session, monkeypatch):
    pin_confidence(monkeypatch, "high")
    first = check(client)
    assert first["charged"] is True
    evaluate(client, first["capture_id"])

    second = check(client)
    assert second["charged"] is False
    assert second["free_reason"] == "repeat"
    assert balance(session) == FREE_EVALUATIONS - 1


def test_a_different_car_is_charged(client, session, monkeypatch):
    pin_confidence(monkeypatch, "high")
    check(client, listing="100000000000001")
    assert check(client, listing="100000000000002")["charged"] is True
    assert balance(session) == FREE_EVALUATIONS - 2


def test_a_repeat_works_even_with_no_checks_left(client, session, monkeypatch):
    pin_confidence(monkeypatch, "high")
    check(client)
    user = session.scalars(select(User).where(User.email == DEFAULT_TEST_EMAIL)).one()
    get_or_create_account(session, user.id).credit_balance = 0
    session.commit()

    assert check(client)["free_reason"] == "repeat"
    other = observation(source_listing_id="100000000000009")
    assert client.post("/v1/captures", json=capture_payload(target=other)).status_code == 402


def test_another_users_check_of_the_car_does_not_make_yours_free(client, session):
    from app.config import Settings

    from .test_saved import sign_in  # a second, distinct account

    other_headers = sign_in(session, Settings(), "someone-else@example.com")
    session.commit()
    payload = capture_payload(target=observation())
    assert client.post("/v1/captures", json=payload, headers=other_headers).status_code == 201

    assert check(client)["charged"] is True


# --- can't be priced confidently ------------------------------------------------


def test_an_unconfident_evaluation_refunds_the_check(client, session, monkeypatch):
    pin_confidence(monkeypatch, "low")
    capture = check(client)
    assert balance(session) == FREE_EVALUATIONS - 1

    body = evaluate(client, capture["capture_id"])
    assert body["check_refunded"] is True
    assert balance(session) == FREE_EVALUATIONS

    # Refetching (the extension retries) refunds nothing more, but still says so.
    assert evaluate(client, capture["capture_id"])["check_refunded"] is True
    assert balance(session) == FREE_EVALUATIONS
    rows = session.scalars(
        select(CreditLedger).where(CreditLedger.reason == "evaluation_refund")
    ).all()
    assert len(rows) == 1


def test_no_confidence_at_all_is_refunded_too(client, session, monkeypatch):
    pin_confidence(monkeypatch, "none")
    capture = check(client)
    assert evaluate(client, capture["capture_id"])["check_refunded"] is True
    assert balance(session) == FREE_EVALUATIONS


def test_a_confident_evaluation_keeps_the_charge(client, session, monkeypatch):
    for level in ("medium", "high"):
        pin_confidence(monkeypatch, level)
        capture = check(client, listing=f"10000000000{level == 'high':04d}")
        assert evaluate(client, capture["capture_id"])["check_refunded"] is False
    assert balance(session) == FREE_EVALUATIONS - 2


def test_a_free_check_is_never_refunded_into_a_profit(client, session, monkeypatch):
    pin_confidence(monkeypatch, "low")
    first = check(client)
    evaluate(client, first["capture_id"])  # refunded: back to full
    repeat = check(client)  # free, so nothing to refund
    assert evaluate(client, repeat["capture_id"])["check_refunded"] is False
    assert balance(session) == FREE_EVALUATIONS


# --- not a vehicle --------------------------------------------------------------


def test_a_listing_with_no_vehicle_identity_is_free(client, session):
    capture = check(client, make=None, model=None, year=None)
    assert capture["charged"] is False
    assert capture["free_reason"] == "not_vehicle"
    assert balance(session) == FREE_EVALUATIONS
