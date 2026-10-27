"""Request/response models for the UPSC evaluation agent."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AgentRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500, description="What the user asks for, in plain language")
    question: str | None = Field(None, max_length=2000, description="The UPSC question (needed to evaluate)")
    answer: str | None = Field(None, max_length=8000, description="The candidate answer (needed to evaluate)")
    evaluation_id: str | None = Field(None, max_length=64, description="An earlier evaluation (explain / improve)")
    user_id: str = Field("anonymous", max_length=64)
    role: str = Field("student", max_length=32)


class EvidenceItem(BaseModel):
    quote: str
    verified: bool = Field(..., description="True when the quote appears verbatim in the candidate answer")
    comment: str


class CriterionResult(BaseModel):
    key: Literal["clarity_of_thought", "depth_of_analysis", "language_and_expression"]
    label: str
    score: int = Field(..., ge=0, le=10)
    feedback: str
    evidence: list[EvidenceItem]
    suggestions: list[str]


class EvaluationResult(BaseModel):
    evaluation_id: str
    overall_score: float = Field(..., description="Mean of the three criterion scores, computed by the server")
    max_score: int = 10
    criteria: list[CriterionResult]


class RouteInfo(BaseModel):
    intent: str
    confidence: float
    band: str
    risk_level: str
    trace_id: str
    contract_id: str | None = None


class MenuItem(BaseModel):
    label: str
    message: str = Field(..., description="Send this as `message` to take the option (it is routed by Scout like any request)")


class Clarification(BaseModel):
    question: str
    options: list[MenuItem] = []


class PersistenceInfo(BaseModel):
    """Whether this evaluation was saved to Zetaris. Only 'saved' means it is stored."""

    status: Literal["saved", "failed", "disabled"]
    message: str


class HistoryEntry(BaseModel):
    evaluation_id: str
    created_at: str
    overall_score: float
    clarity_score: int
    depth_score: int
    language_score: int
    question_preview: str


class HistorySummary(BaseModel):
    count: int
    entries: list[HistoryEntry] = Field(default_factory=list, description="Newest first")
    average_overall: float | None = None
    average_clarity: float | None = None
    average_depth: float | None = None
    average_language: float | None = None
    first_overall: float | None = None
    latest_overall: float | None = None
    change: float | None = Field(None, description="latest minus first overall score; needs at least 2 evaluations")
    trend: Literal["improving", "declining", "steady", "insufficient_data"] = "insufficient_data"
    strongest_criterion: str | None = None
    weakest_criterion: str | None = None


class AgentResponse(BaseModel):
    status: Literal["ok", "clarify", "menu", "blocked", "needs_input", "model_unavailable", "storage_unavailable", "error"]
    message: str
    route: RouteInfo | None = None
    evaluation: EvaluationResult | None = None
    explanation: str | None = None
    suggestions: list[str] | None = None
    persistence: PersistenceInfo | None = Field(None, description="Set only for evaluations: was it saved to Zetaris?")
    history: HistorySummary | None = None
    clarification: Clarification | None = None
    menu: list[MenuItem] = []
