"""Referrals: share codes, who referred whom, and when the referrer was paid.

- `users.referral_code` (unique), minted lazily by `GET /v1/referrals/me`.
- `users.referred_by_user_id`, set when a referred account is created.
- `users.referral_rewarded_at`, set when the referrer is credited.

The reward itself is a `credit_ledger` row with reason `referral_reward`;
no new table. See `app/referrals/service.py`.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-15

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("referral_code", sa.String(16), nullable=True))
        batch.add_column(sa.Column("referred_by_user_id", sa.BigInteger, nullable=True))
        batch.add_column(
            sa.Column("referral_rewarded_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch.create_unique_constraint("uq_users_referral_code", ["referral_code"])
        batch.create_foreign_key(
            "fk_users_referred_by_user_id",
            "users",
            ["referred_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_users_referred_by", "users", ["referred_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_users_referred_by", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_referred_by_user_id", type_="foreignkey")
        batch.drop_constraint("uq_users_referral_code", type_="unique")
        batch.drop_column("referral_rewarded_at")
        batch.drop_column("referred_by_user_id")
        batch.drop_column("referral_code")
