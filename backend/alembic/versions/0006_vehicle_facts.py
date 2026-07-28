"""Decomposed trim columns, trim provenance, seller type and transmission.

`trim_text` is one free-text column encoding at least four facts ("2.0i Premium
Sport Utility 4D" is trim level Premium, body sport_utility, engine 2.0i), and
comparing whole strings made a body-style mismatch indistinguishable from a
trim-level one. These columns split it apart; `trim_text` itself is unchanged
and remains the verbatim audit trail.

`seller_type` and `transmission` are payload fields Facebook always exposed and
the extractor never read, because `FB_KEYS` searched for `vehicle_trim` /
`vehicle_seller_type` while the real keys are `vehicle_trim_display_name` /
`vehicle_seller_type`. They are NULL on every row captured before that fix, and
`app.cli.backfill_vehicle_facts` deliberately does not invent them -- only the
trim columns are recoverable offline, from `raw_extract.title`.

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-28

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Every column is nullable with no server default: absent is the honest value
#: for the rows already stored, and a default would make "not captured" and
#: "captured as empty" the same thing.
_COLUMNS = (
    ("trim_level", sa.String(128)),
    ("body_style", sa.String(32)),
    ("engine_text", sa.String(16)),
    ("drivetrain", sa.String(8)),
    ("trim_source", sa.String(16)),
    ("seller_type", sa.String(32)),
    ("transmission", sa.String(32)),
)


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column("listing_observations", sa.Column(name, type_, nullable=True))

    # Comp filtering reads trim_level for every candidate in a capture, and the
    # backfill scans the table whole.
    op.create_index(
        "ix_observations_trim_level",
        "listing_observations",
        ["trim_level"],
    )


def downgrade() -> None:
    op.drop_index("ix_observations_trim_level", table_name="listing_observations")
    for name, _ in reversed(_COLUMNS):
        op.drop_column("listing_observations", name)
