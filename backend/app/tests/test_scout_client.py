"""Scout client + contract verification + Nightshift client. No live services needed."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.core.config import settings
from app.integrations.meterless_runtime import (
    APP_ID, TOKEN_KEY, MeterlessRuntimeClient, ModelUnavailable,
    RuntimeSettingsStore, normalize_base_url,
)
from app.integrations.scout_client import (
    ContractInvalid,
    ScoutClient,
    ScoutUnavailable,
    canonical_json,
    contract_signature,
    verify_contract,
)

# Same fixed contract and secret as scout/test/scout.test.ts ("golden vector").
GOLDEN_CONTRACT = {
    "contractId": "01TESTULID", "traceId": "t-1",
    "intent": {"primary": {"id": "upsc.evaluate", "version": 1}, "parameters": {}, "references": {}, "confidence": 0.9, "alternates": []},
    "risk": {"level": "low", "flags": [], "redactions": [], "approvals": []},
    "toolPlan": [{"capability": "llm.evaluate", "tool": "llm.evaluate", "input": {}}],
    "modelProfile": {"id": "p", "provider": "x", "model": "y"},
    "scope": {"user": {"id": "u", "role": "student"}, "surface": "api", "capabilities": ["llm.evaluate"]},
    "issuedAt": "2026-01-01T00:00:00.000Z", "expiresAt": "2026-01-01T00:05:00.000Z",
    "registryVersion": 1, "policyPackVersion": "default@1", "signedBy": "scout",
}
GOLDEN_SIGNATURE = "3a651784f786e407151aa9058045328c6b4b71077129089f680461f2def0f4ed"
SECRET = "golden-test-secret"
WITHIN = datetime(2026, 1, 1, 0, 1, tzinfo=timezone.utc)


def test_canonical_json_matches_typescript():
    assert canonical_json({"b": 1, "a": [{"z": 1, "y": "é"}]}) == '{"a":[{"y":"é","z":1}],"b":1}'


def test_golden_signature_matches_typescript():
    assert contract_signature(GOLDEN_CONTRACT, SECRET) == GOLDEN_SIGNATURE


def _signed(**over):
    c = {**GOLDEN_CONTRACT, **over}
    return {**c, "signature": contract_signature(c, SECRET)}


def test_verify_accepts_valid_contract():
    verify_contract(_signed(), SECRET, now=WITHIN, capabilities=["llm.evaluate"], user_id="u")


@pytest.mark.parametrize(
    "mutate, kwargs, reason",
    [
        (lambda c: {**c, "toolPlan": []}, {}, "bad-signature"),
        (lambda c: c, {"now": datetime(2026, 1, 1, 0, 6, tzinfo=timezone.utc)}, "expired"),
        (lambda c: c, {"capabilities": ["email.send"]}, "scope-mismatch"),
        (lambda c: c, {"user_id": "someone-else"}, "user-mismatch"),
    ],
)
def test_verify_rejects(mutate, kwargs, reason):
    kw = {"now": WITHIN, **kwargs}
    with pytest.raises(ContractInvalid, match=reason):
        verify_contract(mutate(_signed()), SECRET, **kw)


def test_verify_rejects_wrong_or_missing_secret():
    with pytest.raises(ContractInvalid):
        verify_contract(_signed(), "other", now=WITHIN)
    with pytest.raises(ContractInvalid):
        verify_contract(_signed(), "", now=WITHIN)


# ------------------------------------------------------------------ ScoutClient
async def test_scout_client_returns_decision():
    t = httpx.MockTransport(lambda r: httpx.Response(200, json={"intent": {"id": "GENERAL"}, "risk": {"level": "low"}}))
    assert (await ScoutClient("http://scout", transport=t).decide({"prompt": "hi", "surface": "api"}))["intent"]["id"] == "GENERAL"


@pytest.mark.parametrize(
    "handler",
    [
        lambda r: httpx.Response(500),
        lambda r: httpx.Response(200, text="not json"),
        lambda r: httpx.Response(200, json={"unexpected": True}),
        lambda r: (_ for _ in ()).throw(httpx.ConnectError("down")),
    ],
)
async def test_scout_client_fails_closed(handler):
    with pytest.raises(ScoutUnavailable):
        await ScoutClient("http://scout", transport=httpx.MockTransport(handler)).decide({"prompt": "x", "surface": "api"})


# ------------------------------------------------------------ Meterless Runtime
async def test_runtime_not_configured_refuses_without_network(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "meterless_runtime_token", "")
    client = MeterlessRuntimeClient(transport=httpx.MockTransport(lambda r: pytest.fail("must not call network")), store=RuntimeSettingsStore(tmp_path / "settings.json"))
    with pytest.raises(ModelUnavailable):
        await client.complete("s", "u")
    assert await client.status() == "not_configured"


async def test_runtime_placeholder_token_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "meterless_runtime_token", "rt-local")
    with pytest.raises(ModelUnavailable):
        await MeterlessRuntimeClient(store=RuntimeSettingsStore(tmp_path / "settings.json")).complete("s", "u")


async def test_runtime_sends_auth_headers_and_returns_plain_text(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "meterless_runtime_token", "test-token-value")
    seen = {}

    def handler(r: httpx.Request) -> httpx.Response:
        seen["auth"], seen["app"], seen["scope"] = r.headers["authorization"], r.headers["meterless-app"], r.headers["meterless-scope"]
        seen["body"] = json.loads(r.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}]})

    out = await MeterlessRuntimeClient(transport=httpx.MockTransport(handler), store=RuntimeSettingsStore(tmp_path / "settings.json")).complete("sys", "usr")
    assert out == "hello"
    assert seen["auth"] == "Bearer test-token-value" and seen["scope"] == "user" and seen["app"] == APP_ID
    assert seen["body"]["model"] == "meterless/auto" and isinstance(seen["body"]["messages"][1]["content"], str)


@pytest.mark.parametrize("code, expected", [(200, "online"), (401, "unauthorized"), (403, "unauthorized"), (500, "offline")])
async def test_runtime_status_uses_model_discovery(monkeypatch, code, expected, tmp_path):
    monkeypatch.setattr(settings, "meterless_runtime_token", "test-token-value")
    def handler(_r):
        return httpx.Response(code, json={"data": [{"id": "meterless/auto"}]} if code == 200 else {})
    assert await MeterlessRuntimeClient(transport=httpx.MockTransport(handler), store=RuntimeSettingsStore(tmp_path / "settings.json")).status() == expected


async def test_runtime_rejected_token_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "meterless_runtime_token", "test-token-value")
    with pytest.raises(ModelUnavailable):
        await MeterlessRuntimeClient(transport=httpx.MockTransport(lambda r: httpx.Response(401)), store=RuntimeSettingsStore(tmp_path / "settings.json")).complete("s", "u")


@pytest.mark.parametrize("entered", [
    "127.0.0.1:8088", "http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1/models",
    "http://127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/healthz",
])
def test_runtime_url_normalization_never_duplicates_v1(entered):
    assert normalize_base_url(entered)[0] == "http://127.0.0.1:8088/v1"


def test_connect_link_sets_base_and_stores_key_without_returning_it(tmp_path):
    store = RuntimeSettingsStore(tmp_path / "settings.json")
    client = MeterlessRuntimeClient(store=store)
    assert client.configure("http://runtime:8088/connect#k=secret-key") == "http://runtime:8088/v1"
    assert store.get(TOKEN_KEY) == "secret-key"
    assert json.loads(store.path.read_text(encoding="utf-8"))["meterless_runtime_token"] == "secret-key"


def test_runtime_token_file_is_imported_under_contract_key(tmp_path):
    (tmp_path / "proxy-token").write_text("runtime-token\n", encoding="utf-8")
    store = RuntimeSettingsStore(tmp_path / "settings.json")
    assert store.get(TOKEN_KEY) == "runtime-token"
    assert json.loads(store.path.read_text(encoding="utf-8"))[TOKEN_KEY] == "runtime-token"


async def test_wrong_token_is_unauthorized_and_auto_detect_saves_first_hit(tmp_path):
    requests = []
    def handler(request):
        requests.append(str(request.url))
        if "127.0.0.1:8088" in str(request.url):
            return httpx.Response(401)
        return httpx.Response(200, json={"data": [{"id": "meterless/auto"}, {"id": "meterless/future-mode"}]})
    store = RuntimeSettingsStore(tmp_path / "settings.json")
    store.update({TOKEN_KEY: "wrong-token"})
    client = MeterlessRuntimeClient(transport=httpx.MockTransport(handler), store=store)
    result = await client.auto_detect()
    assert result == {"status": "unauthorized", "base_url": "http://127.0.0.1:8088/v1"}
    assert client.base_url == result["base_url"]
    # A real token failure is distinguished from a process that has no model API.
    assert await client.status() == "unauthorized"


async def test_online_auto_detect_finds_later_runtime_and_persists_url(tmp_path):
    def handler(request):
        if "127.0.0.1:8090" in str(request.url):
            return httpx.Response(200, json={"data": [{"id": "meterless/auto"}]})
        return httpx.Response(404)
    store = RuntimeSettingsStore(tmp_path / "settings.json")
    result = await MeterlessRuntimeClient(transport=httpx.MockTransport(handler), store=store).auto_detect()
    assert result == {"status": "online", "base_url": "http://127.0.0.1:8090/v1"}
    assert store.get("meterless_runtime_base_url") == result["base_url"]


async def test_discovery_keeps_unrecognized_meterless_ids(tmp_path):
    transport = httpx.MockTransport(lambda _r: httpx.Response(200, json={"data": [{"id": "meterless/auto"}, {"id": "meterless/new-class.experimental"}, {"id": "other-model"}]}))
    client = MeterlessRuntimeClient(transport=transport, store=RuntimeSettingsStore(tmp_path / "settings.json"))
    assert await client.models() == ["meterless/auto", "meterless/new-class.experimental"]
