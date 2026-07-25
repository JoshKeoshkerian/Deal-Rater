from app.services.relisting_key import compute_relisting_key


def key(**overrides) -> str | None:
    base = {
        "year": 2014,
        "make": "Toyota",
        "model": "Camry",
        "mileage": 96_400,
        "location_text": "Tulsa, OK",
    }
    base.update(overrides)
    return compute_relisting_key(**base)


def test_same_vehicle_produces_the_same_key():
    assert key() == key()


def test_mileage_drift_within_a_bucket_still_matches():
    """A relisted car accrues miles and sellers round differently between posts."""
    assert key(mileage=96_400) == key(mileage=99_900)


def test_mileage_across_buckets_does_not_match():
    assert key(mileage=96_400) != key(mileage=104_000)


def test_state_abbreviation_variants_match():
    assert key(location_text="Tulsa, OK") == key(location_text="Tulsa, Oklahoma")


def test_case_and_punctuation_are_normalised():
    assert key(make="TOYOTA", model="camry") == key(make="Toyota", model="Camry")


def test_different_model_does_not_match():
    assert key(model="Corolla") != key(model="Camry")


def test_different_year_does_not_match():
    assert key(year=2015) != key(year=2014)


def test_missing_year_yields_no_key():
    """Better no key than a key that collides across unrelated vehicles."""
    assert key(year=None) is None


def test_missing_model_yields_no_key():
    assert key(model=None) is None


def test_missing_mileage_still_yields_a_key():
    assert key(mileage=None) is not None
