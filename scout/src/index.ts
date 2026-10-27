// Scout Intent: Sense -> Interpret -> Guard -> Route -> Recommend -> signed ExecutionContract.
// Implements engines/scout-intent/AGENTS.md. Scout decides, guards, routes and signs; it executes nothing.
import { IntentRegistry, type RegistrySource } from "./registry.js";
import { Stage1Scanner, bandOf, tokenize, DEFAULT_BANDS, DEFAULT_SCAN, type Bands, type ScanConfig } from "./scoring.js";
import { interpret } from "./interpret.js";
import { injectionCheck, loadPacks, packVersion, parameterPolicy, redactPII, RateLimiter, reduceRisk, scopeCheck } from "./guard.js";
import { CapabilityGraph, type ToolSpec } from "./graph.js";
import { ModelRouter } from "./models.js";
import { DEFAULT_TTL_MS, resolveSecret, signContract, ulid, verifyContract } from "./contract.js";
import type { Candidate, Clarification, Decision, DecideInput, ExecutionContract, Intent, RiskFlag, UserRef } from "./types.js";

export type ScoutOptions = {
  intentRegistry: RegistrySource;
  /** Named pack(s). The spec shows a string; the official runner passes an array. Both work. */
  policyPack?: string | string[];
  modelProfiles?: string;
  capabilityGraph?: ToolSpec[] | string;
  signingSecret?: string;
  bands?: Bands;
  scan?: Partial<ScanConfig>;
  ttlMs?: number;
  rateLimit?: { capacity: number; perMinute: number };
  scanBudgetMs?: number;
  onEvent?: (e: Record<string, unknown>) => void;
};

const HIGH_RISK_PROCEED = 0.95;
const TIE_WINDOW = 0.05;
const RECENCY_WINDOW_MS = 10 * 60 * 1000;

export class Scout {
  readonly registry: IntentRegistry;
  readonly events: Record<string, unknown>[] = [];
  private scanner: Stage1Scanner;
  private packs;
  private graph: CapabilityGraph;
  private models: ModelRouter;
  private limiter: RateLimiter;
  private secret: string;
  private bands: Bands;
  private ttl: number;
  private issued = new Map<string, { input: DecideInput; contract: ExecutionContract }>();
  private anchors = new Map<string, Set<string>>();
  private recent = new Map<string, Map<string, number>>(); // user -> intent -> last used (ms)

  constructor(private opts: ScoutOptions) {
    this.registry = IntentRegistry.load(opts.intentRegistry);
    this.scanner = new Stage1Scanner(this.registry, { ...DEFAULT_SCAN, ...opts.scan });
    this.packs = loadPacks(opts.policyPack);
    this.graph = new CapabilityGraph(opts.capabilityGraph);
    this.models = new ModelRouter(opts.modelProfiles);
    this.limiter = new RateLimiter(opts.rateLimit?.capacity, opts.rateLimit?.perMinute);
    this.secret = resolveSecret(opts.signingSecret);
    this.bands = opts.bands ?? DEFAULT_BANDS;
    this.ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    for (const i of this.registry.intents) if (i.anchors?.length) this.anchors.set(i.id, new Set(tokenize(i.anchors.join(" "))));
    this.selfTest(opts.scanBudgetMs ?? 16);
  }

  /** Startup self-test (spec 4.1): a full-registry scan must fit the latency budget, or we fail loudly. */
  private selfTest(budgetMs: number): void {
    const probes = this.registry.intents.flatMap((i) => i.examples).slice(0, 40);
    for (const p of probes) this.scanner.scan(p); // warm-up
    const t0 = performance.now();
    for (const p of probes) this.scanner.scan(p);
    const perScan = (performance.now() - t0) / Math.max(1, probes.length);
    if (perScan > budgetMs) throw new Error(`Scout self-test failed: full-registry scan ${perScan.toFixed(2)} ms > ${budgetMs} ms budget`);
  }

  private emit(e: Record<string, unknown>): void {
    this.events.push(e);
    if (this.events.length > 1000) this.events.shift();
    this.opts.onEvent?.(e);
  }

  /** Verify a contract this Scout issued (downstream engines call the equivalent). */
  verify(c: ExecutionContract, opts?: { now?: Date; capability?: string }) {
    return verifyContract(c, this.secret, opts);
  }

  // ------------------------------------------------------------------ Sense
  async classify(input: { prompt: string; surface: string }): Promise<{ candidates: Candidate[] }> {
    return { candidates: this.sense(input.prompt).slice(0, 5) };
  }

  /** Recency is per user and expires (RECENCY_WINDOW_MS), so decisions don't depend on unrelated sessions. */
  private recencyFor(userId: string): Map<string, number> {
    const now = Date.now();
    const out = new Map<string, number>();
    for (const [intent, at] of this.recent.get(userId) ?? []) if (now - at < RECENCY_WINDOW_MS) out.set(intent, 1);
    return out;
  }

