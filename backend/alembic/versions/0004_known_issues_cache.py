"""Known-issues cache for spec 6.6's single LLM call (spec 10).

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB()
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    # Keyed by VEHICLE, not by listing (spec 10): "cache known-issues text by
    # year/make/model/trim/mileage-band, not per listing". `llm_model` and
    # `prompt_version` join the key because either one changing produces
    # different text -- a prompt revision then invalidates by missing the cache
    # rather than needing a purge.
    op.create_table(
        "known_issues_entries",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("model_year", sa.SmallInteger(), nullable=False),
        sa.Column("make", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        # NOT NULL with an empty-string sentinel: NULLs do not compare equal in
        # a unique constraint, so a nullable trim would let every no-trim
        # listing insert its own duplicate row.
        sa.Column("trim", sa.String(128), nullable=False, server_default=""),
        sa.Column("mileage_band", sa.String(16), nullable=False),
        sa.Column("llm_model", sa.String(64), nullable=False),
        sa.Column("prompt_version", sa.SmallInteger(), nullable=False),
        sa.Column("generated_at", TZ, nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("failure_modes", JSONB, nullable=False),
        sa.Column("inspect", JSONB, nullable=False),
        sa.Column("ask", JSONB, nullable=False),
        sa.Column("ownership_notes", JSONB, nullable=False),
        sa.Column(
            "currency_items_dropped", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        # Spec 10's cost instrumentation. served_count is the denominator:
        # cache hits are free, so cost per evaluation is total spend divided by
        # evaluations served, not by calls made.
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_microdollars", sa.Integer(), nullable=True),
        sa.Column("served_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_served_at", TZ, nullable=True),
        sa.UniqueConstraint(
            "model_year",
            "make",
            "model",
            "trim",
            "mileage_band",
            "llm_model",
            "prompt_version",
            name="uq_known_issues_vehicle_key",
        ),
    )


def downgrade() -> None:
    op.drop_table("known_issues_entries")
