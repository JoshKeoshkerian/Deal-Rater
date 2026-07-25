"""Initial capture/observation schema.

Revision ID: 0001
Revises:
Create Date: 2026-07-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB()
TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "captures",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("client_capture_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("client_name", sa.String(64), nullable=False),
        sa.Column("client_version", sa.String(32), nullable=False),
        sa.Column("captured_at", TZ, nullable=False),
        sa.Column("received_at", TZ, nullable=False),
        sa.Column("comp_search_query", JSONB, nullable=True),
        sa.Column("comp_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extraction_ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("client_capture_id", name="uq_captures_client_capture_id"),
    )
    op.create_index("ix_captures_captured_at", "captures", ["captured_at"])

    op.create_table(
        "listings",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "source", sa.String(64), nullable=False, server_default="facebook_marketplace"
        ),
        sa.Column("source_listing_id", sa.String(128), nullable=False),
        sa.Column("first_observed_at", TZ, nullable=False),
        sa.Column("last_observed_at", TZ, nullable=False),
        sa.Column("vin", sa.String(17), nullable=True),
        sa.Column("relisting_key", sa.String(40), nullable=True),
        sa.UniqueConstraint("source", "source_listing_id", name="uq_listings_source_id"),
    )
    op.create_index("ix_listings_vin", "listings", ["vin"])
    op.create_index("ix_listings_relisting_key", "listings", ["relisting_key"])

    op.create_table(
        "sellers",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("seller_hash", sa.String(64), nullable=False),
        sa.Column("hash_version", sa.SmallInteger(), nullable=False),
        sa.Column("first_seen_at", TZ, nullable=False),
        sa.Column("last_seen_at", TZ, nullable=False),
        sa.UniqueConstraint("seller_hash", "hash_version", name="uq_sellers_hash_version"),
    )

    op.create_table(
        "listing_observations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("listing_id", sa.BigInteger(), nullable=False),
        sa.Column("capture_id", sa.BigInteger(), nullable=False),
        sa.Column("observed_at", TZ, nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(8), nullable=True),
        sa.Column("mileage", sa.Integer(), nullable=True),
        sa.Column("mileage_unit", sa.String(4), nullable=True),
        sa.Column("year", sa.SmallInteger(), nullable=True),
        sa.Column("make", sa.String(64), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("trim_text", sa.String(128), nullable=True),
        sa.Column("title_status", sa.String(32), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("photo_count", sa.Integer(), nullable=True),
        sa.Column("posted_at", TZ, nullable=True),
        sa.Column("posted_relative_text", sa.String(64), nullable=True),
        sa.Column("price_changed", sa.Boolean(), nullable=True),
        sa.Column("location_text", sa.String(255), nullable=True),
        sa.Column("latitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("longitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("listing_url", sa.Text(), nullable=True),
        sa.Column("seller_id", sa.BigInteger(), nullable=True),
        sa.Column("field_strategies", JSONB, nullable=False, server_default="{}"),
        sa.Column("raw_extract", JSONB, nullable=True),
        sa.ForeignKeyConstraint(["listing_id"], ["listings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["capture_id"], ["captures.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["seller_id"], ["sellers.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("listing_id", "capture_id", name="uq_observation_listing_capture"),
        sa.CheckConstraint("role IN ('target','comp')", name="ck_observation_role"),
    )
    op.create_index(
        "ix_observations_listing_time", "listing_observations", ["listing_id", "observed_at"]
    )
    op.create_index("ix_observations_capture", "listing_observations", ["capture_id"])
    op.create_index("ix_observations_seller", "listing_observations", ["seller_id"])
    op.create_index("ix_observations_observed_at", "listing_observations", ["observed_at"])

    op.create_table(
        "seller_observations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("seller_id", sa.BigInteger(), nullable=False),
        sa.Column("capture_id", sa.BigInteger(), nullable=False),
        sa.Column("observed_at", TZ, nullable=False),
        sa.Column("active_vehicle_listing_count", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["seller_id"], ["sellers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["capture_id"], ["captures.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("seller_id", "capture_id", name="uq_seller_observation_capture"),
    )
    op.create_index("ix_seller_observations_time", "seller_observations", ["observed_at"])

    op.create_table(
        "extraction_reports",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("capture_id", sa.BigInteger(), nullable=False),
        sa.Column("observed_at", TZ, nullable=False),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("field_name", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("expectation", sa.String(16), nullable=False),
        sa.Column("strategies_attempted", JSONB, nullable=True),
        sa.Column("page_signature", sa.String(64), nullable=True),
        sa.ForeignKeyConstraint(["capture_id"], ["captures.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_reports_capture", "extraction_reports", ["capture_id"])
    op.create_index("ix_reports_field_time", "extraction_reports", ["field_name", "observed_at"])


def downgrade() -> None:
    op.drop_table("extraction_reports")
    op.drop_table("seller_observations")
    op.drop_table("listing_observations")
    op.drop_table("sellers")
    op.drop_table("listings")
    op.drop_table("captures")
