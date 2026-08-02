"""`POST /v1/evaluations/{capture_id}/known-issues` -- the AI Insights click.

Unlike `GET /v1/evaluations/{capture_id}` (tested in `test_api.py`), this route
never touches NHTSA -- it only loads the capture and runs spec 6.6's gate and
call -- so, unlike that route, these tests exercise it WITHOUT `offline=true`
and still never reach the network: the one function that would (`_call_model`)
is monkeypatched, exactly as in `test_known_issues.py`.
"""

from __future__ import annotations

from app.config import Settings
from app.known_issues import client as ki_client
from app.known_issues.client import _Completion
from app.known_issues.prompt import KnownIssuesReport
from tests.conftest import capture_payload, observation


def settings(**overrides) -> Settings:
    base = {
        "anthropic_api_key": "sk-ant-test",
        "known_issues_model": "claude-haiku-4-5",
        "known_issues_enabled": True,
    }
    base.update(overrides)
    return Settings(**base)


def report(**overrides) -> KnownIssuesReport:
    base = {
        "summary": "This generation is generally durable, with one known weak point.",
        "failure_modes": ["The dual-clutch transmission shudders at low speed."],
        "inspect": ["Drive it from a stop in traffic and feel for shudder."],
        "ask": ["Ask whether the clutch pack has been replaced."],
        "ownership_notes": ["Transmission work on this car is dealer-only in most areas."],
    }
    base.update(overrides)
    return KnownIssuesReport(**base)


def stub_model(monkeypatch, *, cfg=None):
    """Route `app.api.evaluations.get_settings` and `_call_model`, and return
    the list `_call_model` calls will be appended to."""
    calls: list = []
    monkeypatch.setattr("app.api.evaluations.get_settings", lambda: cfg or settings())
    monkeypatch.setattr(
        ki_client, "_call_model", lambda **kwargs: (calls.append(kwargs), _Completion(
            report=report(), input_tokens=1200, output_tokens=300,
        ))[1]
    )
    return calls


def test_404_for_a_missing_capture(client, monkeypatch):
    stub_model(monkeypatch)
    response = client.post("/v1/evaluations/999999/known-issues")
    assert response.status_code == 404


def test_gate_declined_returns_the_verdict_and_calls_nothing(client, monkeypatch):
    calls = stub_model(monkeypatch)
    post = client.post(
        "/v1/captures", json=capture_payload(target=observation(title_status="salvage"))
    )
    capture_id = post.json()["capture_id"]

    response = client.post(f"/v1/evaluations/{capture_id}/known-issues")
    assert response.status_code == 200
    body = response.json()
    assert body["known_issues"] is None
    assert body["known_issues_unavailable_code"] == "title_disqualifier"
    assert calls == []


def test_a_fresh_vehicle_generates_and_returns_the_answer(client, monkeypatch):
    calls = stub_model(monkeypatch)
    post = client.post("/v1/captures", json=capture_payload())
    capture_id = post.json()["capture_id"]

    response = client.post(f"/v1/evaluations/{capture_id}/known-issues")
    assert response.status_code == 200
    body = response.json()
    assert body["known_issues"]["summary"] == report().summary
    assert body["known_issues"]["cached"] is False
    assert body["known_issues_unavailable_reason"] is None
    assert len(calls) == 1


def test_a_second_click_for_the_same_vehicle_is_free(client, monkeypatch):
    calls = stub_model(monkeypatch)
    post = client.post("/v1/captures", json=capture_payload())
    capture_id = post.json()["capture_id"]

    first = client.post(f"/v1/evaluations/{capture_id}/known-issues")
    assert len(calls) == 1

    second = client.post(f"/v1/evaluations/{capture_id}/known-issues")
    assert second.json()["known_issues"]["cached"] is True
    assert len(calls) == 1  # unchanged -- the second click never called the model

    assert first.json()["known_issues"]["summary"] == second.json()["known_issues"]["summary"]


def test_disabled_reports_a_reason_and_calls_nothing(client, monkeypatch):
    calls = stub_model(monkeypatch, cfg=settings(known_issues_enabled=False))
    post = client.post("/v1/captures", json=capture_payload())
    capture_id = post.json()["capture_id"]

    response = client.post(f"/v1/evaluations/{capture_id}/known-issues")
    assert response.json()["known_issues"] is None
    assert response.json()["known_issues_unavailable_code"] == "deployment_disabled"
    assert calls == []


def test_the_eager_get_defers_while_this_route_generates(client, monkeypatch):
    # The whole point of the feature: a plain page load never pays, and only
    # this route does. `?offline=true` on the GET keeps it free of real NHTSA
    # calls (see test_api.py); it isn't needed here since this route never
    # touches NHTSA at all.
    calls = stub_model(monkeypatch)
    post = client.post("/v1/captures", json=capture_payload())
    capture_id = post.json()["capture_id"]

    eager = client.get(f"/v1/evaluations/{capture_id}?offline=true")
    assert eager.json()["known_issues"] is None
    assert eager.json()["known_issues_pending"] is False  # offline reports its own reason
    assert eager.json()["known_issues_unavailable_code"] == "deployment_offline"
    assert calls == []

    clicked = client.post(f"/v1/evaluations/{capture_id}/known-issues")
    assert clicked.json()["known_issues"] is not None
    assert len(calls) == 1
