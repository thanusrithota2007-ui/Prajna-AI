// Recommend stage: model profile routing with data-class clearance (docs/model-routing.md).
import { readFileSync } from "node:fs";
import type { ModelProfileRef } from "./types.js";

type Profile = {
  id: string;
  provider: string;
  model: string;
  cost?: { in: number; out: number };
  latency?: { p95Ms: number };
  dataClasses?: string[];
};

const DEFAULT_PROFILE: ModelProfileRef = { id: "unconfigured", provider: "none", model: "unspecified" };

export class ModelRouter {
  private profiles: Profile[];
  constructor(file?: string) {
    this.profiles = file ? (JSON.parse(readFileSync(file, "utf-8")).profiles ?? []) : [];
  }

  /** Data class "restricted" (PII was redacted) must stay on a profile cleared for it. */
  pick(dataClass: "public" | "restricted"): ModelProfileRef {
    const cleared = this.profiles.filter((p) => (p.dataClasses ?? ["public"]).includes(dataClass));
    cleared.sort(
      (a, b) =>
        (a.cost?.in ?? 0) + (a.cost?.out ?? 0) - ((b.cost?.in ?? 0) + (b.cost?.out ?? 0)) ||
        (a.latency?.p95Ms ?? 0) - (b.latency?.p95Ms ?? 0),
    );
    const p = cleared[0];
    return p ? { id: p.id, provider: p.provider, model: p.model } : DEFAULT_PROFILE;
  }
}
