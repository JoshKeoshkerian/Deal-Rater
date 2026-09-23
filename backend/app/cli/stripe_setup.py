"""One-off: create the Stripe Products/Prices for the three plans in
`app/billing/plans.py`.

    python -m app.cli.stripe_setup

Prints the resulting price ids. Paste them into `PLANS` in
`app/billing/plans.py` as each plan's `stripe_price_id` -- there is no
runtime lookup of Stripe's product catalog, by design (see that module's
docstring), so this is a manual, one-time step rather than something the
server does automatically on boot.

Safe to re-run: it looks up an existing Product by its `lookup_key` (the plan
id) before creating one, so running this twice does not create duplicates on
either the plan already set up or the ones still missing a price id.

Talks to whichever account the configured key belongs to -- almost always the
test-mode key while building this out. Re-run against the live secret key
once before flipping the site over to it.
"""

from __future__ import annotations

import argparse
import sys

from ..billing.plans import PLANS
from ..config import get_settings


def _stripe():
    import stripe

    settings = get_settings()
    if not settings.stripe_secret_key:
        print("DEAL_RATER_STRIPE_SECRET_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    stripe.api_key = settings.stripe_secret_key
    return stripe


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)

    stripe = _stripe()

    print("Creating Stripe Products/Prices for the plans in app/billing/plans.py...\n")
    results: dict[str, str] = {}

    for plan in PLANS.values():
        existing = stripe.Price.list(lookup_keys=[plan.id], limit=1).data
        if existing:
            price = existing[0]
            print(f"  {plan.id:<20} already exists: {price.id}")
            results[plan.id] = price.id
            continue

        product = stripe.Product.create(name=f"Curbside — {plan.name}")
        price_kwargs: dict[str, object] = {
            "product": product.id,
            "unit_amount": plan.price_cents,
            "currency": "usd",
            "lookup_key": plan.id,
        }
        if plan.mode == "subscription":
            price_kwargs["recurring"] = {"interval": "month"}
        price = stripe.Price.create(**price_kwargs)
        print(f"  {plan.id:<20} created:       {price.id}")
        results[plan.id] = price.id

    print("\nPaste these into app/billing/plans.py's PLANS dict:\n")
    for plan_id, price_id in results.items():
        print(f'  "{plan_id}": ... stripe_price_id="{price_id}" ...')

    return 0


if __name__ == "__main__":
    sys.exit(main())
