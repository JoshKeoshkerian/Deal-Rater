"""NHTSA vPIC decode and vehicle safety caches (spec 4.2, 10).

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB()
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    # No expiry: spec 10 caches VIN decodes indefinitely, because the
    # VIN-to-specification mapping never changes.
    op.create_table(
        "vin_decodes",
        sa.Column("vin", sa.String(17), primary_key=True),
        sa.Column("decoded_at", TZ, nullable=False),
        sa.Column("make", sa.String(64), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("model_year", sa.SmallInteger(), nullable=True),
        sa.Column("trim", sa.String(128), nullable=True),
        sa.Column("series", sa.String(128), nullable=True),
        sa.Column("drive_type", sa.String(32), nullable=True),
        sa.Column("transmission", sa.String(64), nullable=True),
        sa.Column("engine_cylinders", sa.SmallInteger(), nullable=True),
        sa.Column("displacement_l", sa.Numeric(4, 1), nullable=True),
        sa.Column("body_class", sa.String(128), nullable=True),
        sa.Column("fuel_type", sa.String(64), nullable=True),
        sa.Column("error_code", sa.String(32), nullable=True),
        sa.Column("raw", JSONB, nullable=True),
    )

    # Keyed by year/make/model, not VIN: NHTSA's free recall API is model-level.
    # See the model docstring for why that distinction is load-bearing.
    op.create_table(
        "vehicle_safety_lookups",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("model_year", sa.SmallInteger(), nullable=False),
        sa.Column("make", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("fetched_at", TZ, nullable=False),
        sa.Column("recall_count", sa.Integer(), nullable=True),
        sa.Column("complaint_count", sa.Integer(), nullable=True),
        sa.Column("complaints_by_component", JSONB, nullable=True),
        sa.Column("recalls", JSONB, nullable=True),
        sa.UniqueConstraint("model_year", "make", "model", name="uq_safety_year_make_model"),
    )


def downgrade() -> None:
    op.drop_table("vehicle_safety_lookups")
    op.drop_table("vin_decodes")
