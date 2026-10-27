// The only place that knows how an evaluation is obtained.
// UI components call `evaluateAnswer()` and never touch fetch or mock data.
//
// Backend mode talks to POST /agent/message (FastAPI). The reply is mapped in ./apiMapping.ts.
//
// SECURITY: no API keys, model credentials or tokens belong in this file or in any VITE_ variable.
// The browser talks only to our own backend; the backend talks to Scout, Zetaris and the model provider.

import { buildMockEvaluation } from '../data/mockEvaluation';
import type { EvaluationRequest, EvaluationResult } from '../types';
import { EvaluationError, mapAgentResponse, messageForHttpError, type AgentResponse } from './apiMapping';

export { EvaluationError };

/** The backend routes by intent, so this exact phrase (a known Scout "seed") is what makes it evaluate. */
export const EVALUATE_MESSAGE = 'Evaluate my UPSC Mains answer';
export const EVALUATE_PATH = '/agent/message';

/** Backend limits (backend/app/schemas/agent.py). The form checks these before sending. */
export const LIMITS = { questionChars: 2000, answerChars: 8000 } as const;

// `import.meta.env` is undefined outside Vite (e.g. the contract check script), hence the optional chaining.
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const USE_MOCK = (env.VITE_USE_MOCK ?? 'false') !== 'false';
const API_BASE_URL = (env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export const isMockMode = USE_MOCK;

/** Simulated latency so the loading state is realistic in mock mode. */
const MOCK_DELAY_MS = 1400;
/** The model call can take a while (the backend allows up to 180 s). */
const REQUEST_TIMEOUT_MS = 200_000;

const USER_KEY = 'prajna_user_id';
let memoryUserId: string | null = null;

/**
 * A random, anonymous id kept in this browser. The backend scopes saved evaluations and history by it.
 * It is NOT authentication: anyone who knows an id can ask for that id's history.
 */
export function getUserId(): string {
  try {
    const saved = localStorage.getItem(USER_KEY);
    if (saved && /^[A-Za-z0-9_.@-]{1,64}$/.test(saved)) return saved;
    const fresh = `anon-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    localStorage.setItem(USER_KEY, fresh);
    return fresh;
  } catch {
    memoryUserId ??= `anon-${Math.random().toString(16).slice(2, 22)}`; // storage blocked: per-tab id
    return memoryUserId;
  }
}

async function evaluateWithMock(req: EvaluationRequest): Promise<EvaluationResult> {
  // Runs entirely in the browser: the answer is not sent anywhere.
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  return buildMockEvaluation(req);
}

export async function evaluateWithBackend(
  req: EvaluationRequest,
  cfg: { baseUrl: string; userId?: string; timeoutMs?: number } = { baseUrl: API_BASE_URL },
): Promise<EvaluationResult> {
  if (!cfg.baseUrl) {
    throw new EvaluationError(
      'The backend address is not configured. Set VITE_API_BASE_URL, or switch back to sample mode.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}${EVALUATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      // subject, marks and wordLimit are not sent: the evaluator does not use them (it scores each criterion out of 10).
      body: JSON.stringify({
        message: EVALUATE_MESSAGE,
        question: req.question,
        answer: req.answer,
        user_id: cfg.userId ?? getUserId(),
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new EvaluationError('The evaluation took too long and was stopped. Please try again.');
    }
    throw new EvaluationError('Could not reach the evaluation service. Check that the backend is running, then try again.');
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* non-JSON error page: handled below */
  }

  if (!response.ok) throw new EvaluationError(messageForHttpError(response.status, body));
  if (body === null) throw new EvaluationError('The evaluation service sent a reply that could not be read.');
  return mapAgentResponse(body as AgentResponse);
}

export function evaluateAnswer(req: EvaluationRequest): Promise<EvaluationResult> {
  return USE_MOCK ? evaluateWithMock(req) : evaluateWithBackend(req);
}
