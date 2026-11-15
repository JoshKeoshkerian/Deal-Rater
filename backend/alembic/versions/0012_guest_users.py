"""Guest users: run the first check before giving an email.

- `users.email` becomes nullable (NULL only for a guest).
- `users.is_guest`, `users.guest_ip_hash`, `users.merged_into_user_id`.
- An index for the guest-creation rate limits (per IP per day, and a global
  daily ceiling), which both filter on `is_guest` and `created_at`.

See `User.is_guest` in `app/models.py` and `create_guest` / `verify_code` in
`app/auth/service.py`.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-15

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("email", existing_type=sa.String(320), nullable=True)
        batch.add_column(
            sa.Column("is_guest", sa.Boolean, nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("guest_ip_hash", sa.String(64), nullable=True))
        batch.add_column(sa.Column("merged_into_user_id", sa.BigInteger, nullable=True))
        batch.create_foreign_key(
            "fk_users_merged_into_user_id",
            "users",
            ["merged_into_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_users_guest_created", "users", ["is_guest", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_users_guest_created", table_name="users")
    # Guests have no email and cannot survive the NOT NULL coming back.
    op.execute("DELETE FROM users WHERE email IS NULL")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_merged_into_user_id", type_="foreignkey")
        batch.drop_column("merged_into_user_id")
        batch.drop_column("guest_ip_hash")
        batch.drop_column("is_guest")
        batch.alter_column("email", existing_type=sa.String(320), nullable=False)
