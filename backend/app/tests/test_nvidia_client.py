"""NVIDIA OpenAI-compatible provider tests use only mocked HTTP responses."""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import Settings, settings
from app.integrations.meterless_runtime import MeterlessRuntimeClient, ModelUnavailable
from app.integrations.model_provider import create_model_client
from app.integrations.nvidia_client import NvidiaClient
from app.services.evaluator import evaluate


def _evaluation_json() -> str:
    answer = "Federalism shares power between the Union and states."
    criteria = [
        {
            "key": key,
            "score": score,
            "feedback": "Specific feedback.",
            "evidence": [{"quote": "shares power", "comment": "Relevant evidence."}],
            "suggestions": ["Add a constitutional example."],
        }
        for key, score in (
            ("clarity_of_thought", 7),
            ("depth_of_analysis", 8),
            ("language_and_expression", 6),
        )
    ]
    assert answer
    return json.dumps({"criteria": criteria})


def test_provider_factory_keeps_meterless_as_default(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "meterless")
    assert isinstance(create_model_client(), MeterlessRuntimeClient)


def test_provider_factory_selects_nvidia(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "nvidia")
    assert isinstance(create_model_client(), NvidiaClient)


async def test_nvidia_uses_configured_endpoint_model_and_bearer_without_meterless_headers(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_base_url", "https://nvidia.example/v1/")
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "meta/llama-test")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}]})

    result = await NvidiaClient(transport=httpx.MockTransport(handler)).complete("system", "user")
    assert result == "hello"
    assert seen["url"] == "https://nvidia.example/v1/chat/completions"
    assert seen["headers"]["authorization"] == "Bearer unit-test-api-key"
    assert "meterless-app" not in seen["headers"]
    assert "meterless-scope" not in seen["headers"]
    assert seen["body"]["model"] == "meta/llama-test"
    assert seen["body"]["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "user"},
    ]


async def test_nvidia_json_content_runs_through_existing_evaluator(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "meta/llama-test")
    payload = _evaluation_json()
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"choices": [{"message": {"content": payload}}]})
    )

    result = await evaluate(
        NvidiaClient(transport=transport),
        "Discuss federalism.",
        "Federalism shares power between the Union and states.",
        "eval-1",
    )
    assert result.evaluation_id == "eval-1"
    assert result.overall_score == 7.0
    assert len(result.criteria) == 3
    assert all(item.evidence[0].verified for item in result.criteria)


async def test_missing_nvidia_credentials_fail_safely_without_network(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "")
    monkeypatch.setattr(settings, "nvidia_model", "meta/llama-test")
    client = NvidiaClient(transport=httpx.MockTransport(lambda _request: pytest.fail("unexpected HTTP call")))

    with pytest.raises(ModelUnavailable, match="NVIDIA_API_KEY is not configured") as error:
        await client.complete("system", "user")
    assert "unit-test-api-key" not in str(error.value)


async def test_missing_nvidia_model_has_safe_configuration_error(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "")
    with pytest.raises(ModelUnavailable, match="NVIDIA_MODEL is not configured"):
        await NvidiaClient().complete("system", "user")


@pytest.mark.parametrize("status", [401, 403])
async def test_nvidia_authentication_errors_are_sanitized(monkeypatch, status):
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "nvidia/nemotron-3.5-lightning-30b-a3b")
    client = NvidiaClient(transport=httpx.MockTransport(lambda _request: httpx.Response(status, text="secret detail")))

    with pytest.raises(ModelUnavailable, match="NVIDIA rejected the API credentials") as error:
        await client.complete("system", "user")
    assert "unit-test-api-key" not in str(error.value)
    assert "secret detail" not in str(error.value)


@pytest.mark.parametrize("status", [429, 500])
async def test_nvidia_api_errors_are_sanitized(monkeypatch, status):
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "nvidia/nemotron-3.5-lightning-30b-a3b")
    client = NvidiaClient(transport=httpx.MockTransport(lambda _request: httpx.Response(status, text="private error")))

    with pytest.raises(ModelUnavailable, match="NVIDIA request failed") as error:
        await client.complete("system", "user")
    assert "unit-test-api-key" not in str(error.value)
    assert "private error" not in str(error.value)


async def test_nvidia_timeout_is_reported_without_exposing_request_details(monkeypatch):
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "nvidia/nemotron-3.5-lightning-30b-a3b")

    def timeout(_request):
        raise httpx.ReadTimeout("private transport details")

    with pytest.raises(ModelUnavailable, match="NVIDIA request failed") as error:
        await NvidiaClient(transport=httpx.MockTransport(timeout)).complete("system", "user")
    assert "unit-test-api-key" not in str(error.value)
    assert "private transport details" not in str(error.value)


@pytest.mark.parametrize("payload", [{}, {"choices": []}, {"choices": [{"message": {"content": None}}]}])
async def test_nvidia_invalid_or_empty_response_is_rejected(monkeypatch, payload):
    monkeypatch.setattr(settings, "nvidia_api_key", "unit-test-api-key")
    monkeypatch.setattr(settings, "nvidia_model", "nvidia/nemotron-3.5-lightning-30b-a3b")
    client = NvidiaClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=payload)))

    with pytest.raises(ModelUnavailable, match="NVIDIA"):
        await client.complete("system", "user")


def test_backend_env_overrides_root_env(tmp_path):
    root_env = tmp_path / "root.env"
    backend_env = tmp_path / "backend.env"
    root_env.write_text("NVIDIA_MODEL=root-model\n", encoding="utf-8")
    backend_env.write_text("NVIDIA_MODEL=backend-model\n", encoding="utf-8")

    loaded = Settings(_env_file=(root_env, backend_env))
    assert loaded.nvidia_model == "backend-model"
