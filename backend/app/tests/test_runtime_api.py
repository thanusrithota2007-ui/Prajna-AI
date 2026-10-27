"""Meterless Runtime configuration and diagnostics endpoints."""

import httpx
from fastapi.testclient import TestClient

from app.api import runtime as runtime_api
from app.integrations.meterless_runtime import MeterlessRuntimeClient, RuntimeSettingsStore
from app.main import app


def test_status_surfaces_wrong_token_as_unauthorized(monkeypatch, tmp_path):
    store = RuntimeSettingsStore(tmp_path / "settings.json")
    store.update({"meterless_runtime_token": "wrong-token"})
    runtime = MeterlessRuntimeClient(
        transport=httpx.MockTransport(lambda _r: httpx.Response(403)), store=store
    )
    monkeypatch.setattr(runtime_api, "_runtime", runtime)
    response = TestClient(app).get("/agent/runtime/status")
    assert response.status_code == 200
    assert response.json()["status"] == "unauthorized"


def test_config_accepts_connect_link_and_never_returns_token(monkeypatch, tmp_path):
    store = RuntimeSettingsStore(tmp_path / "settings.json")
    monkeypatch.setattr(runtime_api, "_runtime", MeterlessRuntimeClient(store=store))
    response = TestClient(app).put(
        "/agent/runtime/config", json={"base_url": "http://runtime:8088/connect#k=link-secret"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "base_url": "http://runtime:8088/v1", "model": "meterless/auto", "token_configured": True
    }
    assert "link-secret" not in response.text
    assert store.get("meterless_runtime_token") == "link-secret"


def test_test_generation_returns_plain_text_value(monkeypatch, tmp_path):
    def handler(request):
        assert request.headers["authorization"] == "Bearer test-token"
        assert request.headers["meterless-app"] == "upsc-evaluator"
        assert request.headers["meterless-scope"] == "user"
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    store = RuntimeSettingsStore(tmp_path / "settings.json")
    store.update({"meterless_runtime_token": "test-token"})
    monkeypatch.setattr(runtime_api, "_runtime", MeterlessRuntimeClient(transport=httpx.MockTransport(handler), store=store))
    response = TestClient(app).post("/agent/runtime/test-generation", json={"model": "meterless/auto"})
    assert response.status_code == 200 and response.json() == {"status": "ok", "text": "OK"}
