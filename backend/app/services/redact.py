"""Server-side contact-detail redaction for description text.

Clients redact before transmitting, but the API cannot assume a well-behaved
client and stays independent of any particular one (spec 8.1.4), so it redacts
again on the way in. Idempotent: running it over already-redacted text is a
no-op.

Substitution rather than deletion is intentional. Nothing in the spec consumes
a seller's phone number, but "text me at ..." is a real negotiation and scam
signal (spec 6.3/6.4), and that signal lives in the surrounding phrasing. The
token preserves it while keeping the contact detail out of Postgres.
"""

from __future__ import annotations

import re

PHONE_TOKEN = "[PHONE]"
EMAIL_TOKEN = "[EMAIL]"

_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b", re.IGNORECASE)

# North American numbers as written by hand in listings: 918-555-0134,
# (918) 555 0134, 9185550134, 918.555.0134, +1 918 555 0134.
_PHONE_RE = re.compile(
    r"""
    (?<![\w-])
    (?:\+?1[\s.\-]*)?
    (?:\(\s*\d{3}\s*\)|\d{3})
    [\s.\-]*\d{3}[\s.\-]*\d{4}
    (?![\w-])
    """,
    re.VERBOSE,
)

# Digits spelled out to dodge naive filters: "nine one eight five five five...".
_SPELLED_DIGITS = r"(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)"
_SPELLED_PHONE_RE = re.compile(
    rf"\b(?:{_SPELLED_DIGITS}[\s.\-]+){{6,}}{_SPELLED_DIGITS}\b",
    re.IGNORECASE,
)


def redact_contact_details(text: str | None) -> str | None:
    """Replace phone numbers and email addresses with fixed tokens."""
    if text is None:
        return None
    out = _EMAIL_RE.sub(EMAIL_TOKEN, text)
    out = _PHONE_RE.sub(PHONE_TOKEN, out)
    out = _SPELLED_PHONE_RE.sub(PHONE_TOKEN, out)
    return out
