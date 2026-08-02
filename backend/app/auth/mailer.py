"""Sending the sign-in email, via Resend.

Chosen over Postmark on setup friction alone, as asked: an API key and one POST,
with no per-message-stream or approval step before the first send. The provider
is confined to this module -- `service.py` calls `send_sign_in_email` and knows
nothing else about it -- so swapping it is a change to one file.

`urllib` rather than the `resend` SDK or `httpx`: this is a single JSON POST,
and the backend's only existing HTTP client (`nhtsa/client.py`) is stdlib for
the same reason. A dependency that saves four lines is not worth the supply
chain.

THE EMAIL CARRIES BOTH A CODE AND A LINK, and they are the same secret in two
transports. The extension cannot receive a click -- the paste-a-code flow is a
deliberate choice to avoid adding `externally_connectable` to the manifest
straight after Chrome review -- so the code is the primary affordance and is
what the layout leads with. The link is for the website, where a click is the
natural gesture.
"""

from __future__ import annotations

import json
import logging
import ssl
import urllib.error
import urllib.parse
import urllib.request

import certifi

from app.config import Settings

from .tokens import format_code

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
REQUEST_TIMEOUT_SECONDS = 10


class MailerError(RuntimeError):
    """The provider refused or could not be reached."""


def _ssl_context() -> ssl.SSLContext:
    # Same reason as nhtsa/client.py: python.org builds do not read the macOS
    # keychain, so the CA bundle is explicit rather than assumed.
    return ssl.create_default_context(cafile=certifi.where())


def _body(code: str, link: str, ttl_minutes: int) -> tuple[str, str]:
    pretty = format_code(code)
    text = (
        "Sign in to Curbside\n"
        "\n"
        f"Your code is:  {pretty}\n"
        "\n"
        "Paste it into the extension's sign-in box to save evaluations.\n"
        "\n"
        f"Signing in on the web instead? Open {link}\n"
        "\n"
        f"The code works once and expires in {ttl_minutes} minutes. "
        "If you did not ask to sign in, you can ignore this email -- "
        "no account is created until a code is used.\n"
    )
    html = (
        '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;'
        'max-width:420px;color:#081D36">'
        '<h1 style="font-size:18px;margin:0 0 16px">Sign in to Curbside</h1>'
        '<p style="margin:0 0 8px;font-size:14px;color:#40566F">Your code:</p>'
        '<p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;'
        "font-size:30px;letter-spacing:.12em;font-weight:600;margin:0 0 20px;"
        'color:#081D36">'
        f"{pretty}</p>"
        '<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#40566F">'
        "Paste it into the extension's sign-in box to save evaluations.</p>"
        f'<p style="margin:0 0 20px;font-size:14px"><a href="{link}" '
        'style="color:#16A47D">Signing in on the web instead?</a></p>'
        '<p style="margin:0;font-size:12px;line-height:1.5;color:#7A8CA3">'
        f"The code works once and expires in {ttl_minutes} minutes. "
        "If you did not ask to sign in you can ignore this email &mdash; "
        "no account is created until a code is used.</p>"
        "</div>"
    )
    return text, html


def send_sign_in_email(settings: Settings, *, to: str, code: str) -> None:
    """Deliver one sign-in code. Raises `MailerError` if it did not go out.

    Failure is raised rather than swallowed on purpose. The endpoint above this
    reports success without revealing whether an account exists, but "we could
    not send mail at all" is a server fault rather than an account fact, and
    reporting it as a sent message would leave the user waiting on an email that
    was never going to arrive.
    """
    if not settings.resend_api_key:
        raise MailerError("no email provider configured (DEAL_RATER_RESEND_API_KEY unset)")

    link = (
        f"{settings.app_base_url.rstrip('/')}/saved"
        f"?email={urllib.parse.quote(to)}&code={urllib.parse.quote(code)}"
    )
    text, html = _body(code, link, settings.magic_link_ttl_minutes)

    payload = json.dumps(
        {
            "from": settings.auth_from_email,
            "to": [to],
            "subject": f"{format_code(code)} is your Curbside sign-in code",
            "text": text,
            "html": html,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        RESEND_ENDPOINT,
        data=payload,
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
            # Resend's API sits behind Cloudflare, and `urllib`'s default
            # User-Agent ("Python-urllib/3.x") is a well-known bot fingerprint
            # that Cloudflare blocks outright -- a 403 with body "error code:
            # 1010", which is Cloudflare's own block signature, not a Resend
            # error. It has nothing to do with the API key, the sender domain,
            # or CORS; every one of those was a red herring chased while this
            # header was missing. Confirmed by sending the identical payload
            # with and without this header: 403 without, 200 with.
            "User-Agent": "curbside-backend/1.0 (+https://curbsidescore.com)",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request, timeout=REQUEST_TIMEOUT_SECONDS, context=_ssl_context()
        ) as response:
            if response.status >= 300:
                raise MailerError(f"email provider returned {response.status}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        # The RECIPIENT is not logged: an unsent sign-in email is a support
        # question, and the log line answering it does not need to be a record
        # of who tried to sign in and when.
        #
        # The SENDER is, because it is configuration rather than personal data.
        # TWO DIFFERENT THINGS PRODUCE A 403 HERE, distinguishable only by
        # `detail`, so both are stated rather than guessing one:
        #
        #   Resend's own validation_error, naming an unverified `from` domain --
        #   including the deliberately-invalid default in config.py, which is
        #   what an unconfigured deployment sends as.
        #
        #   Cloudflare's block page ("error code: 1010"), because Resend's API
        #   sits behind it and `urllib`'s default User-Agent is a known bot
        #   fingerprint -- this is why the request now sets one explicitly. If
        #   this ever appears again, something is stripping or overriding that
        #   header before the request leaves the process.
        logger.error(
            "Resend rejected a sign-in email: %s %s (from=%r). If `detail` names "
            "an unverified domain, check DEAL_RATER_AUTH_FROM_EMAIL against "
            "https://resend.com/domains. If it reads \"error code: 1010\", that is "
            "Cloudflare blocking the request before it reaches Resend, not a "
            "Resend rejection -- see the User-Agent header on this request.",
            error.code,
            detail,
            settings.auth_from_email,
        )
        raise MailerError(f"email provider returned {error.code}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        logger.warning("Could not reach the email provider: %s", error)
        raise MailerError("could not reach the email provider") from error
