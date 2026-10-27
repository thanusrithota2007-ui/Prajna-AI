"""
Agent orchestration: Scout decides first, then (and only then) a workflow runs.

Order of operations for every request:
  1. Scout classifies the request, guards it and returns a signed execution contract.
  2. We verify the contract (signature, expiry, capabilities, user) -- fail closed.
  3. Only the workflow the contract names is executed. Blocked / unsupported requests never reach the model.
"""

from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.integrations.nightshift_client import ModelClient, ModelUnavailable
from app.integrations.scout_client import ScoutClient, verify_contract
from app.schemas.agent import AgentRequest, AgentResponse, Clarification, MenuItem, RouteInfo
from app.services import evaluator
from app.integrations.zetaris_history import HistoryError
from app.services.evaluation_store import EvaluationStore, StoredEvaluation
from app.services.history import HistoryDisabled, HistoryService

# Capabilities each workflow needs; the contract's scope must grant them all.
WORKFLOW_CAPABILITIES: dict[str, list[str]] = {
    "GENERAL": [],
    "upsc.evaluate": ["rubric.load", "llm.evaluate"],
    "upsc.explain": ["evaluation.recall", "llm.explain"],
    "upsc.improve": ["evaluation.recall", "llm.improve"],
    "upsc.history": ["history.recall"],
}

# Menu entries send a phrase Scout routes reliably (checked live in test_scout_live.py), so a menu tap is
# classified and guarded like any other request.
MENU = {
    "upsc.evaluate": MenuItem(label="Evaluate my answer", message="Evaluate my UPSC Mains answer"),
    "upsc.explain": MenuItem(label="Explain my evaluation", message="Break down my marks by criterion"),
    "upsc.improve": MenuItem(label="Suggest improvements", message="What changes would raise my marks?"),
    "upsc.history": MenuItem(label="Show my progress", message="Show my evaluation history"),
}


def _route(decision: dict[str, Any]) -> RouteInfo:
    contract = decision.get("executionContract") or {}
    return RouteInfo(
        intent=decision["intent"]["id"],
        confidence=float(decision["intent"].get("confidence", 0)),
        band=decision.get("band", "reject"),
        risk_level=decision["risk"]["level"],
        trace_id=decision.get("traceId", ""),
        contract_id=contract.get("contractId"),
    )


def _menu_response(decision: dict[str, Any], message: str) -> AgentResponse:
    return AgentResponse(status="menu", message=message, route=_route(decision), menu=list(MENU.values()))


async def handle_message(
    req: AgentRequest, scout: ScoutClient, model: ModelClient, store: EvaluationStore, history: HistoryService
) -> AgentResponse:
    context: dict[str, Any] = {}
    for key, value in (("evaluationId", req.evaluation_id), ("question", req.question), ("answer", req.answer)):
        if value:
            context[key] = value
    decision = await scout.decide(
        {"prompt": req.message, "surface": "api", "user": {"id": req.user_id, "role": req.role}, "context": context}
    )
    route = _route(decision)

    # 1. Refused at the boundary: no contract, no model call.
    if decision["risk"]["level"] == "block":
        return AgentResponse(status="blocked", message="I can't help with that request.", route=route)

    # 2. Scout needs more information before anything may run.
    clar = decision.get("clarification")
    if clar and not decision.get("executionContract"):
        if clar.get("trigger") == "params":
            return AgentResponse(
                status="needs_input",
                message="Which evaluation do you mean? Send the evaluation_id returned when you evaluated an answer.",
                route=route,
            )
        options = [MENU[o["intent"]] for o in clar.get("options", []) if o.get("intent") in MENU]
        return AgentResponse(
            status="clarify",
            message=clar.get("question", "Could you clarify what you'd like to do?"),
            route=route,
            clarification=Clarification(question=clar.get("question", ""), options=options or list(MENU.values())),
        )

    contract = decision.get("executionContract")
    if not contract:  # should not happen; refuse rather than guess
        return _menu_response(decision, "I couldn't work out what you'd like to do.")

    # 3. Verify the contract before acting on it (raises ContractInvalid -> HTTP 503 in the API layer).
    intent = contract["intent"]["primary"]["id"]
    needed = WORKFLOW_CAPABILITIES.get(intent)
    if needed is None:  # an intent this backend has no workflow for
        return _menu_response(decision, "That isn't something I can do yet.")
    verify_contract(contract, settings.scout_signing_secret, capabilities=needed, user_id=req.user_id)

    if intent == "GENERAL":
        return _menu_response(
            decision,
            "I evaluate UPSC Mains answers on clarity of thought, depth of analysis and language and expression. What would you like to do?",
        )

    try:
        if intent == "upsc.evaluate":
            if not (req.question and req.answer):
                return AgentResponse(status="needs_input", message="Please send both the `question` and your `answer` to evaluate.", route=route)
            result = await evaluator.evaluate(model, req.question, req.answer, store.new_id())
            store.put(StoredEvaluation(req.user_id, req.question, req.answer, result))
            persistence = await history.save_evaluation(req.user_id, req.question, req.answer, result)
            return AgentResponse(
                status="ok", message=f"Overall score {result.overall_score}/10.", route=route,
                evaluation=result, persistence=persistence,
            )

        if intent == "upsc.history":
            try:
                summary = await history.progress(req.user_id)
            except HistoryDisabled:
                return AgentResponse(status="storage_unavailable", message="Score history is not enabled on this server.", route=route)
            except HistoryError:
                return AgentResponse(status="storage_unavailable", message="Score history is temporarily unavailable.", route=route)
            msg = "You have no saved evaluations yet." if summary.count == 0 else f"Found {summary.count} saved evaluation(s); trend: {summary.trend.replace('_', ' ')}."
            return AgentResponse(status="ok", message=msg, route=route, history=summary)

        evaluation_id = contract["intent"]["parameters"].get("evaluationId")
        record = store.get(req.user_id, str(evaluation_id)) if evaluation_id else None
        if not record:
            return AgentResponse(status="needs_input", message="I couldn't find that evaluation. Evaluate an answer first.", route=route)

        if intent == "upsc.explain":
            text = await evaluator.explain(model, record.result, record.answer, req.message)
            return AgentResponse(status="ok", message="Here is how your evaluation was reached.", route=route, explanation=text)

        tips = await evaluator.improve(model, record.result, record.answer, req.message)
        return AgentResponse(status="ok", message="Here is how to improve this answer.", route=route, suggestions=tips)
    except ModelUnavailable:
        return AgentResponse(status="model_unavailable", message="The model runtime is not available right now.", route=route)
    except evaluator.ModelOutputError:
        return AgentResponse(status="error", message="The model's reply could not be used. Please try again.", route=route)
