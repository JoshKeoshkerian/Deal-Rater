"""Checkout, the Billing Portal, and the webhook that keeps credits and
subscription state in sync.

    GET  /v1/billing/me         current balance/plan/history, for /account
    POST /v1/billing/checkout   start buying a pack or subscribing
    POST /v1/billing/portal     manage/cancel an existing subscription
    POST /v1/billing/webhook    Stripe -> us, server to server

Nothing here trusts the client for anything money-related. A Checkout Session
is created with the price looked up server-side from `billing/plans.py`, not
whatever price the frontend claims; the webhook is the only place a balance
or a subscription status actually changes, and it only accepts requests
carrying a valid Stripe signature.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import require_user
from app.billing import (
    get_account_by_subscription_id,
    get_or_create_account,
    has_ever_purchased,
    has_stripe_customer,
    is_unlimited,
    list_purchases,
    plan_by_id,
    record_purchase,
    sync_subscription_state,
)
from app.billing.stripe_client import (
    construct_webhook_event,
    create_checkout_session,
    create_customer,
    create_portal_session,
)
from app.config import get_settings
from app.db import get_session
from app.models import User
from app.schemas import BillingMeOut, CheckoutIn, CheckoutOut, PortalOut, PurchaseOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["billing"])

NOT_CONFIGURED_DETAIL = "Payments are not available: this server has no Stripe key configured."


def _require_stripe_configured() -> None:
    if not get_settings().stripe_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_CONFIGURED_DETAIL
        )


@router.get("/billing/me", response_model=BillingMeOut)
def billing_me(
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> BillingMeOut:
    account = get_or_create_account(session, user.id)
    unlimited = is_unlimited(account)
    ever_purchased = has_ever_purchased(session, user.id)
    purchases = list_purchases(session, user.id)

    # The plan label persists past the moment its credits run out -- "Current:
    # 20 checks, one time" stays true until the next purchase, not just while
    # the balance from that purchase is still nonzero.
    plan_id = (
        account.subscription_plan if unlimited else (purchases[0].plan_id if purchases else None)
    )

    return BillingMeOut(
        plan=plan_id,
        evaluations_remaining=None if unlimited else account.credit_balance,
        # Once anything has ever been bought, "how much of this is free" stops
        # being a distinction worth drawing -- the pools are fungible from
        # that point on. See `BillingMeOut`.
        free_evaluations_remaining=0 if ever_purchased else account.credit_balance,
        renews_at=(
            account.current_period_end
            if unlimited and not account.cancel_at_period_end
            else None
        ),
        ends_at=(
            account.current_period_end if unlimited and account.cancel_at_period_end else None
        ),
        purchases=[
            PurchaseOut(
                id=row.id,
                at=row.created_at,
                description=row.description or "",
                amount_cents=row.amount_cents or 0,
            )
            for row in purchases
        ],
    )


@router.post("/billing/checkout", response_model=CheckoutOut)
def create_checkout(
    payload: CheckoutIn,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> CheckoutOut:
    _require_stripe_configured()
    settings = get_settings()

    plan = plan_by_id(payload.plan_id)
    if plan is None or plan.stripe_price_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown plan {payload.plan_id!r}.",
        )

    account = get_or_create_account(session, user.id)
    if not has_stripe_customer(account):
        # A double-click racing itself here creates two Stripe Customers
        # instead of one -- harmless (an unused Customer object costs and
        # does nothing) rather than a data-integrity problem, since this row
        # is a plain UPDATE, not an insert a unique constraint needs to guard.
        account.stripe_customer_id = create_customer(settings, email=user.email, user_id=user.id)
        session.commit()

    url = create_checkout_session(
        settings,
        customer_id=account.stripe_customer_id,
        price_id=plan.stripe_price_id,
        mode=plan.mode,
        user_id=user.id,
        plan_id=plan.id,
        success_url=f"{settings.app_base_url}/account?checkout=success",
        cancel_url=f"{settings.app_base_url}/pricing?checkout=cancelled",
    )
    return CheckoutOut(url=url)


@router.post("/billing/portal", response_model=PortalOut)
def create_portal(
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> PortalOut:
    _require_stripe_configured()
    settings = get_settings()

    account = get_or_create_account(session, user.id)
    if not has_stripe_customer(account):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No billing history yet -- nothing to manage.",
        )

    url = create_portal_session(
        settings,
        customer_id=account.stripe_customer_id,
        return_url=f"{settings.app_base_url}/account",
    )
    return PortalOut(url=url)


def _epoch(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, tz=UTC) if value else None


def _handle_checkout_completed(session: Session, event: dict, data: dict) -> None:
    metadata = data.get("metadata") or {}
    user_id_raw = metadata.get("user_id") or data.get("client_reference_id")
    plan_id = metadata.get("plan_id")
    if not user_id_raw or not plan_id:
        logger.warning(
            "checkout.session.completed with no user_id/plan_id metadata: %s", data.get("id")
        )
        return

    plan = plan_by_id(plan_id)
    if plan is None:
        logger.warning("checkout.session.completed for unknown plan_id %r", plan_id)
        return
    user_id = int(user_id_raw)

    account = get_or_create_account(session, user_id)
    if data.get("customer") and account.stripe_customer_id != data["customer"]:
        account.stripe_customer_id = data["customer"]

    record_purchase(
        session,
        user_id=user_id,
        plan=plan,
        stripe_event_id=event["id"],
        amount_cents=data.get("amount_total") or 0,
    )

    if plan.mode == "subscription":
        # `current_period_end` isn't on the Checkout Session payload -- Stripe
        # also fires `customer.subscription.created` for every new
        # subscription, and that handler (same code path as `.updated` below)
        # fills it in. Recorded here as 'active' so a slow arrival of that
        # second event doesn't leave a paying user briefly reading as free.
        sync_subscription_state(
            session,
            user_id=user_id,
            stripe_customer_id=data.get("customer"),
            stripe_subscription_id=data.get("subscription"),
            status="active",
            plan_id=plan.id,
            current_period_end=account.current_period_end,
            cancel_at_period_end=False,
        )


def _handle_subscription_synced(session: Session, data: dict) -> None:
    """Shared by `customer.subscription.updated` and `.deleted` -- a deleted
    subscription's payload already carries `status: "canceled"`, so both are
    just "apply what Stripe is telling us right now."
    """
    metadata = data.get("metadata") or {}
    user_id_raw = metadata.get("user_id")
    if not user_id_raw:
        # Falls back to matching the subscription id we stored at checkout,
        # for the case where an older event predates `subscription_data.
        # metadata` being set (or Stripe re-sends one from before it was).
        account = get_account_by_subscription_id(session, data.get("id", ""))
        if account is None:
            logger.warning("subscription event for unknown subscription %s", data.get("id"))
            return
        user_id = account.user_id
    else:
        user_id = int(user_id_raw)

    sync_subscription_state(
        session,
        user_id=user_id,
        stripe_customer_id=data.get("customer"),
        stripe_subscription_id=data.get("id"),
        status=data.get("status"),
        plan_id=metadata.get("plan_id") or "unlimited-monthly",
        current_period_end=_epoch(data.get("current_period_end")),
        cancel_at_period_end=bool(data.get("cancel_at_period_end")),
    )


def _handle_invoice_paid(session: Session, event: dict, data: dict) -> None:
    # The first period's charge is already recorded via
    # `checkout.session.completed` -- only a renewal belongs in history again.
    if data.get("billing_reason") != "subscription_cycle":
        return

    subscription_id = data.get("subscription")
    if not subscription_id:
        return
    account = get_account_by_subscription_id(session, subscription_id)
    if account is None:
        logger.warning("invoice.paid for unknown subscription %s", subscription_id)
        return
    plan = plan_by_id(account.subscription_plan or "")
    if plan is None:
        return

    record_purchase(
        session,
        user_id=account.user_id,
        plan=plan,
        stripe_event_id=event["id"],
        amount_cents=data.get("amount_paid") or 0,
    )


@router.post("/billing/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, session: Session = Depends(get_session)) -> Response:
    """Stripe calls this directly, server to server -- no session cookie, no
    bearer token, no CORS relevance (CORS governs browser requests only).
    The Stripe signature IS the authentication.
    """
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webhook is not configured."
        )

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")

    try:
        event = construct_webhook_event(settings, payload=payload, signature=signature)
    except Exception as exc:  # noqa: BLE001 - any failure here means "reject the request"
        logger.warning("Stripe webhook signature check failed: %s", exc)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid signature.") from exc

    event_type = event["type"]
    data = event["data"]["object"]

    subscription_events = (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    )
    if event_type == "checkout.session.completed":
        _handle_checkout_completed(session, event, data)
    elif event_type in subscription_events:
        _handle_subscription_synced(session, data)
    elif event_type == "invoice.paid":
        _handle_invoice_paid(session, event, data)
    # Anything else: acknowledged, ignored -- Stripe's own recommendation for
    # a webhook endpoint that only cares about a handful of event types.

    session.commit()
    return Response(status_code=status.HTTP_200_OK)
