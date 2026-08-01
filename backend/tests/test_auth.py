"""Sign-in: the code exchange, and what it refuses.

The mailer is patched out throughout. These tests are about the state machine
in `auth/service.py`, not about Resend, and a suite that needs an API key to run
is a suite that stops being run.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.service import AuthError, request_sign_in, resolve_session, verify_code
from app.auth.tokens import canonicalize_code, format_code, hash_secret, normalize_email
from app.config import Settings
from app.db import get_session
from app.main import app
from app.models import AuthSession, MagicLinkToken, User


@pytest.fixture
def settings() -> Settings:
    return Settings(
        resend_api_key="test-key",
        magic_link_ttl_minutes=15,
        magic_link_max_attempts=5,
        session_ttl_days=90,
    )


def _challenge(session, email: str) -> MagicLinkToken:
    return session.scalars(
        select(MagicLinkToken).where(MagicLinkToken.email == email)
    ).all()[-1]


def test_code_is_never_stored_in_the_clear(session, settings):
    email, code = request_sign_in(session, settings, email="Buyer@Example.COM")

    assert email == "buyer@example.com"
    row = _challenge(session, email)
    assert row.code_hash != code
    assert row.code_hash == hash_secret(code)


def test_requesting_a_code_creates_no_account(session, settings):
    """Anyone can post any address here, so an account at this point would let
    a stranger fill the users table with addresses that never consented."""
    request_sign_in(session, settings, email="stranger@example.com")

    assert session.scalars(select(User)).all() == []


def test_verify_creates_the_account_and_a_session(session, settings):
    email, code = request_sign_in(session, settings, email="buyer@example.com")

    issued = verify_code(session, settings, email=email, code=code)

    assert issued.user.email == email
    assert resolve_session(session, issued.token) is not None
    assert issued.expires_at > datetime.now(UTC) + timedelta(days=89)


def test_second_sign_in_reuses_the_account(session, settings):
    email, code = request_sign_in(session, settings, email="buyer@example.com")
    first = verify_code(session, settings, email=email, code=code)

    _, code2 = request_sign_in(session, settings, email=email)
    second = verify_code(session, settings, email=email, code=code2)

    assert first.user.id == second.user.id
    assert first.token != second.token
    assert len(session.scalars(select(User)).all()) == 1


def test_a_code_works_once(session, settings):
    email, code = request_sign_in(session, settings, email="buyer@example.com")
    verify_code(session, settings, email=email, code=code)

    with pytest.raises(Exception, match="expired or was already used"):
        verify_code(session, settings, email=email, code=code)


def test_requesting_again_kills_the_previous_code(session, settings):
    """Two live codes in one inbox is a trap: people type the older one.

    The superseded code is refused as WRONG rather than as EXPIRED, because
    `verify_code` reads only the newest unconsumed challenge and the old code
    simply does not match it. Both are refusals and the distinction is not worth
    surfacing to a user -- but it does mean typing a stale code burns an attempt
    against the live one, which is why this asserts the refusal rather than its
    wording.
    """
    email, first = request_sign_in(session, settings, email="buyer@example.com")
    _, second = request_sign_in(session, settings, email=email)

    with pytest.raises(AuthError):
        verify_code(session, settings, email=email, code=first)

    assert verify_code(session, settings, email=email, code=second).user.email == email


def test_expired_code_is_refused(session, settings):
    email, code = request_sign_in(session, settings, email="buyer@example.com")
    _challenge(session, email).expires_at = datetime.now(UTC) - timedelta(seconds=1)

    with pytest.raises(Exception, match="expired"):
        verify_code(session, settings, email=email, code=code)


def test_wrong_code_counts_against_the_attempt_cap(session, settings):
    email, code = request_sign_in(session, settings, email="buyer@example.com")

    for _ in range(settings.magic_link_max_attempts):
        with pytest.raises(Exception, match="not right"):
            verify_code(session, settings, email=email, code="WRONGCOD")

    # The cap holds even once the correct code is presented: a challenge that
    # has been guessed at five times is a challenge under attack.
    with pytest.raises(Exception, match="Too many attempts"):
        verify_code(session, settings, email=email, code=code)


def test_a_code_is_bound_to_its_address(session, settings):
    _, code = request_sign_in(session, settings, email="buyer@example.com")
    request_sign_in(session, settings, email="other@example.com")

    with pytest.raises(Exception, match="not right"):
        verify_code(session, settings, email="other@example.com", code=code)


def test_hyphens_and_case_are_not_a_wrong_code(session, settings):
    """The email shows `ABCD-2345`; people paste exactly that."""
    email, code = request_sign_in(session, settings, email="buyer@example.com")

    issued = verify_code(session, settings, email=email, code=f" {format_code(code).lower()} ")

    assert issued.user.email == email


def test_revoked_and_expired_sessions_stop_resolving(session, settings):
    email, code = request_sign_in(session, settings, email="buyer@example.com")
    issued = verify_code(session, settings, email=email, code=code)
    row = session.scalars(select(AuthSession)).one()

    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert resolve_session(session, issued.token) is None

    row.expires_at = datetime.now(UTC) + timedelta(days=1)
    row.revoked_at = datetime.now(UTC)
    assert resolve_session(session, issued.token) is None


def test_unknown_token_resolves_to_nobody(session):
    assert resolve_session(session, "not-a-real-token") is None
    assert resolve_session(session, "") is None


def test_email_normalisation_does_not_fold_plus_addresses(session):
    """`me+cars@` is a distinct account, not a Gmail alias to be merged."""
    assert normalize_email(" Me+Cars@Example.com ") == "me+cars@example.com"


def test_code_canonicalisation():
    assert canonicalize_code("abcd-2345") == "ABCD2345"
    assert canonicalize_code(" A B C D 2 3 4 5 ") == "ABCD2345"


# --- the two transports ------------------------------------------------------
#
# These go through the API, because what is under test is the difference
# between the two clients -- which is a property of the endpoint, not of the
# state machine above.


def _verify_via_api(client, session, settings, *, client_kind: str, email: str):
    normalized, code = request_sign_in(session, settings, email=email)
    session.commit()
    return client.post(
        "/v1/auth/verify",
        json={"email": normalized, "code": code, "client": client_kind},
    )


def test_the_website_gets_a_cookie_and_not_a_token(client, session, settings, monkeypatch):
    monkeypatch.setattr("app.api.auth.get_settings", lambda: settings)

    response = _verify_via_api(
        client, session, settings, client_kind="web", email="web@example.com"
    )

    assert response.status_code == 200
    # Page JavaScript that can read a session token is one XSS away from
    # handing it over, and the website does not need it.
    assert response.json()["token"] is None

    cookie = response.headers["set-cookie"]
    assert settings.session_cookie_name in cookie
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=lax" in cookie.lower().replace("samesite=lax", "SameSite=lax")
    # The leading dot is what lets app. read what api. set.
    assert f"Domain={settings.session_cookie_domain}" in cookie


def test_the_extension_gets_a_token_and_no_cookie(client, session, settings, monkeypatch):
    monkeypatch.setattr("app.api.auth.get_settings", lambda: settings)

    response = _verify_via_api(
        client, session, settings, client_kind="extension", email="ext@example.com"
    )

    assert response.status_code == 200
    assert response.json()["token"]
    assert "set-cookie" not in response.headers


@pytest.fixture
def web_client(session, monkeypatch):
    """A client that can actually hold the session cookie.

    Two deviations from production, both forced by the harness rather than
    chosen. The cookie is HOST-ONLY, because `TestClient` runs on `testserver`
    and a cookie scoped to `.curbsidescore.com` is correctly not sent to a
    different host. And the base URL is https, because the cookie is `Secure`
    and would correctly not be sent over http.

    The production attributes -- the leading-dot Domain in particular -- are
    asserted directly off the `Set-Cookie` header in the tests above, which is
    where they can be checked honestly.
    """
    local = Settings(resend_api_key="test-key", session_cookie_domain="")
    monkeypatch.setattr("app.api.auth.get_settings", lambda: local)

    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app, base_url="https://testserver") as c:
        yield c, local
    app.dependency_overrides.clear()


def test_the_cookie_authenticates_the_same_as_a_bearer_token(web_client, session):
    """One session, two transports, one `resolve_session`. If these ever
    diverge, the duplicated auth logic this design exists to prevent is back."""
    client, local = web_client
    _verify_via_api(client, session, local, client_kind="web", email="web@example.com")

    # The cookie jar carries it; there is no Authorization header on this call.
    me = client.get("/v1/users/me")

    assert me.status_code == 200
    assert me.json()["email"] == "web@example.com"


def test_signing_out_clears_the_cookie_and_kills_the_session(web_client, session):
    client, local = web_client
    _verify_via_api(client, session, local, client_kind="web", email="web@example.com")
    assert client.get("/v1/users/me").status_code == 200

    out = client.post("/v1/auth/sign-out")

    assert out.status_code == 204
    assert client.get("/v1/users/me").status_code == 401


def test_sign_out_deletes_the_cookie_with_the_domain_it_was_set_with(
    client, session, settings, monkeypatch
):
    """A delete_cookie whose attributes do not match writes a SECOND cookie and
    leaves the original in place, which reads as a sign-out that did not work."""
    monkeypatch.setattr("app.api.auth.get_settings", lambda: settings)

    out = client.post("/v1/auth/sign-out")

    assert f"Domain={settings.session_cookie_domain}" in out.headers["set-cookie"]


def test_a_host_only_cookie_is_still_issued_when_no_domain_is_configured(
    client, session, monkeypatch
):
    """Local development: empty domain is legal and yields a host-only cookie,
    rather than an error or a silently absent one."""
    local = Settings(resend_api_key="test-key", session_cookie_domain="")
    monkeypatch.setattr("app.api.auth.get_settings", lambda: local)

    response = _verify_via_api(
        client, session, local, client_kind="web", email="local@example.com"
    )

    cookie = response.headers["set-cookie"]
    assert local.session_cookie_name in cookie
    assert "Domain=" not in cookie
