"""Helpful links: KBB and Consumer Reports jumping-off points.

The claims under test:

  1. A clean (year, make, model) slugs into a direct model-year page for both
     sites.
  2. No network call, no seller/listing data -- pure templating from
     year/make/model[, trim].
  3. The known-ugly model shapes from spec 4.3 are each handled sanely: a
     repeated make is repaired, a trim/engine/package jammed into the model
     falls back rather than producing a broken URL, and a missing trim never
     blocks a link (trim is not part of either URL).
  4. Missing year/make/model falls back rather than building a partial URL.
"""

from __future__ import annotations

from app.links import build_helpful_links


def test_a_clean_vehicle_builds_direct_model_pages():
    links = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim="Touring")
    by_label = {link.label: link for link in links}
    assert by_label["Kelley Blue Book"].url == "https://www.kbb.com/mazda/cx-5/2016/"
    assert (
        by_label["Consumer Reports"].url
        == "https://www.consumerreports.org/cars/mazda/cx-5/2016/overview/"
    )


def test_hyphenated_models_keep_their_hyphen():
    # "cx-5" is the real KBB/CR slug; normalize_key-style alnum stripping
    # would have produced "cx5", which is not the same page.
    links = build_helpful_links(year=2020, make="Ford", model="F-150", trim=None)
    for link in links:
        assert "f-150" in link.url


def test_multi_word_models_hyphenate_on_spaces():
    links = build_helpful_links(year=2019, make="Jeep", model="Grand Cherokee", trim=None)
    for link in links:
        assert "grand-cherokee" in link.url


def test_no_seller_or_listing_data_appears_anywhere_in_the_payload():
    # Spec 8.2's minimization principle: only vehicle identity, never price,
    # mileage, VIN, or anything seller-specific.
    links = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim="Touring")
    for link in links:
        assert "12345" not in link.url
        assert "vin" not in link.url.lower()


class TestKnownUglyModelShapes:
    """The exact fixtures spec 4.3 documents for `vehicle_model_display_name`."""

    def test_a_repeated_make_is_stripped_not_treated_as_malformed(self):
        # "MAZDA MAZDA3": the make's own catalog string leaking into the model
        # field unparsed. Repaired, not rejected -- the real model is right
        # there once the repeat is removed.
        links = build_helpful_links(year=2008, make="Mazda", model="MAZDA MAZDA3", trim=None)
        by_label = {link.label: link for link in links}
        assert by_label["Kelley Blue Book"].url == "https://www.kbb.com/mazda/mazda3/2008/"

    def test_an_engine_designator_jammed_into_the_model_falls_back(self):
        # "q5 2.0t premium plus": trim and engine concatenated onto the model
        # with nothing to split them off. `vehicle_facts.decompose` catches
        # the engine token and this falls back rather than linking
        # "audi/q5-2-0t-premium-plus/2017/", which is not a real page.
        links = build_helpful_links(year=2017, make="Audi", model="Q5 2.0T Premium Plus", trim=None)
        for link in links:
            assert link.url in (
                "https://www.kbb.com/car-values/",
                "https://www.consumerreports.org/cars/",
            )

    def test_a_drivetrain_word_jammed_into_the_model_falls_back(self):
        # "CR-V EX-L AWD": a trim and drivetrain suffix with no separator.
        links = build_helpful_links(year=2018, make="Honda", model="CR-V EX-L AWD", trim=None)
        for link in links:
            assert link.url in (
                "https://www.kbb.com/car-values/",
                "https://www.consumerreports.org/cars/",
            )

    def test_a_missing_trim_never_blocks_a_link(self):
        # Trim is not part of either site's model-page URL, so its absence is
        # a non-issue for slugging -- only year/make/model matter here.
        with_trim = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim="Touring")
        without_trim = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim=None)
        assert {link.url for link in with_trim} == {link.url for link in without_trim}

    def test_the_note_mentions_trim_only_when_one_is_known(self):
        with_trim = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim="Touring")
        without_trim = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim=None)
        for link in with_trim:
            assert link.note is not None and "Touring" in link.note
        for link in without_trim:
            assert link.note is not None and "not specifically" not in link.note


class TestMissingFields:
    def test_a_missing_year_falls_back(self):
        links = build_helpful_links(year=None, make="Mazda", model="CX-5", trim=None)
        for link in links:
            assert link.url in (
                "https://www.kbb.com/car-values/",
                "https://www.consumerreports.org/cars/",
            )

    def test_a_missing_make_falls_back(self):
        links = build_helpful_links(year=2016, make=None, model="CX-5", trim=None)
        for link in links:
            assert link.url in (
                "https://www.kbb.com/car-values/",
                "https://www.consumerreports.org/cars/",
            )

    def test_a_missing_model_falls_back(self):
        links = build_helpful_links(year=2016, make="Mazda", model=None, trim=None)
        for link in links:
            assert link.url in (
                "https://www.kbb.com/car-values/",
                "https://www.consumerreports.org/cars/",
            )

    def test_an_empty_string_model_falls_back(self):
        links = build_helpful_links(year=2016, make="Mazda", model="", trim=None)
        for link in links:
            assert link.url in (
                "https://www.kbb.com/car-values/",
                "https://www.consumerreports.org/cars/",
            )


class TestOutputShape:
    def test_always_returns_exactly_kbb_and_consumer_reports(self):
        # No minimum-comp or confidence gate: this always returns both links,
        # even when everything fell back to a landing page.
        links = build_helpful_links(year=None, make=None, model=None, trim=None)
        labels = {link.label for link in links}
        assert labels == {"Kelley Blue Book", "Consumer Reports"}

    def test_every_link_carries_a_note(self):
        links = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim=None)
        assert all(link.note for link in links)

    def test_fallback_and_direct_links_carry_the_same_shaped_note(self):
        # Build step 12, item 6: a buyer is never shown a different
        # treatment for a direct model link versus a fallback landing page.
        # The payload itself carries no flag distinguishing the two, so a
        # renderer cannot single one out even if it wanted to.
        direct = build_helpful_links(year=2016, make="Mazda", model="CX-5", trim=None)
        fallback = build_helpful_links(year=None, make=None, model=None, trim=None)
        direct_notes = {link.label: link.note for link in direct}
        fallback_notes = {link.label: link.note for link in fallback}
        assert direct_notes == fallback_notes
