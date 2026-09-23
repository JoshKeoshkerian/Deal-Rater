"""Credit and subscription bookkeeping. No Stripe import anywhere in this file.

Every function here is plain SQLAlchemy, so the balance/spend/grant rules are
testable without a Stripe key, a webhook, or a network call -- the same
reason `auth/service.py` is kept free of FastAPI.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import BillingAccount, CreditLedger, User

from .plans import FREE_EVALUATIONS, Plan


def get_or_create_account(session: Session, user_id: int) -> BillingAccount:
    account = session.get(BillingAccount, user_id)
    if account is None:
        account = BillingAccount(
            user_id=user_id, credit_balance=0, created_at=datetime.now(UTC)
        )
        session.add(account)
        session.flush()
    return account


def grant_free_credits(session: Session, user: User) -> None:
    """The 10-check welcome grant. Called once, from `auth/service.py`'s
    `verify_code`, in the same transaction that creates the `User` row.

    Free checks are granted at ACCOUNT CREATION now, not at extension install
    -- sign-in is required before the first check, so the two used to be the
    same moment for a new user and no longer have to be.
    """
    account = get_or_create_account(session, user.id)
    account.credit_balance += FREE_EVALUATIONS
    session.add(
        CreditLedger(
            user_id=user.id,
            delta=FREE_EVALUATIONS,
            reason="free_grant",
            created_at=datetime.now(UTC),
        )
    )
    session.flush()


def is_unlimited(account: BillingAccount) -> bool:
    """Whether this account bypasses the credit balance entirely right now.

    Reads Stripe's status as cached on the row (kept in sync by the webhook),
    not Stripe itself -- see `BillingAccount`'s docstring for why that cache
    exists.
    """
    return account.subscription_status == "active"


def try_reserve_credit(session: Session, user_id: int) -> bool:
    """Atomically spend one credit, or refuse if there isn't one.

    A single conditional `UPDATE` rather than a read-then-write, so two
    concurrent checks against a balance of 1 cannot both read "1 left" and
    both proceed -- the second `UPDATE` simply matches zero rows. The ledger
    row recording WHICH check this paid for is written separately
    (`record_evaluation_spend`) once the capture id exists; this function only
    answers "was a credit available," which is what the caller needs before
    doing any of the work a check involves.
    """
    result = session.execute(
        update(BillingAccount)
        .where(BillingAccount.user_id == user_id, BillingAccount.credit_balance > 0)
        .values(credit_balance=BillingAccount.credit_balance - 1)
    )
    return result.rowcount > 0


def record_evaluation_spend(session: Session, user_id: int, capture_id: int) -> None:
    """The audit row for a credit `try_reserve_credit` already took."""
    session.add(
        CreditLedger(
            user_id=user_id,
            delta=-1,
            reason="evaluation_spend",
            capture_id=capture_id,
            created_at=datetime.now(UTC),
        )
    )


def record_purchase(
    session: Session,
    *,
    user_id: int,
    plan: Plan,
    stripe_event_id: str,
    amount_cents: int,
) -> bool:
    """Grant a pack's credits (or log a subscription charge), idempotently.

    Returns False if `stripe_event_id` was already recorded -- Stripe retries
    webhook deliveries, and this is what stops a retried
    `checkout.session.completed` from granting a pack twice.
    `credit_ledger.stripe_event_id`'s unique index is what actually enforces
    it; the pre-check here just avoids a needless failed `flush()` on the
    common, non-retried path.
    """
    already = session.scalars(
        select(CreditLedger.id).where(CreditLedger.stripe_event_id == stripe_event_id)
    ).first()
    if already is not None:
        return False

    account = get_or_create_account(session, user_id)
    delta = plan.evaluations if plan.mode == "payment" else 0
    if delta:
        account.credit_balance += delta

    session.add(
        CreditLedger(
            user_id=user_id,
            delta=delta,
            reason="pack_purchase" if plan.mode == "payment" else "subscription_charge",
            stripe_event_id=stripe_event_id,
            amount_cents=amount_cents,
            description=plan.name,
            plan_id=plan.id,
            created_at=datetime.now(UTC),
        )
    )
    session.flush()
    return True


def sync_subscription_state(
    session: Session,
    *,
    user_id: int,
    stripe_customer_id: str,
    stripe_subscription_id: str | None,
    status: str | None,
    plan_id: str | None,
    current_period_end: datetime | None,
    cancel_at_period_end: bool,
) -> None:
    """Overwrite the cached subscription fields from a Stripe event.

    Idempotent by construction -- applying the same status twice is a no-op --
    so unlike a credit grant this needs no event-id dedup. Source of truth is
    always Stripe; this only updates the read-time cache described in
    `BillingAccount`'s docstring.
    """
    account = get_or_create_account(session, user_id)
    account.stripe_customer_id = stripe_customer_id
    account.stripe_subscription_id = stripe_subscription_id
    account.subscription_status = status
    account.subscription_plan = plan_id
    account.current_period_end = current_period_end
    account.cancel_at_period_end = cancel_at_period_end
    session.flush()


def has_stripe_customer(account: BillingAccount) -> bool:
    return account.stripe_customer_id is not None


def get_account_by_subscription_id(
    session: Session, stripe_subscription_id: str
) -> BillingAccount | None:
    """Used by the `invoice.paid` webhook handler, which knows a subscription
    id but carries no `user_id` metadata of its own (only the Subscription
    object does)."""
    return session.scalars(
        select(BillingAccount).where(
            BillingAccount.stripe_subscription_id == stripe_subscription_id
        )
    ).first()


def list_purchases(session: Session, user_id: int, limit: int = 20) -> list[CreditLedger]:
    """Newest first, for `GET /v1/billing/me`'s billing-history table."""
    return list(
        session.scalars(
            select(CreditLedger)
            .where(
                CreditLedger.user_id == user_id,
                CreditLedger.reason.in_(("pack_purchase", "subscription_charge")),
            )
            .order_by(CreditLedger.created_at.desc())
            .limit(limit)
        )
    )


def has_ever_purchased(session: Session, user_id: int) -> bool:
    """Whether any credit on this account ever came from money rather than the
    free grant. `GET /v1/billing/me` uses this to decide whether the current
    balance should still be described as "of your free checks" -- once
    something has been bought, the two pools are no longer meaningfully
    distinct (see that route for the exact reasoning).
    """
    return (
        session.scalars(
            select(CreditLedger.id)
            .where(
                CreditLedger.user_id == user_id,
                CreditLedger.reason.in_(("pack_purchase", "subscription_charge")),
            )
            .limit(1)
        ).first()
        is not None
    )