  private sense(prompt: string, userId = "anonymous"): Candidate[] {
    return this.scanner.scan(prompt, this.recencyFor(userId));
  }

  /** Multi-intent (4.5): clause-level scan; secondaries must be High band, in a different clause. */
  private secondaries(prompt: string, primary: string, userId: string): Candidate[] {
    const clauses = prompt.split(/\s*(?:,|;|\band\b|\bthen\b|&)\s*/i).filter((c) => c.trim().length > 3);
    if (clauses.length < 2) return [];
    const out = new Map<string, Candidate>();
    for (const span of clauses) {
      const top = this.sense(span, userId)[0];
      if (top && top.intent !== "GENERAL" && top.score >= this.bands.high && top.intent !== primary && !out.has(top.intent))
        out.set(top.intent, { intent: top.intent, score: top.score, span });
    }
    return [...out.values()];
  }

  // ----------------------------------------------------------------- Decide
  async decide(input: DecideInput, lineage?: { parentId?: string; traceId?: string }): Promise<Decision> {
    const t0 = performance.now();
    const traceId = lineage?.traceId ?? ulid();
    const user: UserRef = { id: input.user?.id ?? "anonymous", role: input.user?.role ?? "user" };
    const { text: redactedPrompt, redactions } = redactPII(input.prompt);

    // 1. Sense
    const candidates = this.sense(redactedPrompt, user.id).slice(0, 5);
    const top = candidates[0];
    const band = top ? bandOf(top.score, this.bands) : "reject";
    // Anchor gate: an intent that declares anchors only routes when the prompt names its subject matter
    // (e.g. "answer", "marks"); otherwise it degrades to GENERAL, however well its verbs match.
    const need = top ? this.anchors.get(top.intent) : undefined;
    const anchored = !need || tokenize(redactedPrompt).some((t) => need.has(t));
    const reject = band === "reject" || !anchored;
    const general = this.registry.get("GENERAL")!;
    const intent: Intent = reject || !top ? general : this.registry.get(top.intent)!;
    const confidence = reject || !top ? top?.score ?? 0 : top.score;

    // 2. Interpret
    const interp = interpret(intent, redactedPrompt, input.context);
    const secondaries = reject ? [] : this.secondaries(redactedPrompt, intent.id, user.id);
    const planned = [intent, ...secondaries.map((s) => this.registry.get(s.intent)!)];

    // 3. Guard (five layers)
    const flags: RiskFlag[] = [
      // Untrusted text anywhere in the request (prompt AND string context such as a candidate answer) is guarded.
      ...injectionCheck(
        [input.prompt, ...Object.values(input.context ?? {}).filter((v): v is string => typeof v === "string")].join("\n"),
        this.packs,
        this.graph.knownTools(this.registry.intents),
      ),
      ...planned.flatMap((i) => scopeCheck(i, user, input.surface)),
    ];
    if (!this.limiter.take(`${user.id}:${intent.id}:${input.surface}`))
      flags.push({ layer: "rate-limit", status: "block", kind: "rate-limit", evidence: [intent.id] });
    const floorOrder = { low: 0, medium: 1, high: 2 } as const;
    const floor = planned.reduce((a, i) => (floorOrder[i.riskClass] > floorOrder[a] ? i.riskClass : a), "low" as Intent["riskClass"]);
    const risk = reduceRisk(flags, floor, redactions);
    const bad = parameterPolicy(intent, interp.parameters);
    if (bad.length && risk.level !== "block") {
      risk.flags.push({ layer: "policy", status: "block", kind: "parameter-bounds", evidence: bad });
      risk.level = "block";
      risk.reason = `policy:parameter-bounds (${bad.join("; ")})`;
    }

    const base = {
      traceId,
      band,
      candidates,
      redactedPrompt,
      stage2: "skipped" as const,
      intent: { id: intent.id, confidence, parameters: interp.parameters },
    };
    const finish = (d: Omit<Decision, "latencyMs" | "traceId" | "band" | "candidates" | "redactedPrompt" | "stage2" | "intent">): Decision => {
      const out: Decision = { ...base, ...d, latencyMs: Math.round((performance.now() - t0) * 100) / 100 };
      this.emit({
        event: "scout.decision", traceId, intent: intent.id, band, risk: out.risk.level,
        latencyMs: out.latencyMs, stage2: "skipped", clarification: out.clarification?.trigger,
      });
      return out;
    };

    if (risk.level === "block") return finish({ risk, toolPlan: [] }); // refuse at the boundary: no contract

    // 4. Clarification triggers (4.6), checked in spec order
    let clarification: Clarification | undefined;
    const options = candidates.filter((c) => c.intent !== "GENERAL").slice(0, 4).map((c) => ({ label: this.registry.get(c.intent)!.description, intent: c.intent }));
    const approved = (input.approvals ?? []).some((a) => a.kind === "user-confirm" && /^(y|yes|confirm)/i.test(a.confirmation ?? "") );
    // Falling back to GENERAL is the safe outcome, so a GENERAL winner never needs a clarifying question.
    if (intent.id === "GENERAL") clarification = undefined;
    else if (band === "low") clarification = { trigger: "low-band", question: "I'm not sure what you want to do. Which of these is closest?", options };
    else if (band === "medium" && candidates[1] && top.score - candidates[1].score < TIE_WINDOW)
      clarification = { trigger: "tie", question: "Did you mean one of these?", options };
    else if (interp.missing.length || interp.invalid.length)
      clarification = { trigger: "params", question: `I need ${[...interp.missing, ...interp.invalid].join(", ")} to continue.`, options: [] };
    else if (interp.unresolvedReference)
      clarification = { trigger: "reference", question: "I can't tell which earlier item you mean. Could you spell it out?", options };
    else if (intent.riskClass === "high" && confidence < HIGH_RISK_PROCEED && !approved)
      clarification = { trigger: "high-risk", question: `This is a high-risk action (${intent.id}). Please confirm.`, options: [{ label: "Yes, proceed", intent: intent.id }] };
    if (clarification) this.emit({ event: "scout.clarification", traceId, trigger: clarification.trigger });

    // Only the approval-pending case issues a contract: it carries unmet approvals, so executors refuse it.
    // Every other clarification means "no decision yet", so nothing executable is issued.
    if (clarification && clarification.trigger !== "high-risk") return finish({ risk, clarification, toolPlan: [] });

    // 5. Route (capability graph)
    const caps = [...new Set(planned.flatMap((i) => i.capabilities))];
    const { steps, missing } = this.graph.plan(caps, interp.parameters, user, input.surface);
    if (missing.length) {
      risk.flags.push({ layer: "route", status: "warn", kind: "capability-unresolved", evidence: missing });
      return finish({ risk: { ...risk, level: "block", reason: `route:unresolved-capability (${missing.join(", ")})` }, toolPlan: [] });
    }

    // 6. Recommend: model profile + signed contract
    const level = risk.level as Exclude<typeof risk.level, "block">;
    const now = Date.now();
    const contract = signContract(
      {
        contractId: ulid(),
        parentId: lineage?.parentId,
        traceId,
        intent: {
          primary: { id: intent.id, version: intent.version },
          parameters: interp.parameters,
          references: interp.references,
          confidence,
          alternates: [...secondaries, ...candidates.filter((c) => c.intent !== intent.id && !secondaries.some((s) => s.intent === c.intent))].slice(0, 4),
        },
        risk: { level, flags: risk.flags, redactions, approvals: (input.approvals ?? []) as ExecutionContract["risk"]["approvals"] },
        toolPlan: steps,
        modelProfile: this.models.pick(redactions.length ? "restricted" : "public"),
        scope: { user, surface: input.surface, capabilities: caps },
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.ttl).toISOString(),
        registryVersion: this.registry.version,
        policyPackVersion: packVersion(this.packs),
      },
      this.secret,
    );
    this.issued.set(contract.contractId, { input, contract });
    if (this.issued.size > 500) this.issued.delete(this.issued.keys().next().value!);
    const mine = this.recent.get(user.id) ?? new Map<string, number>();
    mine.set(intent.id, Date.now());
    this.recent.set(user.id, mine);
    this.emit({ event: "contract.issued", traceId, contractId: contract.contractId, intent: intent.id, risk: level, profile: contract.modelProfile.id });

