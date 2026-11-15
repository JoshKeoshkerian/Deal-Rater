"""Guest checks: the first check without an email, and what signing in does.

Covers `POST /v1/auth/guest`, its rate limits, a guest running exactly one
check, the 402 that follows, what a guest is kept away from
(`require_account`), and the two sign-in paths: upgrade-in-place for a new
email, and merge-into-existing for an email that already has an account.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.auth.service import request_sign_in
from app.billing import FREE_EVALUATIONS, GUEST_FREE_EVALUATIONS
from app.config import Settings
from app.models import BillingAccount, Capture, SavedEvaluation, User

from .conftest import capture_payload


@pytest.fixture
def settings() -> Settings:
    return Settings(
        resend_api_key="test-key",
        guest_checks_enabled=True,
        guest_max_per_ip_per_day=3,
        guest_max_per_day=500,
        guest_ip_salt="test-salt",
    )


@pytest.fixture(autouse=True)
def _use_settings(monkeypatch, settings):
    monkeypatch.setattr("app.api.auth.get_settings", lambda: settings)


def new_guest(client, ip: str = "203.0.113.7") -> dict[str, str]:
    response = client.post(
        "/v1/auth/guest", headers={"Authorization": "", "X-Forwarded-For": ip}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["free_checks"] == GUEST_FREE_EVALUATIONS
    assert body["checks_on_sign_up"] == FREE_EVALUATIONS - GUEST_FREE_EVALUATIONS
    return {"Authorization": f"Bearer {body['token']}"}


def balance(session, user_id: int) -> int:
    session.expire_all()
    return session.get(BillingAccount, user_id).credit_balance


def guest_user(session) -> User:
    session.expire_all()
    return session.scalars(select(User).where(User.is_guest.is_(True))).all()[-1]


def sign_in_as(client, session, settings, email: str, headers: dict[str, str]) -> dict:
    normalized, code = request_sign_in(session, settings, email=email)
    session.commit()
    response = client.post(
        "/v1/auth/verify",
        json={"email": normalized, "code": code, "client": "extension"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- creating a guest -------------------------------------------------------


def test_a_guest_gets_one_check_and_no_email(client, session):
    new_guest(client)
    guest = guest_user(session)
    assert guest.email is None
    assert guest.guest_ip_hash is not None
    assert balance(session, guest.id) == GUEST_FREE_EVALUATIONS


def test_the_ip_is_stored_only_as_a_salted_hash(client, session):
    new_guest(client, ip="198.51.100.20")
    guest = guest_user(session)
    assert "198.51.100.20" not in guest.guest_ip_hash
    assert len(guest.guest_ip_hash) == 64


def test_guests_are_limited_per_network(client, settings):
    for _ in range(settings.guest_max_per_ip_per_day):
        new_guest(client, ip="198.51.100.1")
    refused = client.post(
        "/v1/auth/guest", headers={"Authorization": "", "X-Forwarded-For": "198.51.100.1"}
    )
    assert refused.status_code == 429
    # A different network is unaffected.
    new_guest(client, ip="198.51.100.2")


def test_the_proxy_appended_address_is_the_one_counted(client, settings):
    """A caller can prepend anything to X-Forwarded-For; only the last entry
    (added by the proxy) is trusted, so spoofed prefixes don't dodge the limit."""
    for n in range(settings.guest_max_per_ip_per_day):
        new_guest(client, ip=f"10.0.0.{n}, 198.51.100.9")
    refused = client.post(
        "/v1/auth/guest",
        headers={"Authorization": "", "X-Forwarded-For": "10.9.9.9, 198.51.100.9"},
    )
    assert refused.status_code == 429


def test_guests_are_limited_in_total_per_day(client, settings):
    settings.guest_max_per_day = 2
    new_guest(client, ip="192.0.2.1")
    new_guest(client, ip="192.0.2.2")
    refused = client.post(
        "/v1/auth/guest", headers={"Authorization": "", "X-Forwarded-For": "192.0.2.3"}
    )
    assert refused.status_code == 429


def test_the_kill_switch_refuses_guests(client, settings):
    settings.guest_checks_enabled = False
    assert client.post("/v1/auth/guest", headers={"Authorization": ""}).status_code == 503


# --- what a guest can and cannot do -----------------------------------------


