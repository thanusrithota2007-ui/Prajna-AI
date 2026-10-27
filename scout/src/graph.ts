// Route stage: capability graph -> ordered tool plan (AGENTS.md section 7).
import { readFileSync } from "node:fs";
import type { Intent, ToolStep, UserRef } from "./types.js";

export type ToolSpec = {
  id: string;
  capability: string;
  local?: boolean;
  available?: boolean;
  roles?: string[];
  surfaces?: string[];
  costUsd?: number;
  latencyMs?: number;
};

export class CapabilityGraph {
  private tools: ToolSpec[] | null; // null => permissive identity graph (capability id == tool id)
  private down = new Set<string>();

  constructor(tools?: ToolSpec[] | string | { tools: ToolSpec[] }) {
    if (tools === undefined) this.tools = null;
    else if (typeof tools === "string") this.tools = (JSON.parse(readFileSync(tools, "utf-8")).tools ?? []) as ToolSpec[];
    else this.tools = Array.isArray(tools) ? tools : tools.tools;
  }

  markUnavailable(toolId: string): void {
    this.down.add(toolId);
  }

  /** Ids a prompt may legitimately reference (used by the out-of-band tool-ref check). */
  knownTools(intents: Intent[]): Set<string> {
    const s = new Set<string>();
    for (const i of intents) i.capabilities.forEach((c) => s.add(c));
    this.tools?.forEach((t) => (s.add(t.id), s.add(t.capability)));
    return s;
  }

  private resolve(capability: string, user: UserRef, surface: string): ToolSpec | undefined {
    if (this.tools === null) return { id: capability, capability, local: true };
    const ok = this.tools
      .filter((t) => t.capability === capability)
      .filter((t) => !t.roles || t.roles.includes("*") || t.roles.includes(user.role)) // 1. permissions
      .filter((t) => t.available !== false && !this.down.has(t.id)) // 2. availability
      .filter((t) => !t.surfaces || t.surfaces.includes(surface)); // 3. surface
    ok.sort(
      (a, b) =>
        (a.costUsd ?? 0) - (b.costUsd ?? 0) || // 4. cost, then latency
        (a.latencyMs ?? 0) - (b.latencyMs ?? 0) ||
        Number(b.local ?? false) - Number(a.local ?? false), // 5. tie-break: local first
    );
    return ok[0];
  }

  plan(capabilities: string[], params: Record<string, unknown>, user: UserRef, surface: string) {
    const steps: ToolStep[] = [];
    const missing: string[] = [];
    for (const c of capabilities) {
      const t = this.resolve(c, user, surface);
      if (t) steps.push({ capability: c, tool: t.id, input: params });
      else missing.push(c); // never silently substitute an out-of-scope tool
    }
    return { steps, missing };
  }
}
