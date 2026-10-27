"""Evaluation history: save completed evaluations to Zetaris and summarise a student's progress."""

from __future__ import annotations

import asyncio
import logging
import re

from app.core.config import settings
from app.integrations.zetaris_history import HistoryError, HistoryRecord, HistoryStore, StoredEntry
from app.schemas.agent import EvaluationResult, HistoryEntry, HistorySummary, PersistenceInfo

logger = logging.getLogger(__name__)

_MODEL_OK = re.compile(r"[A-Za-z0-9_./:-]{1,100}")
_CRITERIA = (("clarity_of_thought", "Clarity of thought"), ("depth_of_analysis", "Depth of analysis"), ("language_and_expression", "Language and expression"))
STEADY_BAND = 0.5  # a change smaller than this (on a 0-10 scale) is reported as steady


class HistoryDisabled(RuntimeError):
    """History storage is switched off in settings."""


def model_label() -> str:
    name = getattr(settings, "nightshift_model", "") or "unknown"
    return name if _MODEL_OK.fullmatch(name) else "unknown"


def summarise(entries: list[StoredEntry]) -> HistorySummary:
    """Pure function: newest-first entries in, progress summary out."""
    if not entries:
        return HistorySummary(count=0)
    chronological = list(reversed(entries))
    n = len(entries)
    mean = lambda xs: round(sum(xs) / len(xs), 1)  # noqa: E731
    avg = {
        "clarity": mean([e.clarity_score for e in entries]),
        "depth": mean([e.depth_score for e in entries]),
        "language": mean([e.language_score for e in entries]),
    }
    first, latest = chronological[0].overall_score, chronological[-1].overall_score
    change = round(latest - first, 1) if n >= 2 else None
    trend = "insufficient_data" if change is None else "improving" if change >= STEADY_BAND else "declining" if change <= -STEADY_BAND else "steady"
    by_label = dict(zip((label for _, label in _CRITERIA), avg.values()))
    return HistorySummary(
        count=n,
        entries=[
            HistoryEntry(
                evaluation_id=e.evaluation_id, created_at=e.created_at, overall_score=e.overall_score,
                clarity_score=e.clarity_score, depth_score=e.depth_score, language_score=e.language_score,
                question_preview=e.question[:120],
            )
            for e in entries
        ],
        average_overall=mean([e.overall_score for e in entries]),
        average_clarity=avg["clarity"], average_depth=avg["depth"], average_language=avg["language"],
        first_overall=first, latest_overall=latest, change=change, trend=trend,
        strongest_criterion=max(by_label, key=by_label.get) if n >= 1 and len(set(by_label.values())) > 1 else None,
        weakest_criterion=min(by_label, key=by_label.get) if n >= 1 and len(set(by_label.values())) > 1 else None,
    )


class HistoryService:
    def __init__(self, store: HistoryStore | None, enabled: bool, timeout_s: float = 45.0, model: str | None = None):
        self._store, self._enabled, self._timeout, self._model = store, enabled, timeout_s, model

    @classmethod
    def from_settings(cls) -> "HistoryService":
        enabled = bool(settings.zetaris_history_enabled)
        store = None
        if enabled:
            try:
                store = HistoryStore(settings.zetaris_history_table)
            except HistoryError:
                logger.warning("Zetaris history is enabled but the table name is invalid")
        return cls(store, enabled, settings.zetaris_history_timeout_s)

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def _call(self, fn, *args):
        return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=self._timeout)

    async def save_evaluation(self, user_id: str, question: str, answer: str, result: EvaluationResult) -> PersistenceInfo:
        """Never raises: an evaluation must still be returned if storage fails, with an accurate status."""
        if not self._enabled:
            return PersistenceInfo(status="disabled", message="History storage is not enabled; this evaluation was not saved.")
        if self._store is None:
            return PersistenceInfo(status="failed", message="History storage is misconfigured; this evaluation was not saved.")
        try:
            scores = {c.key: c.score for c in result.criteria}
            record = HistoryRecord(
                evaluation_id=result.evaluation_id, user_id=user_id, question=question, answer=answer,
                overall_score=result.overall_score, clarity_score=scores["clarity_of_thought"],
                depth_score=scores["depth_of_analysis"], language_score=scores["language_and_expression"],
                model=self._model or model_label(), created_at=HistoryRecord.now(),
            )
            await self._call(self._store.save, record)
            return PersistenceInfo(status="saved", message="Saved to your evaluation history.")
        except asyncio.TimeoutError:
            logger.warning("Zetaris history write timed out")
            return PersistenceInfo(status="failed", message="Saving timed out, so it could not be confirmed. Treat this evaluation as not saved.")
        except HistoryError:
            return PersistenceInfo(status="failed", message="This evaluation could not be saved to your history.")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Unexpected history save failure: %s", type(exc).__name__)
            return PersistenceInfo(status="failed", message="This evaluation could not be saved to your history.")

    async def progress(self, user_id: str, limit: int = 20) -> HistorySummary:
        """Raises HistoryDisabled / HistoryError; the caller turns those into an honest status."""
        if not self._enabled:
            raise HistoryDisabled()
        if self._store is None:
            raise HistoryError("history misconfigured")
        try:
            entries = await self._call(self._store.list_for_user, user_id, limit)
        except asyncio.TimeoutError as exc:
            raise HistoryError("history read timed out") from exc
        return summarise(entries)
