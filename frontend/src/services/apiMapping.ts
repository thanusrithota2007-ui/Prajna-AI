// Maps the backend's POST /agent/message reply onto the UI's EvaluationResult.
// Pure functions (no fetch, no import.meta), so they can be checked in isolation:
//   npm run check:backend
//
// Backend contract (backend/app/schemas/agent.py):
//   AgentResponse { status, message, route, evaluation?, persistence?, ... }
//   evaluation   { evaluation_id, overall_score, max_score, criteria[3] }
//   criterion    { key, label, score 0-10, feedback, evidence[{quote, comment, verified}], suggestions[] }
// Everything the backend does not provide (strengths, next steps, structure, sample rewrite, marks scaling)
// is left undefined and the UI hides those sections.

import type { DimensionKey, DimensionResult, EvaluationResult, ImprovementPoint, PersistenceInfo } from '../types';

export class EvaluationError extends Error {}

export interface AgentCriterion {
  key: string;
  label: string;
  score: number;
  feedback: string;
  evidence: { quote: string; comment: string; verified: boolean }[];
  suggestions: string[];
}

export interface AgentResponse {
  status: string;
  message?: string;
  evaluation?: { evaluation_id: string; overall_score: number; max_score: number; criteria: AgentCriterion[] } | null;
  persistence?: PersistenceInfo | null;
}

const KEY_MAP: Record<string, DimensionKey> = {
  clarity_of_thought: 'clarity',
  depth_of_analysis: 'depth',
  language_and_expression: 'language',
};

export function bandFor(score: number, max: number): DimensionResult['band'] {
  const pct = max > 0 ? score / max : 0;
  if (pct < 0.45) return 'Needs work';
  if (pct < 0.6) return 'Developing';
  if (pct < 0.75) return 'Solid';
  return 'Strong';
}

/** Friendly message for every reply that is NOT an evaluation, so the UI never renders a half-empty result. */
export function messageForStatus(status: string): string {
  switch (status) {
    case 'blocked':
      return 'This text was stopped by the safety checks, usually because part of it reads like instructions to the evaluator. Remove those parts and try again.';
    case 'menu':
    case 'clarify':
    case 'needs_input':
      return 'The service could not treat this as an evaluation request. Please try again.';
    case 'model_unavailable':
      return 'The evaluation model is not available right now. Please try again shortly.';
    case 'storage_unavailable':
      return 'Saved history is not available right now.';
    default:
      return 'The evaluation service returned an unexpected reply. Please try again.';
  }
}

export function mapAgentResponse(data: AgentResponse): EvaluationResult {
  if (data.status !== 'ok' || !data.evaluation) throw new EvaluationError(messageForStatus(data.status));
  const ev = data.evaluation;
  if (!Array.isArray(ev.criteria) || ev.criteria.length === 0) {
    throw new EvaluationError('The evaluation came back incomplete. Please try again.');
  }

  const max = ev.max_score || 10;
  const dimensions: DimensionResult[] = ev.criteria.map((c) => ({
    key: KEY_MAP[c.key] ?? 'clarity',
    label: c.label,
    score: c.score,
    maxScore: max,
    band: bandFor(c.score, max),
    explanation: c.feedback,
    evidence: c.evidence ?? [],
    suggestions: c.suggestions ?? [],
  }));

  const best = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const worst = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const summary =
    best.score === worst.score
      ? `Your three criteria scored evenly (${best.score} out of ${max} each).`
      : `Strongest: ${best.label} (${best.score} out of ${max}). Needs the most work: ${worst.label} (${worst.score} out of ${max}).`;

  const improvements: ImprovementPoint[] = ev.criteria.flatMap((c) =>
    (c.suggestions ?? []).map((action) => ({ title: c.label, action })),
  );

  return {
    id: ev.evaluation_id,
    source: 'api',
    overall: { score: ev.overall_score, maxScore: max, label: bandFor(ev.overall_score, max), summary },
    dimensions,
    improvements,
    persistence: data.persistence ?? undefined,
  };
}

/** Turns a non-2xx reply into a message. FastAPI errors carry `detail` (string, or a list for 422). */
export function messageForHttpError(status: number, body: unknown): string {
  const b = (body ?? {}) as { status?: string; detail?: unknown };
  if (status === 422) {
    return 'The question or answer was rejected as invalid. Questions can be up to 2,000 characters and answers up to 8,000.';
  }
  if (status === 503 && b.status) return messageForStatus(b.status);
  if (status === 503) return 'The evaluation service is not ready (routing unavailable). Please try again shortly.';
  if (status === 502) return 'The model replied, but not in a form that could be used. Please try again.';
  if (status === 404) return 'The evaluation endpoint was not found. Check VITE_API_BASE_URL.';
  return `The evaluation service returned an error (${status}). Please try again.`;
}
