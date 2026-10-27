// Guard stage: five independent layers (AGENTS.md section 6, docs/risk-and-policy.md).
import type { Intent, Level, Redaction, Risk, RiskFlag, UserRef } from "./types.js";

// ---------------------------------------------------------------- policy packs
type Rule = { id: string; kind: "pattern" | "role-drift" | "tool-ref"; re: RegExp; status: "warn" | "block" };
type Pack = { name: string; version: number; rules: Rule[]; toolRefCheck?: boolean };

const PACKS: Record<string, Pack> = {
  default: {
    name: "default",
    version: 1,
    rules: [
      {
        // "ignore (all) previous instructions", "disregard the rules above": needs the instruction noun right after
        // the qualifier, so ordinary prose such as "do not ignore previous reforms" does not trip it.
        id: "instruction-override",
        kind: "pattern",
        status: "block",
        re: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)*(?:(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|context)|(?:instructions?|rules?|guidelines?|polic(?:y|ies))\s+(?:above|before|given to you|so far))\b/i,
      },
      { id: "pretend-away", kind: "pattern", status: "block", re: /\bpretend\b[^.\n]{0,40}\b(?:instructions?|rules?|guidelines?)\b[^.\n]{0,20}\b(?:never existed|do(?:es)? not exist|were never)\b/i },
      { id: "forced-output", kind: "pattern", status: "block", re: /\bfrom now on,?\s+(?:respond|answer|reply|output)\s+(?:only\s+)?with\b/i },
      { id: "wipe-context", kind: "pattern", status: "block", re: /\b(?:ignore|disregard|forget)\s+(?:everything|all)\s+(?:above|you (?:were|have been) told|so far|before)\b/i },
      { id: "disregard-user", kind: "pattern", status: "block", re: /\bdisregard (the )?user\b/i },
      {
        id: "role-markers",
        kind: "pattern",
        status: "block",
        re: /<\/?(s|user|system|assistant)>|\[\/?INST\]|<\|[a-z_]+\|>|^\s*(system|assistant)\s*:|\b(?:system|assistant)\s*:\s*you\b/im,
      },
      { id: "role-drift", kind: "role-drift", status: "block", re: /\b(you are now|pretend (to be|you are)|act as if you (are|were)|from now on,? you)\b/i },
      { id: "control-chars", kind: "pattern", status: "block", re: /[\u202A-\u202E\u2066-\u2069]|\\u202[A-Ea-e]|\\u206[6-9]/ },
    ],
  },
  "adversarial-tight": {
    name: "adversarial-tight",
    version: 1,
    toolRefCheck: true,
    rules: [
      {
        id: "secret-exfiltration",
        kind: "pattern",
        status: "block",
        re: /\b(reveal|show|print|dump|leak|exfiltrate)\b[^.\n]{0,30}\b(api keys?|credentials?|secrets?|passwords?|tokens?|(?:system|hidden|initial|original) (?:prompt|instructions?))\b/i,
      },
      { id: "privilege-escalation", kind: "pattern", status: "block", re: /\bgrant\b[^.\n]{0,15}\b(admin|root|superuser|privileges?)\b/i },
      { id: "unrestricted-mode", kind: "pattern", status: "block", re: /\b(unrestricted|jailbreak|developer|DAN) mode\b/i },
      { id: "destructive-sql", kind: "pattern", status: "block", re: /\bdrop\s+(the\s+)?\w+\s+table\b/i },
    ],
  },
};

export function loadPacks(names: string | string[] | undefined): Pack[] {
  const list = names === undefined ? ["default"] : Array.isArray(names) ? names : [names];
  return list.map((n) => {
    const p = PACKS[n];
    if (!p) throw new Error(`Unknown policy pack "${n}". Known packs: ${Object.keys(PACKS).join(", ")}`);
    return p;
  });
}

export const packVersion = (packs: Pack[]) => packs.map((p) => `${p.name}@${p.version}`).join("+");

