"""
Client for the Scout Intent sidecar, plus verification of its signed execution contracts.

Fail closed: if Scout is unreachable, answers badly, or returns a contract that does not verify,
the caller gets an exception and must NOT route the request anywhere else.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings


class ScoutUnavailable(RuntimeError):
    """Scout could not be reached or returned something unusable."""


class ContractInvalid(RuntimeError):
    """The execution contract failed verification (signature, expiry or scope)."""


def canonical_json(value: Any) -> str:
    """Sorted keys, no whitespace, non-ASCII kept. Must match scout/src/contract.ts canonicalJson()."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def contract_signature(contract: dict[str, Any], secret: str) -> str:
    body = {k: v for k, v in contract.items() if k != "signature"}
    return hmac.new(secret.encode(), canonical_json(body).encode(), hashlib.sha256).hexdigest()


def verify_contract(
    contract: dict[str, Any],
    secret: str,
    *,
    now: datetime | None = None,
    capabilities: list[str] | None = None,
    user_id: str | None = None,
) -> None:
    """Raise ContractInvalid unless the contract is authentic, unexpired, in scope and for this user."""
    if not secret:
        raise ContractInvalid("no signing secret configured")
    given = str(contract.get("signature", ""))
    if not hmac.compare_digest(given, contract_signature(contract, secret)):
        raise ContractInvalid("bad-signature")
    expires = datetime.fromisoformat(str(contract["expiresAt"]).replace("Z", "+00:00"))
    if (now or datetime.now(timezone.utc)) > expires:
        raise ContractInvalid("expired")
    granted = set(contract.get("scope", {}).get("capabilities", []))
    missing = [c for c in (capabilities or []) if c not in granted]
    if missing:
        raise ContractInvalid(f"scope-mismatch: {', '.join(missing)}")
    if user_id is not None and contract.get("scope", {}).get("user", {}).get("id") != user_id:
        raise ContractInvalid("user-mismatch")


class ScoutClient:
    def __init__(self, base_url: str | None = None, timeout_s: float | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self._base = (base_url or settings.scout_url).rstrip("/")
        self._timeout = timeout_s or settings.scout_timeout_s
        self._transport = transport

    async def decide(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                r = await client.post(f"{self._base}/decide", json=payload)
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ScoutUnavailable(f"Scout call failed: {type(exc).__name__}") from exc
        if not isinstance(data, dict) or "risk" not in data or "intent" not in data:
            raise ScoutUnavailable("Scout returned an unexpected response")
        return data

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                return (await client.get(f"{self._base}/healthz")).status_code == 200
        except httpx.HTTPError:
            return False
