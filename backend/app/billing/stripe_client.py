"""The only module that imports `stripe`.

Thin wrappers around Checkout, the Billing Portal, Customers and the webhook
signature check -- no ledger writes and no business decisions here. `app/api/
billing.py` decides what a Stripe event means; this only talks to Stripe.

Imported lazily by every function below, the same way `known_issues/client.py`
imports `anthropic` lazily: a deployment with no Stripe key configured never
loads the package, and the test suite never needs it installed.
"""

from __future__ import annotations

from typing import Any

from app.config import Settings


def _api_key(settings: Settings) -> str:
    if not settings.stripe_secret_key:
        raise RuntimeError("Stripe is not configured (DEAL_RATER_STRIPE_SECRET_KEY unset).")
    return settings.stripe_secret_key


def create_customer(settings: Settings, *, email: str, user_id: int) -> str:
    import stripe

    stripe.api_key = _api_key(settings)
    customer = stripe.Customer.create(email=email, metadata={"user_id": str(user_id)})
    return customer.id


def create_checkout_session(
    settings: Settings,
    *,
    customer_id: str,
    price_id: str,
    mode: str,
    user_id: int,
    plan_id: str,
    success_url: str,
    cancel_url: str,
) -> str:
    import stripe

    stripe.api_key = _api_key(settings)
    metadata = {"user_id": str(user_id), "plan_id": plan_id}
    kwargs: dict[str, Any] = dict(
        customer=customer_id,
        mode=mode,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=str(user_id),
        metadata=metadata,
        # Stripe's Managed Payments (on by default for new accounts) requires
        # a tax code on every Product it prices, which this app has no use
        # for -- checks aren't a taxable physical good and we're not using
        # Stripe Tax. Opting out here is what Stripe's own error message
        # recommends for exactly this case.
        managed_payments={"enabled": False},
    )
    if mode == "subscription":
        # Carried on the Subscription object too, not just the Checkout
        # Session -- `customer.subscription.updated`/`.deleted` events (which
        # fire long after the session is gone, on every future renewal or
        # cancellation) need `user_id` to know whose `BillingAccount` to sync.
        kwargs["subscription_data"] = {"metadata": metadata}
    session = stripe.checkout.Session.create(**kwargs)
    return session.url


def create_portal_session(settings: Settings, *, customer_id: str, return_url: str) -> str:
    import stripe

    stripe.api_key = _api_key(settings)
    portal = stripe.billing_portal.Session.create(customer=customer_id, return_url=return_url)
    return portal.url


def construct_webhook_event(settings: Settings, *, payload: bytes, signature: str) -> Any:
    import stripe

    stripe.api_key = _api_key(settings)
    if not settings.stripe_webhook_secret:
        raise RuntimeError("Stripe webhook secret is not configured.")
    return stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)