    return finish({
      risk: { ...risk, approvalsRequired: level === "high" && !approved ? [{ kind: "user-confirm" }] : undefined },
      plan: secondaries.length ? [{ intent: intent.id, score: confidence }, ...secondaries] : undefined,
      clarification,
      toolPlan: steps,
      executionContract: contract,
    });
  }

  /** Re-planning with lineage (section 8.3): same trace, new contract, parentId = the original. */
  async replan(input: { parent: string; reason: string; state?: unknown }): Promise<Decision> {
    const prior = this.issued.get(input.parent);
    if (!prior) throw new Error(`replan: unknown parent contract ${input.parent}`);
    const tool = input.reason.match(/tool\.([\w.]+)/)?.[1];
    if (tool) this.graph.markUnavailable(tool);
    this.emit({ event: "scout.replan", traceId: prior.contract.traceId, parent: input.parent, reason: tool ? "tool-unavailable" : "other" });
    return this.decide(prior.input, { parentId: input.parent, traceId: prior.contract.traceId });
  }

  /** Guard stack only (used by examples in the official repo). */
  async guard(input: DecideInput) {
    return (await this.decide(input)).risk;
  }
}

export { IntentRegistry } from "./registry.js";
export { verifyContract, canonicalJson } from "./contract.js";
export type * from "./types.js";
