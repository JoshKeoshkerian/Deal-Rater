"""Accounts, magic-link sessions, and saved evaluations.

Four tables and no changes to any existing one. Nothing here alters the capture
path: the ingest and evaluation endpoints stay exactly as unauthenticated as
they were before this migration, and gating them is a separate decision.

`saved_evaluations.capture_id` and `.listing_id` are ON DELETE SET NULL, which
is the one place this schema deviates from the CASCADE used on every other
capture foreign key. `app/retention.py` deletes captures past the retention
window; CASCADE here would silently empty a user's saved list at the retention
boundary. The snapshot in `evaluation` is the payload and outlives its source
deliberately -- see the model docstring.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "magic_link_tokens",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_magic_link_email", "magic_link_tokens", ["email"])
    op.create_index("ix_magic_link_code_hash", "magic_link_tokens", ["code_hash"])

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("client", sa.String(16), nullable=False, server_default="unknown"),
    )
    op.create_index("ix_auth_sessions_user", "auth_sessions", ["user_id"])

    op.create_table(
        "saved_evaluations",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_capture_id", sa.BigInteger, nullable=False),
        sa.Column(
            "capture_id",
            sa.BigInteger,
            sa.ForeignKey("captures.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "listing_id",
            sa.BigInteger,
            sa.ForeignKey("listings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evaluation", postgresql.JSONB, nullable=False),
        sa.Column("vehicle", sa.String(255), nullable=True),
        sa.Column("listing_url", sa.Text, nullable=True),
        sa.UniqueConstraint("user_id", "source_capture_id", name="uq_saved_user_capture"),
    )
    op.create_index("ix_saved_user_time", "saved_evaluations", ["user_id", "saved_at"])


def downgrade() -> None:
    op.drop_index("ix_saved_user_time", table_name="saved_evaluations")
    op.drop_table("saved_evaluations")
    op.drop_index("ix_auth_sessions_user", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_magic_link_code_hash", table_name="magic_link_tokens")
    op.drop_index("ix_magic_link_email", table_name="magic_link_tokens")
    op.drop_table("magic_link_tokens")
    op.drop_table("users")
