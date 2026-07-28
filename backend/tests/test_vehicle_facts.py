"""Trim decomposition (app/services/vehicle_facts.py).

One `trim_text` string encodes at least four facts. These tests pin the split,
and in particular pin the cases that motivated it: strings that differ only by
an engine designator or a body style were previously reported as different
trims, with no way to tell which half caused it.

Every literal here is a real value from the captured observations.
"""

from __future__ import annotations

import pytest

from app.services.vehicle_facts import DrivetrainSignal, decompose, trim_tokens


class TestDecompose:
    def test_splits_the_four_facts_apart(self):
        facts = decompose("2.0i Premium Sport Utility 4D")
        assert facts.trim_level == "premium"
        assert facts.body_style == "sport_utility"
        assert facts.engine_text == "2.0i"
        assert facts.drivetrain is None

    def test_recovers_drivetrain_stated_in_the_trim(self):
        facts = decompose("Grand Touring AWD")
        assert facts.trim_level == "grand touring"
        assert facts.drivetrain == DrivetrainSignal.AWD.value

    def test_a_bare_trim_yields_a_level_and_nothing_else(self):
        facts = decompose("LX")
        assert facts.trim_level == "lx"
        assert facts.body_style is None
        assert facts.engine_text is None
        assert facts.drivetrain is None

    def test_a_body_style_alone_yields_no_trim_level(self):
        # "Sedan 4D" says nothing about the trim, and reporting "sedan" as the
        # trim level would make every unstated-trim listing look like it
        # matched every other one.
        facts = decompose("Sedan 4D")
        assert facts.trim_level is None
        assert facts.body_style == "sedan"

    def test_nothing_in_nothing_out(self):
        facts = decompose(None)
        assert facts == decompose("")
        assert facts.trim_level is None

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("Touring Sport Utility 4D", "sport_utility"),
            ("Sport SUV 4D", "sport_utility"),
            ("EX Hatchback 4D", "hatchback"),
            ("LX Coupe 2D", "coupe"),
            ("Convertible 2D", "convertible"),
            ("EX-L Minivan 4D", "minivan"),
            ("1500 LT Pickup 4D 5 3/4 ft", "pickup"),
        ],
    )
    def test_normalises_body_styles(self, text: str, expected: str):
        assert decompose(text).body_style == expected

    def test_sport_survives_when_it_is_the_trim_not_the_body(self):
        # "Sport" is a body-style word in "Touring Sport Utility 4D" and a real
        # trim level in "Sport SUV 4D". Captured data writes both.
        assert decompose("Sport SUV 4D").trim_level == "sport"
        assert decompose("Touring Sport Utility 4D").trim_level == "touring"

    def test_strips_the_listing_noise_that_bleeds_into_trim(self):
        assert decompose("LT \U0001f918 74173 Miles").trim_level == "lt"
        assert decompose("GLI Autobahn - 515266A").trim_level == "gli autobahn"
        # The option package is not a trim level: "EX-L w/Honda Sensing" is an
        # EX-L, and treating the package as part of the name splits one trim in
        # two. Punctuation flattens to a space, as it does in `trim_tokens`, so
        # a seller writing "EX L" and one writing "EX-L" land on one value.
        assert decompose("EX-L w/Honda Sensing").trim_level == "ex l"
        assert decompose("EX L").trim_level == decompose("EX-L").trim_level

    def test_a_shorter_trim_is_not_a_longer_one(self):
        # The flattening above must not make EX and EX-L the same trim.
        assert decompose("EX Sedan 4D").trim_level != decompose("EX-L Sedan 4D").trim_level


class TestDecomposeSeparatesWhatEqualityConflated:
    """The pairs that motivated the decomposition, straight from captured data."""

    def test_same_trim_written_with_and_without_the_engine(self):
        # 28 such pairs on one model in captured data. `trim_tokens` calls these
        # different because the engine token survives it; decomposed, the trim
        # level is identical and the difference is attributable to the engine.
        plain = decompose("Premium Sport Utility 4D")
        with_engine = decompose("2.0i Premium Sport Utility 4D")
        assert plain.trim_level == with_engine.trim_level == "premium"
        assert plain.engine_text is None
        assert with_engine.engine_text == "2.0i"

    def test_a_body_mismatch_is_visible_as_a_body_mismatch(self):
        hatch = decompose("EX-L Hatchback 4D")
        sedan = decompose("EX-L Sedan 4D")
        assert hatch.trim_level == sedan.trim_level
        assert hatch.body_style != sedan.body_style

    def test_a_genuine_trim_difference_stays_a_trim_difference(self):
        # The regression this must never cause. Touring and Grand Touring are
        # thousands of dollars apart -- exactly the "large price variance" spec
        # 4.3 warns trim drives.
        assert decompose("Touring Sport Utility 4D").trim_level == "touring"
        assert decompose("Grand Touring Sport Utility 4D").trim_level == "grand touring"

    def test_displacements_do_not_collapse_into_each_other(self):
        # "2.0T" must not tokenise to "0t", which made 2.0T and 3.0T identical.
        assert decompose("2.0T Premium").engine_text == "2.0t"
        assert decompose("3.0T Premium").engine_text == "3.0t"


class TestTrimTokensUnchanged:
    """`trim_tokens` moved modules; its behaviour did not.

    `trims_agree` is calibrated against it and `params.py` forbids moving a
    calibrated threshold without a calibration run, so the move has to be a pure
    relocation.
    """

    def test_body_style_is_still_stripped(self):
        assert trim_tokens("Touring Sport Utility 4D") == trim_tokens("Touring")
        assert trim_tokens("Sport Utility 4D") == frozenset()

    def test_engine_displacement_is_still_preserved(self):
        assert "0t" not in trim_tokens("2.0T Premium")
        assert trim_tokens("2.0T Premium Plus") != trim_tokens("3.0T Premium Plus")

    def test_drivetrain_words_are_still_stripped(self):
        assert trim_tokens("Grand Touring AWD") == trim_tokens("Grand Touring")

    def test_quattro_is_still_branding_not_drivetrain(self):
        assert "quattro" in trim_tokens("2.0 TFSI quattro Premium")