// ----------------------------------------------------------- layer 1: injection
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };
/** Undo trivial character substitutions ("1gn0re" -> "ignore") so patterns see the intended words. */
const deLeet = (t: string) => t.replace(/[013457@$]/g, (c) => LEET[c]);

export function injectionCheck(prompt: string, packs: Pack[], knownTools: Set<string>): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const variants = [prompt, deLeet(prompt)];
  for (const pack of packs) {
    for (const r of pack.rules) {
      if (variants.some((v) => r.re.test(v))) {
        // Metadata only: the payload itself is never recorded (spec default).
        flags.push({ layer: "injection", status: r.status, kind: r.kind, score: 1, evidence: [r.id] });
      }
    }
    if (pack.toolRefCheck) {
      // Out-of-band tool references: snake_case identifiers that are not reachable tools.
      for (const m of prompt.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/g)) {
        if (!knownTools.has(m[0])) {
          flags.push({ layer: "injection", status: "block", kind: "tool-ref", score: 0.9, evidence: ["out-of-band-tool"] });
          break;
        }
      }
    }
  }
  return flags;
}

// ------------------------------------------------------ layer 2+3: policy + scope
export function scopeCheck(intent: Intent, user: UserRef, surface: string): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (!intent.surfaces.includes(surface) && !intent.surfaces.includes("*"))
    flags.push({ layer: "scope", status: "block", kind: "surface", evidence: [`${intent.id}@${surface}`] });
  if (!intent.roles.includes("*") && !intent.roles.includes(user.role))
    flags.push({ layer: "policy", status: "block", kind: "role", evidence: [`${intent.id}:${user.role}`] });
  return flags;
}

export function parameterPolicy(intent: Intent, params: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const props = intent.parameters?.properties ?? {};
  for (const [k, v] of Object.entries(params)) {
    const s = props[k];
    if (typeof v === "number" && s) {
      if (s.minimum !== undefined && v < s.minimum) bad.push(`${k} below ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) bad.push(`${k} above ${s.maximum}`);
    }
  }
  return bad;
}

// ------------------------------------------------------------- layer 4: PII
const PII: { kind: string; re: RegExp; mask: string }[] = [
  { kind: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, mask: "[email]" },
  { kind: "credit-card", re: /\b(?:\d[ -]?){13,16}\b/g, mask: "[card]" },
  { kind: "credential", re: /\b(?:sk|pk|rk|ghp|xox[bp])[-_][A-Za-z0-9_-]{16,}\b/g, mask: "[credential]" },
  { kind: "phone", re: /\+\d[\d\s().-]{8,14}\d/g, mask: "[phone]" },
];

export function redactPII(prompt: string): { text: string; redactions: Redaction[] } {
  let text = prompt;
  const redactions: Redaction[] = [];
  for (const p of PII) {
    const hits = text.match(p.re);
    if (hits) {
      redactions.push({ kind: p.kind, count: hits.length });
      text = text.replace(p.re, p.mask);
    }
  }
  return { text, redactions };
}

// ----------------------------------------------------------- layer 5: rate limit
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity = 30, private perMinute = 30) {}
  /** True when the call is allowed. Token bucket per user/intent/surface. */
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 60000) * this.perMinute);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }
}

// ------------------------------------------------------------------ composition
const ORDER: Level[] = ["low", "medium", "high"];
export function reduceRisk(flags: RiskFlag[], floor: Intent["riskClass"], redactions: Redaction[]): Risk {
  const block = flags.find((f) => f.status === "block");
  if (block) {
    return { level: "block", flags, redactions, reason: `${block.layer}:${block.kind}${block.evidence?.[0] ? ` (${block.evidence[0]})` : ""}` };
  }
  let idx = ORDER.indexOf(floor);
  if (flags.some((f) => f.status === "warn")) idx = Math.min(idx + 1, 2); // warn lifts one band
  const level = ORDER[idx] as Risk["level"];
  return { level, flags, redactions, approvalsRequired: level === "high" ? [{ kind: "user-confirm" }] : undefined };
}
