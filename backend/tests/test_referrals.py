"""Referrals: 2 free checks to the referrer when someone they referred installs
the extension and signs up with an email, at most 5 times.

"Installed" is evidenced by an extension sign-in (`client: "extension"`, or a
guest session upgrading -- guests only come from the extension). See
`app/referrals/service.py`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.auth.service import request_sign_in
from app.billing import (
    FREE_EVALUATIONS,
    REFERRAL_MAX_REWARDS,
    REFERRAL_REWARD_EVALUATIONS,
)
from app.config import Settings
from app.models import BillingAccount, CreditLedger, User
from app.referrals import normalize_referral_code

from .conftest import DEFAULT_TEST_EMAIL


@pytest.fixture
def settings() -> Settings:
    return Settings(
        resend_api_key="test-key",
        guest_checks_enabled=True,
        guest_max_per_ip_per_day=100,
        guest_max_per_day=500,
        guest_ip_salt="test-salt",
        app_base_url="https://curbsidescore.com",
    )


@pytest.fixture(autouse=True)
def _use_settings(monkeypatch, settings):
    monkeypatch.setattr("app.api.auth.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.referrals.get_settings", lambda: settings)


def my_referrals(client) -> dict:
    response = client.get("/v1/referrals/me")
    assert response.status_code == 200, response.text
    return response.json()


def balance_of(session, email: str) -> int:
    session.expire_all()
    user = session.scalars(select(User).where(User.email == email)).one()
    return session.get(BillingAccount, user.id).credit_balance


def verify(
    client,
    session,
    settings,
    email: str,
    *,
    client_kind: str = "extension",
    code: str | None = None,
    cookie: str | None = None,
    guest_token: str | None = None,
):
    normalized, otp = request_sign_in(session, settings, email=email)
    session.commit()
    body = {"email": normalized, "code": otp, "client": client_kind}
    if code is not None:
        body["referral_code"] = code
    headers = {"Authorization": f"Bearer {guest_token}" if guest_token else ""}
    if cookie is not None:
        client.cookies.set(settings.referral_cookie_name, cookie)
    try:
        response = client.post("/v1/auth/verify", json=body, headers=headers)
    finally:
        client.cookies.clear()
    assert response.status_code == 200, response.text
    return response.json()


# --- the share link ---------------------------------------------------------


def test_the_link_is_stable_and_starts_at_zero(client):
    first = my_referrals(client)
    assert first["url"] == f"https://curbsidescore.com/?ref={first['code']}"
    assert normalize_referral_code(first["code"]) == first["code"]
    assert first["rewarded"] == 0
    assert first["checks_earned"] == 0
    assert first["pending"] == 0
    assert first["max_rewards"] == REFERRAL_MAX_REWARDS
    assert first["checks_per_referral"] == REFERRAL_REWARD_EVALUATIONS
    assert my_referrals(client)["code"] == first["code"]


def test_a_guest_has_no_referral_link(client):
    token = client.post("/v1/auth/guest", headers={"Authorization": ""}).json()["token"]
    response = client.get("/v1/referrals/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_codes_are_normalized_and_junk_is_rejected():
    assert normalize_referral_code("  abcd2345 ") == "ABCD2345"
    assert normalize_referral_code("ABCD234") is None  # too short
    assert normalize_referral_code("ABCD234O") is None  # O is not in the alphabet
    assert normalize_referral_code("") is None
    assert normalize_referral_code(None) is None


# --- the reward ---------------------------------------------------------------


def test_extension_sign_up_with_a_code_pays_the_referrer(client, session, settings):
    code = my_referrals(client)["code"]
    before = balance_of(session, DEFAULT_TEST_EMAIL)

    verify(client, session, settings, "friend@example.com", code=code)

    assert balance_of(session, DEFAULT_TEST_EMAIL) == before + REFERRAL_REWARD_EVALUATIONS
    # The friend gets the ordinary sign-up allowance, nothing more.
    assert balance_of(session, "friend@example.com") == FREE_EVALUATIONS
    stats = my_referrals(client)
    assert stats["rewarded"] == 1
    assert stats["checks_earned"] == REFERRAL_REWARD_EVALUATIONS
    assert stats["pending"] == 0


def test_the_code_can_arrive_as_the_website_cookie(client, session, settings):
    code = my_referrals(client)["code"]
    before = balance_of(session, DEFAULT_TEST_EMAIL)
    verify(client, session, settings, "friend@example.com", cookie=code.lower())
    assert balance_of(session, DEFAULT_TEST_EMAIL) == before + REFERRAL_REWARD_EVALUATIONS


def test_a_guest_upgrading_counts_as_installed_and_signed_up(client, session, settings):
    code = my_referrals(client)["code"]
    before = balance_of(session, DEFAULT_TEST_EMAIL)
    guest_token = client.post("/v1/auth/guest", headers={"Authorization": ""}).json()["token"]

    verify(client, session, settings, "friend@example.com", cookie=code, guest_token=guest_token)

    assert balance_of(session, DEFAULT_TEST_EMAIL) == before + REFERRAL_REWARD_EVALUATIONS


def test_web_sign_up_waits_for_the_extension(client, session, settings):
    """Signing up on the website is only half of it; the referrer is paid when
    the friend later signs in through the extension, and only once."""
    code = my_referrals(client)["code"]
    before = balance_of(session, DEFAULT_TEST_EMAIL)

    verify(client, session, settings, "friend@example.com", client_kind="web", code=code)
    assert balance_of(session, DEFAULT_TEST_EMAIL) == before
    assert my_referrals(client)["pending"] == 1

    verify(client, session, settings, "friend@example.com")  # installs, signs in there
    assert balance_of(session, DEFAULT_TEST_EMAIL) == before + REFERRAL_REWARD_EVALUATIONS

    verify(client, session, settings, "friend@example.com")  # again: no second payment
    assert balance_of(session, DEFAULT_TEST_EMAIL) == before + REFERRAL_REWARD_EVALUATIONS
    assert my_referrals(client)["pending"] == 0


def test_an_existing_account_cannot_be_referred(client, session, settings):
    code = my_referrals(client)["code"]
    verify(client, session, settings, "old@example.com")  # already has an account
    before = balance_of(session, DEFAULT_TEST_EMAIL)

    verify(client, session, settings, "old@example.com", code=code)

    assert balance_of(session, DEFAULT_TEST_EMAIL) == before
    session.expire_all()
    old = session.scalars(select(User).where(User.email == "old@example.com")).one()
    assert old.referred_by_user_id is None


def test_a_guest_merging_into_an_existing_account_is_not_a_referral(client, session, settings):
    code = my_referrals(client)["code"]
    verify(client, session, settings, "old@example.com")
    before = balance_of(session, DEFAULT_TEST_EMAIL)
    guest_token = client.post("/v1/auth/guest", headers={"Authorization": ""}).json()["token"]

    verify(client, session, settings, "old@example.com", code=code, guest_token=guest_token)

    assert balance_of(session, DEFAULT_TEST_EMAIL) == before


def test_unknown_codes_are_ignored(client, session, settings):
    before = balance_of(session, DEFAULT_TEST_EMAIL)
    verify(client, session, settings, "friend@example.com", code="ZZZZZZZZ")
    verify(client, session, settings, "friend2@example.com", cookie="not a code")
    assert balance_of(session, DEFAULT_TEST_EMAIL) == before
    assert balance_of(session, "friend@example.com") == FREE_EVALUATIONS


def test_rewards_stop_at_the_cap(client, session, settings):
    code = my_referrals(client)["code"]
    before = balance_of(session, DEFAULT_TEST_EMAIL)

    for n in range(REFERRAL_MAX_REWARDS + 2):
        verify(client, session, settings, f"friend{n}@example.com", code=code)

    assert balance_of(session, DEFAULT_TEST_EMAIL) == (
        before + REFERRAL_MAX_REWARDS * REFERRAL_REWARD_EVALUATIONS
    )
    session.expire_all()
    rows = session.scalars(
        select(CreditLedger).where(CreditLedger.reason == "referral_reward")
    ).all()
    assert len(rows) == REFERRAL_MAX_REWARDS
    stats = my_referrals(client)
    assert stats["rewarded"] == REFERRAL_MAX_REWARDS
    assert stats["checks_earned"] == REFERRAL_MAX_REWARDS * REFERRAL_REWARD_EVALUATIONS
    # Past the cap nobody is "pending": they will never pay out.
    assert stats["pending"] == 0


def test_referral_credits_do_not_show_as_purchases(client, session, settings):
    code = my_referrals(client)["code"]
    verify(client, session, settings, "friend@example.com", code=code)
    billing = client.get("/v1/billing/me").json()
    assert billing["purchases"] == []
    assert billing["evaluations_remaining"] == FREE_EVALUATIONS + REFERRAL_REWARD_EVALUATIONS
