"""
UPSC evaluation agent endpoints.

POST /agent/message  -- the single entry point; Scout routes every request before any workflow runs.
GET  /agent/health   -- is Scout reachable, is the model runtime configured/online.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.integrations.nightshift_client import ModelClient, NightshiftClient
from app.integrations.scout_client import ContractInvalid, ScoutClient, ScoutUnavailable
from app.schemas.agent import AgentRequest, AgentResponse
from app.services.agent import handle_message
from app.services.evaluation_store import EvaluationStore
from app.services.history import HistoryService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])

_scout = ScoutClient()
_model = NightshiftClient()
_store = EvaluationStore()
_history: HistoryService | None = None


# Dependency providers: tests override these with fakes.
def get_scout() -> ScoutClient:
    return _scout


def get_model() -> ModelClient:
    return _model


def get_store() -> EvaluationStore:
    return _store


def get_history() -> HistoryService:
    global _history
    if _history is None:  # built lazily so settings (.env) are read once the app is up
        _history = HistoryService.from_settings()
    return _history


@router.post("/message", response_model=AgentResponse, summary="Evaluate, explain or improve a UPSC answer")
async def message(
    req: AgentRequest,
    scout: ScoutClient = Depends(get_scout),
    model: ModelClient = Depends(get_model),
    store: EvaluationStore = Depends(get_store),
    history: HistoryService = Depends(get_history),
):
    try:
        resp = await handle_message(req, scout, model, store, history)
    except ScoutUnavailable:
        logger.warning("Scout unavailable; refusing request (fail closed)")
        raise HTTPException(status_code=503, detail="Request routing is unavailable. Please try again shortly.")
    except ContractInvalid as exc:
        logger.warning("Execution contract rejected: %s", exc)
        raise HTTPException(status_code=503, detail="Request routing could not be verified.")
    if resp.status in ("model_unavailable", "storage_unavailable"):
        return JSONResponse(status_code=503, content=resp.model_dump(mode="json"))
    if resp.status == "error":
        return JSONResponse(status_code=502, content=resp.model_dump(mode="json"))
    return resp


@router.get("/health", summary="Scout and model runtime status")
async def agent_health(scout: ScoutClient = Depends(get_scout), model: ModelClient = Depends(get_model)) -> dict[str, object]:
    return {"scout": "online" if await scout.healthy() else "offline", "nightshift": await model.status()}
