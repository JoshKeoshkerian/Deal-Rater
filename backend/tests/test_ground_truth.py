"""Ground truth labelling and agreement scoring (spec 9.1).

The behaviour these tests protect is mostly REFUSAL. Step 3's success criterion
is agreement with manual assessment, and the failure mode worth guarding against
is the tooling producing a confident-looking number when the evidence for it
does not exist.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.cli import agreement as agreement_cli
from app.cli import label as label_cli
from app.models import Capture, GroundTruthLabel, Listing, ListingObservation


@pytest.fixture
def capture_with_target(session):
    capture = Capture(
        client_capture_id="11111111-1111-1111-1111-111111111111",
        client_name="test",
        client_version="0",
        captured_at=datetime.now(UTC),
        received_at=datetime.now(UTC),
        comp_count=0,
    )
    listing = Listing(
        source="facebook_marketplace",
        source_listing_id="900001",
        first_observed_at=datetime.now(UTC),
        last_observed_at=datetime.now(UTC),
    )
    session.add_all([capture, listing])
    session.flush()

    obs = ListingObservation(
        listing_id=listing.id,
        capture_id=capture.id,
        observed_at=datetime.now(UTC),
        role="target",
        price_cents=1_100_000,
        mileage=120_000,
        year=2016,
        make="Mazda",
        model="CX-5",
        field_strategies={},
    )
    session.add(obs)
    session.commit()
    return obs


class TestLabelSchema:
    def test_a_label_attaches_to_an_observation_not_a_listing(self, session, capture_with_target):
        # A verdict is a verdict about a PRICE. Pinned to the listing it would
        # silently become a claim about a different offer after a price drop.
        label = GroundTruthLabel(
            observation_id=capture_with_target.id,
            label="fair",
            labeler="tester",
            labeled_at=datetime.now(UTC),
        )
        session.add(label)
        session.commit()
        assert label.observation_id == capture_with_target.id

    def test_one_verdict_per_labeller_per_observation(self, session, capture_with_target):
        for _ in range(2):
            session.add(
                GroundTruthLabel(
                    observation_id=capture_with_target.id,
                    label="fair",
                    labeler="tester",
                    labeled_at=datetime.now(UTC),
                )
            )
        with pytest.raises(IntegrityError):
            session.commit()

    def test_two_labellers_may_disagree_on_one_observation(self, session, capture_with_target):
        session.add_all(
            [
                GroundTruthLabel(
                    observation_id=capture_with_target.id,
                    label="fair",
                    labeler="a",
                    labeled_at=datetime.now(UTC),
                ),
                GroundTruthLabel(
                    observation_id=capture_with_target.id,
                    label="overpriced",
                    labeler="b",
                    labeled_at=datetime.now(UTC),
                ),
            ]
        )
        session.commit()
        assert len(session.scalars(select(GroundTruthLabel)).all()) == 2


class TestAgreementRefuses:
    def test_it_refuses_when_no_labels_exist(self, session, capsys):
        # The state this repo is actually in. Spec 13.3's success criterion
        # cannot be evaluated, and the tool says so rather than inventing a set.
        code = agreement_cli.run(session, labeler=None)
        assert code == 1
        assert "does not exist yet" in capsys.readouterr().err

    def test_it_refuses_to_score_too_few_labels(self, session, capture_with_target, capsys):
        session.add(
            GroundTruthLabel(
                observation_id=capture_with_target.id,
                label="fair",
                labeler="tester",
                labeled_at=datetime.now(UTC),
            )
        )
        session.commit()
        code = agreement_cli.run(session, labeler=None)
        assert code == 1
        out = capsys.readouterr().out
        assert "REFUSING TO REPORT AN AGREEMENT FIGURE" in out

    def test_the_floor_is_below_the_spec_target(self):
        # Spec 9.1 asks for 50-100. The scorer's floor is lower so that a
        # partial set can still be inspected, but it must not exceed the target.
        assert agreement_cli.MIN_LABELS_TO_SCORE < 50


class TestVerdictMapping:
    def test_the_model_cannot_produce_avoid(self):
        # "avoid" is a vehicle- and seller-risk verdict (spec 6.2, 6.3), which
        # are build steps 5 and 6. The pricing dimension cannot express it, and
        # the scorer reports those rows separately rather than as plain misses.
        from app.pricing.curve import rate_price_residual

        verdicts = {
            agreement_cli.model_verdict(rate_price_residual(r / 100))
            for r in range(-95, 60)
        }
        assert "avoid" not in verdicts

    def test_no_rating_yields_no_verdict(self):
        assert agreement_cli.model_verdict(None) is None


class TestLabelStatus:
    def test_status_reports_honestly_against_the_spec_target(self, session, capture_with_target,
                                                             capsys):
        label_cli.run_status(session)
        out = capsys.readouterr().out
        assert "50" in out
        assert "cannot reach 50 without capturing more" in out

    def test_the_label_vocabulary_matches_the_spec(self):
        assert set(label_cli.LABELS.values()) == {"good_deal", "fair", "overpriced", "avoid"}
