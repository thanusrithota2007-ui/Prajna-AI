// Interpret stage: bind parameters/references, decide whether clarification is needed
// (AGENTS.md section 5). Interpret never mutates scores.
import type { Intent } from "./types.js";

export type Interpretation = {
  parameters: Record<string, unknown>;
  references: Record<string, unknown>;
  missing: string[]; // required parameters that could not be bound
  invalid: string[]; // bound but out of schema range
  unresolvedReference: boolean;
};

const BACK_REFERENCE = /\b(we (talked|discussed|spoke) about|as (we )?discussed|like last time|the usual|same as before)\b/i;

function numberFrom(prompt: string, name: string, schema: any): number | undefined {
  if (/count|limit|^n$|top/i.test(name)) {
    const m = prompt.match(/(?<![$\d.])(\d{1,3})(?![\d.]*\s*(?:k\b|m\b|%|months?|weeks?|days?|years?))/i);
    if (m) return Number(m[1]);
  }
  if (/min|max|value|amount|price/i.test(name)) {
    const m = prompt.match(/\$\s*(\d+(?:\.\d+)?)\s*([km])?|\b(\d+(?:\.\d+)?)\s*([km])\b/i);
    if (m) {
      const n = Number(m[1] ?? m[3]);
      const suffix = (m[2] ?? m[4] ?? "").toLowerCase();
      return suffix === "k" ? n * 1e3 : suffix === "m" ? n * 1e6 : n;
    }
  }
  void schema;
  return undefined;
}

export function interpret(intent: Intent, prompt: string, context: Record<string, unknown> = {}): Interpretation {
  const props: Record<string, any> = intent.parameters?.properties ?? {};
  const parameters: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(props)) {
    if (context[name] !== undefined) {
      parameters[name] = context[name]; // explicit context wins (e.g. an evaluationId the caller holds)
      continue;
    }
    if (Array.isArray(schema.enum)) {
      const hit = schema.enum.find((v: string) => new RegExp(`\\b${v}\\b`, "i").test(prompt));
      if (hit !== undefined) parameters[name] = hit;
    } else if (schema.type === "integer" || schema.type === "number") {
      const n = numberFrom(prompt, name, schema);
      if (n !== undefined) parameters[name] = schema.type === "integer" ? Math.trunc(n) : n;
    }
  }
  const required: string[] = intent.parameters?.required ?? [];
  const missing = required.filter((r) => parameters[r] === undefined);
  const invalid: string[] = [];
  for (const [k, v] of Object.entries(parameters)) {
    const s = props[k];
    if (typeof v === "number" && s) {
      if (s.minimum !== undefined && v < s.minimum) invalid.push(k);
      if (s.maximum !== undefined && v > s.maximum) invalid.push(k);
    }
  }
  const hasContext = Object.keys(context).length > 0;
  return { parameters, references: {}, missing, invalid, unresolvedReference: BACK_REFERENCE.test(prompt) && !hasContext };
}