def test_a_guest_runs_one_check_and_reads_it_then_hits_a_402(client, session):
    headers = new_guest(client)

    first = client.post("/v1/captures", json=capture_payload(), headers=headers)
    assert first.status_code == 201, first.text
    capture_id = first.json()["capture_id"]

    evaluation = client.get(f"/v1/evaluations/{capture_id}", headers=headers)
    assert evaluation.status_code == 200, evaluation.text

    second = client.post("/v1/captures", json=capture_payload(), headers=headers)
    assert second.status_code == 402
    assert "Sign in" in second.json()["detail"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/v1/evaluations/1/save"),
        ("post", "/v1/evaluations/1/save"),
        ("get", "/v1/users/me/saved"),
        ("get", "/v1/users/me"),
        ("get", "/v1/billing/me"),
        ("post", "/v1/auth/adopt"),
    ],
)
def test_a_guest_is_kept_away_from_account_features(client, method, path):
    headers = new_guest(client)
    response = getattr(client, method)(path, headers=headers)
    assert response.status_code == 401


# --- signing in: upgrade ----------------------------------------------------


def test_a_new_email_upgrades_the_guest_in_place(client, session, settings):
    headers = new_guest(client)
    capture_id = client.post("/v1/captures", json=capture_payload(), headers=headers).json()[
        "capture_id"
    ]
    guest_id = guest_user(session).id

    body = sign_in_as(client, session, settings, "new@example.com", headers)

    session.expire_all()
    user = session.get(User, guest_id)
    assert body["user"]["id"] == guest_id
    assert user.email == "new@example.com"
    assert user.is_guest is False
    assert user.guest_ip_hash is None
    # Used the 1 guest check, topped up by the remainder: 3 free in total.
    assert balance(session, guest_id) == FREE_EVALUATIONS - GUEST_FREE_EVALUATIONS

    # The check run as a guest is still readable with the new session.
    new_headers = {"Authorization": f"Bearer {body['token']}"}
    assert client.get(f"/v1/evaluations/{capture_id}", headers=new_headers).status_code == 200


def test_an_unused_guest_check_carries_over_on_upgrade(client, session, settings):
    headers = new_guest(client)
    guest_id = guest_user(session).id
    sign_in_as(client, session, settings, "fresh@example.com", headers)
    assert balance(session, guest_id) == FREE_EVALUATIONS


# --- signing in: merge ------------------------------------------------------


def test_an_existing_email_absorbs_the_guest(client, session, settings):
    # `client`'s default user is buyer@example.com, with its own free checks.
    existing = session.scalars(select(User).where(User.email == "buyer@example.com")).one()
    existing_balance = balance(session, existing.id)

    headers = new_guest(client)
    capture_id = client.post("/v1/captures", json=capture_payload(), headers=headers).json()[
        "capture_id"
    ]
    guest_id = guest_user(session).id

    body = sign_in_as(client, session, settings, "buyer@example.com", headers)

    session.expire_all()
    assert body["user"]["id"] == existing.id
    assert session.get(Capture, capture_id).user_id == existing.id
    assert session.get(User, guest_id).merged_into_user_id == existing.id
    # No free top-up for an account that already had its allowance.
    assert balance(session, existing.id) == existing_balance

    # The guest token is dead; the new one reads the moved check.
    assert client.get(f"/v1/evaluations/{capture_id}", headers=headers).status_code == 401
    new_headers = {"Authorization": f"Bearer {body['token']}"}
    assert client.get(f"/v1/evaluations/{capture_id}", headers=new_headers).status_code == 200


def test_merge_moves_saved_evaluations_and_drops_duplicates(client, session, settings):
    existing = session.scalars(select(User).where(User.email == "buyer@example.com")).one()
    headers = new_guest(client)
    guest_id = guest_user(session).id

    # Saving needs an account, so plant the guest's saved rows directly.
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    session.add_all(
        [
            SavedEvaluation(
                user_id=existing.id, source_capture_id=1, saved_at=now, evaluated_at=now,
                evaluation={},
            ),
            SavedEvaluation(
                user_id=guest_id, source_capture_id=1, saved_at=now, evaluated_at=now,
                evaluation={},
            ),
            SavedEvaluation(
                user_id=guest_id, source_capture_id=2, saved_at=now, evaluated_at=now,
                evaluation={},
            ),
        ]
    )
    session.commit()

    sign_in_as(client, session, settings, "buyer@example.com", headers)

    session.expire_all()
    rows = session.scalars(select(SavedEvaluation)).all()
    assert sorted((r.user_id, r.source_capture_id) for r in rows) == [
        (existing.id, 1),
        (existing.id, 2),
    ]


def test_signing_in_with_a_normal_session_never_touches_that_account(client, session, settings):
    """Only a GUEST token is upgraded or merged. A regular account's token on
    the verify call (signing in as someone else) leaves that account alone."""
    existing = session.scalars(select(User).where(User.email == "buyer@example.com")).one()
    body = sign_in_as(client, session, settings, "other@example.com", dict(client.headers))
    session.expire_all()
    assert body["user"]["id"] != existing.id
    assert session.get(User, existing.id).email == "buyer@example.com"
    assert session.get(User, existing.id).merged_into_user_id is None
