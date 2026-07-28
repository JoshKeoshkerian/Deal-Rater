"""Seller star rating on seller_observations (spec 6.3 seller signal).

The rating and review count Marketplace already renders on the listing page
itself -- a reputation number, not identity, so it is exempt from spec 8.2's
"never collected" list the same way active_vehicle_listing_count already was.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-28

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "seller_observations",
        sa.Column("rating_average", sa.Numeric(3, 2), nullable=True),
    )
    op.add_column(
        "seller_observations",
        sa.Column("rating_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("seller_observations", "rating_count")
    op.drop_column("seller_observations", "rating_average")
