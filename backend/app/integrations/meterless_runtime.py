"""OpenAI-compatible client and local configuration for Meterless Runtime."""

from __future__ import annotations

import json
import os
import tempfile
import asyncio
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qs, urlsplit, urlunsplit

import httpx

from app.core.config import settings

PROVIDER_ID = "meterless"
PROVIDER_NAME = "Meterless Runtime"
DEFAULT_BASE_URL = "http://127.0.0.1:8088/v1"
APP_ID = "upsc-evaluator"
TOKEN_KEY = "meterless_runtime_token"
ROUTING_MODES = {"auto", "fast", "deep", "cheap", "local", "fusion"}
_PLACEHOLDER_TOKENS = {"", "rt-local"}


class ModelUnavailable(RuntimeError):
    """The configured Runtime could not complete a model request."""


class ModelClient(Protocol):
    async def complete(self, system: str, user: str) -> str: ...
    async def status(self) -> str: ...


def normalize_base_url(value: str) -> tuple[str, str | None]:
    """Normalize an entered URL or Runtime connect link to origin + /v1."""
    value = value.strip()
    if not value:
        return DEFAULT_BASE_URL, None
    if "/connect#" in value:
        candidate = value if "://" in value else f"http://{value}"
        parsed = urlsplit(candidate)
        key = parse_qs(parsed.fragment).get("k", [None])[0]
        if not key:
            raise ValueError("Connect link is missing its key")
        return urlunsplit((parsed.scheme, parsed.netloc, "/v1", "", "")), key
    candidate = value if "://" in value else f"http://{value}"
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Enter an HTTP or HTTPS Runtime URL")
    path = parsed.path.rstrip("/")
    allowed = {"", "/v1", "/v1/chat/completions", "/v1/models", "/healthz"}
    if path not in allowed:
        raise ValueError("Runtime URL must be an origin, /v1, /v1/models, /v1/chat/completions, or /healthz")
    return urlunsplit((parsed.scheme, parsed.netloc, "/v1", "", "")), None


class RuntimeSettingsStore:
    """Small local state store. The token is never returned or logged."""

    def __init__(self, path: Path | None = None):
        self.path = path or Path(settings.meterless_state_dir) / "settings.json"

    def read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def get(self, key: str, default: str = "") -> str:
        val = self.read().get(key, default)
        if key == TOKEN_KEY and not val:
            try:
                val = (self.path.parent / "proxy-token").read_text(encoding="utf-8").strip()
            except OSError:
                val = default
            if val:
                self.update({TOKEN_KEY: val})
        return val if isinstance(val, str) else default

    def update(self, values: dict[str, str]) -> None:
        current = self.read()
        current.update(values)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix="runtime-", dir=self.path.parent)
        try:
            try:
                os.chmod(temp_name, 0o600)
            except OSError:
                pass
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(current, stream)
            os.replace(temp_name, self.path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)


class MeterlessRuntimeClient:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, store: RuntimeSettingsStore | None = None):
        self._transport = transport
        self._store = store or RuntimeSettingsStore()

    @property
    def base_url(self) -> str:
        raw = self._store.get("meterless_runtime_base_url", settings.meterless_runtime_base_url)
        return normalize_base_url(raw)[0]

    @property
    def token(self) -> str:
        return self._store.get(TOKEN_KEY, settings.meterless_runtime_token)

    @property
    def model(self) -> str:
        return self._store.get("meterless_runtime_model", settings.meterless_runtime_model)

    def configure(self, base_url: str, token: str | None = None, model: str | None = None) -> str:
        normalized, link_token = normalize_base_url(base_url)
        values = {"meterless_runtime_base_url": normalized}
        effective_token = link_token if link_token is not None else token
        if effective_token is not None:
            if effective_token.strip() in _PLACEHOLDER_TOKENS:
                raise ValueError("Runtime token is invalid; rt-local is a placeholder")
            values[TOKEN_KEY] = effective_token.strip()
        if model is not None:
            if not model.startswith("meterless/"):
                raise ValueError("Runtime model id must start with meterless/")
            values["meterless_runtime_model"] = model
        self._store.update(values)
        return normalized

    def _headers(self, *, chat: bool = False) -> dict[str, str]:
        token = self.token
        if token in _PLACEHOLDER_TOKENS:
            raise ModelUnavailable("Meterless Runtime token is not configured")
        headers = {"Authorization": f"Bearer {token}", "meterless-app": APP_ID}
        if chat:
            headers["meterless-scope"] = "user"
        return headers

    async def models(self, *, base_url: str | None = None, token: str | None = None) -> list[str]:
        root = normalize_base_url(base_url)[0] if base_url else self.base_url
        auth = token if token is not None else self.token
        if auth == "rt-local":
            raise ModelUnavailable("not_configured")
        headers = {"Authorization": f"Bearer {auth}", "meterless-app": APP_ID}
        try:
            async with httpx.AsyncClient(timeout=5.0, transport=self._transport) as client:
                response = await client.get(f"{root}/models", headers=headers)
            if response.status_code in (401, 403):
                raise ModelUnavailable("unauthorized")
            if response.status_code != 200:
                return []
            body = response.json()
            rows = body.get("data", []) if isinstance(body, dict) else []
            ids = [item.get("id") for item in rows if isinstance(item, dict)]
            return [ident for ident in ids if isinstance(ident, str) and ident.startswith("meterless/")]
        except ModelUnavailable:
            raise
        except (httpx.HTTPError, ValueError, TypeError):
            return []

    async def status(self) -> str:
        if self.token in _PLACEHOLDER_TOKENS:
            return "not_configured"
        try:
            return "online" if await self.models() else "offline"
        except ModelUnavailable as exc:
            return "unauthorized" if str(exc) == "unauthorized" else "offline"

    async def complete(self, system: str, user: str, model: str | None = None) -> str:
        body = {
            "model": model or self.model,
            "temperature": 0,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        try:
            async with httpx.AsyncClient(timeout=180.0, transport=self._transport) as client:
                response = await client.post(f"{self.base_url}/chat/completions", json=body, headers=self._headers(chat=True))
            if response.status_code in (401, 403):
                raise ModelUnavailable("Meterless Runtime rejected the token")
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ModelUnavailable("Meterless Runtime returned non-text content")
            return content
        except ModelUnavailable:
            raise
        except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
            raise ModelUnavailable(f"Meterless Runtime call failed: {type(exc).__name__}") from exc

    async def auto_detect(self) -> dict[str, str]:
        candidates = [
            f"http://{host}:{port}/v1"
            for host in ("127.0.0.1", "localhost", "[::1]")
            for port in (8088, 8090, 8787, 11434)
        ]

        async def probe(url: str) -> tuple[str, str]:
            try:
                ids = await self.models(base_url=url)
                return url, "online" if ids else "offline"
            except ModelUnavailable as exc:
                return url, "unauthorized" if str(exc) == "unauthorized" else "offline"

        results = await asyncio.gather(*(probe(url) for url in candidates))
        for url, status in results:  # candidate order breaks ties deterministically
            if status in {"online", "unauthorized"}:
                self._store.update({"meterless_runtime_base_url": url})
                return {"status": status, "base_url": url}
        return {"status": "offline", "base_url": self.base_url}

    async def test_generation(self, model: str = "meterless/auto") -> str:
        return await self.complete("Return only the word OK.", "Reply with the word OK.", model=model)


# Compatibility for the existing evaluator and its public protocol imports.
NightshiftClient = MeterlessRuntimeClient
