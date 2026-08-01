"""Secret generation, hashing, and email normalisation.

Two kinds of secret, generated differently on purpose:

  SESSION TOKEN   `secrets.token_urlsafe(32)` -- 256 bits, never typed by a
                  person, stored by a machine. Long is free.

  SIGN-IN CODE    8 characters from a 32-symbol alphabet -- 40 bits, read off a
                  phone and typed into a browser extension. Length here costs
                  the user something, so the strength comes from the code being
                  single-use, valid for minutes, capped at a few attempts and
                  bound to one email address, rather than from entropy alone.

Neither is stored. Both are kept as SHA-256 hex, and every lookup hashes the
presented value and compares hashes. A dump of this database is therefore not a
set of live credentials -- which matters more here than usual, because one of
these tables is short-lived by design and the other is the only thing standing
between a stranger and someone's saved list.

Plain SHA-256 rather than a password hash (bcrypt/argon2) is correct for both:
those exist to make brute force expensive against LOW-entropy human-chosen
secrets. These are high-entropy machine-generated values with short lives, and
a slow hash on the read path would tax every authenticated request to defend
against a search nobody can run.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

#: No I, L, O, U, 0 or 1. The first four are the characters people misread off
#: a screen; U is excluded because its absence makes accidental words unlikely.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def generate_code() -> str:
    """A sign-in code, formatted for reading aloud and typing back."""
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def secrets_equal(a: str, b: str) -> bool:
    """Constant-time comparison, for comparing two hashes.

    The database lookup is by hash and would leak nothing by itself, but the
    attempt-counting path in `service.py` compares in Python, and a byte-by-byte
    `==` there is a timing oracle over a value an attacker is actively guessing.
    """
    return hmac.compare_digest(a, b)


def normalize_email(raw: str) -> str:
    """Lower-case and strip.

    Nothing more. Gmail's dot and plus-address folding is deliberately NOT
    applied: it is a Gmail-specific rule, applying it universally would merge
    genuinely distinct addresses at providers that treat them as distinct, and
    a user who signs up as `me+cars@` expects that to be their account.
    """
    return raw.strip().lower()


def format_code(code: str) -> str:
    """`ABCD2345` -> `ABCD-2345`, for the email only.

    The hyphen is never stored or compared; `service.py` strips non-alphanumerics
    from whatever the user types back, so both forms verify.
    """
    mid = len(code) // 2
    return f"{code[:mid]}-{code[mid:]}"


def canonicalize_code(raw: str) -> str:
    """Whatever the user pasted -> the form that was hashed.

    People paste the hyphen, a trailing space, and lower case. None of those are
    a wrong code, and treating them as one burns an attempt and reads as a bug.
    """
    return "".join(ch for ch in raw.upper() if ch.isalnum())
