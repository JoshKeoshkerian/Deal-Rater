"""Install attribution: `POST /v1/attribution`, install_id on captures and
accounts, and the `funnel_by_source` view. See `app/attribution.py`."""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select, text

import app.api.attribution as attribution_api
from app.attribution import RateLimiter
from app.auth.service import request_sign_in
from app.billing import record_purchase
from app.billing.plans import plan_by_id
from app.config import Settings
from app.models import Capture, Install, User

from .conftest import DEFAULT_TEST_EMAIL, capture_payload, observation

MIGRATION = Path(__file__).parent.parent / "alembic" / "versions" / "0014_install_attribution.py"


def funnel_sql() -> str:
    spec = importlib.util.spec_from_file_location("m0014", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.FUNNEL_BY_SOURCE_SQL


@pytest.fixture
def settings() -> Settings:
    return Settings(
        resend_api_key="test-key",
        guest_checks_enabled=True,
        guest_max_per_ip_per_day=100,
        guest_max_per_day=500,
        guest_ip_salt="test-salt",
    )


@pytest.fixture(autouse=True)
def _fresh(monkeypatch, settings):
    monkeypatch.setattr("app.api.auth.get_settings", lambda: settings)
    monkeypatch.setattr(attribution_api, "_limiter", RateLimiter(limit=30, window=60))


def attribute(client, install_id: str, **utms):
    return client.post(
        "/v1/attribution",
        json={"install_id": install_id, **utms},
        headers={"Authorization": ""},
    )


def check(client, install_id, *, listing: str = "100000000000001", headers=None) -> int:
    body = capture_payload(target=observation(source_listing_id=listing))
    if install_id is not None:
        body["install_id"] = install_id
    response = client.post("/v1/captures", json=body, headers=headers or {})
    assert response.status_code == 201, response.text
    return response.json()["capture_id"]


def me(session) -> User:
    session.expire_all()
    return session.scalars(select(User).where(User.email == DEFAULT_TEST_EMAIL)).one()


# --- POST /v1/attribution -----------------------------------------------------


def test_an_install_is_recorded_with_its_utms(client, session):
    install_id = str(uuid.uuid4())
    response = attribute(
        client,
        install_id,
        utm_source="quora",
        utm_medium="cpc",
        utm_campaign="test2_offer",
        utm_content="web_offer",
        utm_term=None,
        landed_at="2026-11-16T10:00:00Z",
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"install_id": install_id, "created": True}

    row = session.get(Install, install_id)
    assert (row.utm_source, row.utm_campaign, row.utm_content, row.utm_term) == (
        "quora",
        "test2_offer",
        "web_offer",
        None,
    )
    assert row.landed_at is not None and row.installed_at is not None


def test_no_utms_is_recorded_as_organic(client, session):
    install_id = str(uuid.uuid4())
    assert attribute(client, install_id).status_code == 200
    row = session.get(Install, install_id)
    assert row.utm_source is None and row.utm_campaign is None and row.landed_at is None


def test_the_first_report_wins(client, session):
    install_id = str(uuid.uuid4())
    attribute(client, install_id, utm_campaign="first")
    again = attribute(client, install_id, utm_campaign="second")
    assert again.status_code == 200
    assert again.json()["created"] is False
    session.expire_all()
    assert session.get(Install, install_id).utm_campaign == "first"


def test_a_malformed_install_id_is_rejected(client, session):
    assert attribute(client, "not-a-uuid").status_code == 422
    assert session.scalars(select(Install)).all() == []


def test_long_values_are_truncated_not_rejected(client, session):
    install_id = str(uuid.uuid4())
    assert attribute(client, install_id, utm_campaign="x" * 1000).status_code == 200
    assert len(session.get(Install, install_id).utm_campaign) == 255


def test_attribution_is_rate_limited_per_address(client):
    for _ in range(30):
        assert attribute(client, str(uuid.uuid4())).status_code == 200
    assert attribute(client, str(uuid.uuid4())).status_code == 429


# --- install_id on checks and accounts -----------------------------------------


def test_a_check_carries_its_install_and_links_the_account(client, session):
    install_id = str(uuid.uuid4())
    capture_id = check(client, install_id)
    session.expire_all()
    assert session.get(Capture, capture_id).install_id == install_id
    assert me(session).install_id == install_id


def test_a_check_without_an_install_id_still_works(client, session):
    capture_id = check(client, None)
    assert session.get(Capture, capture_id).install_id is None
    assert me(session).install_id is None


def test_a_malformed_install_id_never_costs_a_check(client, session):
    capture_id = check(client, "garbage")
    assert session.get(Capture, capture_id).install_id is None


def test_an_account_keeps_its_first_install(client, session):
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    check(client, first, listing="100000000000001")
    check(client, second, listing="100000000000002")
    assert me(session).install_id == first


def test_sign_in_links_the_install(client, session, settings):
    install_id = str(uuid.uuid4())
    normalized, code = request_sign_in(session, settings, email="new@example.com")
    session.commit()
    response = client.post(
        "/v1/auth/verify",
        json={"email": normalized, "code": code, "client": "extension", "install_id": install_id},
        headers={"Authorization": ""},
    )
    assert response.status_code == 200, response.text
    session.expire_all()
    user = session.scalars(select(User).where(User.email == "new@example.com")).one()
    assert user.install_id == install_id


def test_a_guest_merging_into_an_account_brings_its_install(client, session, settings):
    install_id = str(uuid.uuid4())
    guest = client.post(
        "/v1/auth/guest", headers={"Authorization": "", "X-Forwarded-For": "203.0.113.9"}
    ).json()
    headers = {"Authorization": f"Bearer {guest['token']}"}
    check(client, install_id, headers=headers)

    # The default test user already exists, so this sign-in MERGES the guest.
    normalized, code = request_sign_in(session, settings, email=DEFAULT_TEST_EMAIL)
    session.commit()
    response = client.post(
        "/v1/auth/verify",
        json={"email": normalized, "code": code, "client": "extension"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert me(session).install_id == install_id


# --- funnel_by_source -----------------------------------------------------------


def test_funnel_by_source(client, session):
    session.execute(text(funnel_sql()))
    a, b, c, organic = (str(uuid.uuid4()) for _ in range(4))
    for install_id in (a, b, c):
        attribute(client, install_id, utm_campaign="test2_offer", utm_content="web_offer")
    attribute(client, organic)

    # a: 3 checks and a purchase. b: 1 check. c: none. organic: 1 check.
    for n in range(3):
        check(client, a, listing=f"10000000000000{n}")
    user = me(session)
    record_purchase(
        session,
        user_id=user.id,
        plan=plan_by_id("pack-10"),
        stripe_event_id="evt_1",
        amount_cents=900,
    )
    session.commit()

    other = client.post(
        "/v1/auth/guest", headers={"Authorization": "", "X-Forwarded-For": "203.0.113.10"}
    ).json()
    check(client, b, headers={"Authorization": f"Bearer {other['token']}"})
    other2 = client.post(
        "/v1/auth/guest", headers={"Authorization": "", "X-Forwarded-For": "203.0.113.11"}
    ).json()
    check(client, organic, headers={"Authorization": f"Bearer {other2['token']}"})

    rows = {
        (r.utm_campaign, r.utm_content): r._asdict()
        for r in session.execute(text("SELECT * FROM funnel_by_source"))
    }
    assert rows[("test2_offer", "web_offer")] == {
        "utm_campaign": "test2_offer",
        "utm_content": "web_offer",
        "installs": 3,
        "installs_with_1plus_evaluations": 2,
        "installs_with_3plus_evaluations": 1,
        "installs_with_purchase": 1,
    }
    assert rows[(None, None)]["installs"] == 1
    assert rows[(None, None)]["installs_with_1plus_evaluations"] == 1
    assert rows[(None, None)]["installs_with_purchase"] == 0
