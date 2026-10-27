// Shared types. Shapes follow engines/scout-intent/AGENTS.md and docs/execution-contract.md.

export type RiskClass = "low" | "medium" | "high";
export type Level = RiskClass | "block";

export type Intent = {
  id: string;
  category: string;
  description: string;
  parameters: any; // JSON-schema-style
  capabilities: string[];
  riskClass: RiskClass;
  surfaces: string[];
  roles: string[];
  examples: string[];
  /** Optional. A prompt must contain at least one of these words before this intent may route. */
  anchors?: string[];
  version: number;
};

export type RegistryDoc = { version: number; intents: Intent[] };

export type UserRef = { id: string; role: string };

export type ApprovalRecord = {
  kind: "user-confirm" | "operator-review";
  at?: string;
  by?: string;
  confirmation?: string;
  decision?: string;
};

export type DecideInput = {
  prompt: string;
  user?: Partial<UserRef>;
  surface: string;
  context?: Record<string, unknown>;
  approvals?: ApprovalRecord[];
};

export type Candidate = { intent: string; score: number; span?: string };

export type RiskFlag = { layer: string; status: "warn" | "block"; kind: string; score?: number; evidence?: string[] };
export type Redaction = { kind: string; count: number };

export type Risk = {
  level: Level;
  flags: RiskFlag[];
  redactions: Redaction[];
  reason?: string;
  approvalsRequired?: { kind: string }[];
};

export type ToolStep = { capability: string; tool: string; input: Record<string, unknown> };

export type Clarification = {
  trigger: "low-band" | "tie" | "params" | "high-risk" | "reference";
  question: string;
  options: { label: string; intent: string }[];
};

export type ModelProfileRef = { id: string; provider: string; model: string };

export type ExecutionContract = {
  contractId: string;
  parentId?: string;
  traceId: string;
  intent: {
    primary: { id: string; version: number };
    parameters: Record<string, unknown>;
    references: Record<string, unknown>;
    confidence: number;
    alternates: Candidate[];
  };
  risk: { level: Exclude<Level, "block">; flags: RiskFlag[]; redactions: Redaction[]; approvals: ApprovalRecord[] };
  toolPlan: ToolStep[];
  modelProfile: ModelProfileRef;
  scope: { user: UserRef; surface: string; capabilities: string[]; deadline?: string; budget?: unknown };
  issuedAt: string;
  expiresAt: string;
  registryVersion: number;
  policyPackVersion: string;
  signature: string;
  signedBy: "scout";
};

export type Decision = {
  traceId: string;
  band: "high" | "medium" | "low" | "reject";
  candidates: Candidate[];
  intent: { id: string; confidence: number; parameters: Record<string, unknown> };
  plan?: Candidate[]; // multi-intent plan (primary + secondaries), each with a span
  risk: Risk;
  clarification?: Clarification;
  toolPlan: ToolStep[];
  executionContract?: ExecutionContract;
  redactedPrompt: string;
  stage2: "skipped" | "used";
  latencyMs: number;
};
