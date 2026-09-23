"""Plan definitions: the backend's mirror of curbside-app/lib/plans.ts.

NOTHING HERE TALKS TO STRIPE. `stripe_price_id` is filled in by hand after
running `python -m app.cli.stripe_setup`, which creates the matching Stripe
Products/Prices via the API and prints the ids to paste in here. A plain dict
means validating a `plan_id` posted to `POST /v1/billing/checkout` never
depends on Stripe's API being reachable -- only actually creating the
Checkout Session does.

Prices are in CENTS, matching `lib/plans.ts`'s own rule: a float dollar
amount is a rounding bug waiting for a discount code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

PlanId = Literal["pack-10", "pack-20", "unlimited-monthly"]

#: Granted once, at account creation (`auth/service.py`'s `verify_code`) --
#: not at extension install, now that sign-in is required before the first
#: check. Kept as a module constant, mirroring `lib/plans.ts`'s
#: `FREE_EVALUATIONS`, so the two numbers cannot drift independently.
FREE_EVALUATIONS = 10


@dataclass(frozen=True)
class Plan:
    id: PlanId
    name: str
    price_cents: int
    #: 'payment' for a one-time pack, 'subscription' for the unlimited plan --
    #: passed straight through as the Checkout Session's `mode`.
    mode: Literal["payment", "subscription"]
    #: Evaluations bought. `None` means uncapped (the subscription only).
    evaluations: int | None
    #: Filled in by `python -m app.cli.stripe_setup`. `None` until then, which
    #: `POST /v1/billing/checkout` treats as "not configured yet" (503) rather
    #: than trying to create a session with no price to sell.
    stripe_price_id: str | None


PLANS: dict[PlanId, Plan] = {
    "pack-10": Plan(
        id="pack-10",
        name="10 checks",
        price_cents=799,
        mode="payment",
        evaluations=10,
        stripe_price_id="price_1UIgubQecxBqsGW5Oli7tgK9",
    ),
    "pack-20": Plan(
        id="pack-20",
        name="20 checks",
        price_cents=1199,
        mode="payment",
        evaluations=20,
        stripe_price_id="price_1UIgucQecxBqsGW5plG15kir",
    ),
    "unlimited-monthly": Plan(
        id="unlimited-monthly",
        name="Unlimited",
        price_cents=1699,
        mode="subscription",
        evaluations=None,
        stripe_price_id="price_1UIgucQecxBqsGW54RAx5kTM",
    ),
}


def plan_by_id(plan_id: str) -> Plan | None:
    return PLANS.get(plan_id)  # type: ignore[arg-type]


def plan_by_price_id(stripe_price_id: str) -> Plan | None:
    """The plan a Checkout Session's or Invoice's Stripe price id belongs to.

    Used by the webhook, which only knows the price it was charged for, not
    which of our plan ids that maps back to.
    """
    for plan in PLANS.values():
        if plan.stripe_price_id == stripe_price_id:
            return plan
    return None
