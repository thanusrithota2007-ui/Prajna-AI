// Intent registry: load, compose, validate, version (AGENTS.md section 3).
import { readFileSync } from "node:fs";
import type { Intent, RegistryDoc } from "./types.js";

export type RegistrySource = string | RegistryDoc | IntentRegistry | RegistrySource[];

const ID_RE = /^(GENERAL|[a-z][a-z0-9]*\.[a-z][a-z0-9-]*)$/;

export class IntentRegistry {
  readonly intents: Intent[];
  readonly version: number;
  private byId: Map<string, Intent>;

  constructor(intents: Intent[], version: number) {
    this.intents = intents;
    this.version = version;
    this.byId = new Map(intents.map((i) => [i.id, i]));
    this.validate();
  }

  static load(src: RegistrySource): IntentRegistry {
    if (src instanceof IntentRegistry) return src;
    if (Array.isArray(src)) {
      const parts = src.map((s) => IntentRegistry.load(s));
      return new IntentRegistry(parts.flatMap((p) => p.intents), Math.max(...parts.map((p) => p.version)));
    }
    const doc: RegistryDoc = typeof src === "string" ? JSON.parse(readFileSync(src, "utf-8")) : src;
    return new IntentRegistry(doc.intents, doc.version ?? 1);
  }

  get(id: string): Intent | undefined {
    return this.byId.get(id);
  }

  private validate(): void {
    const seen = new Set<string>();
    for (const i of this.intents) {
      if (!ID_RE.test(i.id)) throw new Error(`Registry: bad intent id "${i.id}" (category.name grammar)`);
      if (seen.has(i.id)) throw new Error(`Registry: duplicate intent id "${i.id}"`);
      seen.add(i.id);
      if (!i.examples?.length) throw new Error(`Registry: intent "${i.id}" has no examples (mandatory)`);
      if (!i.capabilities || !i.surfaces || !i.roles) throw new Error(`Registry: intent "${i.id}" is incomplete`);
    }
    if (!seen.has("GENERAL")) throw new Error('Registry: the safe fallback intent "GENERAL" is required');
  }
}
