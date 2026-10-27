"""
Health endpoints.

GET /health        — process is alive (no external dependencies)
GET /health/zetaris — live JDBC probe: SELECT 1 + full metadata discovery
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health", summary="Process health check")
async def health() -> dict[str, str]:
    """
    Returns 200 as long as the FastAPI process is running.
    No database calls — safe to use as a liveness probe.
    """
    return {"status": "ok"}


@router.get("/health/zetaris", summary="Zetaris JDBC live probe")
async def health_zetaris() -> JSONResponse:
    """
    Runs the full read-only discovery sequence against the Lightning JDBC
    endpoint and returns a structured JSON payload.

    HTTP 200 is always returned so that callers can inspect per-statement
    results without treating a partial failure as a network-level error.
    The top-level ``status`` field is ``"ok"`` when SELECT 1 succeeded,
    ``"degraded"`` otherwise.
    """
    from app.integrations.zetaris_jdbc import run_discovery  # lazy import

    start = time.monotonic()
    try:
        discovery = run_discovery()
    except Exception as exc:  # noqa: BLE001
        logger.exception("run_discovery raised unexpectedly")
        elapsed = round(time.monotonic() - start, 3)
        return JSONResponse(
            status_code=200,
            content={
                "status": "error",
                "elapsed_s": elapsed,
                "error": str(exc),
                "discovery": None,
            },
        )

    elapsed = round(time.monotonic() - start, 3)
    select_ok: bool = discovery.get("select_1", {}).get("ok", False)

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok" if select_ok else "degraded",
            "elapsed_s": elapsed,
            "select_1_ok": select_ok,
            "discovery": discovery,
        },
    )
