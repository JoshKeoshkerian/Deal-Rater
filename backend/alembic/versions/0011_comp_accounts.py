"""Manually comped billing accounts.

`billing_accounts.is_comped`: unlimited checks granted by hand (family,
testing) rather than through Stripe. Kept separate from
`subscription_status` so a comped account can never be mistaken for, or
later overwritten by, a real subscription -- see `BillingAccount`'s
docstring and `app/billing/ledger.py`'s `is_unlimited`.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-23

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "billing_accounts",
        sa.Column("is_comped", sa.Boolean, nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("billing_accounts", "is_comped")
