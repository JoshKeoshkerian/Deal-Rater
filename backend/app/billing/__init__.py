"""Credits, subscriptions, and Stripe.

    plans.py          plan ids, prices, and their Stripe price ids -- the
                       backend's mirror of curbside-app/lib/plans.ts
    ledger.py          pure database operations: grants, spends, balance
    stripe_client.py   the only module that imports `stripe`

Kept in three modules so `ledger.py` is unit-testable with no Stripe
involved at all, the same split `known_issues/` draws between the cached
answer (`client.py`'s `_lookup`/`_serve`) and the model call itself.
"""

from __future__ import annotations

from .ledger import (
    get_account_by_subscription_id,
    get_or_create_account,
    grant_free_credits,
    has_ever_purchased,
    has_stripe_customer,
    is_unlimited,
    list_purchases,
    record_evaluation_spend,
    record_purchase,
    sync_subscription_state,
    try_reserve_credit,
)
from .plans import FREE_EVALUATIONS, PLANS, Plan, PlanId, plan_by_id, plan_by_price_id

__all__ = [
    "FREE_EVALUATIONS",
    "PLANS",
    "Plan",
    "PlanId",
    "get_account_by_subscription_id",
    "get_or_create_account",
    "grant_free_credits",
    "has_ever_purchased",
    "has_stripe_customer",
    "is_unlimited",
    "list_purchases",
    "plan_by_id",
    "plan_by_price_id",
    "record_evaluation_spend",
    "record_purchase",
    "sync_subscription_state",
    "try_reserve_credit",
]
