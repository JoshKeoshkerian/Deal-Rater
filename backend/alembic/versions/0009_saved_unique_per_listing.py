"""One saved evaluation per user per vehicle, not per capture.

`saved_evaluations` was unique on (user_id, source_capture_id) only. A capture
is one click, so running the tool a second time on a car already saved produced
a second capture id, an empty star, and -- once pressed -- a second row for the
same vehicle. The website showed the car twice with different figures and no
indication which was current. `app/api/saved.py` now matches on the listing;
this is the same rule where a race cannot get past it.

THIS MIGRATION DELETES ROWS. Any duplicate that the old key allowed has to go
before a unique index can exist, and there is no merge to perform: each row is a
whole snapshot of the same vehicle, so the choice is which one to keep. It keeps
the most recently EVALUATED row per (user_id, listing_id) -- the freshest
figures, which is what the surviving card should show -- breaking ties on id.
Run `--sql` first if you want to see the count on your data; the delete is
scoped to rows that share a (user_id, listing_id) with a newer sibling and
touches nothing else.

Rows whose `listing_id` is NULL are untouched and unconstrained. Null there
means retention removed the capture behind the snapshot (spec 8.2), so the row
has no vehicle identity left to be unique on, and a user can legitimately hold
several of them.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-13

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Every saved row that shares a (user_id, listing_id) with a row that was
#: evaluated later. Written as a correlated EXISTS rather than a window function
#: so it runs identically on Postgres and on the SQLite the test suite uses.
_SUPERSEDED = sa.text(
    """
    DELETE FROM saved_evaluations
     WHERE listing_id IS NOT NULL
       AND EXISTS (
             SELECT 1
               FROM saved_evaluations AS newer
              WHERE newer.user_id = saved_evaluations.user_id
                AND newer.listing_id = saved_evaluations.listing_id
                AND (newer.evaluated_at, newer.id)
                  > (saved_evaluations.evaluated_at, saved_evaluations.id)
           )
    """
)


def upgrade() -> None:
    op.execute(_SUPERSEDED)
    op.create_index(
        "uq_saved_user_listing",
        "saved_evaluations",
        ["user_id", "listing_id"],
        unique=True,
        postgresql_where=sa.text("listing_id IS NOT NULL"),
        sqlite_where=sa.text("listing_id IS NOT NULL"),
    )


def downgrade() -> None:
    # The deleted duplicates are not restorable, which is the honest state of a
    # de-duplication: down only removes the constraint.
    op.drop_index("uq_saved_user_listing", table_name="saved_evaluations")
