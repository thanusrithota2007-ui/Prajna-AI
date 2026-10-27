"""In-memory store of evaluations so explain / improve can refer back to them. Scoped per user, bounded."""

from __future__ import annotations

import uuid
from collections import OrderedDict
from dataclasses import dataclass

from app.schemas.agent import EvaluationResult


@dataclass(frozen=True)
class StoredEvaluation:
    user_id: str
    question: str
    answer: str
    result: EvaluationResult


class EvaluationStore:
    def __init__(self, max_items: int = 500):
        self._items: OrderedDict[str, StoredEvaluation] = OrderedDict()
        self._max = max_items

    def new_id(self) -> str:
        return uuid.uuid4().hex[:16]

    def put(self, record: StoredEvaluation) -> None:
        self._items[record.result.evaluation_id] = record
        while len(self._items) > self._max:
            self._items.popitem(last=False)

    def get(self, user_id: str, evaluation_id: str) -> StoredEvaluation | None:
        rec = self._items.get(evaluation_id)
        return rec if rec and rec.user_id == user_id else None  # never reveal another user's evaluation
