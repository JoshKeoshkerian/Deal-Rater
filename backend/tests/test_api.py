from tests.conftest import capture_payload, observation


def test_post_capture_returns_summary(client):
    comps = [observation(role="comp", source_listing_id=f"9000{i}") for i in range(3)]
    response = client.post("/v1/captures", json=capture_payload(comps=comps))

    assert response.status_code == 201
    body = response.json()
    assert body["observations_written"] == 4
    assert body["listings_ingested"] == 4
    assert body["duplicate"] is False
    assert body["extraction_ok"] is True
    assert body["capture_id"] > 0


def test_replay_returns_the_original_capture(client):
    payload = capture_payload(client_capture_id="22222222-2222-4222-8222-222222222222")

    first = client.post("/v1/captures", json=payload).json()
    second = client.post("/v1/captures", json=payload).json()

    assert second["duplicate"] is True
    assert second["capture_id"] == first["capture_id"]


def test_invalid_payload_is_rejected(client):
    payload = capture_payload(target=observation(vin="IIIIIIIIIIIIIIIII"))
    assert client.post("/v1/captures", json=payload).status_code == 422


def test_oversized_comp_set_is_rejected(client):
    comps = [observation(role="comp", source_listing_id=str(i)) for i in range(201)]
    response = client.post("/v1/captures", json=capture_payload(comps=comps))
    assert response.status_code == 413


def test_evaluation_surfaces_a_low_seller_rating(client):
    # End-to-end for the seller-rating direct modifier (spec 6.3 build step
    # 5): a listing with plenty of comps below, so a price residual and
    # therefore a score exist to be capped.
    comps = [
        observation(
            role="comp",
            source_listing_id=f"81000{i}",
            price_cents=1_290_000 - i * 5_000,
            mileage=96_400 + i * 3_000,
        )
        for i in range(10)
    ]
    target = observation(
        seller={
            "seller_hash": "b" * 64,
            "hash_version": 1,
            "active_vehicle_listing_count": 1,
            "rating_average": 2.4,
            "rating_count": 7,
        },
    )
    post = client.post("/v1/captures", json=capture_payload(target=target, comps=comps))
    capture_id = post.json()["capture_id"]

    response = client.get(f"/v1/evaluations/{capture_id}?offline=true")
    assert response.status_code == 200
    seller_risk = response.json()["seller_risk"]
    assert seller_risk is not None
    assert seller_risk["seller_rating_average"] == 2.4
    assert seller_risk["seller_rating_count"] == 7
    assert any("2.4/5 star rating from 7 reviews" in m for m in seller_risk["messages"])


def test_evaluation_always_carries_helpful_links(client):
    # Additive (app/links/builder.py, build step 12): no minimum-comp or
    # confidence gate, so this is present even with zero comps -- unlike
    # every other section in this payload.
    post = client.post("/v1/captures", json=capture_payload(comps=[]))
    capture_id = post.json()["capture_id"]

    response = client.get(f"/v1/evaluations/{capture_id}?offline=true")
    assert response.status_code == 200
    links = response.json()["helpful_links"]
    by_label = {link["label"]: link for link in links}
    assert by_label.keys() == {"Kelley Blue Book", "Consumer Reports"}
    # The default fixture target is a clean 2014 Toyota Camry, so both should
    # resolve to a direct model page rather than a fallback landing page.
    assert by_label["Kelley Blue Book"]["url"] == "https://www.kbb.com/toyota/camry/2014/"
    assert (
        by_label["Consumer Reports"]["url"]
        == "https://www.consumerreports.org/cars/toyota/camry/2014/overview/"
    )
    assert all(link["note"] for link in links)


def test_api_has_no_client_specific_behaviour(client):
    """Spec 8.1.4: the backend stays independent of the extension. A different
    client name must be handled identically."""
    payload = capture_payload()
    payload["client"] = {"name": "web-paste-url", "version": "0.0.1"}

    response = client.post("/v1/captures", json=payload)
    assert response.status_code == 201
    assert response.json()["observations_written"] == 1


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_extraction_health_reports_field_fill_rates(client):
    client.post("/v1/captures", json=capture_payload())
    client.post(
        "/v1/captures",
        json=capture_payload(
            target=observation(source_listing_id="123", mileage=None, price_cents=None),
            extraction_report=[
                {
                    "scope": "target",
                    "field_name": "mileage",
                    "status": "missing",
                    "expectation": "expected",
                    "strategies_attempted": ["json_payload", "text_pattern"],
                    "page_signature": "sig-a",
                },
                {
                    "scope": "target",
                    "field_name": "listing_payload",
                    "status": "missing",
                    "expectation": "required",
                    "strategies_attempted": ["json_payload"],
                    "page_signature": "sig-a",
                },
            ],
        ),
    )

    body = client.get("/v1/telemetry/extraction-health?days=365").json()

    assert body["captures"] == 2
    # Only the `required` failure counts as breakage.
    assert body["captures_with_issues"] == 1

    mileage = next(f for f in body["fields"] if f["field_name"] == "mileage")
    assert mileage["observed"] == 2
    assert mileage["populated"] == 1
    assert mileage["fill_rate"] == 0.5

    issues = {i["field_name"]: i for i in body["issues"]}
    assert issues["mileage"]["count"] == 1
    assert issues["mileage"]["expectation"] == "expected"


def test_extraction_health_reports_strategy_mix(client):
    """The early-warning signal: which tier is actually producing each field."""
    client.post("/v1/captures", json=capture_payload())
    client.post(
        "/v1/captures",
        json=capture_payload(
            target=observation(
                source_listing_id="456",
                field_strategies={"price_cents": "text_pattern"},
            )
        ),
    )

    body = client.get("/v1/telemetry/extraction-health?days=365").json()
    mix = {(m["field_name"], m["strategy"]): m["count"] for m in body["strategy_mix"]}

    assert mix[("price_cents", "json_payload")] == 1
    assert mix[("price_cents", "text_pattern")] == 1
