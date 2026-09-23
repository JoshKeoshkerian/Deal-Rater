"""Grant an already-signed-up user unlimited checks by hand, no Stripe involved.

    python -m app.cli.comp_account someone@example.com
    python -m app.cli.comp_account someone@example.com --off

Sets `billing_accounts.is_comped`, which `is_unlimited()` (app/billing/
ledger.py) treats exactly like an active subscription. Also sets
`subscription_plan = "unlimited-monthly"` purely so `/account` labels it the
same way a real unlimited subscriber sees -- `subscription_status` is left
alone (`None`), since this account has no Stripe subscription behind it and
must never look like one to the webhook handlers.

Idempotent and safe to re-run. `--off` reverses it.
"""

from __future__ import annotations

import argparse
import sys

from app.auth.tokens import normalize_email
from app.billing import get_or_create_account
from app.db import session_scope
from app.models import User


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email", help="Email of an existing user (must have signed in once).")
    parser.add_argument(
        "--off", action="store_true", help="Revoke comped status instead of granting it."
    )
    args = parser.parse_args(argv)

    email = normalize_email(args.email)

    with session_scope() as session:
        user = session.query(User).filter(User.email == email).first()
        if user is None:
            print(f"No user with email {email!r}. They need to sign in once first.", file=sys.stderr)
            return 1

        account = get_or_create_account(session, user.id)
        account.is_comped = not args.off
        account.subscription_plan = "unlimited-monthly" if not args.off else None

    verb = "Revoked comped status for" if args.off else "Granted unlimited checks to"
    print(f"{verb} {email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
