"""Model-backed workflows: evaluate, explain, improve. Pure logic over a ModelClient, so tests use a fake."""

from __future__ import annotations

import json
import re

from app.integrations.nightshift_client import ModelClient
from app.schemas.agent import CriterionResult, EvaluationResult, EvidenceItem
from app.services import rubric


class ModelOutputError(RuntimeError):
    """The model answered, but not in a form we can trust."""


def _json_object(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start : end + 1])
    except ValueError as exc:
        raise ModelOutputError("model did not return valid JSON") from exc
    if not isinstance(data, dict):
        raise ModelOutputError("model JSON was not an object")
    return data


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _clamp_score(value: object) -> int:
    try:
        return max(0, min(10, int(round(float(value)))))  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ModelOutputError("non-numeric score") from exc


def parse_evaluation(raw: str, answer: str, evaluation_id: str) -> EvaluationResult:
    data = _json_object(raw)
    by_key = {c.get("key"): c for c in data.get("criteria", []) if isinstance(c, dict)}
    if set(by_key) != set(rubric.CRITERION_KEYS):
        raise ModelOutputError("model did not return exactly the three criteria")
    answer_norm = _norm(answer)
    criteria: list[CriterionResult] = []
    for spec in rubric.CRITERIA:
        c = by_key[spec["key"]]
        evidence = [
            EvidenceItem(
                quote=str(e.get("quote", ""))[:400],
                comment=str(e.get("comment", ""))[:400],
                verified=bool(e.get("quote")) and _norm(str(e["quote"])) in answer_norm,  # checked by us, not the model
            )
            for e in (c.get("evidence") or [])[:3]
            if isinstance(e, dict)
        ]
        criteria.append(
            CriterionResult(
                key=spec["key"],  # type: ignore[arg-type]
                label=spec["label"],
                score=_clamp_score(c.get("score")),
                feedback=str(c.get("feedback", ""))[:1200],
                evidence=evidence,
                suggestions=[str(s)[:400] for s in (c.get("suggestions") or [])[:3]],
            )
        )
    overall = round(sum(c.score for c in criteria) / len(criteria), 1)  # arithmetic is ours, not the model's
    return EvaluationResult(evaluation_id=evaluation_id, overall_score=overall, criteria=criteria)


async def evaluate(model: ModelClient, question: str, answer: str, evaluation_id: str) -> EvaluationResult:
    raw = await model.complete(rubric.EVALUATE_SYSTEM, rubric.evaluate_user_prompt(question, answer))
    return parse_evaluation(raw, answer, evaluation_id)


async def explain(model: ModelClient, result: EvaluationResult, answer: str, request: str) -> str:
    text = await model.complete(rubric.EXPLAIN_SYSTEM, rubric.context_prompt(result.model_dump_json(), answer, request))
    if not text.strip():
        raise ModelOutputError("empty explanation")
    return text.strip()


async def improve(model: ModelClient, result: EvaluationResult, answer: str, request: str) -> list[str]:
    raw = await model.complete(rubric.IMPROVE_SYSTEM, rubric.context_prompt(result.model_dump_json(), answer, request))
    items = _json_object(raw).get("suggestions")
    if not isinstance(items, list) or not items:
        raise ModelOutputError("no suggestions returned")
    return [str(i)[:500] for i in items[:6]]
