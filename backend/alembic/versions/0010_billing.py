"""Credits, subscriptions, and the paid-capture path.

Three new tables plus one column on an existing one:

  billing_accounts   1:1 with users. Current balance/subscription state, a
                      CURSOR over `credit_ledger` and Stripe's own Subscription
                      object -- see the model docstring for why a mutable
                      cache is the right shape here, the same reasoning as
                      `listings.last_observed_at`.
  credit_ledger       append-only. Every grant and spend, ever. The source of
                      truth `billing_accounts.credit_balance` is a cursor over.
  captures.user_id    nullable. NULL on every capture taken before sign-in was
                      required to run a check; SET NULL rather than CASCADE so
                      deleting an account doesn't take the capture's whole
                      observation history with it, only the attribution.

Nothing here retroactively charges anyone: every existing `captures` row gets
`user_id = NULL` and stays exactly as readable as it was before this
migration (see `app/api/evaluations.py`'s ownership check).

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-22

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "captures",
        sa.Column(
            "user_id",
            sa.BigInteger,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_captures_user", "captures", ["user_id"])

    op.create_table(
        "billing_accounts",
        sa.Column(
            "user_id",
            sa.BigInteger,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("stripe_customer_id", sa.String(64), nullable=True, unique=True),
        sa.Column("credit_balance", sa.Integer, nullable=False, server_default="0"),
        sa.Column("stripe_subscription_id", sa.String(64), nullable=True, unique=True),
        sa.Column("subscription_status", sa.String(32), nullable=True),
        sa.Column("subscription_plan", sa.String(32), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "cancel_at_period_end", sa.Boolean, nullable=False, server_default=sa.false()
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "credit_ledger",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("delta", sa.Integer, nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column(
            "capture_id",
            sa.BigInteger,
            sa.ForeignKey("captures.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("stripe_event_id", sa.String(255), nullable=True),
        sa.Column("amount_cents", sa.Integer, nullable=True),
        sa.Column("description", sa.String(128), nullable=True),
        sa.Column("plan_id", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_credit_ledger_user_time", "credit_ledger", ["user_id", "created_at"])
    op.create_index(
        "uq_credit_ledger_stripe_event",
        "credit_ledger",
        ["stripe_event_id"],
        unique=True,
        postgresql_where=sa.text("stripe_event_id IS NOT NULL"),
        sqlite_where=sa.text("stripe_event_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_credit_ledger_stripe_event", table_name="credit_ledger")
    op.drop_index("ix_credit_ledger_user_time", table_name="credit_ledger")
    op.drop_table("credit_ledger")
    op.drop_table("billing_accounts")
    op.drop_index("ix_captures_user", table_name="captures")
    op.drop_column("captures", "user_id")
