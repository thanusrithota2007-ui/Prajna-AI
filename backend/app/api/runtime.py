"""Local Meterless Runtime configuration and connection checks."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.integrations.meterless_runtime import (
    DEFAULT_BASE_URL,
    PROVIDER_ID,
    PROVIDER_NAME,
    MeterlessRuntimeClient,
    ModelUnavailable,
)

router = APIRouter(prefix="/agent/runtime", tags=["Meterless Runtime"])
_runtime = MeterlessRuntimeClient()


class RuntimeConfig(BaseModel):
    base_url: str | None = Field(None, max_length=2048)
    token: str | None = Field(None, max_length=4096)
    model: str | None = Field(None, max_length=256)


class GenerationCheck(BaseModel):
    model: str = Field("meterless/auto", max_length=256)


@router.get("/provider")
async def provider_info() -> dict[str, str]:
    return {"id": PROVIDER_ID, "name": PROVIDER_NAME, "base_url": DEFAULT_BASE_URL}


@router.put("/config")
async def configure_runtime(config: RuntimeConfig) -> dict[str, Any]:
    try:
        base_url = _runtime.configure(config.base_url or _runtime.base_url, config.token, config.model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"base_url": base_url, "model": _runtime.model,
            "token_configured": _runtime.token not in {"", "rt-local"}}


@router.get("/status")
async def runtime_status() -> dict[str, Any]:
    status = await _runtime.status()
    return {"provider": PROVIDER_ID, "status": status, "base_url": _runtime.base_url,
            "token_configured": _runtime.token not in {"", "rt-local"}}


@router.get("/models")
async def runtime_models() -> dict[str, Any]:
    try:
        ids = await _runtime.models()
    except ModelUnavailable as exc:
        return {"status": "not_configured" if str(exc) == "not_configured" else "unauthorized", "models": []}
    return {"status": "online" if ids else "offline", "models": ids}


@router.post("/auto-detect")
async def auto_detect() -> dict[str, str]:
    return await _runtime.auto_detect()


@router.post("/test-generation")
async def test_generation(request: GenerationCheck) -> dict[str, str]:
    try:
        text = await _runtime.test_generation(request.model)
    except ModelUnavailable as exc:
        if "rejected the token" in str(exc):
            raise HTTPException(status_code=401, detail="Meterless Runtime authorization failed") from exc
        raise HTTPException(status_code=503, detail="Meterless Runtime text generation failed") from exc
    return {"status": "ok", "text": text}
