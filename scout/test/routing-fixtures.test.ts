// Routing safety invariants over three phrasing sets (test/fixtures/sealed-*.json).
// sealed-1 was used for development, sealed-2 was consumed during tuning, sealed-3 was run once untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Scout } from "../src/index.ts";

const dir = (f: string) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const load = (n: number) => JSON.parse(readFileSync(dir(`sealed-${n}.json`), "utf-8")) as { valid: { intent: string; prompt: string }[]; offtopic: string[] };
const s = new Scout({ intentRegistry: fileURLToPath(new URL("../registry/upsc.json", import.meta.url)), policyPack: ["default", "adversarial-tight"], signingSecret: "t" });
let n = 0;
const route = async (prompt: string) =>
  (await s.decide({ prompt, context: { evaluationId: "ev1" }, user: { id: `f${n++}`, role: "student" }, surface: "api" })).executionContract?.intent.primary.id;

for (const k of [1, 2, 3]) {
  test(`sealed-${k}: a valid prompt is never routed to the WRONG upsc workflow`, async () => {
    for (const v of load(k).valid) {
      const got = await route(v.prompt);
      assert.ok(got === v.intent || !String(got).startsWith("upsc."), `${v.prompt} -> ${got}`);
    }
  });
}

for (const k of [1, 3]) {
  test(`sealed-${k}: off-topic prompts never reach an upsc workflow`, async () => {
    for (const p of load(k).offtopic) assert.ok(!String(await route(p)).startsWith("upsc."), p);
  });
}

test("sealed-2: off-topic prompts never reach an upsc workflow", async () => {
  for (const p of load(2).offtopic) assert.ok(!String(await route(p)).startsWith("upsc."), p);
});

test("a single matching word is not enough to route ('Calculate 15% of 2400')", async () => {
  assert.ok(!String(await route("Calculate 15% of 2400")).startsWith("upsc."));
});
