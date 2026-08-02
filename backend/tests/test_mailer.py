"""The Resend call itself.

`urlopen` is stubbed, so nothing here reaches the network and no API key is
needed. What is under test is the request this module BUILDS and how it maps
the provider's failures -- both of which are invisible until a real user cannot
sign in, which is exactly the wrong moment to find out.
"""

from __future__ import annotations

import io
import json
import logging
import urllib.error
import urllib.request

import pytest

from app.auth.mailer import MailerError, send_sign_in_email
from app.config import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        resend_api_key="re_test_key",
        auth_from_email="Curbside <login@curbsidescore.com>",
        app_base_url="https://app.curbsidescore.com",
        magic_link_ttl_minutes=15,
    )


class _Response:
    """Minimal stand-in for what `urlopen` yields: a context manager with a
    status."""

    def __init__(self, status: int = 200) -> None:
        self.status = status

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_: object) -> None:
        return None


@pytest.fixture
def sent(monkeypatch) -> list[urllib.request.Request]:
    """Capture the request instead of sending it."""
    captured: list[urllib.request.Request] = []

    def fake_urlopen(request, **_kwargs):
        captured.append(request)
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return captured


def _payload(request: urllib.request.Request) -> dict:
    return json.loads(request.data.decode("utf-8"))


# --- the request that gets built ---------------------------------------------


def test_posts_to_resend_with_the_api_key(settings, sent):
    send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    request = sent[0]
    assert request.full_url == "https://api.resend.com/emails"
    assert request.get_method() == "POST"
    assert request.get_header("Authorization") == "Bearer re_test_key"


def test_the_request_does_not_use_urllibs_default_user_agent(settings, sent):
    """Resend's API sits behind Cloudflare, and `urllib`'s default User-Agent
    ("Python-urllib/3.x") is a known bot fingerprint that Cloudflare blocks --
    a 403 that looks identical to an unverified-domain rejection until the
    body is read. Confirmed live: the same payload gets a Cloudflare 403 with
    the default header and a 200 with this one. See the comment in mailer.py.
    """
    send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    user_agent = sent[0].get_header("User-agent")
    assert user_agent is not None
    assert "python-urllib" not in user_agent.lower()


def test_the_email_goes_to_the_address_from_the_configured_sender(settings, sent):
    send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    body = _payload(sent[0])
    assert body["to"] == ["buyer@example.com"]
    # Must be on a domain verified in Resend, or every send is rejected. The
    # default in config.py is deliberately invalid so that fails loudly.
    assert body["from"] == "Curbside <login@curbsidescore.com>"


def test_the_code_appears_in_the_subject_and_both_bodies(settings, sent):
    """A code that reached the provider but not the message is a sign-in that
    silently cannot be completed."""
    send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    body = _payload(sent[0])
    # Hyphenated for reading; `canonicalize_code` strips it on the way back in.
    assert "ABCD-2345" in body["subject"]
    assert "ABCD-2345" in body["text"]
    assert "ABCD-2345" in body["html"]


def test_the_link_points_at_the_website_and_carries_the_code(settings, sent):
    """The website's half of the flow: `/saved?email=&code=` auto-verifies."""
    send_sign_in_email(settings, to="buyer+cars@example.com", code="ABCD2345")

    body = _payload(sent[0])
    assert "https://app.curbsidescore.com/saved?" in body["text"]
    # The `+` in an address is a space once it is in a query string; leaving it
    # unencoded would sign the user in as a different address, or not at all.
    assert "email=buyer%2Bcars%40example.com" in body["text"]
    assert "code=ABCD2345" in body["text"]


def test_the_expiry_is_stated_in_the_message(settings, sent):
    send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    assert "15 minutes" in _payload(sent[0])["text"]


def test_it_says_no_account_is_created_by_a_stray_request(settings, sent):
    """True, and worth saying: anyone can put any address into that endpoint,
    so the recipient may not have asked for this."""
    send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    assert "no account is created" in _payload(sent[0])["text"].lower()


# --- failure mapping ----------------------------------------------------------


def test_no_api_key_is_a_mailer_error_not_a_silent_no_op(sent):
    unconfigured = Settings(resend_api_key=None)

    with pytest.raises(MailerError, match="no email provider configured"):
        send_sign_in_email(unconfigured, to="buyer@example.com", code="ABCD2345")

    assert sent == []


def test_a_rejection_becomes_a_mailer_error(settings, monkeypatch):
    def fake_urlopen(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://api.resend.com/emails",
            422,
            "Unprocessable Entity",
            {},
            io.BytesIO(b'{"message":"The from address is not verified."}'),
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(MailerError, match="422"):
        send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")


def test_an_unreachable_provider_becomes_a_mailer_error(settings, monkeypatch):
    def fake_urlopen(*_args, **_kwargs):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(MailerError, match="could not reach"):
        send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")


def test_a_non_2xx_status_becomes_a_mailer_error(settings, monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_k: _Response(status=500))

    with pytest.raises(MailerError, match="500"):
        send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")


def test_a_rejection_logs_the_sender_and_where_to_check_it(settings, monkeypatch, caplog):
    """A bare status code is not a diagnosis. The log names the configured
    sender and includes Resend's own message text (here, an unverified-domain
    rejection), so the two 403 causes below are distinguishable from the log
    line alone -- the sender is configuration, not personal data."""

    def fake_urlopen(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://api.resend.com/emails",
            403,
            "Forbidden",
            {},
            io.BytesIO(b'{"message":"The domain is not verified."}'),
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with caplog.at_level(logging.ERROR), pytest.raises(MailerError):
        send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    logged = caplog.text
    assert "login@curbsidescore.com" in logged
    assert "DEAL_RATER_AUTH_FROM_EMAIL" in logged
    assert "not verified" in logged


def test_a_cloudflare_block_is_named_as_such_and_not_blamed_on_the_domain(
    settings, monkeypatch, caplog
):
    """The 403 that actually hit production: Resend's API sits behind
    Cloudflare, and `urllib`'s default User-Agent got the request blocked
    there -- before it ever reached Resend's own validation. The body reads
    "error code: 1010" (Cloudflare's own block signature), not anything
    naming a domain, and every minute spent checking `DEAL_RATER_AUTH_FROM_EMAIL`
    against that message was a minute spent on the wrong layer. The log must
    point at the User-Agent header instead of repeating generic sender advice
    that this specific body contradicts.
    """

    def fake_urlopen(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://api.resend.com/emails",
            403,
            "Forbidden",
            {},
            io.BytesIO(b"error code: 1010"),
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with caplog.at_level(logging.ERROR), pytest.raises(MailerError):
        send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    logged = caplog.text
    assert "1010" in logged
    assert "Cloudflare" in logged
    assert "User-Agent" in logged


def test_a_failed_send_does_not_log_the_address_or_the_code(settings, monkeypatch, caplog):
    """An unsent sign-in email is a support question. The log line answering it
    does not need to be a record of who tried to sign in, or of a live code."""

    def fake_urlopen(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://api.resend.com/emails", 422, "nope", {}, io.BytesIO(b"{}")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with caplog.at_level(logging.ERROR), pytest.raises(MailerError):
        send_sign_in_email(settings, to="buyer@example.com", code="ABCD2345")

    logged = caplog.text
    assert "buyer@example.com" not in logged
    assert "ABCD" not in logged
