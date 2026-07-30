"""The backend half of the trim-level parity check.

The extension has to reduce a trim string to its trim level before a capture is
ever posted -- `shouldWiden` decides whether another search is worth a request,
and the comp search names the trim in its query. The backend does the same
reduction at ingest in `services/vehicle_facts`. Two implementations in two
languages, and nothing in the build makes them agree.

They already disagreed once, and expensively. `widen.ts` stripped nine
stopwords where `vehicle_facts` strips thirty-plus phrases, so the client
treated `coupe`, `sedan` and `sport utility` as trim tokens: a target whose trim
was `Coupe 2D` counted 32 of its 36 comps as the same trim while the backend
counted 0. Measured over 170 stored comp sets the client over-counted by 3.76x,
which satisfied `TRIM_MATCH_TARGET` on 91% of comp sets before widening could
request anything -- the trim clause was unreachable, silently, for as long as it
existed.

So this test reads the TypeScript source and asserts the phrase lists are
identical, the same way `test_contract.py` holds the wire payload to one shape
across the two sides. A phrase added on one side and forgotten on the other
fails here rather than quietly making the extension count differently from the
thing it is trying to predict.
"""

import re
from pathlib import Path

import pytest

from app.services.vehicle_facts import (
    _BODY_STYLE_PHRASES,
    _DRIVETRAIN_PHRASES,
    decompose,
)

TRIM_LEVEL_TS = (
    Path(__file__).resolve().parents[2] / "extension" / "src" / "comps" / "trim-level.ts"
)

#: The exported array this test holds to the Python lists.
_ARRAY_RE = re.compile(
    r"TRIM_BODY_AND_DRIVETRAIN_PHRASES:\s*readonly string\[\]\s*=\s*\[(.*?)\];",
    re.DOTALL,
)


def _typescript_phrases() -> list[str]:
    source = TRIM_LEVEL_TS.read_text()
    match = _ARRAY_RE.search(source)
    assert match is not None, (
        f"Could not find TRIM_BODY_AND_DRIVETRAIN_PHRASES in {TRIM_LEVEL_TS}. "
        "If the constant was renamed or restructured, update this test rather "
        "than deleting it -- the parity it enforces is what stopped the client "
        "counting 3.76x what the backend counts."
    )
    # Comments are stripped FIRST. The comments inside that array quote example
    # trim strings ("EX-L FWD", "quattro"), and a bare literal scan reads those
    # as phrases -- which is how the first version of this test failed against a
    # correct pair of lists.
    body = re.sub(r"//[^\n]*", "", match.group(1))
    return re.findall(r'"([^"]+)"', body)


def test_trim_level_ts_exists():
    assert TRIM_LEVEL_TS.is_file(), f"{TRIM_LEVEL_TS} is missing"


def test_phrase_lists_match_exactly():
    """The client strips exactly what the backend strips -- no more, no less.

    Set equality rather than sequence equality: the TypeScript orders longest
    phrase first so `sport utility` is removed before `suv` can match part of
    something else, while Python groups by category. Order is a property of each
    implementation's removal loop; membership is the contract.
    """
    assert set(_typescript_phrases()) == set(_BODY_STYLE_PHRASES) | set(_DRIVETRAIN_PHRASES)


def test_no_duplicate_phrases_in_typescript():
    phrases = _typescript_phrases()
    assert len(phrases) == len(set(phrases))


def test_multi_word_phrases_precede_their_own_substrings():
    """`sport utility` must be removed before `suv`, `van` or `cab` can fire.

    Removing a one-word phrase first would leave the other word behind as a
    phantom trim token -- which is the class of bug this whole module exists to
    prevent, arrived at from the other direction.
    """
    phrases = _typescript_phrases()
    position = {phrase: i for i, phrase in enumerate(phrases)}
    for phrase in phrases:
        words = phrase.split()
        if len(words) < 2:
            continue
        for word in words:
            if word in position:
                assert position[phrase] < position[word], (
                    f'"{phrase}" must appear before "{word}" in '
                    "TRIM_BODY_AND_DRIVETRAIN_PHRASES, or the shorter phrase "
                    "will strip half of the longer one and leave a phantom "
                    "trim token behind."
                )


@pytest.mark.parametrize(
    "trim_text",
    [
        "Sedan 4D",
        "Coupe 2D",
        "Sport Utility 4D",
        "Convertible",
        "Roadster 2D",
        "Hatchback 4D",
        "Crew Cab Pickup",
    ],
)
def test_body_style_only_trims_reduce_to_nothing(trim_text):
    """The 14% of stored targets whose trim is only a body style.

    Asserted on the Python side because it is the definition the client is
    mirroring: these must be "trim unknown", not a trim that matches every other
    listing sharing the body. `widen.ts`'s `shouldWiden` gates its trim clause
    on this being empty, so a regression here would send those targets chasing a
    trim target they can never reach.
    """
    assert decompose(trim_text).trim_level is None


@pytest.mark.parametrize(
    ("trim_text", "expected"),
    [
        # The engine designator is the client's one deliberate divergence from
        # `trim_tokens` (it follows `decompose` instead), so pin the cases that
        # motivated it: one trim written by two sellers.
        ("2.0i Premium Sport Utility 4D", "premium"),
        ("Premium Sport Utility 4D", "premium"),
        # Body style words that are also real trim names must survive.
        ("Sport Sedan 4D", "sport"),
        ("Touring Sport Utility 4D", "touring"),
        # Drivetrain stripped, but "quattro" is trim branding and stays.
        ("EX-L FWD", "ex l"),
        ("quattro Premium Plus", "quattro premium plus"),
    ],
)
def test_trim_level_examples(trim_text, expected):
    assert decompose(trim_text).trim_level == expected
